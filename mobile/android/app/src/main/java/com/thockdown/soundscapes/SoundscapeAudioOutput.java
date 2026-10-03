package com.thockdown.soundscapes;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Process;

/**
 * Android's output for the soundscape: the finished audio, rendered ahead
 * by SoundscapeRenderer in this same process, played by the platform's
 * AudioTrack from a queue held here.
 *
 * This is what keeps playback going through an app switch. The WebView's
 * own audio output pauses or stalls briefly whenever the app leaves the
 * foreground, and anything queued on the web side waits behind it; a queue
 * in this process, written to the device by a thread of audio priority,
 * does not.
 *
 * THE QUEUE holds interleaved 16-bit stereo frames at absolute positions,
 * in a ring of CAPACITY_SEC. `write` puts a block at its position and
 * REPLACES everything queued after that position (that is how a settings
 * change arrives, already crossfaded by the worker); a part already behind
 * the playhead is dropped. Samples arrive at half scale (HEADROOM), so the
 * mix may exceed full scale before the volume brings it down.
 *
 * THE WRITER takes BLOCK_FRAMES at a time from the playhead, applies the
 * listener's volume (glided, so a change is not heard as a step), and
 * writes them to the AudioTrack, blocking while its buffer is full; what is
 * not queued is played as silence and counted. The playhead
 * (playheadFrame) is how far it has handed audio to the AudioTrack, which is
 * as far as a splice can no longer reach; every REPORT_FRAMES it calls the
 * listener's onProgress, which is what lets the renderer render more.
 *
 * A FADE is a second gain, linear over a set time, for the schedule's
 * fade in and out of a run (SoundscapeSession): separate from the volume,
 * which is the listener's and is restored on its own.
 *
 * PAUSED, it glides to silence, then pauses the AudioTrack and stops
 * moving the playhead, so the queue waits where it is and the renderer,
 * its lead full, waits with it. Resuming carries on from the same frame.
 *
 * A write the AudioTrack refuses (a negative result: ERROR_DEAD_OBJECT when
 * the audio system has invalidated the track, for instance on a route
 * change or a restart of the audio server) is not the end of playback: the
 * track is released and built again. Stopping there instead would leave the
 * queue full, the app showing a soundscape playing, and nothing heard.
 */
final class SoundscapeAudioOutput {
    interface Listener {
        void onProgress();
    }

    private static final double CAPACITY_SEC = 12;
    private static final int BLOCK_FRAMES = 1024;
    private static final int REPORT_FRAMES = 2048;
    /** The web side encodes samples at 1/HEADROOM of their value. */
    static final float HEADROOM = 2f;
    /** Below this gain a paused output is silent enough to stop. */
    private static final float SILENT = 1e-4f;
    private static final double PAUSE_FADE_SEC = 0.03;

    final int sampleRate;
    private final Listener listener;
    private AudioTrack track;
    private final int bufferBytes;
    private final Thread writer;
    private volatile boolean running = true;

    private final short[] ring;
    private final int capacity;
    private long playhead = 0;
    private long end = 0;
    private boolean started = false;

    private float volume = 0f;
    private volatile float volumeTarget = 0f;
    private volatile float volumeStep = 1f;
    private float listenerVolume = 0f;
    private float fade = 1f;
    private float fadeTarget = 1f;
    private float fadeStep = 1f;
    /** A value the fade must start from, set by fadeFrom and taken by the writer at its next block; NaN for none. */
    private float fadeStart = Float.NaN;
    private boolean paused = false;

    SoundscapeAudioOutput(Listener listener) {
        this.listener = listener;
        sampleRate = AudioTrack.getNativeOutputSampleRate(AudioManager.STREAM_MUSIC);
        capacity = (int) Math.ceil(CAPACITY_SEC * sampleRate);
        ring = new short[capacity * 2];
        int minimum = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        // A small device buffer: the long one is the queue above.
        bufferBytes = Math.max(minimum * 2, BLOCK_FRAMES * 4 * 4);
        track = buildTrack();
        track.play();
        writer = new Thread(this::run, "SoundscapeAudioOutput");
        writer.start();
    }

    private AudioTrack buildTrack() {
        return new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build())
            .setAudioFormat(new AudioFormat.Builder()
                .setSampleRate(sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .build())
            .setBufferSizeInBytes(bufferBytes)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build();
    }

    /** How far audio has been handed to the device: as far as a splice can no longer reach. */
    synchronized long playheadFrame() {
        return playhead;
    }

