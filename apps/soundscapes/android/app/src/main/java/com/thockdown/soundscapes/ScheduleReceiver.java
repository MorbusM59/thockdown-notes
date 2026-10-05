package com.thockdown.soundscapes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.List;

/**
 * Where the schedule acts with the app closed (SoundscapeSchedule):
 * - its alarm: the events due since the minute it was armed for go to the
 *   session (an alarm can arrive late, and an event in between must not be
 *   skipped), then the next alarm is armed;
 * - a reboot or an app update, which clear alarms: the alarm is armed
 *   again, and so is a one-off alarm a few seconds away that applies the
 *   schedule's state then (a run in progress plays) -- from an alarm,
 *   because the boot broadcast may not start the playback service;
 * - a change of the clock or the time zone: the alarm is armed again for
 *   the new time.
 */
public class ScheduleReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        SoundscapeSession session = SoundscapeSession.get(context);
        if (SoundscapeSchedule.ACTION_ALARM.equals(action)) {
            SoundscapeSchedule schedule = SoundscapeSchedule.load(context);
            if (schedule.enabled) {
                int minute = intent.getIntExtra(SoundscapeSchedule.EXTRA_MINUTE, -1);
                if (minute >= 0) {
                    List<SoundscapeSchedule.Event> due = schedule.dueSince(minute);
                    java.util.Set<Integer> stopMinutes = new java.util.HashSet<>();
                    boolean runStarted = false;
                    for (SoundscapeSchedule.Event event : due) {
                        if ("stop".equals(event.kind)) stopMinutes.add(event.minute);
                        runStarted |= "start".equals(event.kind);
                    }
                    if (!due.isEmpty()) session.applyScheduleEvents(stopMinutes, runStarted);
                }
            }
        } else if (SoundscapeSchedule.ACTION_APPLY_STATE.equals(action)) {
            session.applyScheduleState();
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            SoundscapeSchedule.armApplyState(context);
        }
        SoundscapeSchedule.arm(context);
    }
}
