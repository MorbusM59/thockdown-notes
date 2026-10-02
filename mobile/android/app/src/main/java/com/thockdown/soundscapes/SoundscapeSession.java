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
 */
final class SoundscapeSession {
    interface Listener {
        /** A media control changed what plays: `currentId` is a published entry's id. */
        void onChanged(boolean playing, String currentId);
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
    private static SoundscapeSession instance;

    private final Context context;
    private Listener listener;
    private SoundscapeAudioOutput output;
    /** Volatile: the output's writer thread reads it without the session's lock, which close() holds while joining that thread. */
    private volatile SoundscapeRenderer renderer;
    private boolean playing = false;
    private List<Entry> entries = Collections.emptyList();
    private String currentId = null;
    private float masterVolume = 1f;

    private SoundscapeSession(Context context) {
        this.context = context.getApplicationContext();
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
        refreshService();
        report();
    }

    /** End everything: the notification was dismissed or its stop control pressed. */
    synchronized void controlStop() {
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
        if (listener != null) listener.onChanged(playing, currentId);
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

    private Entry find(String id) {
        int index = indexOf(id);
        return index < 0 ? null : entries.get(index);
    }

    private int indexOf(String id) {
        if (id == null) return -1;
        for (int index = 0; index < entries.size(); index += 1) {
            if (entries.get(index).id.equals(id)) return index;
        }
        return -1;
    }
}
