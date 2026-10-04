package com.thockdown.soundscapes;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The daily schedule as the native side keeps it: the EVENTS the web page
 * worked out from its slots (mobile/src/schedule.ts, the only place the
 * rules about slots are written), the soundscapes those events name, and
 * whether the schedule is on. Kept in SharedPreferences, because it has to
 * act with the app closed and after a restart or a reboot, when no web page
 * exists to ask.
 *
 * It ARMS one exact alarm at a time, for the next event, which
 * ScheduleReceiver hands to the session (SoundscapeSession.applyScheduleEvent)
 * before arming the one after. An exact alarm is also what allows the
 * session's foreground service to be started from the background; the
 * listener grants it once (SCHEDULE_EXACT_ALARM), asked when they turn the
 * schedule on.
 */
final class SoundscapeSchedule {
    static final class Event {
        final int minute;
        /** "start", "switch" or "stop": see ScheduleEvent in schedule.ts. */
        final String kind;
        final String presetId;

        Event(int minute, String kind, String presetId) {
            this.minute = minute;
            this.kind = kind;
            this.presetId = presetId;
        }
    }

    static final String ACTION_ALARM = "com.thockdown.soundscapes.SCHEDULE_ALARM";
    /** Apply the schedule's state now (after a reboot), from an alarm, which may start the service where the boot broadcast may not. */
    static final String ACTION_APPLY_STATE = "com.thockdown.soundscapes.SCHEDULE_APPLY_STATE";
    private static final long APPLY_STATE_DELAY_MS = 5000;
    static final String EXTRA_MINUTE = "minute";
    private static final String PREFERENCES = "soundscape-schedule";
    private static final String KEY = "schedule";
    private static final int MINUTES_PER_DAY = 24 * 60;

    final boolean enabled;
    final float masterVolume;
    final List<Event> events;
    final List<SoundscapeSession.Entry> entries;

    private SoundscapeSchedule(boolean enabled, float masterVolume, List<Event> events, List<SoundscapeSession.Entry> entries) {
        this.enabled = enabled;
        this.masterVolume = masterVolume;
        this.events = events;
        this.entries = entries;
    }

    /** From the web page's `setSchedule` call, or the stored copy of one. */
    static SoundscapeSchedule fromJson(JSONObject json) throws Exception {
        List<Event> events = new ArrayList<>();
        JSONArray eventArray = json.getJSONArray("events");
        for (int index = 0; index < eventArray.length(); index += 1) {
            JSONObject event = eventArray.getJSONObject(index);
            events.add(new Event(event.getInt("minute"), event.getString("kind"),
                event.isNull("presetId") ? null : event.getString("presetId")));
        }
        List<SoundscapeSession.Entry> entries = new ArrayList<>();
        JSONArray entryArray = json.getJSONArray("entries");
        for (int index = 0; index < entryArray.length(); index += 1) {
            JSONObject entry = entryArray.getJSONObject(index);
            entries.add(new SoundscapeSession.Entry(entry.getString("id"), entry.getString("name"), entry.getString("configuration")));
        }
        return new SoundscapeSchedule(json.getBoolean("enabled"), (float) json.getDouble("masterVolume"),
            Collections.unmodifiableList(events), Collections.unmodifiableList(entries));
    }

    static SoundscapeSchedule load(Context context) {
        String stored = preferences(context).getString(KEY, null);
        if (stored != null) {
            try {
                return fromJson(new JSONObject(stored));
            } catch (Exception ignored) {
                // Unreadable: as if there were none.
            }
        }
        return new SoundscapeSchedule(false, 1f, Collections.emptyList(), Collections.emptyList());
    }

    /** Store `json` (a schedule as fromJson reads it). */
    static void save(Context context, JSONObject json) {
        preferences(context).edit().putString(KEY, json.toString()).apply();
    }

