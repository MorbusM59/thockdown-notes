package com.thockdown.soundscapes;

import static org.junit.Assert.assertEquals;

import java.util.Calendar;
import java.util.TimeZone;
import org.junit.Test;

/** SoundscapeSchedule.wallClockMillis: an event fires at its wall-clock time, across a daylight-saving change too. */
public class ScheduleWallClockTest {
    private static final TimeZone BERLIN = TimeZone.getTimeZone("Europe/Berlin");

    private static Calendar at(int year, int month, int day, int hour, int minute) {
        Calendar calendar = Calendar.getInstance(BERLIN);
        calendar.clear();
        calendar.set(year, month, day, hour, minute, 0);
        return calendar;
    }

    private static int hourOf(long millis) {
        Calendar calendar = Calendar.getInstance(BERLIN);
        calendar.setTimeInMillis(millis);
        return calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE);
    }

    /** Second of the week of `day` (0 = Monday) at hour:minute. */
    private static int week(int day, int hour, int minute) {
        return ((day * 24 + hour) * 60 + minute) * 60;
    }

    @Test
    public void spansTheSpringForwardNightAtTheEventsWallClockTime() {
        // Saturday 2026-03-28 22:00; Europe switches to summer time on Sunday the 29th.
        Calendar now = at(2026, Calendar.MARCH, 28, 22, 0);
        long fires = SoundscapeSchedule.wallClockMillis(now, week(6, 8, 0));
        assertEquals(8 * 60, hourOf(fires));
        assertEquals(29, dayOf(fires));
    }

    @Test
    public void spansTheFallBackNightAtTheEventsWallClockTime() {
        Calendar now = at(2026, Calendar.OCTOBER, 24, 22, 0);
        long fires = SoundscapeSchedule.wallClockMillis(now, week(6, 8, 0));
        assertEquals(8 * 60, hourOf(fires));
        assertEquals(25, dayOf(fires));
    }

    @Test
    public void anEventAtThisVerySecondIsNextWeeks() {
        Calendar now = at(2026, Calendar.NOVEMBER, 23, 8, 0); // a Monday
        long fires = SoundscapeSchedule.wallClockMillis(now, week(0, 8, 0));
        assertEquals(7L * 24 * 3600 * 1000, fires - now.getTimeInMillis());
    }

    @Test
    public void laterTodayIsToday() {
        Calendar now = at(2026, Calendar.NOVEMBER, 23, 8, 0);
        long fires = SoundscapeSchedule.wallClockMillis(now, week(0, 9, 30));
        assertEquals(90L * 60 * 1000, fires - now.getTimeInMillis());
    }

    private static int dayOf(long millis) {
        Calendar calendar = Calendar.getInstance(BERLIN);
        calendar.setTimeInMillis(millis);
        return calendar.get(Calendar.DAY_OF_MONTH);
    }
}
