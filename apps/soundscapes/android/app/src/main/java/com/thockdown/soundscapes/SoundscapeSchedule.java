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
 * worked out from its entries (apps/soundscapes/src/schedule.ts, the only place the
 * schedule's rules are written), at minutes of the week, the soundscapes those events name, and
 * whether the schedule is on. Kept in SharedPreferences, because it has to
 * act with the app closed and after a restart or a reboot, when no web page
 * exists to ask.
 *
 * Two CHANNELS, each with its own events (schedule.ts decides each on its
 * own): the soundscape's (`events`, played by SoundscapeSession) and the
 * music's (`musicEvents`, a song set each, played by MusicSession).
 *
 * It ARMS one exact alarm at a time, for the next event, which
 * ScheduleReceiver hands to the session (SoundscapeSession.applyScheduleEvents)
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
        /** The song set a music event plays (null for a stop, and on a soundscape event). */
        final Integer setId;
        /** How long the change takes (timer.ts's fade rule, worked out by schedule.ts). */
        final double fadeSec;
        /**
         * The second of the week the change BEGINS: a stop or a switch fades
         * out the entry ending so it is silent at `minute`, so it begins
         * `fadeSec` before; a start begins at `minute` and fades in.
         */
        final int at;

        Event(int minute, String kind, String presetId, Integer setId, double fadeSec) {
            this.minute = minute;
            this.kind = kind;
            this.presetId = presetId;
            this.setId = setId;
            this.fadeSec = fadeSec;
            int lead = "start".equals(kind) ? 0 : (int) Math.round(fadeSec);
            this.at = Math.floorMod(minute * 60 - lead, SECONDS_PER_WEEK);
        }
    }

    static final String ACTION_ALARM = "com.thockdown.soundscapes.SCHEDULE_ALARM";
    /** Apply the schedule's state now (after a reboot), from an alarm, which may start the service where the boot broadcast may not. */
    static final String ACTION_APPLY_STATE = "com.thockdown.soundscapes.SCHEDULE_APPLY_STATE";
    private static final long APPLY_STATE_DELAY_MS = 5000;
    /** The second of the week the alarm was armed for (Event.at). */
    static final String EXTRA_AT = "at";
    private static final String PREFERENCES = "soundscape-schedule";
    private static final String KEY = "schedule";
    private static final int MINUTES_PER_DAY = 24 * 60;
    /** Event minutes are minutes of the WEEK, from Monday 00:00 (schedule.ts). */
    static final int MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
    static final int SECONDS_PER_WEEK = MINUTES_PER_WEEK * 60;

    final boolean enabled;
    final float masterVolume;
    final List<Event> events;
    final List<Event> musicEvents;
    final List<SoundscapeSession.Entry> entries;

    private SoundscapeSchedule(boolean enabled, float masterVolume, List<Event> events, List<Event> musicEvents, List<SoundscapeSession.Entry> entries) {
        this.enabled = enabled;
        this.masterVolume = masterVolume;
        this.events = ordered(events);
        this.musicEvents = ordered(musicEvents);
        this.entries = entries;
    }

    /** In the order they BEGIN: a fade's lead can put a change before the one listed ahead of it. */
    private static List<Event> ordered(List<Event> events) {
        List<Event> ordered = new ArrayList<>(events);
        ordered.sort((a, b) -> Integer.compare(a.at, b.at));
        return Collections.unmodifiableList(ordered);
    }

    /** From the web page's `setSchedule` call, or the stored copy of one. */
    static SoundscapeSchedule fromJson(JSONObject json) throws Exception {
        List<Event> events = new ArrayList<>();
        JSONArray eventArray = json.getJSONArray("events");
        for (int index = 0; index < eventArray.length(); index += 1) {
            JSONObject event = eventArray.getJSONObject(index);
            events.add(new Event(event.getInt("minute"), event.getString("kind"),
                event.isNull("presetId") ? null : event.getString("presetId"), null, event.optDouble("fadeSec", 0)));
        }
        List<Event> musicEvents = new ArrayList<>();
        JSONArray musicArray = json.optJSONArray("musicEvents");
        for (int index = 0; musicArray != null && index < musicArray.length(); index += 1) {
            JSONObject event = musicArray.getJSONObject(index);
            musicEvents.add(new Event(event.getInt("minute"), event.getString("kind"),
                null, event.isNull("setId") ? null : event.getInt("setId"), event.optDouble("fadeSec", 0)));
        }
        List<SoundscapeSession.Entry> entries = new ArrayList<>();
        JSONArray entryArray = json.getJSONArray("entries");
        for (int index = 0; index < entryArray.length(); index += 1) {
            JSONObject entry = entryArray.getJSONObject(index);
            entries.add(new SoundscapeSession.Entry(entry.getString("id"), entry.getString("name"), entry.getString("configuration")));
        }
        return new SoundscapeSchedule(json.getBoolean("enabled"), (float) json.getDouble("masterVolume"),
            events, musicEvents, Collections.unmodifiableList(entries));
    }

    /**
     * Whether a schedule switched on is IN FORCE: only while exact alarms are
     * granted, since without them it can start nothing on time (and an
     * inexact alarm may not start the playback service from the background).
     * The grant is lost without the schedule being told -- revoked in the
     * system settings, or never restored with the app's data after a
     * reinstall -- and a schedule that stayed "on" then showed on, never
     * asked again and never played. So the stored switch is read through
     * this, by every reader at once (load): the page sees it off, and turning
     * it on asks for the grant again.
     */
    static boolean inForce(boolean switchedOn, boolean exactAlarms) {
        return switchedOn && exactAlarms;
    }

    /** The stored schedule, switched off while it cannot be in force (inForce). */
    static SoundscapeSchedule load(Context context) {
        String stored = preferences(context).getString(KEY, null);
        if (stored != null) {
            try {
                SoundscapeSchedule schedule = fromJson(new JSONObject(stored));
                return inForce(schedule.enabled, canArm(context)) == schedule.enabled ? schedule
                    : new SoundscapeSchedule(false, schedule.masterVolume, schedule.events, schedule.musicEvents, schedule.entries);
            } catch (Exception ignored) {
                // Unreadable: as if there were none.
            }
        }
        return new SoundscapeSchedule(false, 1f, Collections.emptyList(), Collections.emptyList(), Collections.emptyList());
    }

    /** Store `json` (a schedule as fromJson reads it). */
    static void save(Context context, JSONObject json) {
        preferences(context).edit().putString(KEY, json.toString()).apply();
    }

    /**
     * The wall-clock time the run under way next changes (its stop, or a
     * switch to another entry), at the event's own minute rather than where
     * its fade begins; -1 outside a run or with no events.
     */
    long nextChangeMillis() {
        if (events.isEmpty()) return -1;
        Calendar now = Calendar.getInstance();
        int nowSec = secondOfWeek(now);
        Event current = current();
        if (current == null || "stop".equals(current.kind)) return -1;
        int best = Integer.MAX_VALUE;
        Event nearest = null;
        for (Event event : events) {
            if (event == current) continue;
            int distance = Math.floorMod(event.minute * 60 - nowSec, SECONDS_PER_WEEK);
            if (distance > 0 && distance < best) {
                best = distance;
                nearest = event;
            }
        }
        if (nearest == null) return -1;
        return wallClockMillis(now, nearest.minute * 60);
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
     * The events that have begun from `fromAt` (a second of the week) up to
     * now, in order, round the week's end if need be. An alarm armed for
     * `fromAt` may arrive late (Android defers exact alarms in deep sleep,
     * by minutes when two fall close together), and an event between the
     * two would otherwise be skipped, since the next alarm is armed for
     * after now.
     */
    List<Event> dueSince(int fromAt) {
        return dueSince(events, fromAt);
    }

    /** dueSince for the music's events. */
    List<Event> musicDueSince(int fromAt) {
        return dueSince(musicEvents, fromAt);
    }

    private static List<Event> dueSince(List<Event> events, int fromAt) {
        int span = Math.floorMod(secondOfWeek(Calendar.getInstance()) - fromAt, SECONDS_PER_WEEK);
        List<Event> due = new ArrayList<>();
        for (Event event : events) {
            if (Math.floorMod(event.at - fromAt, SECONDS_PER_WEEK) <= span) due.add(event);
        }
        due.sort((a, b) -> Integer.compare(Math.floorMod(a.at - fromAt, SECONDS_PER_WEEK), Math.floorMod(b.at - fromAt, SECONDS_PER_WEEK)));
        return due;
    }

    /** The event whose state holds now: the latest to have begun, round the week; null if there are none. */
    Event current() {
        return holdingAt(secondOfWeek(Calendar.getInstance()));
    }

    /** The soundscape the schedule plays at wall-clock time `millis` (its run's entry), or null: off, or no run then. */
    SoundscapeSession.Entry playingAt(long millis) {
        if (!enabled) return null;
        Calendar at = Calendar.getInstance();
        at.setTimeInMillis(millis);
        Event event = holdingAt(events, secondOfWeek(at));
        return event == null || "stop".equals(event.kind) ? null : entry(event.presetId);
    }

    /** The song set the schedule plays at wall-clock time `millis`, or null: off, or no music run then. */
    Integer musicSetAt(long millis) {
        if (!enabled) return null;
        Calendar at = Calendar.getInstance();
        at.setTimeInMillis(millis);
        Event event = holdingAt(musicEvents, secondOfWeek(at));
        return event == null || "stop".equals(event.kind) ? null : event.setId;
    }

    private Event holdingAt(int now) {
        return holdingAt(events, now);
    }

    /** The event of `events` whose state holds at second `now` of the week. */
    private static Event holdingAt(List<Event> events, int now) {
        if (events.isEmpty()) return null;
        Event latest = events.get(events.size() - 1);
        for (Event event : events) {
            if (event.at <= now) latest = event;
        }
        return latest;
    }

    /** Seconds since Monday 00:00 of this week. */
    static int secondOfWeek(Calendar calendar) {
        return minuteOfWeek(calendar) * 60 + calendar.get(Calendar.SECOND);
    }

    /** Minutes since Monday 00:00 of this week. */
    static int minuteOfWeek(Calendar calendar) {
        int day = Math.floorMod(calendar.get(Calendar.DAY_OF_WEEK) - Calendar.MONDAY, 7);
        return (day * MINUTES_PER_DAY) + (calendar.get(Calendar.HOUR_OF_DAY) * 60) + calendar.get(Calendar.MINUTE);
    }

    /**
     * The next moment after `now` whose WALL-CLOCK time is second `at` of
     * the week, in `now`'s time zone. Counted in calendar days and then set
     * to the event's hour, minute and second, never as `now` plus a number of
     * seconds: across a daylight-saving change a day is 23 or 25 hours long,
     * and adding seconds put the alarm an hour off the event's time (no
     * broadcast tells the app the offset changed, so nothing re-armed it). A
     * time the change skips (02:30 on a spring-forward night) is read
     * leniently, as the same distance past the gap (03:30).
     */
    static long wallClockMillis(Calendar now, int at) {
        int nowSec = secondOfWeek(now);
        int days = Math.floorMod(at / 86400 - nowSec / 86400, 7);
        if (days == 0 && at <= nowSec) days = 7;
        Calendar target = (Calendar) now.clone();
        target.setLenient(true);
        target.add(Calendar.DAY_OF_MONTH, days);
        int ofDay = at % 86400;
        target.set(Calendar.HOUR_OF_DAY, ofDay / 3600);
        target.set(Calendar.MINUTE, (ofDay / 60) % 60);
        target.set(Calendar.SECOND, ofDay % 60);
        target.set(Calendar.MILLISECOND, 0);
        return target.getTimeInMillis();
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
        if (!load(app).enabled) return;
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
        // Both channels' events: the alarm is for whichever begins next.
        List<Event> all = new ArrayList<>(schedule.events);
        all.addAll(schedule.musicEvents);
        all.sort((a, b) -> Integer.compare(a.at, b.at));
        if (!schedule.enabled || all.isEmpty()) {
            alarms.cancel(PendingIntent.getBroadcast(app, 0, intent, flags));
            return;
        }
        Calendar now = Calendar.getInstance();
        int nowSec = secondOfWeek(now);
        // The first event to begin after this second, or next week's first.
        Event next = all.get(0);
        for (Event event : all) {
            if (event.at > nowSec) {
                next = event;
                break;
            }
        }
        intent.putExtra(EXTRA_AT, next.at);
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, wallClockMillis(now, next.at),
            PendingIntent.getBroadcast(app, 0, intent, flags));
    }
}