    /** The minute of the day the run under way stops at: the next stop event from now, round the clock; null for none. */
    Integer nextStopMinute() {
        int now = minuteOfDay(Calendar.getInstance());
        Integer best = null;
        int bestDistance = Integer.MAX_VALUE;
        for (Event event : events) {
            if (!"stop".equals(event.kind)) continue;
            int distance = Math.floorMod(event.minute - now, MINUTES_PER_DAY);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = event.minute;
            }
        }
        return best;
    }

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    SoundscapeSession.Entry entry(String id) {
        for (SoundscapeSession.Entry entry : entries) {
            if (entry.id.equals(id)) return entry;
        }
        return null;
    }

    /**
     * The events from `fromMinute` up to and including this minute, in order,
     * round midnight if need be. An alarm armed for `fromMinute` may arrive
     * late (Android defers exact alarms in deep sleep, by minutes when two
     * fall close together), and an event between the two would otherwise be
     * skipped, since the next alarm is armed for after now.
     */
    List<Event> dueSince(int fromMinute) {
        int now = minuteOfDay(Calendar.getInstance());
        int span = Math.floorMod(now - fromMinute, MINUTES_PER_DAY);
        List<Event> due = new ArrayList<>();
        for (int offset = 0; offset <= span; offset += 1) {
            int minute = (fromMinute + offset) % MINUTES_PER_DAY;
            for (Event event : events) {
                if (event.minute == minute) due.add(event);
            }
        }
        return due;
    }

    /** The event whose state holds now: the latest at or before this minute, round the clock; null if there are none. */
    Event current() {
        if (events.isEmpty()) return null;
        int now = minuteOfDay(Calendar.getInstance());
        Event latest = events.get(events.size() - 1);
        for (Event event : events) {
            if (event.minute <= now) latest = event;
        }
        return latest;
    }

    static int minuteOfDay(Calendar calendar) {
        return (calendar.get(Calendar.HOUR_OF_DAY) * 60) + calendar.get(Calendar.MINUTE);
    }

    /** Whether alarms can be exact here: granted by the listener on Android 12 and later. */
    static boolean canArm(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        return alarms.canScheduleExactAlarms();
    }

    /**
     * After a reboot: arm a one-off alarm a few seconds from now that applies
     * the schedule's state (ScheduleReceiver). The boot broadcast itself may
     * not start a media-playback service on Android 15 and later; an exact
     * alarm may.
     */
    static void armApplyState(Context context) {
        Context app = context.getApplicationContext();
        if (!load(app).enabled || !canArm(app)) return;
        Intent intent = new Intent(app, ScheduleReceiver.class).setAction(ACTION_APPLY_STATE);
        app.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,
            System.currentTimeMillis() + APPLY_STATE_DELAY_MS,
            PendingIntent.getBroadcast(app, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    /** Arm the alarm for the stored schedule's next event, or cancel it if the schedule is off. */
    static void arm(Context context) {
        Context app = context.getApplicationContext();
        AlarmManager alarms = app.getSystemService(AlarmManager.class);
        Intent intent = new Intent(app, ScheduleReceiver.class).setAction(ACTION_ALARM);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        SoundscapeSchedule schedule = load(app);
        if (!schedule.enabled || schedule.events.isEmpty() || !canArm(app)) {
            alarms.cancel(PendingIntent.getBroadcast(app, 0, intent, flags));
            return;
        }
        Calendar now = Calendar.getInstance();
        int nowMinute = minuteOfDay(now);
        // The first event after this minute, or tomorrow's first.
        Event next = schedule.events.get(0);
        int daysAhead = 1;
        for (Event event : schedule.events) {
            if (event.minute > nowMinute) {
                next = event;
                daysAhead = 0;
                break;
            }
        }
        Calendar at = (Calendar) now.clone();
        at.add(Calendar.DAY_OF_YEAR, daysAhead);
        at.set(Calendar.HOUR_OF_DAY, next.minute / 60);
        at.set(Calendar.MINUTE, next.minute % 60);
        at.set(Calendar.SECOND, 0);
        at.set(Calendar.MILLISECOND, 0);
        intent.putExtra(EXTRA_MINUTE, next.minute % MINUTES_PER_DAY);
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at.getTimeInMillis(),
            PendingIntent.getBroadcast(app, 0, intent, flags));
    }
}