    /** Frames the device buffer and one writer block hold beyond the playhead: the least a splice must leave. */
    double committedSec() {
        return ((double) bufferBytes / 4 + BLOCK_FRAMES) / sampleRate;
    }

    /** Queue `samples` (interleaved stereo) at `startFrame`, replacing whatever is queued from there on. */
    synchronized void write(long startFrame, short[] samples) {
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
    }

    /** The listener's volume: glide to `target` with time constant `timeConstantSec` (once resumed, if paused). */
    synchronized void setVolume(float target, double timeConstantSec) {
        listenerVolume = target;
        if (!paused) glideTo(target, timeConstantSec);
    }

    /** Move the fade gain linearly to `target` (0..1) over `seconds`, from where it is. */
    synchronized void setFade(float target, double seconds) {
        fadeStep = (float) (1 / Math.max(1, seconds * sampleRate));
        fadeTarget = target;
    }

    /**
     * Set the fade gain to `from` at the next block, then move it to `to`
     * over `seconds`. One call, because "jump to silence, then ramp up" as
     * two calls arrives as one: the writer only ever saw the second.
     */
    synchronized void fadeFrom(float from, float to, double seconds) {
        fadeStart = from;
        setFade(to, seconds);
    }

    synchronized boolean isPaused() {
        return paused;
    }

    /** Fade out and hold the playhead where it is, or fade back in from it. */
    synchronized void setPaused(boolean pause) {
        if (pause == paused) return;
        paused = pause;
        glideTo(pause ? 0f : listenerVolume, PAUSE_FADE_SEC);
        notifyAll();
    }

    private void glideTo(float target, double timeConstantSec) {
        volumeStep = (float) (1 - Math.exp(-1 / (Math.max(0.001, timeConstantSec) * sampleRate)));
        volumeTarget = target;
    }

    void close() {
        synchronized (this) {
            running = false;
            notifyAll();
        }
        writer.interrupt();
        try {
            writer.join(500);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        track.stop();
        track.release();
    }

    private void run() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        short[] block = new short[BLOCK_FRAMES * 2];
        int sinceReport = 0;
        float toFade;
        float fadeBy;
        while (running) {
            synchronized (this) {
                if (paused && Math.abs(volume) < SILENT) {
                    track.pause();
                    try {
                        while (running && paused) wait();
                    } catch (InterruptedException ignored) {
                        return;
                    }
                    if (!running) return;
                    track.play();
                }
                int available = started ? (int) Math.max(0, Math.min(BLOCK_FRAMES, end - playhead)) : 0;
                for (int index = 0; index < available; index += 1) {
                    int slot = (int) ((playhead + index) % capacity) * 2;
                    block[index * 2] = ring[slot];
                    block[(index * 2) + 1] = ring[slot + 1];
                }
                java.util.Arrays.fill(block, available * 2, block.length, (short) 0);
                // Silence still moves the playhead: positions are time.
                if (started) playhead += BLOCK_FRAMES;
                if (!Float.isNaN(fadeStart)) {
                    fade = fadeStart;
                    fadeStart = Float.NaN;
                }
                toFade = fadeTarget;
                fadeBy = fadeStep;
            }
            float target = volumeTarget;
            float step = volumeStep;
            for (int index = 0; index < BLOCK_FRAMES; index += 1) {
                volume += (target - volume) * step;
                fade = fade < toFade ? Math.min(toFade, fade + fadeBy) : Math.max(toFade, fade - fadeBy);
                float gain = volume * fade * HEADROOM;
                for (int channel = 0; channel < 2; channel += 1) {
                    float value = block[(index * 2) + channel] * gain;
                    block[(index * 2) + channel] = (short) Math.max(-32768, Math.min(32767, Math.round(value)));
                }
            }
            int offset = 0;
            while (running && offset < block.length) {
                int written = track.write(block, offset, block.length - offset, AudioTrack.WRITE_BLOCKING);
                if (written < 0) {
                    try {
                        track.release();
                    } catch (RuntimeException ignored) {
                        // Already unusable; it is being replaced.
                    }
                    track = buildTrack();
                    track.play();
                    // The block is dropped rather than retried into the new
                    // track: positions are time, and it is already late.
                    break;
                }
                offset += written;
            }
            if (!started) continue;
            sinceReport += BLOCK_FRAMES;
            if (sinceReport >= REPORT_FRAMES) {
                sinceReport = 0;
                listener.onProgress();
            }
        }
    }
}
