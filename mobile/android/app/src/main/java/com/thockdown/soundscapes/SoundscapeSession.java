package com.thockdown.soundscapes;

import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The soundscape that is playing, for the whole process: one per process,
 * outliving the web page, the activity and the plugin, so the notification
 * and lock-screen controls work while the web page's JavaScript is paused
 * and after the app has been swiped away.
 *
 * STATES: stopped (nothing exists), playing, paused (the renderer and the
 * queue are kept and the output holds its playhead, so resuming is
 * immediate). The foreground service (SoundscapePlaybackService) exists
 * whenever the session is not stopped, and draws this state.
 *
 * TWO CLIENTS drive it:
 * - the web page, through BackgroundAudioPlugin: it is the authority on
 *   what plays while it is running (play/pause from the engine opening and
 *   closing its playback, the configuration, the volume), and it PUBLISHES
 *   the list of soundscapes the media controls step through, each with the
 *   configuration the engine would send for it;
 * - the media controls, through the service: play, pause, next, previous,
 *   stop. Only these are reported back (Listener), because a change the web
 *   page made itself is one it already knows, and echoing it back would race
 *   the page's next change. The page also asks for the state when it comes
 *   back to the foreground, since a report made while it was paused may not
 *   have reached it.
 *
 * Next and previous configure the renderer from the published list
 * directly; when the web page then follows, the engine sends the same
 * configuration, which the renderer recognises and does not apply again.
 *
 * THE SCHEDULE (SoundscapeSchedule) is a third client, acting through its
 * alarm with or without a web page: a run's START opens or resumes the
 * session and fades it in over SCHEDULE_FADE_SEC, a SWITCH within a run is
 * a transition of that length from one soundscape to the next, a run's
 * STOP fades out over the same time and ends the session. A choice of
 * soundscape by hand -- next or previous here, or in the app -- turns the
 * schedule off and leaves that soundscape playing for as long as it is
 * left; pausing does not, and a paused run plays again at the next start.
 * Like the media controls, the schedule's changes are reported.
 */
final class SoundscapeSession {
    interface Listener {
        /** A media control or the schedule changed what plays: `currentId` is an entry's id. */
        void onChanged(boolean playing, String currentId, boolean scheduleEnabled);
        void onFailure(String message);
    }

    static final class Entry {
        final String id;
        final String name;
        /** A ConfigureMessage as JSON, exactly as the engine would send it. */
        final String configuration;

        Entry(String id, String name, String configuration) {
            this.id = id;
            this.name = name;
            this.configuration = configuration;
        }
    }

    private static final double VOLUME_TIME_CONSTANT_SEC = 0.08;
    /** How long the schedule's fades and transitions take. */
    private static final double SCHEDULE_FADE_SEC = 60;
    /** A fade back from a scheduled stop that was interrupted. */
    private static final double RESTORE_FADE_SEC = 0.5;
    private static SoundscapeSession instance;

