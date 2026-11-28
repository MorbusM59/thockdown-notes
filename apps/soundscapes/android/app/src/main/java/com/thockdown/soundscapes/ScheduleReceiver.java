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
 *   the new time;
 * - the listener granting exact alarms in the system settings (Android 12+)
 *   while the app is closed: the alarm can be armed now.
 *
 * Not exported: the system delivers its own broadcasts to it regardless,
 * and no other app may fire the schedule's alarm actions.
 */
public class ScheduleReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        SoundscapeSession session = SoundscapeSession.get(context);
        if (SoundscapeSchedule.ACTION_ALARM.equals(action)) {
            SoundscapeSchedule schedule = SoundscapeSchedule.load(context);
            if (schedule.enabled) {
                int at = intent.getIntExtra(SoundscapeSchedule.EXTRA_AT, -1);
                if (at >= 0) {
                    List<SoundscapeSchedule.Event> due = schedule.dueSince(at);
                    // The latest change decides how long it takes.
                    if (!due.isEmpty()) session.applyScheduleEvents(due.get(due.size() - 1).fadeSec);
                    List<SoundscapeSchedule.Event> musicDue = schedule.musicDueSince(at);
                    if (!musicDue.isEmpty()) MusicSession.get(context).applySchedule(musicDue.get(musicDue.size() - 1).fadeSec);
                }
            }
        } else if (SoundscapeSchedule.ACTION_APPLY_STATE.equals(action)) {
            session.applyScheduleState(true);
            MusicSession.get(context).applySchedule(SoundscapeSession.HANDOVER_FADE_SEC);
        } else if (android.app.AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) {
            // Granted after the listener tapped the schedule on: it is on now,
            // and the page follows the session's report.
            if (SoundscapeSchedule.switchOnIfWanted(context)) {
                session.applyScheduleState(false);
                MusicSession.get(context).applySchedule(SoundscapeSession.HANDOVER_FADE_SEC);
            }
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            SoundscapeSchedule.armApplyState(context);
        }
        SoundscapeSchedule.arm(context);
    }
}
