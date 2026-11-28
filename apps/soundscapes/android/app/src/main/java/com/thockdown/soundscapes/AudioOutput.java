package com.thockdown.soundscapes;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTimestamp;
import android.media.AudioTrack;
import android.os.Process;
import android.util.Log;
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
 * must be heard at once (a pause or resume, the return to the foreground) RESYNCS:
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
    /** One line per state change (never per block): `adb logcat -s ThockdownAudio`. */
    private static final String LOG = "ThockdownAudio";
    /** How much the device holds while the app is in the background. */
    private static final double DEEP_BUFFER_SEC = 4;
    /** Whether the app is in the background (MainActivity stopped), for an output opened later. */
    private static volatile boolean background = false;

    private static AudioOutput shared;
    /** The output the listener picked (AudioConnection), or null for the system's route; applied to every track built. */
    private static volatile android.media.AudioDeviceInfo preferred = null;
    /**
     * HALTED (AudioConnection: the device the output was heard on went
     * away): nothing is mixed and the track is paused and flushed, every
     * lane rewound to the frame heard, exactly as if every lane held. The
     * lanes' own states are untouched, so lifting the halt plays on from
     * where it was heard.
     */
    private boolean halted = false;
    /** What every block is scaled by: 1, or DUCK_GAIN while another app speaks briefly (AudioConnection's audio focus). */
    private volatile float duckTarget = 1f;
    private float duckGain = 1f;
    static final float DUCK_GAIN = 0.2f;
    /** Told (on the main thread) whenever the output starts to be heard, so audio focus is asked for then. */
    static volatile Runnable onHeard = null;
    /** Whether the halt has already flushed the track (done once, by the writer). */
    private boolean haltFlushed = false;

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
    /**
     * Until when (System.nanoTime) the output stays SHALLOW in the
     * background after the listener pressed something (`interact`); 0 for
     * no such hold.
     */
    private long interactiveUntilNanos = 0;
    /** How long a press keeps the background output shallow, so the presses after it are heard at once too. */
    private static final double INTERACTIVE_HOLD_SEC = 15;
    /** The longest a press waits for the writer to collapse the buffer (it does so between two blocks). */
    private static final long INTERACT_WAIT_MS = 250;
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
        announceHeard();
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
        Log.i(LOG, "track built: offloaded " + offloaded + ", background " + background);
        if (built == null) built = builder().build();
        if (preferred != null) built.setPreferredDevice(preferred);
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

    /**
     * THE LISTENER PRESSED SOMETHING (the lock screen, the notification, a
     * car, headphones): what they asked for must be heard now, not after the
     * seconds a deep background buffer holds. The output returns to the
     * foreground's shallow depth (a resync: the track flushed and every lane
     * rewound to the frame heard) and stays there for INTERACTIVE_HOLD_SEC,
     * after which the writer deepens it again. Returns once the collapse is
     * done (or the writer cannot do it now: everything paused, which the
     * resume's own resync covers), so a step decided after this call is
     * spliced at the shallow margin.
     */
    static void interact() {
        AudioOutput output;
        synchronized (AudioOutput.class) {
            output = shared;
        }
        if (output == null) return;
        synchronized (output) {
            long now = System.nanoTime();
            output.interactiveUntilNanos = now + (long) (INTERACTIVE_HOLD_SEC * 1e9);
            // Nothing to collapse: shallow already, and not draining a deep buffer (drain).
            if (!output.deep() && !output.offloaded && output.depthFrames <= output.shallowFrames && !output.resyncWanted) return;
            Log.i(LOG, "interact: collapsing depth " + output.depthFrames);
            output.wantedFrames = output.shallowFrames;
            output.resyncWanted = true;
            output.notifyAll();
            long deadline = now + INTERACT_WAIT_MS * 1_000_000L;
            try {
                while (output.running && output.resyncWanted && !output.halted && !output.allHolding()) {
                    long left = (deadline - System.nanoTime()) / 1_000_000L;
                    if (left <= 0) break;
                    output.wait(left);
                }
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /** Whether anything is heard now: an output exists, is not halted, and some lane does not hold. */
    static boolean isHeard() {
        AudioOutput output;
        synchronized (AudioOutput.class) {
            output = shared;
        }
        if (output == null) return false;
        synchronized (output) {
            return !output.halted && !output.allHolding();
        }
    }

    /** Halt (true) or resume (false) everything the output plays; AudioConnection's. */
    static void setHalted(boolean halt) {
        AudioOutput output;
        synchronized (AudioOutput.class) {
            output = shared;
        }
        if (output == null) return;
        synchronized (output) {
            if (output.halted == halt) return;
            output.halted = halt;
            output.haltFlushed = false;
            output.notifyAll();
        }
    }

    /** Lower everything heard (another app's short sound) or bring it back. */
    static void setDucked(boolean ducked) {
        AudioOutput output;
        synchronized (AudioOutput.class) {
            output = shared;
        }
        if (output != null) output.duckTarget = ducked ? DUCK_GAIN : 1f;
    }

    private static void announceHeard() {
        Runnable hook = onHeard;
        if (hook != null) new android.os.Handler(android.os.Looper.getMainLooper()).post(hook);
    }

    /** Play through `device`, or (null) wherever the system routes media; applied to the present track at once. */
    static void setPreferredDevice(android.media.AudioDeviceInfo device) {
        preferred = device;
        AudioOutput output;
        synchronized (AudioOutput.class) {
            output = shared;
        }
        if (output == null) return;
        synchronized (output) {
            output.track.setPreferredDevice(device);
        }
    }

    static boolean inBackground() {
        return background;
    }

    /** The app went to the background (true) or came back (false); MainActivity's onStop and onStart. */
    static void setBackground(boolean inBackground) {
        Log.i(LOG, "background " + inBackground);
        AudioOutput output;
        synchronized (AudioOutput.class) {
            background = inBackground;
            output = shared;
        }
        if (output == null) return;
        synchronized (output) {
            // A press's hold keeps it shallow; the writer deepens it when the hold ends.
            if (inBackground && System.nanoTime() < output.interactiveUntilNanos) return;
            output.wantedFrames = inBackground ? Integer.MAX_VALUE : output.shallowFrames;
            // Deepening needs nothing undone unless the track is to become
            // offloaded. A RETURN is not a resync either: flushing the track
            // stops the sound for as long as a restarted track takes to be
            // heard, an audible hiccup on every return to the app. The deep
            // buffer DRAINS instead (the writer holds off until it is down to
            // the shallow depth, `drain`), which plays on without a seam; a
            // press in the meantime collapses it at once (interact), where
            // the change it makes covers the seam.
            // Going into or out of offload is a handover to a new track (drain), not a flush.
            output.notifyAll();
        }
    }

    /**
     * A lane is pausing or resuming: while the buffer is deep, what it holds
     * is dropped so the change is heard now. A resume needs it as much as a
     * pause: while one lane is paused, another that is not (a soundscape
     * lane with nothing started, for one) keeps the writer filling the
     * device with seconds of silence, which a resume would wait behind.
     */
    synchronized void heardNow() {
        Log.i(LOG, "heard now: depth " + depthFrames + ", holding " + allHolding());
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
        resync(true);
    }

    private void resync(boolean play) {
        resyncWanted = false;
        Log.i(LOG, "resync: background " + background + ", depth " + depthFrames + ", queued " + queuedFrames() + ", play state " + track.getPlayState());
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
        if (play) {
            playedNanos = System.nanoTime();
            track.play();
        }
        // A press waiting for the collapse (interact) goes on.
        notifyAll();
    }

    /** A track playing out what it still held after the output left offload (`drain`), released at `retiredUntilNanos`. */
    private AudioTrack retired = null;
    private long retiredUntilNanos = 0;
    /** How little an offloaded track may hold when it is handed over to a PCM one: about what a new track takes to be heard. */
    private static final int HANDOVER_FRAMES = BLOCK_FRAMES * 2;

    /**
     * A change of depth without a seam (see setBackground): shallow wanted
     * and deep held, the device plays the deep buffer down rather than it
     * being flushed; a change into or out of offload hands over to a new
     * track once the old one is nearly played out. Returns false while it is
     * still above the shallow depth (having waited for it to play down), true
     * once the writer may go on: a PCM track's buffer is then set shallow, and
     * an offloaded track, which cannot be made shallow, is handed over to a
     * new PCM track when it holds only HANDOVER_FRAMES, which it plays out
     * (stop() plays a streaming track's remaining data) while the new one
     * starts. Called by the writer with this locked.
     */
    private boolean needsHandover() {
        return offloaded != (deep() && offloadSupported);
    }

    private boolean drain() {
        long queued = queuedFrames();
        boolean handover = needsHandover();
        long floor = handover ? HANDOVER_FRAMES : shallowFrames;
        if (queued > floor) {
            try {
                wait(Math.max(1, (queued - floor) * 1000 / sampleRate));
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            return false;
        }
        if (handover) {
            Log.i(LOG, "drained: handing over to a new track (offloaded now " + offloaded + ") with " + queued + " frames left");
            track.stop();
            releaseRetired();
            retired = track;
            retiredUntilNanos = System.nanoTime() + 1_000_000_000L;
            track = buildTrack();
            trackBase = mixedFrames;
            playedNanos = System.nanoTime();
            track.play();
        } else {
            depthFrames = track.setBufferSizeInFrames(shallowFrames);
            Log.i(LOG, "drained: depth " + depthFrames);
        }
        return true;
    }

    private void releaseRetired() {
        if (retired == null) return;
        try {
            retired.release();
        } catch (RuntimeException ignored) {
            // Already released.
        }
        retired = null;
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
        synchronized (this) {
            releaseRetired();
        }
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
                while (running && !resyncWanted && !halted && deep()) {
                    long spare = queuedFrames() - (depthFrames / 4);
                    if (spare <= 0) return;
                    // Wake for a marker being heard too, so it is reported on time.
                    long marker = nextMarkerMixed();
                    if (marker >= 0) {
                        long until = marker - heardMixed();
                        if (until <= 0) return;
                        spare = Math.min(spare, until);
                    }
                    wait(Math.max(1, spare * 1000 / sampleRate));
                }
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /** The mixed count the track's head has reached. Called with this locked. */
    long heardMixed() {
        return trackBase + (track.getPlaybackHeadPosition() & 0xffffffffL);
    }

    /** The earliest marker a lane waits to hear (OutputLane's `reportAt`), or -1. Called with this locked. */
    private long nextMarkerMixed() {
        long next = -1;
        for (OutputLane lane : lanes) {
            long marker = lane.markerMixed();
            if (marker >= 0 && (next < 0 || marker < next)) next = marker;
        }
        return next;
    }

    /** Add to `due` every lane whose marker the track's head has passed. */
    private void reportHeardMarkers(List<OutputLane> due) {
        synchronized (this) {
            long heard = heardMixed();
            for (OutputLane lane : lanes) {
                long marker = lane.markerMixed();
                if (marker < 0 || marker > heard) continue;
                lane.clearMarker();
                if (!due.contains(lane)) due.add(lane);
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
                if (halted || allHolding()) {
                    if (halted && !haltFlushed) {
                        // What the device still held would be heard on the route the system moved to.
                        haltFlushed = true;
                        resync(false);
                    }
                    track.pause();
                    Log.i(LOG, (halted ? "halted" : "all lanes holding") + ": track paused");
                    try {
                        while (running && (halted || allHolding())) wait();
                    } catch (InterruptedException ignored) {
                        return;
                    }
                    Log.i(LOG, "a lane resumed: track plays, resync " + resyncWanted);
                    if (!running) return;
                    playedNanos = System.nanoTime();
                    track.play();
                    announceHeard();
                }
                if (retired != null && System.nanoTime() >= retiredUntilNanos) releaseRetired();
                if (interactiveUntilNanos != 0 && System.nanoTime() >= interactiveUntilNanos) {
                    // A press's hold has passed: in the background the buffer deepens again.
                    interactiveUntilNanos = 0;
                    if (background && !deep()) {
                        wantedFrames = Integer.MAX_VALUE;
                    }
                }
                if (resyncWanted) {
                    resync();
                } else if (needsHandover() || (!deep() && depthFrames > shallowFrames)) {
                    if (!drain()) continue;
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
            float target = duckTarget;
            if (target != 1f || duckGain != 1f) {
                // Glide to the duck's level over about a block, so the change has no click.
                float step = (target - duckGain) / BLOCK_FRAMES;
                for (int frame = 0; frame < BLOCK_FRAMES; frame += 1) {
                    duckGain += step;
                    mix[frame * 2] *= duckGain;
                    mix[frame * 2 + 1] *= duckGain;
                }
                duckGain = target;
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
            if (deep()) sleepWhileFull();
            reportHeardMarkers(due);
            for (OutputLane lane : due) lane.reportProgress();
        }
    }
}
