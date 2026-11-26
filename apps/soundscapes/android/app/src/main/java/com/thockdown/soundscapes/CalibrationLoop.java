package com.thockdown.soundscapes;

/**
 * The beat delay calibration's loop (packages/visualizer/beat/beatLoops.ts,
 * played for the phone by apps/soundscapes/src/nativeBeatLoop.ts): a drum
 * track the page decoded at the output's rate, played over and over, without
 * a gap, on a lane of the process's one output, so it reaches the speaker
 * the way the music does and the delay set against it is the music's.
 *
 * It is heard ALONE (OutputLane.setSolo): the music and the soundscape hold
 * where they are and carry on from there once it stops. Its position is
 * reported as the lane's playhead, the frame heard, as the music's is; the
 * loop's first frame is frame 0, so the page reads where in the loop the
 * listener is from that frame alone.
 */
final class CalibrationLoop {
    interface Listener {
        /** The frame heard now, at `sampleRate`. */
        void onHeard(long frame, int sampleRate, long heardNanos);
    }

    /** How far ahead of the playhead the loop is kept written. */
    private static final double AHEAD_SEC = 1;
    /** Frames written at a time. */
    private static final int SLICE_FRAMES = 4096;
    /** How soon the loop reaches full level, so its start does not click. */
    private static final double FADE_IN_TIME_CONSTANT_SEC = 0.02;

    private final short[] pcm;
    private final int loopFrames;
    private final OutputLane lane;
    private final Listener listener;
    private final long aheadFrames;
    private long written = 0;
    private boolean closed = false;

    /** Starts the loop: `pcm` is interleaved 16-bit stereo at half scale (OutputLane.HEADROOM), at the output's rate. */
    CalibrationLoop(short[] pcm, Listener listener) {
        this.pcm = pcm;
        this.loopFrames = pcm.length / 2;
        this.listener = listener;
        lane = AudioOutput.openLane(this::onProgress);
        aheadFrames = Math.round(AHEAD_SEC * lane.sampleRate);
        lane.setVolume(1f, FADE_IN_TIME_CONSTANT_SEC);
        lane.setSolo(true);
        // On screen, and filled only a little ahead: reported at the quick pace.
        lane.setResponsive(true);
        fill();
    }

    int sampleRate() {
        return lane.sampleRate;
    }

    private void onProgress() {
        long playhead;
        synchronized (this) {
            if (closed) return;
            fill();
            playhead = lane.playheadFrame();
        }
        listener.onHeard(playhead, lane.sampleRate, lane.heardNanos(playhead));
    }

    /** Writes the loop on, copy after copy, until AHEAD_SEC past the playhead. */
    private synchronized void fill() {
        if (loopFrames == 0) return;
        long target = lane.playheadFrame() + aheadFrames;
        while (written < target) {
            int from = (int) (written % loopFrames);
            int frames = Math.min(SLICE_FRAMES, loopFrames - from);
            short[] slice = new short[frames * 2];
            System.arraycopy(pcm, from * 2, slice, 0, frames * 2);
            lane.write(written, slice);
            written += frames;
        }
    }

    void close() {
        // Marked under the lock, released outside it: the output's writer may be waiting on it in onProgress.
        synchronized (this) {
            if (closed) return;
            closed = true;
        }
        lane.setSolo(false);
        lane.close();
    }
}
