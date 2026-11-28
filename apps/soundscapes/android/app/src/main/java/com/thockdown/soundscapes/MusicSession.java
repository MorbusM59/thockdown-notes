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
        /** `heardNanos`: when `frame` is heard, on System.nanoTime's clock. */
        void onHeard(Integer songId, double seconds, long frame, int sampleRate, boolean playing, long heardNanos);

        /** Spectrum frames for the visualizer (MusicRenderer.Listener.onSpectrum). */
        void onSpectrum(String batchesJson);

        void onFailure(String message);

        /** The car's "next soundstage" chose the stage `id` (`nextStage`). */
        void onStage(String id);

        /** The catalog changed away from the page (`editCatalog`): the page reloads it. */
        void onCatalog(String catalogJson);
    }

    private static final String CATALOG_FILE = "music-catalog.json";
    private static final String ROTATION_FILE = "music-rotation.json";
    /** The last soundstage, so a scheduled run with no page plays with it. */
    private static final String STAGE_FILE = "music-stage.json";
    /** The music channel's switch ("on"/"off"), so a scheduled run with no page follows it. */
    private static final String CHANNEL_FILE = "music-channel.txt";
    /** musicLibrary.ts's EMPTY_CATALOG. */
    private static final String EMPTY_CATALOG = "{\"songs\":[],\"activeSetIds\":[],\"filter\":{\"query\":\"\"}}";
    private static final double VOLUME_TIME_CONSTANT_SEC = 0.05;
    /** A report this far from where the last one ran on to is a jump (a seek), shown on the lock screen at once. */
    private static final double SEEK_NOTICED_SEC = 1.5;
    /** How quickly an undone timer fade returns to full. */
    private static final double TIMER_RESTORE_FADE_SEC = 0.5;

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
    /**
     * THE MUSIC CHANNEL: whether music is part of the mix at all. Switched
     * out, nothing plays it: what played pauses (its position kept, the
     * renderer idle, nothing rendered or decoded), and play, resume, a
     * chosen song and the schedule all do nothing until it is switched in.
     * Read from its file once; the page sends it on every change.
     */
    private Boolean channel = null;
    private Integer heardId = null;
    /**
     * A song chosen as a start of playback (from paused or stopped): the lane
     * is held silent until this song is heard, then fades in from silence, so
     * nothing queued before the choice (the paused song, the pool's opening
     * pick) is heard first. Null when no such start is under way.
     */
    private Integer startingSong = null;
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
        SoundscapePlaybackService.catalogChanged();
    }

    /** Play with `stageJson` (MusicStage), starting the music if it is not playing; the soundstage otherwise. */
    synchronized void play(String stageJson) {
        setStoredStage(stageJson);
        if (!channelOn()) return;
        if (startingSong != null) {
            startingSong = null;
            if (output != null) output.setFade(1f, TIMER_RESTORE_FADE_SEC);
        }
        handler.removeCallbacks(endScheduledRun);
        if (renderer == null) {
            open();
        } else {
            if (output.isPaused()) output.setPaused(false);
            // A timer fade under way is undone by playing again.
            output.setFade(1f, TIMER_RESTORE_FADE_SEC);
            // A scheduled run the listener plays on becomes theirs: their sets, at full level.
            if (scheduledRun) {
                renderer.setPoolSet(null, false);
                output.setFade(1f, 0);
            }
            renderer.resume();
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

    // The soundstages "next soundstage" cycles through (Android Auto), as the page published them.
    private String[] cycleIds = new String[0];
    private String[] cycleStages = new String[0];
    private String cycleActiveId = null;

    /** The page's soundstages in cycle order, each with its stage, and the active one (MusicPlugin's setStageCycle). */
    synchronized void setStageCycle(String[] ids, String[] stages, String activeId) {
        cycleIds = ids;
        cycleStages = stages;
        cycleActiveId = activeId;
    }

    /** Step to the next soundstage of the cycle, wrapping round, heard at once; the page follows (`onStage`). */
    synchronized void nextStage() {
        if (cycleIds.length == 0) return;
        int at = java.util.Arrays.asList(cycleIds).indexOf(cycleActiveId);
        int next = (at + 1) % cycleIds.length;
        cycleActiveId = cycleIds[next];
        setStage(cycleStages[next]);
        if (listener != null) listener.onStage(cycleActiveId);
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

    synchronized void jump(int direction) {
        if (renderer != null) renderer.jump(direction);
    }

    /**
     * Play `songId` now. A song chosen is a start of playback whatever the
     * music was doing: stopped, it opens with the last soundstage (the page
     * sends play first, but the native side must not depend on that order);
     * paused, it resumes.
     */
    synchronized void choose(int songId) {
        if (!channelOn()) return;
        boolean starting = renderer == null || output.isPaused();
        if (renderer == null) {
            if (stage == null) stage = read(STAGE_FILE, null);
            if (stage == null) return;
            play(stage);
            if (renderer == null) return;
        }
        if (starting) {
            // Silent before the lane runs again; the chosen song fades in once heard (onHeard).
            output.discardQueued();
            output.setFade(0f, 0);
            startingSong = songId;
            // Its opening is silent until the lane reports it heard, so the report comes at the quick pace.
            output.setResponsive(true);
            resume();
        }
        renderer.choose(songId);
    }

    synchronized void seek(double seconds) {
        if (renderer != null) renderer.seek(seconds);
    }

    /** The visualizer's spectrum in `bands` log bands, or none (0). */
    synchronized void setSpectrum(int bands) {
        spectrumBands = bands;
        // The visualizer reads the spectrum and the heard clock at the quick pace; otherwise the lane refills at its idle one.
        if (output != null) output.setResponsive(bands > 0 || startingSong != null);
        if (renderer != null) renderer.setSpectrum(bands);
    }

    /** Switch the music channel in or out of the mix (MUSIC CHANNEL above). */
    synchronized void setChannel(boolean on) {
        if (channelOn() == on) return;
        channel = on;
        write(CHANNEL_FILE, on ? "on" : "off");
        if (on) {
            // A scheduled run due now starts; the listener's music waits for play, as from a pause.
            applySchedule(SoundscapeSession.HANDOVER_FADE_SEC);
            return;
        }
        if (scheduledRun) {
            stop();
            return;
        }
        pause();
    }

    private boolean channelOn() {
        if (channel == null) channel = !"off".equals(read(CHANNEL_FILE, "on").trim());
        return channel;
    }

    synchronized void setVolume(float volume) {
        this.volume = volume;
        if (output != null) output.setVolume(volume, VOLUME_TIME_CONSTANT_SEC);
    }

    /**
     * The scheduled run becomes the listener's music, as it is when a pause
     * switches the schedule off under it (SoundscapePlaybackService.pauseAll):
     * play then resumes it where it was, rather than finding it ended.
     */
    synchronized void adoptRun() {
        if (!scheduledRun) return;
        handler.removeCallbacks(endScheduledRun);
        scheduledRun = false;
        report();
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
     * PLAYS is left alone; music the listener PAUSED is not -- a pause does
     * not hold the schedule back -- so a run takes it over, resuming it on
     * the run's set.
     */
    synchronized void applySchedule(double fadeSec) {
        if (!channelOn()) return;
        boolean listeners = output != null && !scheduledRun;
        if (listeners && !output.isPaused()) return;
        SoundscapeSchedule schedule = SoundscapeSchedule.load(context);
        Integer set = schedule.musicSetAt(System.currentTimeMillis());
        handler.removeCallbacks(endScheduledRun);
        if (set == null) {
            if (output == null || listeners) return;
            output.setFade(0f, fadeSec);
            handler.postDelayed(endScheduledRun, Math.round(fadeSec * 1000));
            return;
        }
        if (listeners) {
            scheduledRun = true;
            scheduledSet = set;
            renderer.setPoolSet(set, true);
            output.fadeFrom(0f, 1f, fadeSec);
            resume();
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

    /**
     * THE TIMER (SoundscapeSession's) ends the listener's music with the
     * soundscape: it fades out over the timer's fade, and stops when the
     * timer runs out, handing over to the schedule's music if a run is due.
     * A scheduled run is the schedule's and is left alone.
     */
    synchronized void timerFade(double fadeSec) {
        if (output == null || scheduledRun) return;
        output.setFade(0f, fadeSec);
    }

    /** The timer's fade was undone (a pause, a new timer, a change of soundscape): back to full. */
    synchronized void timerFadeUndone() {
        if (output == null || scheduledRun) return;
        output.setFade(1f, TIMER_RESTORE_FADE_SEC);
    }

    synchronized void timerExpired() {
        if (output == null || scheduledRun) return;
        stop();
        applySchedule(SoundscapeSession.HANDOVER_FADE_SEC);
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

    /** Whether there is music, playing or paused, in the mix (the service and its controls follow it). */
    synchronized boolean isActive() {
        return output != null && channelOn();
    }

    /** Resume paused music (the media controls); nothing without music or with its channel switched out. */
    synchronized void resume() {
        if (output == null || !output.isPaused() || !channelOn()) return;
        output.setPaused(false);
        // A stream that ran out while paused starts the pool's next pick, as play does.
        renderer.resume();
        report();
        SoundscapePlaybackService.sourceChanged(context, true);
    }

    /** The song heard, for the notification: its title, else its file's name; "Music" with none. */
    synchronized String title() {
        org.json.JSONObject song = heardEntry();
        if (song == null) return "Music";
        String title = song.optString("title", "");
        if (!title.isEmpty()) return title;
        String path = android.net.Uri.decode(song.optString("filePath", ""));
        return path.substring(path.lastIndexOf('/') + 1);
    }

    /** The heard song's catalog entry (musicLibrary.ts's CatalogSong: title, artist, album, durationSec), or null. */
    synchronized org.json.JSONObject heardEntry() {
        if (heardId == null) return null;
        try {
            org.json.JSONArray songs = new org.json.JSONObject(catalog()).getJSONArray("songs");
            for (int index = 0; index < songs.length(); index += 1) {
                org.json.JSONObject song = songs.getJSONObject(index);
                if (song.getInt("id") == heardId) return song;
            }
        } catch (org.json.JSONException unreadable) {
            // An unreadable catalog names nothing.
        }
        return null;
    }

    /** How far into the heard song the music is now, in seconds (the last report carried to the playhead). */
    synchronized double heardPosition() {
        if (heardId == null) return 0;
        if (output == null || output.isPaused()) return heardSeconds;
        return heardSeconds + (double) Math.max(0, output.heardFrame() - heardFrame) / output.sampleRate;
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
        output.refillInBursts(false);
        output.setVolume(volume, VOLUME_TIME_CONSTANT_SEC);
        output.setResponsive(spectrumBands > 0 || startingSong != null);
        // A renderer's reports count only while it is the current one: one
        // being closed can still be mid-callback, blocked on this session's
        // lock while close() waits for its thread, and would otherwise report
        // its song over the new renderer's, or close the new renderer on its
        // own failure.
        final MusicRenderer[] self = new MusicRenderer[1];
        renderer = self[0] = new MusicRenderer(context, output, catalog(), rotation(), new MusicRenderer.Listener() {
            @Override
            public void onHeard(Integer songId, double seconds, long frame) {
                synchronized (MusicSession.this) {
                    if (renderer != self[0]) return;
                    // A new song, or a jump within one (a seek): the notification and the lock
                    // screen's position follow. Between those the system runs the position on itself.
                    boolean sameSong = java.util.Objects.equals(songId, heardId);
                    double expected = heardSeconds + (double) (frame - heardFrame) / output.sampleRate;
                    if (!sameSong || Math.abs(seconds - expected) > SEEK_NOTICED_SEC) SoundscapePlaybackService.refreshIfRunning();
                    // Its opening second: the chosen song from its start, never the paused one heard on.
                    if (startingSong != null && startingSong.equals(songId) && seconds < 1) {
                        startingSong = null;
                        output.fadeFrom(0f, 1f, SoundscapeSession.SWITCH_FADE_SEC);
                        output.setResponsive(spectrumBands > 0);
                    }
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
                    if (renderer != self[0]) return;
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
            public void onPoolEmptied() {
                synchronized (MusicSession.this) {
                    if (renderer != self[0] || output == null) return;
                    // A pause's fade, so nothing clicks; the song heard is gone from the screen.
                    output.setPaused(true);
                    heardId = null;
                    heardSeconds = 0;
                    report();
                }
                SoundscapePlaybackService.refreshIfRunning();
                SoundscapePlaybackService.sourceChanged(context, false);
            }

            @Override
            public void onPoolRefilled() {
                synchronized (MusicSession.this) {
                    if (renderer != self[0] || output == null || !channelOn()) return;
                    output.setPaused(false);
                    report();
                }
                SoundscapePlaybackService.sourceChanged(context, true);
            }

            @Override
            public void onQueue(String json) {
                synchronized (MusicSession.this) {
                    if (renderer != self[0] || json.equals(queueJson)) return;
                    queueJson = json;
                }
                SoundscapePlaybackService.refreshIfRunning();
            }

            @Override
            public void onCatalogEdited(String catalogJson) {
                Listener current;
                synchronized (MusicSession.this) {
                    if (renderer != self[0]) return;
                    write(CATALOG_FILE, catalogJson);
                    current = listener;
                }
                SoundscapePlaybackService.refreshIfRunning();
                SoundscapePlaybackService.catalogChanged();
                if (current != null) current.onCatalog(catalogJson);
            }

            @Override
            public void onFailure(String message) {
                Listener current;
                synchronized (MusicSession.this) {
                    if (renderer != self[0]) return;
                    lastFailure = message;
                    close();
                    // The page hears that nothing plays: its play button
                    // follows the reports, and was left showing pause.
                    report();
                    current = listener;
                }
                SoundscapePlaybackService.sourceChanged(context, false);
                if (current != null) current.onFailure(message);
            }
        });
        if (spectrumBands > 0) renderer.setSpectrum(spectrumBands);
    }

    /** The pool in queue order while a renderer plays (musicSandbox.ts's musicQueueJson), "[]" otherwise. */
    private String queueJson = "[]";

    /** The song heard, or null. */
    synchronized Integer heardSong() {
        return heardId;
    }

    synchronized String queue() {
        return queueJson;
    }

    /**
     * A change to the listener's choice from Android Auto, made by the
     * renderer's copy of the page's rules (MusicRenderer.editCatalog): a
     * set toggled, or a filter chosen. Choosing what to hear from the car is
     * a request to hear it, so with nothing playing the music starts first.
     */
    synchronized void editCatalog(String editJson) {
        if (renderer == null) {
            if (stage == null) stage = read(STAGE_FILE, null);
            if (stage != null) play(stage);
        } else if (output.isPaused()) {
            resume();
        }
        if (renderer != null) renderer.editCatalog(editJson);
    }

    private void close() {
        startingSong = null;
        queueJson = "[]";
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
        followTimer();
        if (listener == null) return;
        if (output == null) {
            listener.onHeard(heardId, heardSeconds, heardFrame, 0, false, System.nanoTime());
            return;
        }
        long frame = output.playheadFrame();
        double seconds = heardId == null ? 0 : heardSeconds + (double) (frame - heardFrame) / output.sampleRate;
        // Halted (AudioConnection), the song stands where it was heard: reported as not playing, so the page's clock stops there too.
        listener.onHeard(heardId, seconds, frame, output.sampleRate, isPlaying() && !AudioOutput.isHalted(), output.heardNanos(frame));
    }

    /** The output was halted or resumed: the page is told where the song stands and whether its clock runs. */
    synchronized void haltChanged() {
        report();
    }

    /** Whether SoundscapeSession was last told the listener's music plays. */
    private boolean toldTimer = false;

    /** The timer counts the listener's music too (SoundscapeSession.musicChanged); told on a change only, posted so the two sessions' locks are never held together. */
    private void followTimer() {
        boolean now = output != null && !scheduledRun && !output.isPaused();
        if (now == toldTimer) return;
        toldTimer = now;
        handler.post(() -> SoundscapeSession.get(context).musicChanged(now));
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
