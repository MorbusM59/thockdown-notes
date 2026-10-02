package com.thockdown.soundscapes;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Process;

/**
 * Android's output for the soundscape (see src/sound/SoundscapeEngine.ts):
 * the finished audio, rendered ahead by the web side's worker, played by
 * the platform's AudioTrack from a queue held HERE, in the app's own process.
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
 * not queued is played as silence and counted. `played` reports how far it
 * has handed audio to the AudioTrack, which is as far as a splice can no
 * longer reach.
 *
 * A write the AudioTrack refuses (a negative result: ERROR_DEAD_OBJECT when
 * the audio system has invalidated the track, for instance on a route
 * change or a restart of the audio server) is not the end of playback: the
 * track is released and built again, and the refusal is counted and
 * reported in the statistics. Stopping there instead would leave the queue
 * full, the app showing a soundscape playing, and nothing heard.
 */
final class SoundscapeAudioOutput {
    interface Listener {
        void onPlayed(long frame);
        void onStats(long playedFrames, long queuedFrames, long dryFrames, int dryEvents, int deviceUnderruns, int trackRestarts, int lastError);
    }

    private static final double CAPACITY_SEC = 12;
    private static final int BLOCK_FRAMES = 1024;
    private static final int REPORT_FRAMES = 2048;
    private static final int STATS_FRAMES = 8192;
    /** The web side encodes samples at 1/HEADROOM of their value. */
    private static final float HEADROOM = 2f;

    final int sampleRate;
    private final Listener listener;
    private AudioTrack track;
    private final int bufferBytes;
    private int trackRestarts = 0;
    private int lastError = 0;
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

    private long dryFrames = 0;
    private int dryEvents = 0;
    private boolean wasDry = false;

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

    /** Glide to `target` with time constant `timeConstantSec`. */
    void setVolume(float target, double timeConstantSec) {
        volumeStep = (float) (1 - Math.exp(-1 / (Math.max(0.001, timeConstantSec) * sampleRate)));
        volumeTarget = target;
    }

    void close() {
        running = false;
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
        int sinceStats = 0;
        while (running) {
            long reachedFrame;
            long queued;
            synchronized (this) {
                int available = started ? (int) Math.max(0, Math.min(BLOCK_FRAMES, end - playhead)) : 0;
                for (int index = 0; index < available; index += 1) {
                    int slot = (int) ((playhead + index) % capacity) * 2;
                    block[index * 2] = ring[slot];
                    block[(index * 2) + 1] = ring[slot + 1];
                }
                java.util.Arrays.fill(block, available * 2, block.length, (short) 0);
                if (started) {
                    int dry = BLOCK_FRAMES - available;
                    if (dry > 0 && !wasDry) dryEvents += 1;
                    wasDry = dry > 0;
                    dryFrames += dry;
                    // Silence still moves the playhead: positions are time.
                    playhead += BLOCK_FRAMES;
                }
                reachedFrame = playhead;
                queued = Math.max(0, end - playhead);
            }
            float target = volumeTarget;
            float step = volumeStep;
            for (int index = 0; index < BLOCK_FRAMES; index += 1) {
                volume += (target - volume) * step;
                float gain = volume * HEADROOM;
                for (int channel = 0; channel < 2; channel += 1) {
                    float value = block[(index * 2) + channel] * gain;
                    block[(index * 2) + channel] = (short) Math.max(-32768, Math.min(32767, Math.round(value)));
                }
            }
            int offset = 0;
            while (running && offset < block.length) {
                int written = track.write(block, offset, block.length - offset, AudioTrack.WRITE_BLOCKING);
                if (written < 0) {
                    lastError = written;
                    trackRestarts += 1;
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
            sinceStats += BLOCK_FRAMES;
            if (sinceReport >= REPORT_FRAMES) {
                sinceReport = 0;
                listener.onPlayed(reachedFrame);
            }
            if (sinceStats >= STATS_FRAMES) {
                sinceStats = 0;
                listener.onStats(reachedFrame, queued, dryFrames, dryEvents, track.getUnderrunCount(), trackRestarts, lastError);
            }
        }
    }
}
