package com.thockdown.soundscapes;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The soundscape that is heard, for the whole process: one per process,
 * outliving the web page, the activity and the plugin, so the notification
 * and lock-screen controls work while the web page's JavaScript is paused,
 * and the schedule plays with the app closed.
 *
 * TWO THINGS DECIDE WHAT IS HEARD, and this class is the only place they are
 * combined:
 * - REGULAR MODE (Regular): STOPPED, PLAYING the soundscape the listener
 *   chose, or PAUSED on it. Playing or paused, it OVERRULES the schedule.
 * - THE SCHEDULE (SoundscapeSchedule): on or off, and, when on, the
 *   soundscape its current run plays, if one is under way (`scheduled`).
 * What is heard: regular PLAYING plays the chosen soundscape; PAUSED is
 * silence; STOPPED hands over to the schedule -- its run's soundscape, or
 * nothing at all, which ends the session (no service, no notification).
 * The SOURCE says which of the two is being heard, for the notification and
 * for the app's schedule button.
 *
 * The rules that move regular mode, from any client:
 * - choosing a soundscape (in the app, or next/previous) PLAYS it;
 * - play/pause toggles between PLAYING and PAUSED; pausing what the schedule
 *   plays makes it regular mode PAUSED on that soundscape, so pause always
 *   silences, and play resumes it;
 * - stop (the app's long press on its power button, the notification's
 *   close control, closing the app) makes it STOPPED, handing back to the
 *   schedule;
 * - while regular mode plays or is paused, the schedule is suspended; a
 *   pause left for PAUSE_STOP_MS becomes a STOP, so a forgotten pause
 *   cannot keep the schedule silent;
 * - THE TIMER (timer.ts): with a duration set, regular mode plays that long
 *   from when a soundscape was started or switched to, the countdown held
 *   while paused, and then STOPS, handing back to the schedule. It is silent
 *   at its end, having faded out over the fade it was handed -- or, when a
 *   scheduled run will be playing then, crossfaded into it over that fade,
 *   so the run is at full strength exactly at the timer's end.
 * The schedule's changes fade by the same rule: each event carries its fade
 * (schedule.ts), a stop or a switch fading out the entry that ends so it is
 * silent at its end time (the alarm comes that much early), a start fading
 * its entry in. A STOP hands over faster, over HANDOVER_FADE_SEC: the
 * listener asked for it.
 *
 * CLIENTS. The web page (BackgroundAudioPlugin) plays, pauses, stops,
 * configures and sets the volume, and publishes the soundscapes next and
 * previous step through, each with the configuration the engine would send
 * for it. The media controls (the service) and the schedule (its alarm)
 * act here directly; only their changes are REPORTED (Listener), since a
 * change the page made is one it knows -- a stop's outcome is returned to
 * it instead (state()) -- and echoing the page's own changes back would race
 * its next one. The page also asks for the state when it comes back to the
 * foreground.
 *
 * THE LIST IS STORED (LIBRARY_PREFERENCES), with the soundscape the page was
 * last on, because a client other than the page may ask for it before the
 * page has run since the process started: Android Auto browses the list and
 * plays from it through the service (SoundscapePlaybackService, a
 * MediaBrowserService) with the app never opened. Choosing from that list
 * (controlPlayFrom), play with nothing heard (controlPlay) and next/previous
 * therefore all OPEN a session when there is none, playing the soundscape
 * chosen, the one last heard, or the first.
 */
final class SoundscapeSession {
    enum Regular { STOPPED, PLAYING, PAUSED }

    /** What is heard: the listener's choice, the schedule, or nothing. */
    enum Source { REGULAR, SCHEDULE, NONE }

    interface Listener {
        /** A media control, the schedule or the system changed what is heard. */
        void onChanged(State state);
        /**
         * The timer's countdown started, held, or ended (`endsAtMs`,
         * `remainingMs` as in State). Sent for the page's own changes too:
         * it carries only the countdown, which the page cannot know, never
         * what is heard, so it cannot race the page's next request.
         */
        void onCountdown(long endsAtMs, long remainingMs);
        void onFailure(String message);
    }

