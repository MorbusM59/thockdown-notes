package com.thockdown.soundscapes;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import androidx.javascriptengine.JavaScriptIsolate;
import java.util.concurrent.ConcurrentLinkedQueue;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Renders the music in the app's own process, ahead of playback, into its
 * lane of the app's output (OutputLane, AudioOutput), as SoundscapeRenderer
 * does the soundscape: the shared renderer (apps/soundscapes/src/musicSandbox.ts,
 * built into assets/music-renderer.js) in a JavaScriptSandbox isolate, on a
 * thread that waits for something to do rather than polling.
 *
 * It also DECODES (SongDecoder): the songs, one after another, are handed to
 * the isolate as they are needed, kept DECODE_AHEAD_SEC ahead of the
 * output's playhead, which is more than the renderer's lead, so the renderer
 * never waits on the decoder in ordinary play. When a song is decoded to its
 * end the next is picked IN THE ISOLATE, from the library the page keeps
 * (apps/soundscapes/src/musicLibrary.ts: the page's catalog, given here by
 * `setCatalog`, and the rotation, which only this renderer moves and the
 * listener stores, `onRotation`), by the desktop's own rules
 * (packages/visualizer/shared/musicPool.ts). When the pool has nothing, the
 * stream ends and the renderer plays out the room's tail.
 *
 * A SKIP or a SEEK cuts the stream at a splice a margin past the playhead
 * (MusicSettings.cut): the old song is heard up to it, then the new audio,
 * across the renderer's short crossfade.
 *
 * What is heard at the playhead (the song and the time in it) is reported to
 * the listener as it changes, for the page, the notification and the
 * visualizer; and, while the visualizer asks for it (`setSpectrum`), the
 * spectrum of what is rendered, computed by the renderer
 * (packages/visualizer/visualizer/spectrumFrames.ts), stamped with output
 * frames.
 */
final class MusicRenderer {
    interface Listener {
        /** What is heard now: a song and how far into it, in seconds (null for nothing), at the output's playhead `frame`. */
        void onHeard(Integer songId, double seconds, long frame);

        /** Spectrum frames for the visualizer, while it is on (`setSpectrum`): musicSandbox.ts's batches, as a JSON array. */
        void onSpectrum(String batchesJson);

        /** The rotation moved (a song played or was chosen): store it, to give back as `rotationJson` next time. */
        void onRotation(String rotationJson);

        /** The pool in queue order changed: musicSandbox.ts's musicQueueJson, from the song playing. */
        void onQueue(String queueJson);

        /** A catalog edit made here (`editCatalog`) produced this catalog: store it and tell the page. */
        void onCatalogEdited(String catalogJson);

        void onFailure(String message);
    }

    static final class Song {
        final int id;
        final Uri uri;

        Song(int id, Uri uri) {
            this.id = id;
            this.uri = uri;
        }
    }

    private static final int MAX_CHUNKS_PER_STEP = 12;
    private static final double SPLICE_SLACK_SEC = 0.05;
    /** More than the renderer's lead (renderAhead.ts's RENDER_LEAD_SEC, 10 s). */
    private static final double DECODE_AHEAD_SEC = 14;
    /** How much decoded audio is handed to the sandbox at once (decodeBatch). */
    private static final double DECODE_BATCH_SEC = 0.5;
    /** Empty dequeues in a row (each waits up to SongDecoder's TIMEOUT_US) before a batch goes with what it has. */
    private static final int MAX_IDLE_DEQUEUES = 5;

    private final Context context;
    private final OutputLane output;
    private final String rotationJson;
    private final Listener listener;
    private final Thread thread;
    private final Object signal = new Object();
    /** Commands not yet applied, in order: each runs on the renderer's thread with the isolate. */
    private final ConcurrentLinkedQueue<Command> pending = new ConcurrentLinkedQueue<>();
    private volatile boolean running = true;
    private boolean woken = false;

    // The renderer's thread only.
    private JavaScriptIsolate isolate;
    private String stage = null;
    private SongDecoder decoder = null;
    private Song decoding = null;
    /** Every song started, by id: a seek goes back into the one heard, which the decoder may already have left. */
    private final java.util.Map<Integer, Uri> uris = new java.util.HashMap<>();
    /** The decoder has produced audio for the current song yet: its cue is placed then, at the rate it reports. */
    private boolean cued = false;
    private long cueOffsetFrames = 0;
    private boolean ended = false;
    private Integer heardId = null;
    private long heardSecond = -1;
    /**
     * The song a step (skip, jump, choose) last started, until it is heard:
     * rendering runs seconds ahead of the ear, so a second press soon after
     * a first steps on from the song it started rather than from the one
     * still heard, which would start the same song again.
     */
    private Integer steppedId = null;

    private interface Command {
        void run() throws Exception;
    }

