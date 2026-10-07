package com.thockdown.soundscapes;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * The Android side of mobile/src/backgroundAudioHost.ts: the web page's
 * interface to the soundscape session (SoundscapeSession), to rendering a
 * clip (ClipRenderer), and to saving a file where the reader chooses.
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

    /**
     * The system's back gesture, taken by the page while it has something
     * to go back FROM (help mode): enabled, it reports `back` instead of
     * leaving the app; disabled, back does what it always does.
     */
    private final OnBackPressedCallback backCallback = new OnBackPressedCallback(false) {
        @Override
        public void handleOnBackPressed() {
            notifyListeners("back", new JSObject());
        }
    };

    private final SoundscapeSession.Listener sessionListener = new SoundscapeSession.Listener() {
        @Override
        public void onChanged(SoundscapeSession.State state) {
            notifyListeners("sessionChanged", toJs(state));
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
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), backCallback);
    }

    /** Whether the page takes the back gesture (`{ taken }`); see backCallback. */
    @PluginMethod
    public void takeBack(PluginCall call) {
        boolean taken = Boolean.TRUE.equals(call.getBoolean("taken", false));
        getActivity().runOnUiThread(() -> backCallback.setEnabled(taken));
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        session.clearListener(sessionListener);
        if (clip != null) clip.cancel();
    }

    private static JSObject toJs(SoundscapeSession.State state) {
        JSObject data = new JSObject();
        data.put("regular", state.regular.name().toLowerCase(java.util.Locale.ROOT));
        data.put("source", state.source.name().toLowerCase(java.util.Locale.ROOT));
        data.put("currentId", state.currentId);
        data.put("scheduleEnabled", state.scheduleEnabled);
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
        call.resolve(toJs(session.state()));
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
            SoundscapeSchedule.save(getContext(), json);
            // Turned on or off, or its slots changed under a run: either way
            // what is heard may have changed.
            session.applyScheduleState();
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
            try {
                getContext().startActivity(settings);
            } catch (android.content.ActivityNotFoundException missing) {
                // Some device builds have no page for this setting; the
                // schedule then stays off, as it would if refused.
            }
        }
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    /** `entries`: `[{ id, name, configuration }]`; `currentId`; `currentName`; `masterVolume`. */
    @PluginMethod
    public void publish(PluginCall call) {
        try {
            JSArray array = call.getArray("entries");
            List<SoundscapeSession.Entry> entries = new ArrayList<>();
            for (int index = 0; index < array.length(); index += 1) {
                JSONObject entry = array.getJSONObject(index);
                entries.add(new SoundscapeSession.Entry(entry.getString("id"), entry.getString("name"), entry.getString("configuration")));
            }
            session.publish(entries, call.getString("currentId"), call.getString("currentName"), call.getFloat("masterVolume", 1f));
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

    /** Regular mode stops and the schedule takes over: resolves the outcome, which the page did not cause and cannot work out. */
    @PluginMethod
    public void stop(PluginCall call) {
        call.resolve(toJs(session.stop()));
    }

    /** New settings: `configuration` is a ConfigureMessage as JSON; `transitionSec` 0 for a settings change, else a change of soundscape crossfaded that long. */
    @PluginMethod
    public void configure(PluginCall call) {
        String configuration = call.getString("configuration");
        if (configuration != null) session.configure(configuration, call.getDouble("transitionSec", 0.0));
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        session.setVolume(call.getFloat("volume", 0f), call.getDouble("timeConstantSec", 0.08));
        call.resolve();
    }

    /**
     * Ask where to save a clip (the system's "Save as" dialog, named `name`.m4a),
     * then render `seconds` of `configuration` into a temporary file and copy
     * it there. Asked FIRST, so the dialog does not interrupt the reader a
     * minute later, and cancelling it cancels the clip. Progress arrives as
     * "clipProgress" events, the end as "clipFinished" (`{ saved }`, false on
     * failure or cancel).
     */
    @PluginMethod
    public void renderClip(PluginCall call) {
        if (clip != null) clip.cancel();
        startActivityForResult(call, saveAs(call.getString("name", "Soundscape") + ".m4a", "audio/mp4"), "clipLocationChosen");
    }

    @ActivityCallback
    private void clipLocationChosen(PluginCall call, ActivityResult result) {
        Uri target = chosen(result);
        if (target == null) {
            notifyClipFinished(false);
            call.resolve();
            return;
        }
        File directory = new File(getContext().getCacheDir(), "clips");
        directory.mkdirs();
        File rendered = new File(directory, "clip.m4a");
        ClipRenderer[] self = new ClipRenderer[1];
        self[0] = new ClipRenderer(getContext(), call.getString("configuration"), call.getDouble("seconds", 300.0), rendered,
            new ClipRenderer.Listener() {
                @Override
                public void onProgress(double fraction) {
                    JSObject data = new JSObject();
                    data.put("fraction", fraction);
                    notifyListeners("clipProgress", data);
                }

                @Override
                public void onFinished(File file) {
                    try {
                        copyTo(file, target);
                        finishClip(self[0], true);
                    } catch (Exception error) {
                        finishClip(self[0], false);
                        sessionListener.onFailure("Clip could not be saved: " + error);
                    } finally {
                        file.delete();
                    }
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

    private void finishClip(ClipRenderer finished, boolean saved) {
        getBridge().executeOnMainThread(() -> {
            if (clip != finished) return;
            clip = null;
            notifyClipFinished(saved);
        });
    }

    private void notifyClipFinished(boolean saved) {
        JSObject data = new JSObject();
        data.put("saved", saved);
        notifyListeners("clipFinished", data);
    }

    /**
     * Save `content` (text) as a file named `name`, where the reader chooses
     * in the system's "Save as" dialog. Resolves `{ saved }`, false if the
     * dialog was cancelled.
     */
    @PluginMethod
    public void saveText(PluginCall call) {
        // A type of its own rather than text/plain: given text/plain, some
        // document providers append .txt to the name the reader keeps.
        startActivityForResult(call, saveAs(call.getString("name", "soundscapes.tds"), "application/octet-stream"), "textLocationChosen");
    }

    @ActivityCallback
    private void textLocationChosen(PluginCall call, ActivityResult result) {
        Uri target = chosen(result);
        JSObject data = new JSObject();
        if (target == null) {
            data.put("saved", false);
            call.resolve(data);
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(target, "wt")) {
            out.write(call.getString("content", "").getBytes(StandardCharsets.UTF_8));
            data.put("saved", true);
            call.resolve(data);
        } catch (Exception error) {
            call.reject("Could not save the file: " + error);
        }
    }

    /** The system's "Save as" dialog (the Storage Access Framework): the reader picks the folder and may rename. */
    private static Intent saveAs(String name, String mimeType) {
        return new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, name);
    }

    private static Uri chosen(ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) return null;
        return result.getData().getData();
    }

    private void copyTo(File file, Uri target) throws Exception {
        try (InputStream in = new FileInputStream(file);
             OutputStream out = getContext().getContentResolver().openOutputStream(target, "wt")) {
            byte[] buffer = new byte[65536];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
        }
    }
}
