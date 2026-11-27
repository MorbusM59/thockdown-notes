package com.thockdown.soundscapes;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTimestamp;
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
 * THE DEVICE BUFFER has two depths. In the foreground it is small, so a
 * splice, a pause or a volume change is heard at once. In the background
 * (MainActivity stopped: the screen off, another app in front) it is
 * DEEP_BUFFER_SEC deep, so the writer fills it in long bursts and sleeps in
 * between instead of waking for every few tens of milliseconds of audio.
 * The track asks for PERFORMANCE_MODE_POWER_SAVING, which lets the platform
 * route it to its deep-buffer output, where the audio hardware plays long
 * periods without the processor. A deep buffer commits more audio than a
 * splice margin used to leave, so `committedSec` follows the depth (the
 * renderers hand it to their sandboxes with every step), and anything that
 * must be heard at once (a pause, the return to the foreground) RESYNCS:
 * the track is paused and flushed, and every lane is rewound to the frame
 * that was actually heard, so nothing is skipped and nothing waits behind
 * a second of audio already handed over.
 *
 * A write the AudioTrack refuses (a negative result: ERROR_DEAD_OBJECT when
 * the audio system has invalidated the track, for instance on a route
 * change or a restart of the audio server) is not the end of playback: the
 * track is released and built again.
 */
final class AudioOutput {
    private static final int BLOCK_FRAMES = 1024;
    /** How much the device holds while the app is in the background. */
    private static final double DEEP_BUFFER_SEC = 4;
    /** Whether the app is in the background (MainActivity stopped), for an output opened later. */
    private static volatile boolean background = false;

    private static AudioOutput shared;

