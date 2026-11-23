package com.thockdown.soundscapes;

/**
 * One source's queue in the app's output (AudioOutput): the soundscape's,
 * or the music's. Each is rendered ahead by its own renderer and has its
 * own volume, fade and pause; the output sums them, limits the sum and
 * plays it.
 *
 * THE QUEUE holds interleaved 16-bit stereo frames at absolute positions,
 * the lane's own (its renderer counts from 0), in a ring of CAPACITY_SEC.
 * `write` puts a block at its position and REPLACES everything queued after
 * that position (that is how a settings change arrives, already crossfaded
 * by the renderer); a part already behind the playhead is dropped. Samples
 * arrive at half scale (HEADROOM), so a mix may exceed full scale before the
 * volume brings it down.
 *
 * THE PLAYHEAD (playheadFrame) is how far the output has taken audio from
 * this lane and handed it to the device, which is as far as a splice can no
 * longer reach. It starts at the lane's first write and moves with the
 * output's clock: what is not queued is played as silence. Every
 * REPORT_FRAMES the lane calls its listener, which is what lets its renderer
 * render more.
 *
 * THE VOLUME is the listener's, glided so a change is not heard as a step.
 * A FADE is a second gain, linear over a set time, for a schedule's fade in
 * and out of a run (SoundscapeSession): separate from the volume, which is
 * restored on its own.
 *
 * PAUSED, it glides to silence, then holds: its playhead stops, so the
 * queue waits where it is and its renderer, its lead full, waits with it.
 * Resuming carries on from the same frame.
 */
final class OutputLane {
    interface Listener {
        void onProgress();
    }

    private static final double CAPACITY_SEC = 12;
    private static final int REPORT_FRAMES = 2048;
    /** Renderers encode samples at 1/HEADROOM of their value. */
    static final float HEADROOM = 2f;
    /** Below this gain a paused lane is silent enough to hold. */
    private static final float SILENT = 1e-4f;
    private static final double PAUSE_FADE_SEC = 0.03;

    final int sampleRate;
    private final AudioOutput output;
    private final Listener listener;
    private final short[] ring;
    private final int capacity;
    private long playhead = 0;
    private long end = 0;
    private boolean started = false;
    private boolean closed = false;
    private int sinceReport = 0;

    private float volume = 0f;
    private float volumeTarget = 0f;
    private float volumeStep = 1f;
    private float listenerVolume = 0f;
    private float fade = 1f;
    private float fadeTarget = 1f;
    private float fadeStep = 1f;
    /** A value the fade must start from, taken at the next block; NaN for none. */
    private float fadeStart = Float.NaN;
    private boolean paused = false;
    /** The largest sample this lane added to the mix since `diagnostics` last read it, at full scale 1. */
    private float peak = 0f;

    OutputLane(AudioOutput output, Listener listener) {
        this.output = output;
        this.listener = listener;
        sampleRate = output.sampleRate;
        capacity = (int) Math.ceil(CAPACITY_SEC * sampleRate);
        ring = new short[capacity * 2];
    }

    /** How far audio has been handed to the device: as far as a splice can no longer reach. */
    long playheadFrame() {
        synchronized (output) {
            return playhead;
        }
    }

    /** What the device holds beyond the playhead: the least a splice must leave. */
    double committedSec() {
        return output.committedSec();
    }

    /** Queue `samples` (interleaved stereo) at `startFrame`, replacing whatever is queued from there on. */
    void write(long startFrame, short[] samples) {
        synchronized (output) {
            int frames = samples.length / 2;
            if (!started) {
                started = true;
                playhead = startFrame;
                end = startFrame;
            }
            int skip = 0;
            if (startFrame < playhead) {
                skip = (int) Math.min(frames, playhead - startFrame);
                if (skip >= frames) return;
            }
            long from = startFrame + skip;
            // A gap before this block (never expected) plays as silence.
            for (long frame = end; frame < from; frame += 1) {
                int slot = (int) (frame % capacity) * 2;
                ring[slot] = 0;
                ring[slot + 1] = 0;
            }
            for (int index = skip; index < frames; index += 1) {
                int slot = (int) ((startFrame + index) % capacity) * 2;
                ring[slot] = samples[index * 2];
                ring[slot + 1] = samples[(index * 2) + 1];
            }
            end = startFrame + frames;
            output.notifyAll();
        }
    }

