package com.thockdown.soundscapes;

import android.content.Context;
import android.os.ParcelFileDescriptor;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.util.Calendar;
import org.json.JSONObject;

/** What the schedule's device tests share: a stored schedule, and what AlarmManager actually holds. */
final class ScheduleDevice {
    private ScheduleDevice() {}

    static Context context() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    /** Store a schedule switched on, with one start an hour from now. */
    static void storeScheduleSwitchedOn() throws Exception {
        int minute = Math.floorMod(SoundscapeSchedule.minuteOfWeek(Calendar.getInstance()) + 60, SoundscapeSchedule.MINUTES_PER_WEEK);
        JSONObject json = new JSONObject("{\"enabled\":true,\"masterVolume\":1,"
            + "\"events\":[{\"minute\":" + minute + ",\"kind\":\"start\",\"presetId\":\"a\",\"fadeSec\":0}],"
            + "\"entries\":[{\"id\":\"a\",\"name\":\"A\",\"configuration\":\"{}\"}]}");
        SoundscapeSchedule.save(context(), json);
    }

    /** Whether AlarmManager holds the schedule's alarm: read from the system, not from the app's own PendingIntents, which outlive a cancel. */
    static boolean alarmArmed() throws Exception {
        ParcelFileDescriptor out = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("dumpsys alarm");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream in = new FileInputStream(out.getFileDescriptor())) {
            byte[] buffer = new byte[16384];
            int read;
            while ((read = in.read(buffer)) > 0) bytes.write(buffer, 0, read);
        }
        out.close();
        // The dump also keeps a history of REMOVED alarms, which names a
        // cancelled one too: only what is listed before it is pending.
        String dump = bytes.toString("UTF-8");
        int history = dump.indexOf("emoval history");
        if (history >= 0) dump = dump.substring(0, history);
        return dump.contains(SoundscapeSchedule.ACTION_ALARM);
    }
}
