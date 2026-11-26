package com.thockdown.soundscapes;

import static org.junit.Assert.assertFalse;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Run by CI with exact alarms NOT granted: as on a fresh install or a
 * reinstall that restored the app's data (Android 14 denies them by
 * default), and again after the grant was revoked in the system settings.
 * A schedule stored as on must read as off, and nothing may be armed.
 */
@RunWith(AndroidJUnit4.class)
public class ScheduleWithoutExactAlarmsTest {
    @Test
    public void aSwitchedOnScheduleReadsOffAndArmsNothing() throws Exception {
        ScheduleDevice.storeScheduleSwitchedOn();
        assertFalse(SoundscapeSchedule.canArm(ScheduleDevice.context()));
        assertFalse(SoundscapeSchedule.load(ScheduleDevice.context()).enabled);
        SoundscapeSchedule.arm(ScheduleDevice.context());
        assertFalse(ScheduleDevice.alarmArmed());
    }
}
