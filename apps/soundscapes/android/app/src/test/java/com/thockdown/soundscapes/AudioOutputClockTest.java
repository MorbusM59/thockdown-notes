package com.thockdown.soundscapes;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** AudioOutput.heardNanos: a timestamp from before the track last began playing is never extrapolated from. */
public class AudioOutputClockTest {
    private static final int RATE = 48000;
    private static final long SECOND = 1_000_000_000L;

    @Test
    public void aFreshTimestampIncludesTheRoutesLatency() {
        // Frame 48000 presented at 10s; frame 96000 is heard a second later.
        long heard = AudioOutput.heardNanos(96000, true, 10 * SECOND, 48000, 5 * SECOND, 90000, 10 * SECOND, RATE);
        assertEquals(11 * SECOND, heard);
    }

    @Test
    public void aStampFromBeforeAPauseIsNotExtrapolatedFrom() {
        // Stamp taken at 10s, paused, resumed at 70s: the stamp would put the
        // frame a minute early, so the playback head decides instead.
        long heard = AudioOutput.heardNanos(96000, true, 10 * SECOND, 48000, 70 * SECOND, 96000, 70 * SECOND, RATE);
        assertEquals(70 * SECOND, heard);
    }
}