    /** Drop everything queued past the playhead: it plays as silence until new audio is written. */
    void discardQueued() {
        synchronized (output) {
            if (started) end = Math.min(end, playhead);
        }
    }

    /** The listener's volume: glide to `target` with time constant `timeConstantSec` (once resumed, if paused). */
    void setVolume(float target, double timeConstantSec) {
        synchronized (output) {
            listenerVolume = target;
            if (!paused) glideTo(target, timeConstantSec);
        }
    }

    /** Move the fade gain linearly to `target` (0..1) over `seconds`, from where it is. */
    void setFade(float target, double seconds) {
        synchronized (output) {
            fadeStep = (float) (1 / Math.max(1, seconds * sampleRate));
            fadeTarget = target;
        }
    }

    /**
     * Set the fade gain to `from` at the next block, then move it to `to`
     * over `seconds`. One call, because "jump to silence, then ramp up" as
     * two calls arrives as one: the writer only ever saw the second.
     */
    void fadeFrom(float from, float to, double seconds) {
        synchronized (output) {
            fadeStart = from;
            setFade(to, seconds);
        }
    }

    boolean isPaused() {
        synchronized (output) {
            return paused;
        }
    }

    /** Fade out and hold the playhead where it is, or fade back in from it. */
    void setPaused(boolean pause) {
        synchronized (output) {
            if (pause == paused) return;
            paused = pause;
            glideTo(pause ? 0f : listenerVolume, PAUSE_FADE_SEC);
            output.notifyAll();
        }
    }

    /** Leave the output; the output closes once no lane is left. */
    void close() {
        synchronized (output) {
            if (closed) return;
            closed = true;
        }
        output.removeLane(this);
    }

    private void glideTo(float target, double timeConstantSec) {
        volumeStep = (float) (1 - Math.exp(-1 / (Math.max(0.001, timeConstantSec) * sampleRate)));
        volumeTarget = target;
    }

    /** Paused and faded out: contributes nothing and its playhead stands still. Under the output's lock. */
    boolean holding() {
        return paused && Math.abs(volume) < SILENT;
    }

    /**
     * Add the lane's next `frames` (at its gains, back to full scale) into
     * `mix`, interleaved stereo, and move the playhead past them. Under the
     * output's lock. Returns whether a progress report is due.
     */
    boolean mixInto(float[] mix, int frames) {
        if (holding()) return false;
        if (!Float.isNaN(fadeStart)) {
            fade = fadeStart;
            fadeStart = Float.NaN;
        }
        int available = started ? (int) Math.max(0, Math.min(frames, end - playhead)) : 0;
        // The gains move only once audio has arrived: a renderer takes a
        // moment to start, and a fade-in run over that silence would be over
        // before the first sample, which then starts at full level.
        boolean ramp = started;
        for (int index = 0; index < frames; index += 1) {
            if (ramp) {
                volume += (volumeTarget - volume) * volumeStep;
                fade = fade < fadeTarget ? Math.min(fadeTarget, fade + fadeStep) : Math.max(fadeTarget, fade - fadeStep);
            }
            if (index >= available) continue;
            float gain = volume * fade * HEADROOM / 32768f;
            int slot = (int) ((playhead + index) % capacity) * 2;
            float left = ring[slot] * gain;
            float right = ring[slot + 1] * gain;
            mix[index * 2] += left;
            mix[(index * 2) + 1] += right;
            peak = Math.max(peak, Math.max(Math.abs(left), Math.abs(right)));
        }
        if (!started) return false;
        // Silence still moves the playhead: positions are time.
        playhead += frames;
        sinceReport += frames;
        if (sinceReport < REPORT_FRAMES) return false;
        sinceReport = 0;
        return true;
    }

    /** The lane's state for the app's Debugging section; resets the peak. */
    String diagnostics() {
        synchronized (output) {
            String text = String.format(java.util.Locale.ROOT,
                "started %b, paused %b, volume %.3f (target %.3f, listener %.3f), fade %.3f, playhead %d, queued %d frames, peak %.4f",
                started, paused, volume, volumeTarget, listenerVolume, fade, playhead, end - playhead, peak);
            peak = 0f;
            return text;
        }
    }

    /** Called by the output, outside its lock, when `mixInto` said a report is due. */
    void reportProgress() {
        listener.onProgress();
    }
}