    static final class State {
        final Regular regular;
        final Source source;
        /** The soundscape heard or paused on: an entry's id, or null. */
        final String currentId;
        final boolean scheduleEnabled;
        /** When what is heard ends (wall clock, ms): the timer's end, or the scheduled run's next change; -1 for none. */
        final long endsAtMs;
        /** The timer's time left while paused (ms); -1 for none. */
        final long remainingMs;

        State(Regular regular, Source source, String currentId, boolean scheduleEnabled, long endsAtMs, long remainingMs) {
            this.regular = regular;
            this.source = source;
            this.currentId = currentId;
            this.scheduleEnabled = scheduleEnabled;
            this.endsAtMs = endsAtMs;
            this.remainingMs = remainingMs;
        }

        /** The same in what it says is heard; when it ends follows from that and is not compared. */
        boolean sameAs(State other) {
            return regular == other.regular && source == other.source
                && java.util.Objects.equals(currentId, other.currentId) && scheduleEnabled == other.scheduleEnabled;
        }
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
    /**
     * The shortest a change of what is heard may take: a change of
     * soundscape is crossfaded, a start from silence (opening, resuming
     * from a pause) faded in, and a stop with nothing to hand over to faded
     * out, at least this long. The engine's
     * SOUNDSCAPE_SWITCH_SEC (SoundscapeEngine.ts), which the page's own
     * changes of soundscape arrive with.
     */
    private static final double SWITCH_FADE_SEC = 2;
    /** How long the hand-over takes when the listener stops regular mode: they asked for the change, so it comes promptly. */
    private static final double HANDOVER_FADE_SEC = 10;
    /** A fade back from an ending that was interrupted. */
    private static final double RESTORE_FADE_SEC = 0.5;
    /** How long a pause holds before it becomes a stop, handing back to the schedule. */
    private static final long PAUSE_STOP_MS = 30L * 60 * 1000;
    private static final String LIBRARY_PREFERENCES = "soundscape-library";
    private static final String LIBRARY_KEY = "library";
    private static SoundscapeSession instance;

    private final Context context;
    private Listener listener;
    private OutputLane output;
    /** Volatile: the output's writer thread reads it without the session's lock, which close() holds while joining that thread. */
    private volatile SoundscapeRenderer renderer;
    private Regular regular = Regular.STOPPED;
    /** The timer (timer.ts): how long regular mode plays, in seconds, 0 for no end, and the fade it ends over. */
    private double timerSec = 0;
    private double timerFadeSec = 0;
    /** The countdown: the time left (ms), -1 for none; while PLAYING, measured to `timerDeadline` (elapsedRealtime). */
    private long timerLeftMs = -1;
    private long timerDeadline = 0;
    private Runnable timerFade = null;
    private Runnable timerEnd = null;
    /** Whether the countdown's fade-out has begun on the output, to be undone if the countdown is. */
    private boolean timerFading = false;
    /**
     * The scheduled soundscape the countdown is crossfading into, or null:
     * a run in effect when the timer ends is faded in over the timer's fade,
     * finishing at its end, rather than after it from silence.
     */
    private Entry timerHandover = null;
    /**
     * The schedule's current run's soundscape, or null: outside a run, or the
     * schedule off. READ FROM THE STORED SCHEDULE by settle(), never carried
     * from event to event: the process may have been restarted since the run
     * began, and the entries may have been changed under it.
     */
    private Entry scheduled = null;
    private List<Entry> entries = Collections.emptyList();
    /** The soundscape regular mode plays or is paused on. */
    private String regularId = null;
    /**
     * The name of what regular mode plays, as the page published it: the
     * page may be playing unsaved settings, which are no entry, so its name
     * has to come from here.
     */
    private String regularName = null;
    private float masterVolume;
    /**
     * How the page's next configuration is applied, set when regular mode
     * starts playing; the page only knows its own last configuration, not
     * what the session was doing.
     * - CROSSFADE: something was heard (the schedule's soundscape), so the
     *   new one is a change of soundscape whatever the page says.
     * - REPLACE: nothing was heard (a new output, or one paused), so there
     *   is nothing to crossfade from: the new soundscape simply replaces
     *   what was queued and fades in alone.
     */
    private enum NextConfigure { AS_SENT, CROSSFADE, REPLACE }
    private NextConfigure nextConfigure = NextConfigure.AS_SENT;
    /** The end of a fade-out that ends the session, while one is under way. */
    private Runnable pendingEnd = null;
    /** The stop a pause becomes after PAUSE_STOP_MS, while paused. */
    private Runnable pauseStop = null;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());