    final int sampleRate;
    private volatile AudioTrack track;
    /**
     * Frames mixed so far, counted across tracks; `trackBase` is the count
     * the current track's first frame has. A lane's frame maps to this count
     * by the lane's `anchor`, so a lane frame is a track frame, and the
     * track's timestamp says when that frame is heard.
     */
    long mixedFrames = 0;
    private long trackBase = 0;
    /** System.nanoTime when the track last began playing (created, resumed or rebuilt): a timestamp from before it is stale. */
    private long playedNanos = 0;
    /** The track's allocated capacity, which the deep depth uses whole. */
    private final int bufferBytes;
    /** The small depth, in frames: the foreground's. */
    private final int shallowFrames;
    /** The depth the track is set to now, in frames (what a splice must leave). */
    private volatile int depthFrames;
    /** The depth wanted, applied by the writer between blocks. */
    private int wantedFrames;
    /** Whether the track plays OFFLOADED (see THE DEVICE BUFFER), and whether it should. */
    private boolean offloaded = false;
    private final boolean offloadSupported;
    /** Pause, flush and rewind before the next block (see THE DEVICE BUFFER). */
    private boolean resyncWanted = false;
    private final Thread writer;
    private final OutputLimiter limiter;
    private final List<OutputLane> lanes = new ArrayList<>();
    private boolean running = true;
    /** A lane heard alone (the delay calibration's loop), or null: while it is set the others are not mixed and their playheads stand still. */
    private OutputLane solo = null;

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
        // A small device buffer in the foreground: the long ones are the lanes' queues.
        shallowFrames = Math.max(minimum * 2, BLOCK_FRAMES * 4 * 4) / 4;
        bufferBytes = Math.max(shallowFrames, (int) Math.round(DEEP_BUFFER_SEC * sampleRate)) * 4;
        wantedFrames = background ? Integer.MAX_VALUE : shallowFrames;
        // PCM offload exists from Android 10 (API 29).
        offloadSupported = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q
            && AudioManager.isOffloadedPlaybackSupported(format(), attributes());
        track = buildTrack();
        playedNanos = System.nanoTime();
        track.play();
        writer = new Thread(this::run, "AudioOutput");
        writer.start();
    }

    private static AudioAttributes attributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();
    }

    private AudioFormat format() {
        return new AudioFormat.Builder()
            .setSampleRate(sampleRate)
            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .build();
    }

    private boolean deep() {
        return wantedFrames > shallowFrames;
    }

    /** A track for the present depth: offloaded when deep and the device can, otherwise a power-saving PCM track. */
    private AudioTrack buildTrack() {
        boolean offload = deep() && offloadSupported;
        AudioTrack built = null;
        if (offload && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            try {
                built = builder().setOffloadedPlayback(true).build();
            } catch (RuntimeException refused) {
                // The device said it could and then could not: play as PCM.
                built = null;
            }
        }
        offloaded = built != null;
        if (built == null) built = builder().build();
        // The capacity is the deep depth; the depth in use is set here. An
        // offloaded track's buffer is the platform's to size.
        depthFrames = offloaded ? built.getBufferSizeInFrames() : built.setBufferSizeInFrames(wantedFrames);
        return built;
    }

    private AudioTrack.Builder builder() {
        return new AudioTrack.Builder()
            .setAudioAttributes(attributes())
            .setAudioFormat(format())
            .setBufferSizeInBytes(bufferBytes)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_POWER_SAVING);
    }

    static boolean inBackground() {
        return background;
    }

    /** The app went to the background (true) or came back (false); MainActivity's onStop and onStart. */
    static void setBackground(boolean inBackground) {
        AudioOutput output;
        synchronized (AudioOutput.class) {
            background = inBackground;
            output = shared;
        }
        if (output == null) return;
        synchronized (output) {
            output.wantedFrames = inBackground ? Integer.MAX_VALUE : output.shallowFrames;
            // Deepening needs nothing undone unless the track is to become
            // offloaded; a return must be heard at once.
            if (!inBackground || output.offloadSupported) output.resyncWanted = true;
            output.notifyAll();
        }
    }

    /** A lane is pausing: while the buffer is deep, what it holds is dropped so the pause is heard now. */
    synchronized void pauseHeardNow() {
        if (depthFrames > shallowFrames) {
            resyncWanted = true;
            notifyAll();
        }
    }

    /**
     * Pause and flush the track, rewind every lane to the frame actually
     * heard, apply the wanted depth and play on. Called by the writer, with
     * this locked, between blocks: the track's head then counts every frame
     * mixed since `trackBase`.
     */
    private void resync() {
        resyncWanted = false;
        track.pause();
        long heard = trackBase + (track.getPlaybackHeadPosition() & 0xffffffffL);
        track.flush();
        if (heard < mixedFrames) {
            mixedFrames = heard;
            for (OutputLane lane : lanes) lane.rewindTo(mixedFrames);
        }
        // A flush starts the head from zero.
        trackBase = mixedFrames;
        if (offloaded != (deep() && offloadSupported)) {
            track.release();
            track = buildTrack();
        } else if (!offloaded) {
            depthFrames = track.setBufferSizeInFrames(wantedFrames);
        }
        playedNanos = System.nanoTime();
        track.play();
    }

    /** Frames the device buffer (at its present depth) and one writer block hold beyond a playhead: the least a splice must leave. */
    double committedSec() {
        return ((double) depthFrames + BLOCK_FRAMES) / sampleRate;
    }

    /**
     * When the frame with mixed count `mixedFrame` is (or was) HEARD, on
     * System.nanoTime's clock: from the track's presentation timestamp, which
     * includes what the device and the route (a Bluetooth headset) hold, or,
     * before the track has one, from its playback head, which does not.
     */
    long heardNanos(long mixedFrame) {
        AudioTrack current;
        long base;
        long played;
        synchronized (this) {
            current = track;
            base = trackBase;
            played = playedNanos;
        }
        AudioTimestamp stamp = new AudioTimestamp();
        boolean stamped = current.getTimestamp(stamp);
        long head = current.getPlaybackHeadPosition() & 0xffffffffL;
        return heardNanos(mixedFrame - base, stamped, stamp.nanoTime, stamp.framePosition, played, head, System.nanoTime(), sampleRate);
    }

    /**
     * heardNanos's arithmetic, apart from the track so it can be tested. A
     * timestamp is used only when it was taken after the track last began
     * playing: AudioTrack keeps handing back the stamp from before a pause
     * until the device reports a new one, and extrapolated from there every
     * frame after the pause read as heard earlier by the whole pause, so the
     * visuals ran ahead of the sound after every resume.
     */
    static long heardNanos(long trackFrame, boolean stamped, long stampNanos, long stampFrame,
            long playedNanos, long head, long nowNanos, int sampleRate) {
        if (stamped && stampNanos >= playedNanos) {
            return stampNanos + (trackFrame - stampFrame) * 1_000_000_000L / sampleRate;
        }
        return nowNanos + (trackFrame - head) * 1_000_000_000L / sampleRate;
    }

    /** Hear `lane` alone, or (null) every lane again, each from where it stood. */
    synchronized void setSolo(OutputLane lane) {
        solo = lane;
        notifyAll();
    }

    /** A lane leaves; the last one out closes the output. */
    void removeLane(OutputLane lane) {
        boolean last;
        synchronized (AudioOutput.class) {
            synchronized (this) {
                lanes.remove(lane);
                if (solo == lane) solo = null;
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

    /**
     * In the background, once the device buffer is full, sleep until it is
     * down to a quarter rather than topping it up a block at a time: a
     * blocking write returns as soon as one block fits, which woke this
     * thread every BLOCK_FRAMES whatever the depth. The wait is computed
     * from the track's own head, and anything that must be heard sooner (a
     * pause, the return to the foreground) notifies.
     */
    private void sleepWhileFull() {
        synchronized (this) {
            if (queuedFrames() < depthFrames - BLOCK_FRAMES) return;
            try {
                while (running && !resyncWanted && deep()) {
                    long spare = queuedFrames() - (depthFrames / 4);
                    if (spare <= 0) return;
                    wait(Math.max(1, spare * 1000 / sampleRate));
                }
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /** Frames handed to the track and not yet played. */
    private long queuedFrames() {
        return (mixedFrames - trackBase) - (track.getPlaybackHeadPosition() & 0xffffffffL);
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
                    playedNanos = System.nanoTime();
                    track.play();
                }
                if (resyncWanted) {
                    resync();
                } else if (!offloaded && wantedFrames > depthFrames) {
                    depthFrames = track.setBufferSizeInFrames(wantedFrames);
                }
                java.util.Arrays.fill(mix, 0f);
                mixedFrames += BLOCK_FRAMES;
                for (OutputLane lane : lanes) {
                    if (solo != null && lane != solo) continue;
                    if (lane.mixInto(mix, BLOCK_FRAMES)) due.add(lane);
                }
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
                    AudioTrack rebuilt = buildTrack();
                    synchronized (this) {
                        // The dropped block's frames never reached a track: the new one starts after them.
                        trackBase = mixedFrames;
                        track = rebuilt;
                        playedNanos = System.nanoTime();
                    }
                    rebuilt.play();
                    // The block is dropped rather than retried into the new
                    // track: positions are time, and it is already late.
                    break;
                }
                offset += written;
            }
            for (OutputLane lane : due) lane.reportProgress();
            if (deep()) sleepWhileFull();
        }
    }
}
