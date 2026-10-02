package com.thockdown.soundscapes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Where the schedule acts with the app closed (SoundscapeSchedule):
 * - its alarm: the events due at that minute go to the session, then the
 *   next alarm is armed;
 * - a reboot or an app update, which clear alarms: the schedule's state at
 *   this moment is applied (a run in progress plays), and the alarm armed
 *   again;
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
                for (SoundscapeSchedule.Event event : schedule.dueAt(minute)) session.applyScheduleEvent(schedule, event);
            }
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            session.applyScheduleState();
        }
        SoundscapeSchedule.arm(context);
    }
}