    MusicRenderer(Context context, OutputLane output, String catalogJson, String rotationJson, Listener listener) {
        this.context = context.getApplicationContext();
        this.output = output;
        this.rotationJson = rotationJson;
        setCatalog(catalogJson);
        this.listener = listener;
        thread = new Thread(this::run, "MusicRenderer");
        thread.start();
    }

    /** The page's catalog (musicLibrary.ts's MusicCatalog as JSON), whenever it changes. */
    void setCatalog(String catalogJson) {
        post(() -> {
            isolate.evaluateJavaScriptAsync("musicCatalog(" + JSONObject.quote(catalogJson) + ")").get();
            queued();
        });
    }

    /**
     * A change to the listener's choice made away from the page (musicSandbox.ts's
     * musicEditCatalog: `{ "set": id }` or `{ "filter": query }`), by the page's own rules.
     */
    void editCatalog(String editJson) {
        post(() -> {
            listener.onCatalogEdited(isolate.evaluateJavaScriptAsync("musicEditCatalog(" + JSONObject.quote(editJson) + ")").get());
            queued();
        });
    }

    /**
     * The song set the schedule plays (null for none: the catalog's own
     * sets); `skip` moves on to it at once rather than at the song's end.
     */
    void setPoolSet(Integer setId, boolean skip) {
        post(() -> {
            isolate.evaluateJavaScriptAsync("musicPoolSet(" + (setId == null ? -1 : setId) + ")").get();
            queued();
            if (!skip || stage == null) return;
            settle();
            configure(true);
            startSong(next(heardId), 0);
        });
    }

    /** The soundstage (MusicStage as JSON); the first one starts playback with the pool's first pick. */
    void setStage(String stageJson) {
        post(() -> {
            if (stageJson.equals(stage)) return;
            boolean first = stage == null;
            stage = stageJson;
            settle();
            configure(false);
            if (first) startSong(next(null), 0);
        });
    }

    /**
     * Play was pressed while a renderer exists: if its stream has ended (the
     * last song ran out with nothing after it), the pool's next pick starts,
     * or the music stops saying why; otherwise nothing changes.
     */
    void resume() {
        post(() -> {
            if (stage == null || decoding != null) return;
            settle();
            configure(true);
            startSong(next(heardId), 0);
        });
    }

    /** The visualizer's spectrum in `bands` log bands, or none (0). */
    void setSpectrum(int bands) {
        post(() -> {
            if (stage != null) settle();
            isolate.evaluateJavaScriptAsync("musicSpectrum(" + bands + ")").get();
        });
    }

    /** Leave the song playing for the pool's next pick. */
    void skip() {
        post(() -> {
            if (stage == null) return;
            settle();
            configure(true);
            stepTo(next(current()));
        });
    }

    /** PREVIOUS (-1), through the history of what played, or NEXT (1) from the song playing (musicPool.ts), now. */
    void jump(int direction) {
        post(() -> {
            if (stage == null) return;
            settle();
            Integer from = current();
            Song song = songFrom(isolate.evaluateJavaScriptAsync("musicJump(" + (from == null ? -1 : from) + ", " + direction + ")").get());
            rotated();
            if (song == null) return;
            configure(true);
            stepTo(song);
        });
    }

    /** Play `songId`, chosen from the list, now: it goes to the queue's head and the song left back in (musicPool.ts's choose). */
    void choose(int songId) {
        post(() -> {
            if (stage == null) return;
            settle();
            configure(true);
            Integer from = current();
            stepTo(songFrom(isolate.evaluateJavaScriptAsync("musicChoose(" + songId + ", " + (from == null ? -1 : from) + ")").get()));
            rotated();
        });
    }

    /** Go to `seconds` into the song heard now. */
    void seek(double seconds) {
        post(() -> {
            if (stage == null || heardId == null) return;
            settle();
            configure(true);
            startSong(new Song(heardId, uris.get(heardId)), seconds);
        });
    }

    /** The song a step starts from: the one a step last started until it is heard, else the one heard. */
    private Integer current() {
        return steppedId != null ? steppedId : heardId;
    }

    /** Start `song` from its beginning as a step's choice (`steppedId`). */
    private void stepTo(Song song) throws Exception {
        startSong(song, 0);
        steppedId = decoding == null ? null : decoding.id;
    }

    /** The pool's pick after `previousId` (null at the start), counting it as played. */
    private Song next(Integer previousId) throws Exception {
        Song song = songFrom(isolate.evaluateJavaScriptAsync("musicNext(" + (previousId == null ? -1 : previousId) + ")").get());
        rotated();
        return song;
    }

    private Song songFrom(String json) throws Exception {
        if (json == null || json.equals("null")) return null;
        JSONObject song = new JSONObject(json);
        return new Song(song.getInt("id"), Uri.parse(song.getString("uri")));
    }

