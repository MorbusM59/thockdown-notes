package com.thockdown.soundscapes;

import static org.junit.Assert.assertTrue;

import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Bundle;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The frame the music reports its position with is the frame the device is
 * playing NOW, through a REAL AudioTrack: the page times a reported position
 * by that frame's heard time (OutputLane.heardNanos). Heard time minus the
 * moment of the report is then the route's own presentation latency, which
 * the platform's timestamp measures and the page rightly waits out: a
 * CONSTANT. What would put the visuals off the sound is that difference
 * MOVING, so the test asserts its spread over a start, a seek (a splice
 * written over what is queued), the deep buffer, a press collapsing it (a
 * resync) and the drain on a return stays within TOLERANCE_NANOS.
 *
 * Reporting the playhead instead (what was last handed to the device) put
 * the visuals ahead of the sound by whatever the device buffer held: seconds
 * once the buffer is deep. How much the device holds, and when its timestamp
 * is valid, is the platform's and no reading of our code can check it.
 */
@RunWith(AndroidJUnit4.class)
public class MusicReportClockTest {
    /** How far the reported frame's latency may move: below the 20 to 40 ms at which an audio-visual offset is noticed, about one writer block (1024 frames) plus the timestamp's granularity. */
    private static final long TOLERANCE_NANOS = 30_000_000L;

    private long least = Long.MAX_VALUE;
    private long most = Long.MIN_VALUE;
    private final StringBuilder phases = new StringBuilder();

    /** How far ahead of the playhead the feeder keeps the lane, below the lane's 12 s ring and above the 4 s deep buffer. */
    private static final double FEED_AHEAD_SEC = 8;

    private volatile boolean feeding = true;

    @Test
    public void reportedFrameIsHeardNow() throws Exception {
        int rate = AudioTrack.getNativeOutputSampleRate(AudioManager.STREAM_MUSIC);
        OutputLane lane = AudioOutput.openLane(() -> { });
        Thread feeder = new Thread(() -> feed(lane, rate), "feeder");
        feeder.start();
        try {
            AudioOutput.setBackground(false);
            Thread.sleep(1500);
            check(lane, "start", 2000);

            // A seek: the renderer splices the new position in at the playhead.
            long at = lane.playheadFrame();
            lane.write(at, tone(rate, rate * 2, 330));
            check(lane, "seek", 1500);

            AudioOutput.setBackground(true);
            Thread.sleep(6000);
            check(lane, "deep", 2000);

            AudioOutput.interact();
            check(lane, "interact", 1500);

            AudioOutput.setBackground(true);
            Thread.sleep(16000);
            AudioOutput.setBackground(false);
            check(lane, "drain", 3000);

            Bundle status = new Bundle();
            status.putString("stream", "latency " + (least / 1_000_000.0) + " to " + (most / 1_000_000.0) + " ms;" + phases + "\n");
            InstrumentationRegistry.getInstrumentation().sendStatus(0, status);
            assertTrue("the reported frame's latency moved from " + (least / 1_000_000.0) + " to " + (most / 1_000_000.0) + " ms;" + phases,
                most - least <= TOLERANCE_NANOS);
        } finally {
            feeding = false;
            feeder.join(2000);
            AudioOutput.setBackground(false);
            lane.close();
        }
    }

    /** Sample the reported frame's heard time minus now for `millis`, every 20 ms, after the phase's first half second (the change itself settling). */
    private void check(OutputLane lane, String phase, long millis) throws InterruptedException {
        Thread.sleep(500);
        long until = System.nanoTime() + millis * 1_000_000L;
        long low = Long.MAX_VALUE;
        long high = Long.MIN_VALUE;
        while (System.nanoTime() < until) {
            long frame = MusicRenderer.reportedFrame(lane);
            long off = lane.heardNanos(frame) - System.nanoTime();
            low = Math.min(low, off);
            high = Math.max(high, off);
            Thread.sleep(20);
        }
        least = Math.min(least, low);
        most = Math.max(most, high);
        phases.append(' ').append(phase).append(' ').append(low / 1_000_000.0).append('/').append(high / 1_000_000.0);
    }

    /** Keep the lane FEED_AHEAD_SEC of a quiet tone ahead of its playhead, as the renderer keeps it ahead. */
    private void feed(OutputLane lane, int rate) {
        long end = 0;
        int block = rate / 10;
        try {
            while (feeding) {
                if (end - lane.playheadFrame() < FEED_AHEAD_SEC * rate) {
                    lane.write(end, tone(rate, block, 220));
                    end += block;
                } else {
                    Thread.sleep(20);
                }
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    /** `frames` of a quiet sine, interleaved stereo. */
    private static short[] tone(int rate, int frames, double hz) {
        short[] samples = new short[frames * 2];
        for (int index = 0; index < frames; index += 1) {
            short value = (short) (Math.sin(2 * Math.PI * hz * index / rate) * 2000);
            samples[index * 2] = value;
            samples[(index * 2) + 1] = value;
        }
        return samples;
    }
}
