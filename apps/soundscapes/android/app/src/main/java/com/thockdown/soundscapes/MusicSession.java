package com.thockdown.soundscapes;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * The music, process-wide, as SoundscapeSession is the soundscape: it
 * belongs to the process rather than to the web page, so it plays on with
 * the page paused or gone.
 *
 * It owns the music's lane of the app's output (OutputLane) and its
 * renderer (MusicRenderer) while music plays, and the library's two stored
 * documents (apps/soundscapes/src/musicLibrary.ts): the CATALOG, which the
 * page writes whole (`setCatalog`), and the ROTATION, which only the
 * renderer moves (`onRotation`). Both are files in the app's private
 * storage, written durably (a sibling, then renamed over the original), so a
 * power cut leaves the old document or the new one.
 *
 * THE SCHEDULE plays music too (schedule.ts's music channel, events kept by
 * SoundscapeSchedule): a scheduled run plays its song set alone
 * (MusicRenderer.setPoolSet), faded in and out over the event's fade. Music
 * the listener started overrules it, as regular mode overrules the
 * soundscape's schedule: the schedule then changes nothing until the music
 * is stopped, and a play during a scheduled run makes it the listener's.
 *
 * What is heard (a song and how far into it, at which output frame) is
 * passed to the listener (the page, while it exists) as the renderer reports
 * it, and the visualizer's spectrum while it asks for one (`setSpectrum`).
 */
final class MusicSession {
    interface Listener {
        /** What is heard: a song and the seconds into it (null for nothing) at the output's playhead `frame`, at `sampleRate`. */
        void onHeard(Integer songId, double seconds, long frame, int sampleRate, boolean playing);

        /** Spectrum frames for the visualizer (MusicRenderer.Listener.onSpectrum). */
        void onSpectrum(String batchesJson);

        void onFailure(String message);
    }

    private static final String CATALOG_FILE = "music-catalog.json";
    private static final String ROTATION_FILE = "music-rotation.json";
    /** The last soundstage, so a scheduled run with no page plays with it. */
    private static final String STAGE_FILE = "music-stage.json";
    /** musicLibrary.ts's EMPTY_CATALOG. */
    private static final String EMPTY_CATALOG = "{\"songs\":[],\"activeSetIds\":[],\"filter\":{\"query\":\"\"}}";
    private static final double VOLUME_TIME_CONSTANT_SEC = 0.05;

    private static MusicSession instance;

    private final Context context;
    private Listener listener;
    private OutputLane output;
    private MusicRenderer renderer;
    private String stage;
    /** Whether the music playing is the schedule's run rather than the listener's. */
    private boolean scheduledRun = false;
    /** The set the scheduled run plays, so a schedule re-sent unchanged changes nothing. */
    private Integer scheduledSet = null;
    /** Ends a scheduled run once its fade out is done. */
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable endScheduledRun = this::endScheduledRun;
    private float volume = 1f;
    private Integer heardId = null;
    /** The last failure that stopped the music, for the Debugging section; null for none. */
    private String lastFailure = null;
    private double heardSeconds = 0;
    /** The output frame `heardSeconds` was heard at. */
    private long heardFrame = 0;
    /** The visualizer's spectrum bands (0 for none), kept for a renderer opened later. */
    private int spectrumBands = 0;

    static synchronized MusicSession get(Context context) {
        if (instance == null) instance = new MusicSession(context);
        return instance;
    }