    private void rotated() throws Exception {
        listener.onRotation(isolate.evaluateJavaScriptAsync("musicRotationJson()").get());
        queued();
    }

    /** How many songs of the queue a media session is shown (Android Auto's Up next). */
    private static final int QUEUE_LIMIT = 30;

    private void queued() throws Exception {
        listener.onQueue(isolate.evaluateJavaScriptAsync("musicQueueJson(" + QUEUE_LIMIT + ")").get());
    }

    /** Called by the output as it plays. */
    void wake() {
        synchronized (signal) {
            woken = true;
            signal.notifyAll();
        }
    }

    void close() {
        running = false;
        wake();
        if (Thread.currentThread() == thread) return;
        try {
            thread.join(1000);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private void post(Command command) {
        pending.add(command);
        wake();
    }

    /** Tell the renderer where the playhead is, so a splice is measured from now. */
    private void settle() throws Exception {
        long played = output.playheadFrame();
        handle(isolate.evaluateJavaScriptAsync("musicStep(" + played + ", 0, " + (output.committedSec() + SPLICE_SLACK_SEC) + ", " + output.heardFrame() + ")").get(), played);
    }

    private void configure(boolean cut) throws Exception {
        String settings = "{\"stage\":" + stage + (cut ? ",\"cut\":true}" : "}");
        isolate.evaluateJavaScriptAsync("musicConfigure(" + JSONObject.quote(settings) + ")").get();
    }

    /** At most this many songs in a row that cannot be decoded are passed over before the stream ends. */
    private static final int MAX_UNPLAYABLE = 8;

    /**
     * Start `song` at `seconds`, passing over songs that cannot be opened.
     * When nothing is left: a start that was ASKED for (play, a step, a seek)
     * stops the music, saying why; a song's natural end leaves the stream to
     * end (`musicEnd`), so the tail already rendered still plays out.
     */
    private void startSong(Song song, double seconds) throws Exception {
        startSong(song, seconds, true);
    }

    private void startSong(Song song, double seconds, boolean asked) throws Exception {
        closeDecoder();
        cued = false;
        ended = false;
        Exception unplayable = null;
        int passedOver = 0;
        for (; song != null && passedOver < MAX_UNPLAYABLE; passedOver += 1) {
            decoding = song;
            uris.put(song.id, song.uri);
            try {
                decoder = new SongDecoder(context, song.uri, (long) (seconds * 1_000_000));
                cueOffsetFrames = Math.round(seconds * output.sampleRate);
                return;
            } catch (Exception error) {
                // A song that cannot be decoded is passed over, as if it had played.
                closeDecoder();
                unplayable = error;
                song = next(song.id);
                seconds = 0;
            }
        }
        decoding = null;
        if (!asked) return;
        // Nothing left to play. Rendering on would play silence with the
        // clock of the last song heard running on past its end (a playing
        // lane, a peak of 0), so the music stops, saying why.
        throw new NothingToPlay(unplayable == null
            ? "Nothing to play: no song in the pool (no active set, or a filter nothing matches)"
            : "Nothing to play: " + passedOver + " songs in a row could not be opened, the last with " + unplayable);
    }

    /** The music has nothing it can play; the renderer stops and the session reports it (MusicSession's onFailure). */
    private static final class NothingToPlay extends Exception {
        NothingToPlay(String message) {
            super(message);
        }
    }

    private void closeDecoder() {
        if (decoder != null) decoder.close();
        decoder = null;
    }

    /**
     * Decoded audio gathered to at least DECODE_BATCH_SEC, unless the song
     * ends or the decoder keeps having nothing ready. A decoder hands over
     * one codec buffer at a time (an MP3 frame is 26 ms), and every hand-over
     * to the sandbox is a round trip between processes: one per buffer cost
     * more than the audio lasted, so the decoding fell behind the playhead
     * after the first chunks and the music played nothing, its playhead
     * running on through the silence.
     */
    private short[] decodeBatch() {
        long target = Math.round(DECODE_BATCH_SEC * decoder.sampleRate()) * 2;
        java.util.List<short[]> parts = new java.util.ArrayList<>();
        int total = 0;
        int idle = 0;
        while (total < target && !decoder.finished() && idle < MAX_IDLE_DEQUEUES) {
            short[] part = decoder.next();
            if (part.length == 0) {
                idle += 1;
                continue;
            }
            idle = 0;
            parts.add(part);
            total += part.length;
        }
        if (parts.size() == 1) return parts.get(0);
        short[] batch = new short[total];
        int at = 0;
        for (short[] part : parts) {
            System.arraycopy(part, 0, batch, at, part.length);
            at += part.length;
        }
        return batch;
    }

    /** Decode one batch of the current song into the renderer; at its end, move to the pool's next pick. */
    private void decodeSlice() throws Exception {
        if (decoder == null) {
            if (!ended) {
                ended = true;
                isolate.evaluateJavaScriptAsync("musicEnd()").get();
            }
            return;
        }
        short[] samples = decodeBatch();
        if (samples.length > 0) {
            if (!cued) {
                cued = true;
                isolate.evaluateJavaScriptAsync("musicSong(" + decoding.id + ", " + decoder.sampleRate() + ", " + cueOffsetFrames + ")").get();
            }
            byte[] bytes = new byte[samples.length * 2];
            for (int index = 0; index < samples.length; index += 1) {
                bytes[index * 2] = (byte) samples[index];
                bytes[(index * 2) + 1] = (byte) (samples[index] >> 8);
            }
            isolate.evaluateJavaScriptAsync("musicAppend('" + Base64.encodeToString(bytes, Base64.NO_WRAP) + "')").get();
        }
        if (decoder.finished()) startSong(next(decoding.id), 0, false);
    }

    /** Write a step's chunks into the output and report what is heard at `played`, the playhead the step was told; returns how much input is held ahead. */
    private long[] handle(String result, long played) throws Exception {
        JSONObject step = new JSONObject(result);
        JSONArray chunks = step.getJSONArray("chunks");
        for (int index = 0; index < chunks.length(); index += 1) {
            JSONObject chunk = chunks.getJSONObject(index);
            output.write(chunk.getLong("s"), SharedSandbox.decodeHalfScale(chunk.getString("d")));
        }
        JSONArray spectrum = step.optJSONArray("spectrum");
        if (spectrum != null && spectrum.length() > 0) listener.onSpectrum(spectrum.toString());
        JSONObject at = step.optJSONObject("at");
        Integer id = at == null ? null : at.getInt("songId");
        long second = at == null ? -1 : at.getLong("offsetFrames") / output.sampleRate;
        if (!java.util.Objects.equals(id, heardId) || second != heardSecond) {
            heardId = id;
            heardSecond = second;
            if (java.util.Objects.equals(id, steppedId)) steppedId = null;
            listener.onHeard(id, at == null ? 0 : (double) at.getLong("offsetFrames") / output.sampleRate, played);
        }
        // The lane refills in bursts, so it is asked to report when the next
        // song is heard: that is when the lock screen must name it.
        output.reportAt(step.optLong("next", -1));
        return new long[] { chunks.length(), step.getLong("ahead") };
    }

    private void run() {
        try {
            isolate = SharedSandbox.openRendererIsolate(context, SharedSandbox.MUSIC_RENDERER);
            JSONObject init = new JSONObject();
            init.put("sampleRate", output.sampleRate);
            init.put("spliceMarginSec", output.committedSec() + SPLICE_SLACK_SEC);
            isolate.evaluateJavaScriptAsync("musicInit(" + JSONObject.quote(init.toString()) + ")").get();
            isolate.evaluateJavaScriptAsync("musicRotation(" + JSONObject.quote(rotationJson) + ")").get();
            queued();
            long decodeAheadFrames = Math.round(DECODE_AHEAD_SEC * output.sampleRate);

            while (running) {
                Command command;
                while ((command = pending.poll()) != null) command.run();
                if (stage == null) {
                    waitForWork();
                    continue;
                }
                long played = output.playheadFrame();
                long[] step = handle(isolate.evaluateJavaScriptAsync(
                    "musicStep(" + played + ", " + MAX_CHUNKS_PER_STEP + ", " + (output.committedSec() + SPLICE_SLACK_SEC) + ", " + output.heardFrame() + ")").get(), played);
                // RENDERING COMES FIRST: a step that stopped at its cap has
                // input left to render, and the output is fed before the
                // decoder runs further ahead. Decoding after every step
                // rendered 12 chunks (32 ms) for every half second decoded,
                // so at a start, with nothing queued, the output was fed
                // slower than it played until the decoder was 14 s ahead:
                // seconds before a song was heard.
                boolean renderable = step[0] >= MAX_CHUNKS_PER_STEP;
                boolean wantsInput = !renderable && step[1] < decodeAheadFrames && !ended;
                if (wantsInput) decodeSlice();
                if (step[0] > 0 || wantsInput) continue;
                waitForWork();
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } catch (Exception error) {
            // Where it was thrown, so a failure read off the Debugging section names its line.
            StackTraceElement[] trace = error.getStackTrace();
            if (running) listener.onFailure(error instanceof NothingToPlay
                ? error.getMessage()
                : "Music renderer stopped: " + error + (trace.length > 0 ? " at " + trace[0] : ""));
        } finally {
            closeDecoder();
            if (isolate != null) SharedSandbox.close(isolate);
        }
    }

    private void waitForWork() throws InterruptedException {
        synchronized (signal) {
            while (running && !woken) signal.wait();
            woken = false;
        }
    }
}
