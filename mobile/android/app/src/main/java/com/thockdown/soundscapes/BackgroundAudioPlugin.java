package com.thockdown.soundscapes;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * The Android side of mobile/src/backgroundAudioHost.ts: the web page's
 * interface to the soundscape session (SoundscapeSession), to rendering a
 * clip (ClipRenderer), and to sharing a file.
 *
 * The session outlives this plugin (which goes with the activity), so the
 * plugin holds nothing of it: it forwards the page's calls, and passes the
 * session's reports (a media control was pressed, the renderer failed) back
 * as events while it exists.
 */
@CapacitorPlugin(
    name = "BackgroundAudio",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class BackgroundAudioPlugin extends Plugin {
    private SoundscapeSession session;
    private ClipRenderer clip;

    private final SoundscapeSession.Listener sessionListener = new SoundscapeSession.Listener() {
        @Override
        public void onChanged(boolean playing, String currentId, boolean scheduleEnabled) {
            notifyListeners("sessionChanged", state(playing, currentId, scheduleEnabled));
        }

        @Override
        public void onFailure(String message) {
            JSObject data = new JSObject();
            data.put("message", message);
            notifyListeners("rendererFailure", data);
        }
    };

    @Override
    public void load() {
        session = SoundscapeSession.get(getContext());
        session.setListener(sessionListener);
    }

    @Override
    protected void handleOnDestroy() {
        session.clearListener(sessionListener);
        if (clip != null) clip.cancel();
    }

    private static JSObject state(boolean playing, String currentId, boolean scheduleEnabled) {
        JSObject data = new JSObject();
        data.put("playing", playing);
        data.put("currentId", currentId);
        data.put("scheduleEnabled", scheduleEnabled);
        return data;
    }

    /** Whether the renderer can run on this device (its WebView provides the JavaScriptSandbox). */
    @PluginMethod
    public void isRendererSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", SharedSandbox.isSupported());
        call.resolve(result);
    }

    /** What the session is doing: for the page to catch up with on coming back to the foreground. */
    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(state(session.isPlaying(), session.currentId(), SoundscapeSchedule.load(getContext()).enabled));
    }

    /**
     * The schedule: `{ enabled, masterVolume, events, entries }` (see
     * SoundscapeSchedule). Stored and armed; turning it on also applies its
     * state at this moment, so a run in progress starts playing.
     */
    @PluginMethod
    public void setSchedule(PluginCall call) {
        try {
            JSObject json = call.getData();
            SoundscapeSchedule.fromJson(json);
            boolean wasEnabled = SoundscapeSchedule.load(getContext()).enabled;
            SoundscapeSchedule.save(getContext(), json);
            if (json.getBoolean("enabled") && !wasEnabled) session.applyScheduleState();
            SoundscapeSchedule.arm(getContext());
            call.resolve();
        } catch (Exception error) {
            call.reject("Invalid schedule: " + error);
        }
    }

    /**
     * Whether the schedule's alarms can be exact (`{ granted }`). If not, the
     * system's page for granting it is opened, and the schedule cannot be
     * turned on until it has been.
     */
    @PluginMethod
    public void ensureExactAlarms(PluginCall call) {
        boolean granted = SoundscapeSchedule.canArm(getContext());
        if (!granted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent settings = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:" + getContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
        }
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    /** `entries`: `[{ id, name, configuration }]`; `currentId`; `masterVolume`. */
    @PluginMethod
    public void publish(PluginCall call) {
        try {
            JSArray array = call.getArray("entries");
            List<SoundscapeSession.Entry> entries = new ArrayList<>();
            for (int index = 0; index < array.length(); index += 1) {
                JSONObject entry = array.getJSONObject(index);
                entries.add(new SoundscapeSession.Entry(entry.getString("id"), entry.getString("name"), entry.getString("configuration")));
            }
            session.publish(entries, call.getString("currentId"), call.getFloat("masterVolume", 1f));
            call.resolve();
        } catch (Exception error) {
            call.reject("Invalid soundscape list: " + error);
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        session.play();
        // Android 13+ shows a foreground service's notification only with
        // this permission. Playback does not wait on the answer; asking once
        // is enough, and a refusal only hides the notification.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") == com.getcapacitor.PermissionState.PROMPT) {
            requestPermissionForAlias("notifications", call, "afterNotificationPermission");
            return;
        }
        call.resolve();
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void afterNotificationPermission(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        session.pause();
        call.resolve();
    }

    /** New settings: `configuration` is a ConfigureMessage as JSON. */
    @PluginMethod
    public void configure(PluginCall call) {
        String configuration = call.getString("configuration");
        if (configuration != null) session.configure(configuration);
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        session.setVolume(call.getFloat("volume", 0f), call.getDouble("timeConstantSec", 0.08));
        call.resolve();
    }

    /**
     * Render `seconds` of `configuration` to an .m4a named `name`, then offer
     * it through the share sheet. Progress arrives as "clipProgress" events,
     * the end as "clipFinished" (`{ shared }`, false on failure or cancel).
     */
    @PluginMethod
    public void renderClip(PluginCall call) {
        if (clip != null) clip.cancel();
        File directory = new File(getContext().getCacheDir(), "clips");
        directory.mkdirs();
        File destination = new File(directory, call.getString("name", "Soundscape") + ".m4a");
        ClipRenderer[] self = new ClipRenderer[1];
        self[0] = new ClipRenderer(getContext(), call.getString("configuration"), call.getDouble("seconds", 300.0), destination,
            new ClipRenderer.Listener() {
                @Override
                public void onProgress(double fraction) {
                    JSObject data = new JSObject();
                    data.put("fraction", fraction);
                    notifyListeners("clipProgress", data);
                }

                @Override
                public void onFinished(File file) {
                    finishClip(self[0], true);
                    share(file, "audio/mp4");
                }

                @Override
                public void onFailure(String message) {
                    finishClip(self[0], false);
                    sessionListener.onFailure(message);
                }
            });
        clip = self[0];
        call.resolve();
    }

    @PluginMethod
    public void cancelClip(PluginCall call) {
        ClipRenderer current = clip;
        if (current != null) {
            current.cancel();
            finishClip(current, false);
        }
        call.resolve();
    }

    private void finishClip(ClipRenderer finished, boolean shared) {
        getBridge().executeOnMainThread(() -> {
            if (clip != finished) return;
            clip = null;
            JSObject data = new JSObject();
            data.put("shared", shared);
            notifyListeners("clipFinished", data);
        });
    }

    /** Write `content` (text) to a file named `name` and offer it through the share sheet. */
    @PluginMethod
    public void shareText(PluginCall call) {
        try {
            File directory = new File(getContext().getCacheDir(), "exports");
            directory.mkdirs();
            File file = new File(directory, call.getString("name", "soundscapes.tds"));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(call.getString("content", "").getBytes(StandardCharsets.UTF_8));
            }
            // text/plain rather than a type of its own: a .tds file is text,
            // and the share targets that save files (Files, Drive, mail)
            // accept text where they would refuse an unknown type.
            share(file, "text/plain");
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not share the file: " + error);
        }
    }

    private void share(File file, String mimeType) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        Intent send = new Intent(Intent.ACTION_SEND)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_TITLE, file.getName())
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(send, file.getName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);
    }
}