    private SoundscapeSession(Context context) {
        this.context = context.getApplicationContext();
        // Until the web page publishes it: the schedule may start a session
        // with no web page at all.
        SoundscapeSchedule schedule = SoundscapeSchedule.load(this.context);
        masterVolume = schedule.masterVolume;
        scheduled = scheduledNow(schedule);
        loadLibrary();
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

    synchronized State state() {
        SoundscapeSchedule schedule = SoundscapeSchedule.load(context);
        long endsAt = -1;
        if (regular == Regular.PLAYING && timerLeftMs >= 0) {
            endsAt = System.currentTimeMillis() + (timerDeadline - android.os.SystemClock.elapsedRealtime());
        } else if (source() == Source.SCHEDULE) {
            endsAt = schedule.nextChangeMillis();
        }
        long remaining = regular == Regular.PAUSED ? timerLeftMs : -1;
        return new State(regular, source(), currentId(), schedule.enabled, endsAt, remaining);
    }

    synchronized Source source() {
        if (regular != Regular.STOPPED) return Source.REGULAR;
        return scheduled != null && output != null ? Source.SCHEDULE : Source.NONE;
    }

    /** Whether anything is heard (the notification's play/pause control). */
    synchronized boolean isAudible() {
        return output != null && (regular == Regular.PLAYING || (regular == Regular.STOPPED && scheduled != null));
    }

    synchronized boolean isActive() {
        return output != null;
    }

    synchronized String currentId() {
        return regular == Regular.STOPPED && scheduled != null ? scheduled.id : regularId;
    }

    /** "Soundscape: <name>" for whatever is heard, regular or scheduled; "Soundscape" when the name is unknown. */
    synchronized String title() {
        String id = currentId();
        Entry entry = find(id);
        String name = entry != null ? entry.name : (id == null || id.equals(regularId) ? regularName : null);
        return name != null && !name.isEmpty() ? "Soundscape: " + name : "Soundscape";
    }

    /** The soundscapes next and previous step through: what Android Auto browses. */
    synchronized List<Entry> entries() {
        return entries;
    }

    // --- From the web page ---

    /** The soundscapes next and previous step through, the one the page is on, and the listener's volume. */
    synchronized void publish(List<Entry> published, String current, String currentName, float volume) {
        entries = new ArrayList<>(published);
        if (regular != Regular.STOPPED || current != null || currentName != null) {
            regularId = current;
            regularName = currentName;
        }
        masterVolume = volume;
        saveLibrary();
        SoundscapePlaybackService.libraryChanged();
        // What the schedule plays is not reached by the page's engine, which
        // is closed then: its volume is followed here.
        if (source() == Source.SCHEDULE) output.setVolume(masterVolume, VOLUME_TIME_CONSTANT_SEC);
        refreshService();
    }

    /** Regular mode PLAYING (the engine opened its playback): open, resume, or take over from the schedule. */
    synchronized void play() {
        cancelPendingEnd();
        Regular before = regular;
        if (regular != Regular.PLAYING) {
            nextConfigure = output != null && !output.isPaused() ? NextConfigure.CROSSFADE : NextConfigure.REPLACE;
        }
        setRegular(Regular.PLAYING);
        if (before == Regular.STOPPED) startCountdown();
        else if (before == Regular.PAUSED) runCountdown();
        if (output == null) {
            open(find(regularId));
            output.fadeFrom(0f, 1f, SWITCH_FADE_SEC);
        } else if (output.isPaused()) {
            fadeIn(SWITCH_FADE_SEC);
        }
        refreshService();
    }

    /** Regular mode PAUSED (the engine closed its playback); only from PLAYING -- a stop that came first stands. */
    synchronized void pause() {
        if (regular != Regular.PLAYING || output == null) return;
        setRegular(Regular.PAUSED);
        holdCountdown();
        output.setPaused(true);
        refreshService();
    }

    /** Regular mode STOPPED: the schedule takes over, or the session ends. Returns the outcome. */
    synchronized State stop() {
        setRegular(Regular.STOPPED);
        settle(HANDOVER_FADE_SEC, SWITCH_FADE_SEC);
        return state();
    }

    /** From the page's engine: `transitionSec` 0 for a settings change, else a change of soundscape crossfaded that long. */
    synchronized void configure(String configuration, double transitionSec) {
        if (renderer == null || regular != Regular.PLAYING) return;
        // A change of soundscape is a new play: the timer counts from it.
        if (transitionSec > 0) startCountdown();
        if (nextConfigure == NextConfigure.CROSSFADE) transitionSec = Math.max(transitionSec, SWITCH_FADE_SEC);
        if (nextConfigure == NextConfigure.REPLACE) {
            // Playing again after silence: start from silence, not from the
            // soundscape the output held when it paused (heard fading out
            // under the new one otherwise).
            nextConfigure = NextConfigure.AS_SENT;
            output.discardQueued();
            output.fadeFrom(0f, 1f, SWITCH_FADE_SEC);
            renderer.restart(configuration);
            return;
        }
        nextConfigure = NextConfigure.AS_SENT;
        if (transitionSec > 0) renderer.transition(configuration, transitionSec);
        else renderer.configure(configuration);
    }

    /** The engine's volume: regular mode's alone. A fade-out it sends while handing over must not silence the schedule. */
    synchronized void setVolume(float volume, double timeConstantSec) {
        if (output != null && regular == Regular.PLAYING) output.setVolume(volume, timeConstantSec);
    }

    // --- From the media controls and the system ---

    synchronized void controlPlay() {
        if (output == null) {
            // Nothing is heard and there is no session: play what was heard last, or the first soundscape.
            Entry entry = find(regularId);
            if (entry == null && !entries.isEmpty()) entry = entries.get(0);
            if (entry != null) choose(entry);
            return;
        }
        if (regular != Regular.PAUSED) return;
        setRegular(Regular.PLAYING);
        fadeIn(SWITCH_FADE_SEC);
        runCountdown();
        // The page may have faded the output to silence before it paused it.
        output.setVolume(masterVolume, VOLUME_TIME_CONSTANT_SEC);
        refreshService();
        report();
    }

    /** Pause always silences: what the schedule plays becomes regular mode, paused on it. */
    synchronized void controlPause() {
        if (!isAudible()) return;
        if (regular == Regular.STOPPED) {
            regularId = scheduled.id;
            regularName = scheduled.name;
        }
        cancelPendingEnd();
        setRegular(Regular.PAUSED);
        holdCountdown();
        output.setPaused(true);
        refreshService();
        report();
    }

    /** Step `direction` (+1 or -1) through the published soundscapes, wrapping: choosing one plays it. */
    synchronized void controlSkip(int direction) {
        if (entries.isEmpty()) return;
        int index = indexOf(currentId());
        int next = index < 0
            ? (direction > 0 ? 0 : entries.size() - 1)
            : Math.floorMod(index + direction, entries.size());
        choose(entries.get(next));
    }

    /** A soundscape chosen by id (Android Auto's list): play it. */
    synchronized void controlPlayFrom(String id) {
        Entry entry = find(id);
        if (entry != null) choose(entry);
    }

    /** Regular mode PLAYING `entry`, opening a session if there is none. */
    private void choose(Entry entry) {
        cancelPendingEnd();
        regularId = entry.id;
        regularName = entry.name;
        setRegular(Regular.PLAYING);
        startCountdown();
        if (output == null) {
            open(entry);
            output.fadeFrom(0f, 1f, SWITCH_FADE_SEC);
        } else if (output.isPaused()) {
            // From a pause nothing is heard to crossfade from: the new
            // soundscape replaces what was queued and fades in alone.
            output.discardQueued();
            renderer.restart(entry.configuration);
            fadeIn(SWITCH_FADE_SEC);
        } else {
            renderer.transition(entry.configuration, SWITCH_FADE_SEC);
        }
        output.setVolume(masterVolume, VOLUME_TIME_CONSTANT_SEC);
        saveLibrary();
        refreshService();
        report();
    }

    /** The notification's close control, or the app being closed: regular mode stops; the schedule carries on. */
    synchronized void controlStop() {
        setRegular(Regular.STOPPED);
        settle(HANDOVER_FADE_SEC, SWITCH_FADE_SEC);
        report();
    }

    // --- From the schedule ---

    /** The schedule changed (turned on or off, or its entries edited), or the device rebooted: apply its state at this moment. */
    synchronized void applyScheduleState() {
        State before = state();
        SoundscapeSchedule schedule = SoundscapeSchedule.load(context);
        SoundscapeSchedule.Event current = schedule.current();
        // Turned on in a run: it fades in over its fade. Turned off: what it
        // played goes like a stop, which the listener asked for.
        double fade = !schedule.enabled ? HANDOVER_FADE_SEC
            : current != null ? Math.max(current.fadeSec, SWITCH_FADE_SEC) : SWITCH_FADE_SEC;
        settle(fade, fade);
        // Reported even when the page changed the schedule, since what is
        // heard, and from which source, is the session's to work out -- but
        // only when that changed. The page sends the schedule on every edit
        // of a soundscape, and a report of a state the page already caused
        // lands in the middle of its own requests: the session paused for a
        // silent soundscape reported PAUSED after the page had asked to play
        // again, and the page took that as the listener pausing, so a channel
        // turned on after a reset stayed silent until the next edit.
        if (!state().sameAs(before)) report();
    }

    /**
     * The schedule's alarm: its events have begun, the latest taking
     * `fadeSec`. Regular mode, playing or paused, suspends the schedule,
     * which then changes nothing.
     */
    synchronized void applyScheduleEvents(double fadeSec) {
        settle(fadeSec, fadeSec);
        report();
    }

    // --- The timer ---

    /** The timer, from the page: `seconds` 0 for none. Changed while playing, it counts again from now. */
    synchronized void setTimer(double seconds, double fadeSec) {
        timerSec = Math.max(0, seconds);
        timerFadeSec = Math.max(0, fadeSec);
        saveLibrary();
        if (regular == Regular.PLAYING) {
            startCountdown();
        } else if (regular == Regular.PAUSED) {
            timerLeftMs = timerSec > 0 ? Math.round(timerSec * 1000) : -1;
            reportCountdown();
        }
    }

    /** A play begins (a start, or a change of soundscape): the whole duration again, or none. */
    private void startCountdown() {
        clearCountdownCallbacks();
        timerLeftMs = timerSec > 0 ? Math.round(timerSec * 1000) : -1;
        runCountdown();
    }

    /** Count the time left down while PLAYING: fade out over the timer's fade (or what is left of it), then stop. */
    private void runCountdown() {
        clearCountdownCallbacks();
        if (timerLeftMs < 0 || regular != Regular.PLAYING) {
            reportCountdown();
            return;
        }
        long now = android.os.SystemClock.elapsedRealtime();
        timerDeadline = now + timerLeftMs;
        long fadeMs = Math.round(timerFadeSec * 1000);
        timerFade = () -> {
            synchronized (SoundscapeSession.this) {
                timerFade = null;
                long left = timerDeadline - android.os.SystemClock.elapsedRealtime();
                if (output == null || renderer == null || left <= 0) return;
                Entry next = SoundscapeSchedule.load(context).playingAt(System.currentTimeMillis() + left);
                if (next != null) {
                    renderer.transition(next.configuration, left / 1000.0);
                    timerHandover = next;
                } else {
                    output.setFade(0f, left / 1000.0);
                    timerFading = true;
                }
            }
        };
        timerEnd = () -> {
            synchronized (SoundscapeSession.this) {
                timerEnd = null;
                timerExpired();
            }
        };
        main.postDelayed(timerFade, Math.max(0, timerLeftMs - fadeMs));
        main.postDelayed(timerEnd, timerLeftMs);
        reportCountdown();
    }

    /** Paused: the countdown holds what is left. */
    private void holdCountdown() {
        if (timerLeftMs >= 0 && (timerFade != null || timerEnd != null)) {
            timerLeftMs = Math.max(0, timerDeadline - android.os.SystemClock.elapsedRealtime());
        }
        clearCountdownCallbacks();
        reportCountdown();
    }

    private void reportCountdown() {
        if (listener == null) return;
        State now = state();
        listener.onCountdown(now.endsAtMs, now.remainingMs);
    }

    private void clearCountdownCallbacks() {
        // A fade-out under way is undone: the play goes on after all (or
        // is paused, and a resume fades in from silence regardless).
        if (timerFading) {
            timerFading = false;
            if (output != null) output.setFade(1f, RESTORE_FADE_SEC);
        }
        if (timerHandover != null) {
            timerHandover = null;
            // The crossfade into the schedule is turned back to what plays.
            Entry own = find(regularId);
            if (renderer != null && own != null) renderer.transition(own.configuration, SWITCH_FADE_SEC);
        }
        if (timerFade != null) main.removeCallbacks(timerFade);
        if (timerEnd != null) main.removeCallbacks(timerEnd);
        timerFade = null;
        timerEnd = null;
    }

    /**
     * The timer ran out: regular mode stops. If a scheduled run was due it
     * has already been crossfaded in and carries on; otherwise the output
     * is silent by now and the session ends, or a run that began since
     * fades in from silence.
     */
    private void timerExpired() {
        if (regular != Regular.PLAYING) return;
        Entry handedTo = timerHandover;
        timerHandover = null;
        if (handedTo != null) {
            // Already crossfaded into the run: it simply goes on, unless the
            // schedule has changed under the crossfade.
            setRegular(Regular.STOPPED);
            scheduled = scheduledNow(SoundscapeSchedule.load(context));
            if (scheduled == null || !scheduled.id.equals(handedTo.id)) settle(SWITCH_FADE_SEC, SWITCH_FADE_SEC);
            else output.setVolume(masterVolume, VOLUME_TIME_CONSTANT_SEC);
            refreshService();
            report();
            return;
        }
        if (output != null) output.setPaused(true);
        setRegular(Regular.STOPPED);
        SoundscapeSchedule.Event current = SoundscapeSchedule.load(context).current();
        double fade = current != null ? Math.max(current.fadeSec, SWITCH_FADE_SEC) : SWITCH_FADE_SEC;
        settle(fade, 0);
        report();
    }

    /** The soundscape of the run the stored schedule is in at this moment, or null. */
    private static Entry scheduledNow(SoundscapeSchedule schedule) {
        SoundscapeSchedule.Event current = schedule.enabled ? schedule.current() : null;
        return current == null || "stop".equals(current.kind) ? null : schedule.entry(current.presetId);
    }

    /**
     * Make what is heard follow regular mode and the schedule, after either
     * changed: with regular mode STOPPED, play the schedule's run -- fading
     * in from silence, or transitioning from whatever was heard -- or, with
     * no run, fade out and end: over `fadeSec` into the run, over
     * `endSec` into silence. Regular mode PLAYING or PAUSED is already what
     * is heard, and the schedule changes nothing.
     */
    private void settle(double fadeSec, double endSec) {
        scheduled = scheduledNow(SoundscapeSchedule.load(context));
        if (regular != Regular.STOPPED) {
            refreshService();
            return;
        }
        if (scheduled == null) {
            endSession(endSec);
            return;
        }
        cancelPendingEnd();
        if (output == null) {
            open(scheduled);
            output.fadeFrom(0f, 1f, fadeSec);
        } else if (output.isPaused()) {
            // Nothing is heard to crossfade from: the run replaces what was queued.
            output.discardQueued();
            renderer.restart(scheduled.configuration);
            fadeIn(fadeSec);
        } else {
            renderer.transition(scheduled.configuration, fadeSec);
            output.setFade(1f, RESTORE_FADE_SEC);
        }
        output.setVolume(masterVolume, VOLUME_TIME_CONSTANT_SEC);
        refreshService();
    }

    /** End the session: at once if nothing is heard, after a fade-out if something is. */
    private void endSession(double fadeSec) {
        if (output == null) return;
        if (output.isPaused()) {
            close();
            return;
        }
        if (pendingEnd != null) return;
        output.setFade(0f, fadeSec);
        pendingEnd = () -> {
            synchronized (SoundscapeSession.this) {
                pendingEnd = null;
                close();
                report();
            }
        };
        main.postDelayed(pendingEnd, Math.round(fadeSec * 1000));
        refreshService();
    }

    /** Resume a paused output, faded in from silence over `seconds`. */
    private void fadeIn(double seconds) {
        output.fadeFrom(0f, 1f, seconds);
        output.setPaused(false);
    }

    /** An ending abandoned: something is to be heard after all. */
    private void cancelPendingEnd() {
        if (pendingEnd == null) return;
        main.removeCallbacks(pendingEnd);
        pendingEnd = null;
        if (output != null) output.setFade(1f, RESTORE_FADE_SEC);
    }

    // --- Internals ---

    /** Move regular mode; stopping it ends the countdown. */
    private void setRegular(Regular next) {
        if (pauseStop != null) {
            main.removeCallbacks(pauseStop);
            pauseStop = null;
        }
        if (next == Regular.PAUSED) {
            pauseStop = () -> {
                synchronized (SoundscapeSession.this) {
                    pauseStop = null;
                    if (regular != Regular.PAUSED) return;
                    setRegular(Regular.STOPPED);
                    settle(HANDOVER_FADE_SEC, SWITCH_FADE_SEC);
                    report();
                }
            };
            main.postDelayed(pauseStop, PAUSE_STOP_MS);
        }
        if (next == Regular.STOPPED) {
            clearCountdownCallbacks();
            timerLeftMs = -1;
        }
        regular = next;
    }

    private void open(Entry entry) {
        // The renderer reads the output's playhead and the output wakes the
        // renderer as it plays: each needs the other, so the output's
        // listener reaches the renderer through the field.
        output = AudioOutput.openLane(() -> {
            SoundscapeRenderer current = renderer;
            if (current != null) current.wake();
        });
        renderer = new SoundscapeRenderer(context, output, this::failed);
        if (entry != null) renderer.configure(entry.configuration);
    }

    private void failed(String message) {
        Listener current;
        synchronized (this) {
            setRegular(Regular.STOPPED);
            close();
            current = listener;
        }
        if (current != null) current.onFailure(message);
    }

    /** Close the output and the renderer and stop the service. */
    private void close() {
        if (renderer != null) {
            renderer.close();
            renderer = null;
        }
        if (output != null) {
            output.close();
            output = null;
        }
        context.stopService(new Intent(context, SoundscapePlaybackService.class));
        // Android Auto may keep the service bound past the stop: it leaves the foreground instead.
        SoundscapePlaybackService.sessionEnded();
    }

    /** Store the list and the soundscape last chosen, for a client that asks before the page has run. */
    private void saveLibrary() {
        try {
            JSONArray array = new JSONArray();
            for (Entry entry : entries) {
                array.put(new JSONObject().put("id", entry.id).put("name", entry.name).put("configuration", entry.configuration));
            }
            JSONObject json = new JSONObject().put("entries", array).put("masterVolume", (double) masterVolume);
            if (regularId != null) json.put("currentId", regularId);
            if (regularName != null) json.put("currentName", regularName);
            json.put("timerSec", timerSec).put("timerFadeSec", timerFadeSec);
            preferences().edit().putString(LIBRARY_KEY, json.toString()).apply();
        } catch (Exception ignored) {
            // JSONObject.put throws only for a non-finite number, which a volume is not.
        }
    }

    private void loadLibrary() {
        String stored = preferences().getString(LIBRARY_KEY, null);
        try {
            // Nothing published yet (a fresh install, or opened from Android
            // Auto before the app has run): the factory soundscapes, written
            // into the assets at build time by scripts/writeFactoryLibrary.ts.
            JSONObject json = new JSONObject(stored != null ? stored : factoryLibrary());
            JSONArray array = json.getJSONArray("entries");
            List<Entry> loaded = new ArrayList<>();
            for (int index = 0; index < array.length(); index += 1) {
                JSONObject entry = array.getJSONObject(index);
                loaded.add(new Entry(entry.getString("id"), entry.getString("name"), entry.getString("configuration")));
            }
            entries = loaded;
            regularId = json.optString("currentId", null);
            regularName = json.optString("currentName", null);
            masterVolume = (float) json.optDouble("masterVolume", masterVolume);
            timerSec = json.optDouble("timerSec", 0);
            timerFadeSec = json.optDouble("timerFadeSec", 0);
        } catch (Exception corrupt) {
            // Unreadable: as if never stored; the page's next publish replaces it.
        }
    }

    private String factoryLibrary() throws java.io.IOException {
        try (java.io.InputStream in = context.getAssets().open("factory-soundscapes.json")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int read; (read = in.read(buffer)) > 0; ) bytes.write(buffer, 0, read);
            return bytes.toString("UTF-8");
        }
    }

