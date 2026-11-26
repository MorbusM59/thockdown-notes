package com.thockdown.soundscapes;

import static org.junit.Assert.assertTrue;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run by CI after granting exact alarms: the stored schedule is in force and its alarm is in AlarmManager. */
@RunWith(AndroidJUnit4.class)
public class ScheduleWithExactAlarmsTest {
    @Test
    public void aSwitchedOnScheduleArmsItsAlarm() throws Exception {
        ScheduleDevice.storeScheduleSwitchedOn();
        assertTrue(SoundscapeSchedule.canArm(ScheduleDevice.context()));
        assertTrue(SoundscapeSchedule.load(ScheduleDevice.context()).enabled);
        SoundscapeSchedule.arm(ScheduleDevice.context());
        assertTrue(ScheduleDevice.alarmArmed());
    }
}
