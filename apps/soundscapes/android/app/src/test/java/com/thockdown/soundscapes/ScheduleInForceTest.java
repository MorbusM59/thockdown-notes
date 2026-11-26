package com.thockdown.soundscapes;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * A schedule switched on without exact alarms is not in force, so every
 * reader (the page's switch, the alarm, the session) sees it off and turning
 * it on asks for the grant again. Regression: a lost grant left the switch
 * on, never asked, and never played.
 */
public class ScheduleInForceTest {
    @Test
    public void onlyInForceWithExactAlarms() {
        assertTrue(SoundscapeSchedule.inForce(true, true));
        assertFalse(SoundscapeSchedule.inForce(true, false));
        assertFalse(SoundscapeSchedule.inForce(false, true));
        assertFalse(SoundscapeSchedule.inForce(false, false));
    }
}