    private final Context context;
    private Listener listener;
    private SoundscapeAudioOutput output;
    /** Volatile: the output's writer thread reads it without the session's lock, which close() holds while joining that thread. */
    private volatile SoundscapeRenderer renderer;
    private boolean playing = false;
    private List<Entry> entries = Collections.emptyList();
    private String currentId = null;
    private float masterVolume;
    /** The end of a scheduled stop's fade-out, while one is under way. */
    private Runnable pendingStop = null;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());

    private SoundscapeSession(Context context) {
        this.context = context.getApplicationContext();
        // Until the web page publishes it: the schedule may start a session
        // with no web page at all.
        masterVolume = SoundscapeSchedule.load(this.context).masterVolume;
    }

    static synchronized SoundscapeSession get(Context context) {
        if (instance == null) instance = new SoundscapeSession(context);
        return instance;
    }

    synchronized void setListener(Listener listener) {
        this.listener = listener;
    }

    synchronized void clearListener(Listener listener) {
        if (this.listener == listener) this.listener = null;
    }

    // --- State, read by the service and the plugin ---

    synchronized boolean isActive() {
        return output != null;
    }

    synchronized boolean isPlaying() {
        return playing;
    }

    synchronized String currentId() {
        return currentId;
    }

    synchronized String title() {
        Entry entry = find(currentId);
        return entry != null ? entry.name : "Soundscape";
    }

    // --- From the web page ---

    /** The soundscapes the media controls step through, which of them is current, and the listener's volume. */
    synchronized void publish(List<Entry> published, String current, float volume) {
        entries = new ArrayList<>(published);
        currentId = current;
        masterVolume = volume;
        refreshService();
    }

    /** Start playing, or carry on: opening what does not exist yet, resuming what is paused. */
    synchronized void play() {
        cancelScheduledStop();
        if (output == null) open();
        else output.setPaused(false);
        playing = true;
        refreshService();
    }

    synchronized void pause() {
        if (output == null || !playing) return;
        output.setPaused(true);
        playing = false;
        refreshService();
    }

    synchronized void configure(String configuration) {
        if (renderer != null) renderer.configure(configuration);
    }

    synchronized void setVolume(float volume, double timeConstantSec) {
        if (output != null) output.setVolume(volume, timeConstantSec);
    }

    // --- From the media controls ---

    synchronized void controlPlay() {
        if (output == null) return;
        cancelScheduledStop();
        output.setPaused(false);
        // The web page may have faded the output to silence before it
        // paused it: come back at the listener's volume.
        output.setVolume(masterVolume, VOLUME_TIME_CONSTANT_SEC);
        playing = true;
        refreshService();
        report();
    }

    synchronized void controlPause() {
        if (output == null || !playing) return;
        pause();
        report();
    }

    /** Step `direction` (+1 or -1) through the published soundscapes, wrapping. */
    synchronized void controlSkip(int direction) {
        if (output == null || entries.isEmpty()) return;
        int index = indexOf(currentId);
        int next = index < 0
            ? (direction > 0 ? 0 : entries.size() - 1)
            : Math.floorMod(index + direction, entries.size());
        Entry entry = entries.get(next);
        currentId = entry.id;
        renderer.configure(entry.configuration);
        // A soundscape chosen by hand: the schedule no longer decides.
        SoundscapeSchedule.disable(context);
        refreshService();
        report();
    }

    /** End everything: the notification was dismissed or its stop control pressed. */
    synchronized void controlStop() {
        cancelScheduledStop();
        endSession();
    }

    // --- From the schedule ---

    /** Apply the schedule's state at this moment: what a run in progress plays, or nothing. */
    synchronized void applyScheduleState() {
        SoundscapeSchedule schedule = SoundscapeSchedule.load(context);
        if (!schedule.enabled) return;
        SoundscapeSchedule.Event current = schedule.current();
        if (current == null || "stop".equals(current.kind)) {
            if (output != null) applyScheduleEvent(schedule, new SoundscapeSchedule.Event(current == null ? 0 : current.minute, "stop", null));
            return;
        }
        applyScheduleEvent(schedule, new SoundscapeSchedule.Event(current.minute, "start", current.presetId));
    }

    synchronized void applyScheduleEvent(SoundscapeSchedule schedule, SoundscapeSchedule.Event event) {
        if ("stop".equals(event.kind)) {
            if (output == null) return;
            if (!playing) {
                endSession();
                return;
            }
            output.setFade(0f, SCHEDULE_FADE_SEC);
            cancelScheduledStop();
            pendingStop = () -> {
                synchronized (SoundscapeSession.this) {
                    pendingStop = null;
                    endSession();
                }
            };
            main.postDelayed(pendingStop, Math.round(SCHEDULE_FADE_SEC * 1000));
            return;
        }
        Entry entry = schedule.entry(event.presetId);
        if (entry == null) return;
        cancelScheduledStop();
        if ("start".equals(event.kind)) {
            currentId = entry.id;
            if (output == null) {
                open();
                output.setFade(0f, 0);
            } else if (!playing) {
                output.setFade(0f, 0);
                renderer.configure(entry.configuration);
                output.setPaused(false);
            } else {
                renderer.transition(entry.configuration, SCHEDULE_FADE_SEC);
            }
            output.setVolume(masterVolume, VOLUME_TIME_CONSTANT_SEC);
            output.setFade(1f, playing ? RESTORE_FADE_SEC : SCHEDULE_FADE_SEC);
            playing = true;
        } else {
            // A switch: heard if playing; if paused, the run carries on
            // silently and plays its current soundscape when resumed.
            if (output == null) return;
            currentId = entry.id;
            if (playing) renderer.transition(entry.configuration, SCHEDULE_FADE_SEC);
            else renderer.configure(entry.configuration);
        }
        refreshService();
        report();
    }

    /** A scheduled stop's fade-out, abandoned: something chose to play. */
    private void cancelScheduledStop() {
        if (pendingStop == null) return;
        main.removeCallbacks(pendingStop);
        pendingStop = null;
        if (output != null) output.setFade(1f, RESTORE_FADE_SEC);
    }

    private void endSession() {
        close();
        playing = false;
        context.stopService(new Intent(context, SoundscapePlaybackService.class));
        report();
    }

    // --- Internals ---

    private void open() {
        // The renderer reads the output's playhead and the output wakes the
        // renderer as it plays: each needs the other, so the output's
        // listener reaches the renderer through the field.
        output = new SoundscapeAudioOutput(() -> {
            SoundscapeRenderer current = renderer;
            if (current != null) current.wake();
        });
        renderer = new SoundscapeRenderer(context, output, this::failed);
        Entry entry = find(currentId);
        if (entry != null) renderer.configure(entry.configuration);
    }

    private void failed(String message) {
        Listener current;
        synchronized (this) {
            close();
            playing = false;
            context.stopService(new Intent(context, SoundscapePlaybackService.class));
            current = listener;
        }
        if (current != null) current.onFailure(message);
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

    private void report() {
        if (listener != null) listener.onChanged(playing, currentId, SoundscapeSchedule.load(context).enabled);
    }

    /**
     * Have the service redraw (it reads this state itself), starting it if
     * it is not running. Only starting it goes through the system: a
     * foreground service may not be STARTED from the background, which is
     * where the media controls are pressed, but it is already running then.
     */
    private void refreshService() {
        if (output == null) return;
        if (SoundscapePlaybackService.refreshIfRunning()) return;
        ContextCompat.startForegroundService(context, new Intent(context, SoundscapePlaybackService.class));
    }

    /** An entry of the published cycle, or failing that of the schedule, which may name soundscapes outside the cycle. */
    private Entry find(String id) {
        int index = indexOf(id);
        if (index >= 0) return entries.get(index);
        return id == null ? null : SoundscapeSchedule.load(context).entry(id);
    }

    private int indexOf(String id) {
        if (id == null) return -1;
        for (int index = 0; index < entries.size(); index += 1) {
            if (entries.get(index).id.equals(id)) return index;
        }
        return -1;
    }
}
