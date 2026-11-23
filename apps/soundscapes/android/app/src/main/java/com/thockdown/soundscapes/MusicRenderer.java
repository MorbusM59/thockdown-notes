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
 * visualizer.
 */
final class MusicRenderer {
    interface Listener {
        /** What is heard now: a song and how far into it, in seconds; null for nothing. */
        void onHeard(Integer songId, double seconds);

        /** The rotation moved (a song played or was chosen): store it, to give back as `rotationJson` next time. */
        void onRotation(String rotationJson);

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
        post(() -> isolate.evaluateJavaScriptAsync("musicCatalog(" + JSONObject.quote(catalogJson) + ")").get());
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

    /** Leave the song playing for the pool's next pick. */
    void skip() {
        post(() -> {
            if (stage == null) return;
            settle();
            configure(true);
            startSong(next(heardId), 0);
        });
    }

    /** Play `songId`, chosen from the list, now: the pool is rotated to it (musicPool.ts's rotatePoolTo). */
    void choose(int songId) {
        post(() -> {
            if (stage == null) return;
            settle();
            configure(true);
            startSong(songFrom(isolate.evaluateJavaScriptAsync("musicChoose(" + songId + ")").get()), 0);
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
        handle(isolate.evaluateJavaScriptAsync("musicStep(" + output.playheadFrame() + ", 0)").get());
    }

    private void configure(boolean cut) throws Exception {
        String settings = "{\"stage\":" + stage + (cut ? ",\"cut\":true}" : "}");
        isolate.evaluateJavaScriptAsync("musicConfigure(" + JSONObject.quote(settings) + ")").get();
    }

    /** At most this many songs in a row that cannot be decoded are passed over before the stream ends. */
    private static final int MAX_UNPLAYABLE = 8;

    private void startSong(Song song, double seconds) throws Exception {
        closeDecoder();
        cued = false;
        ended = false;
        for (int attempt = 0; song != null && attempt < MAX_UNPLAYABLE; attempt += 1) {
            decoding = song;
            uris.put(song.id, song.uri);
            try {
                decoder = new SongDecoder(context, song.uri, (long) (seconds * 1_000_000));
                cueOffsetFrames = Math.round(seconds * output.sampleRate);
                return;
            } catch (Exception error) {
                // A song that cannot be decoded is passed over, as if it had played.
                closeDecoder();
                song = next(song.id);
                seconds = 0;
            }
        }
        decoding = null;
    }

    private void closeDecoder() {
        if (decoder != null) decoder.close();
        decoder = null;
    }

    /** Decode one slice of the current song into the renderer; at its end, move to the pool's next pick. */
    private void decodeSlice() throws Exception {
        if (decoder == null) {
            if (!ended) {
                ended = true;
                isolate.evaluateJavaScriptAsync("musicEnd()").get();
            }
            return;
        }
        short[] samples = decoder.next();
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
        if (decoder.finished()) startSong(next(decoding.id), 0);
    }

    /** Write a step's chunks into the output and report what is heard; returns how much input is held ahead. */
    private long[] handle(String result) throws Exception {
        JSONObject step = new JSONObject(result);
        JSONArray chunks = step.getJSONArray("chunks");
        for (int index = 0; index < chunks.length(); index += 1) {
            JSONObject chunk = chunks.getJSONObject(index);
            output.write(chunk.getLong("s"), SharedSandbox.decodeHalfScale(chunk.getString("d")));
        }
        JSONObject at = step.optJSONObject("at");
        Integer id = at == null ? null : at.getInt("songId");
        long second = at == null ? -1 : at.getLong("offsetFrames") / output.sampleRate;
        if (!java.util.Objects.equals(id, heardId) || second != heardSecond) {
            heardId = id;
            heardSecond = second;
            listener.onHeard(id, at == null ? 0 : (double) at.getLong("offsetFrames") / output.sampleRate);
        }
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
            long decodeAheadFrames = Math.round(DECODE_AHEAD_SEC * output.sampleRate);

            while (running) {
                Command command;
                while ((command = pending.poll()) != null) command.run();
                if (stage == null) {
                    waitForWork();
                    continue;
                }
                long[] step = handle(isolate.evaluateJavaScriptAsync(
                    "musicStep(" + output.playheadFrame() + ", " + MAX_CHUNKS_PER_STEP + ")").get());
                boolean wantsInput = step[1] < decodeAheadFrames && !ended;
                if (wantsInput) decodeSlice();
                if (step[0] > 0 || wantsInput) continue;
                waitForWork();
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } catch (Exception error) {
            if (running) listener.onFailure("Music renderer stopped: " + error);
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