    private SharedPreferences preferences() {
        return context.getSharedPreferences(LIBRARY_PREFERENCES, Context.MODE_PRIVATE);
    }

    private void report() {
        if (listener != null) listener.onChanged(state());
    }

    /**
     * Have the service redraw (it reads this state itself), starting it if
     * it is not running. Only starting it goes through the system: a
     * foreground service may not be STARTED from the background, except from
     * an exact alarm, and it is already running when the media controls are
     * pressed.
     */
    private void refreshService() {
        if (output == null) return;
        if (SoundscapePlaybackService.refreshIfRunning()) return;
        try {
            ContextCompat.startForegroundService(context, new Intent(context, SoundscapePlaybackService.class));
        } catch (RuntimeException refused) {
            // Refused a start from the background: end rather than play with
            // no service to keep the process, or the listener, informed.
            setRegular(Regular.STOPPED);
            close();
            Listener current = listener;
            if (current != null) current.onFailure("Soundscape could not start in the background: " + refused);
        }
    }

    /** An entry of the published list, or failing that of the schedule, which may name soundscapes outside it. */
    private Entry find(String id) {
        int index = indexOf(id);
        if (index >= 0) return entries.get(index);
        if (id == null) return null;
        if (scheduled != null && scheduled.id.equals(id)) return scheduled;
        return SoundscapeSchedule.load(context).entry(id);
    }

    private int indexOf(String id) {
        if (id == null) return -1;
        for (int index = 0; index < entries.size(); index += 1) {
            if (entries.get(index).id.equals(id)) return index;
        }
        return -1;
    }
}