    private MusicSession(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized void setListener(Listener listener) {
        this.listener = listener;
        // With no page there is nothing to draw a spectrum: the renderer stops computing one.
        if (listener == null) setSpectrum(0);
    }

    /** The catalog as stored (an empty one before the page has written any). */
    synchronized String catalog() {
        return read(CATALOG_FILE, EMPTY_CATALOG);
    }

    /** The rotation as stored, for the page to show the pool's order. */
    synchronized String rotation() {
        return read(ROTATION_FILE, "[]");
    }

    /** The page's catalog, whole: stored, and given to the renderer if music plays. */
    synchronized void setCatalog(String catalogJson) {
        write(CATALOG_FILE, catalogJson);
        if (renderer != null) renderer.setCatalog(catalogJson);
    }

    /** Play with `stageJson` (MusicStage), starting the music if it is not playing; the soundstage otherwise. */
    synchronized void play(String stageJson) {
        setStoredStage(stageJson);
        handler.removeCallbacks(endScheduledRun);
        if (renderer == null) {
            open();
        } else {
            if (output.isPaused()) output.setPaused(false);
            // A scheduled run the listener plays on becomes theirs: their sets, at full level.
            if (scheduledRun) {
                renderer.setPoolSet(null, false);
                output.setFade(1f, 0);
            }
        }
        scheduledRun = false;
        renderer.setStage(stageJson);
        report();
        if (!SoundscapePlaybackService.sourceChanged(context, true)) {
            // Refused a start from the background: no service would keep the process playing.
            close();
            report();
            lastFailure = "Music could not start in the background";
            if (listener != null) listener.onFailure(lastFailure);
        }
    }

    /** A new soundstage, heard at once if music plays. */
    synchronized void setStage(String stageJson) {
        setStoredStage(stageJson);
        if (renderer != null) renderer.setStage(stageJson);
    }

    synchronized void pause() {
        if (output == null) return;
        output.setPaused(true);
        report();
        SoundscapePlaybackService.sourceChanged(context, false);
    }

    synchronized void skip() {
        if (renderer != null) renderer.skip();
    }

    synchronized void choose(int songId) {
        if (renderer != null) renderer.choose(songId);
    }

    synchronized void seek(double seconds) {
        if (renderer != null) renderer.seek(seconds);
    }

    /** The visualizer's spectrum in `bands` log bands, or none (0). */
    synchronized void setSpectrum(int bands) {
        spectrumBands = bands;
        if (renderer != null) renderer.setSpectrum(bands);
    }

    synchronized void setVolume(float volume) {
        this.volume = volume;
        if (output != null) output.setVolume(volume, VOLUME_TIME_CONSTANT_SEC);
    }

    /** End the music: the renderer and the lane close. */
    synchronized void stop() {
        handler.removeCallbacks(endScheduledRun);
        scheduledRun = false;
        close();
        heardId = null;
        report();
        SoundscapePlaybackService.sourceChanged(context, false);
    }

    /**
     * Follow the schedule's music channel as it stands now, a change taking
     * `fadeSec`: its set plays (faded in, or moved on to at once if a run
     * already plays), or the run fades out and ends. Music the listener
     * started is left alone.
     */
    synchronized void applySchedule(double fadeSec) {
        if (output != null && !scheduledRun) return;
        SoundscapeSchedule schedule = SoundscapeSchedule.load(context);
        Integer set = schedule.musicSetAt(System.currentTimeMillis());
        handler.removeCallbacks(endScheduledRun);
        if (set == null) {
            if (output == null) return;
            output.setFade(0f, fadeSec);
            handler.postDelayed(endScheduledRun, Math.round(fadeSec * 1000));
            return;
        }
        if (output != null) {
            if (!set.equals(scheduledSet)) renderer.setPoolSet(set, true);
            scheduledSet = set;
            output.setFade(1f, fadeSec);
            return;
        }
        if (stage == null) stage = read(STAGE_FILE, null);
        if (stage == null) return;
        open();
        scheduledRun = true;
        scheduledSet = set;
        output.fadeFrom(0f, 1f, fadeSec);
        renderer.setPoolSet(set, false);
        renderer.setStage(stage);
        report();
        if (!SoundscapePlaybackService.sourceChanged(context, true)) {
            scheduledRun = false;
            close();
            report();
        }
    }

    private synchronized void endScheduledRun() {
        if (!scheduledRun) return;
        stop();
    }

    private void setStoredStage(String stageJson) {
        if (stageJson.equals(stage)) return;
        stage = stageJson;
        write(STAGE_FILE, stageJson);
    }

    /** Whether there is music, playing or paused (the service and its controls follow it). */
    synchronized boolean isActive() {
        return output != null;
    }

    /** Resume paused music (the media controls); nothing without music. */
    synchronized void resume() {
        if (output == null || !output.isPaused()) return;
        output.setPaused(false);
        report();
        SoundscapePlaybackService.sourceChanged(context, true);
    }

    /** The song heard, for the notification: its title, else its file's name; "Music" with none. */
    synchronized String title() {
        if (heardId == null) return "Music";
        try {
            org.json.JSONArray songs = new org.json.JSONObject(catalog()).getJSONArray("songs");
            for (int index = 0; index < songs.length(); index += 1) {
                org.json.JSONObject song = songs.getJSONObject(index);
                if (song.getInt("id") != heardId) continue;
                String title = song.optString("title", "");
                if (!title.isEmpty()) return title;
                String path = android.net.Uri.decode(song.optString("filePath", ""));
                return path.substring(path.lastIndexOf('/') + 1);
            }
        } catch (org.json.JSONException unreadable) {
            // An unreadable catalog names nothing.
        }
        return "Music";
    }

    /** What the music's output is doing, for the app's Debugging section. */
    synchronized String diagnostics() {
        String failure = lastFailure == null ? "" : " Last failure: " + lastFailure;
        if (output == null) return "No music output open." + failure;
        return failure.trim() + (failure.isEmpty() ? "" : " | ") + "Song " + heardId + " at " + Math.round(heardSeconds) + " s, session volume " + volume + "; lane: " + output.diagnostics();
    }

    synchronized boolean isPlaying() {
        return output != null && !output.isPaused();
    }

    private void open() {
        // The renderer reads the lane's playhead and the lane wakes the
        // renderer as it plays: each needs the other, so the lane's listener
        // reaches the renderer through the field.
        output = AudioOutput.openLane(() -> {
            MusicRenderer current = renderer;
            if (current != null) current.wake();
        });
        output.setVolume(volume, VOLUME_TIME_CONSTANT_SEC);
        renderer = new MusicRenderer(context, output, catalog(), rotation(), new MusicRenderer.Listener() {
            @Override
            public void onHeard(Integer songId, double seconds, long frame) {
                synchronized (MusicSession.this) {
                    // A new song: the notification names it.
                    if (!java.util.Objects.equals(songId, heardId)) SoundscapePlaybackService.refreshIfRunning();
                    heardId = songId;
                    heardSeconds = seconds;
                    heardFrame = frame;
                    report();
                }
            }

            @Override
            public void onSpectrum(String batchesJson) {
                Listener current;
                synchronized (MusicSession.this) {
                    current = listener;
                }
                if (current != null) current.onSpectrum(batchesJson);
            }

            @Override
            public void onRotation(String rotationJson) {
                synchronized (MusicSession.this) {
                    write(ROTATION_FILE, rotationJson);
                }
            }

            @Override
            public void onFailure(String message) {
                Listener current;
                synchronized (MusicSession.this) {
                    lastFailure = message;
                    close();
                    current = listener;
                }
                SoundscapePlaybackService.sourceChanged(context, false);
                if (current != null) current.onFailure(message);
            }
        });
        if (spectrumBands > 0) renderer.setSpectrum(spectrumBands);
    }

    private void close() {
        if (renderer != null) {
            renderer.close();
            renderer = null;
        }
        if (output != null) {
            output.close();
            output = null;
        }
    }

    /**
     * Reports what is heard now: the song and seconds last reported, carried
     * to the playhead as it stands (a pause between two reports), so the
     * page can run the clock on from a consistent pair.
     */
    private void report() {
        if (listener == null) return;
        if (output == null) {
            listener.onHeard(heardId, heardSeconds, heardFrame, 0, false);
            return;
        }
        long frame = output.playheadFrame();
        double seconds = heardId == null ? 0 : heardSeconds + (double) (frame - heardFrame) / output.sampleRate;
        listener.onHeard(heardId, seconds, frame, output.sampleRate, isPlaying());
    }

    private String read(String name, String fallback) {
        File file = new File(context.getFilesDir(), name);
        if (!file.exists()) return fallback;
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) file.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int read = in.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
            return new String(bytes, 0, offset, StandardCharsets.UTF_8);
        } catch (IOException error) {
            return fallback;
        }
    }

    private void write(String name, String text) {
        File target = new File(context.getFilesDir(), name);
        File sibling = new File(context.getFilesDir(), name + ".tmp");
        try (FileOutputStream out = new FileOutputStream(sibling)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException error) {
            return;
        }
        if (!sibling.renameTo(target)) sibling.delete();
    }
}
