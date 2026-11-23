package com.thockdown.soundscapes;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Process;
import java.util.ArrayList;
import java.util.List;

/**
 * The app's one audio output: everything it plays (the soundscape and the
 * music, each an OutputLane fed by its own renderer in this process) summed,
 * limited (OutputLimiter, the desktop's shared limiter) and played by the
 * platform's AudioTrack. The desktop has the same shape in Web Audio
 * (packages/soundscape/audioOutputBus.ts): one context, one limiter, every
 * source into it.
 *
 * This is what keeps playback going through an app switch. The WebView's
 * own audio output pauses or stalls briefly whenever the app leaves the
 * foreground, and anything queued on the web side waits behind it; queues
 * in this process, written to the device by a thread of audio priority,
 * do not.
 *
 * There is ONE per process, opened by the first lane (`openLane`) and
 * closed with the last, so the soundscape and the music share a device
 * stream and its clock instead of competing for it.
 *
 * THE WRITER takes BLOCK_FRAMES at a time from every lane, sums them,
 * limits the sum and writes it to the AudioTrack, blocking while its buffer
 * is full. When every lane holds (paused and faded out) it pauses the track
 * and waits.
 *
 * A write the AudioTrack refuses (a negative result: ERROR_DEAD_OBJECT when
 * the audio system has invalidated the track, for instance on a route
 * change or a restart of the audio server) is not the end of playback: the
 * track is released and built again.
 */
final class AudioOutput {
    private static final int BLOCK_FRAMES = 1024;

    private static AudioOutput shared;

    final int sampleRate;
    private AudioTrack track;
    private final int bufferBytes;
    private final Thread writer;
    private final OutputLimiter limiter;
    private final List<OutputLane> lanes = new ArrayList<>();
    private boolean running = true;

    /** A new lane in the process's output, opening the output if it is the first. */
    static OutputLane openLane(OutputLane.Listener listener) {
        synchronized (AudioOutput.class) {
            if (shared == null) shared = new AudioOutput();
            AudioOutput output = shared;
            OutputLane lane = new OutputLane(output, listener);
            synchronized (output) {
                output.lanes.add(lane);
                output.notifyAll();
            }
            return lane;
        }
    }

    private AudioOutput() {
        sampleRate = AudioTrack.getNativeOutputSampleRate(AudioManager.STREAM_MUSIC);
        limiter = new OutputLimiter(sampleRate);
        int minimum = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        // A small device buffer: the long ones are the lanes' queues.
        bufferBytes = Math.max(minimum * 2, BLOCK_FRAMES * 4 * 4);
        track = buildTrack();
        track.play();
        writer = new Thread(this::run, "AudioOutput");
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

    /** Frames the device buffer and one writer block hold beyond a playhead: the least a splice must leave. */
    double committedSec() {
        return ((double) bufferBytes / 4 + BLOCK_FRAMES) / sampleRate;
    }

    /** A lane leaves; the last one out closes the output. */
    void removeLane(OutputLane lane) {
        boolean last;
        synchronized (AudioOutput.class) {
            synchronized (this) {
                lanes.remove(lane);
                last = lanes.isEmpty();
                if (last) {
                    running = false;
                    notifyAll();
                }
            }
            if (last && shared == this) shared = null;
        }
        if (!last) return;
        writer.interrupt();
        try {
            writer.join(500);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        track.stop();
        track.release();
    }

    private boolean allHolding() {
        for (OutputLane lane : lanes) if (!lane.holding()) return false;
        return true;
    }

    private void run() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        float[] mix = new float[BLOCK_FRAMES * 2];
        short[] block = new short[BLOCK_FRAMES * 2];
        List<OutputLane> due = new ArrayList<>();
        while (true) {
            due.clear();
            synchronized (this) {
                if (!running) return;
                if (allHolding()) {
                    track.pause();
                    try {
                        while (running && allHolding()) wait();
                    } catch (InterruptedException ignored) {
                        return;
                    }
                    if (!running) return;
                    track.play();
                }
                java.util.Arrays.fill(mix, 0f);
                for (OutputLane lane : lanes) if (lane.mixInto(mix, BLOCK_FRAMES)) due.add(lane);
            }
            limiter.process(mix, BLOCK_FRAMES);
            for (int index = 0; index < block.length; index += 1) {
                block[index] = (short) Math.max(-32768, Math.min(32767, Math.round(mix[index] * 32768f)));
            }
            int offset = 0;
            while (offset < block.length) {
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
            for (OutputLane lane : due) lane.reportProgress();
        }
    }
}
