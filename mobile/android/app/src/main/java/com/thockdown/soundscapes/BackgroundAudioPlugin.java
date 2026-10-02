package com.thockdown.soundscapes;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * The Android side of mobile/src/backgroundAudioHost.ts.
 *
 * Two jobs. It holds a foreground service of type mediaPlayback open for as
 * long as the web side says a soundscape is audible (start/stop), which is
 * what keeps Android from freezing or killing the process once the app is in
 * the background or the screen is off. And it runs the soundscape itself
 * (openRenderer/configure/setVolume/closeRenderer): SoundscapeRenderer
 * renders it ahead in this process and SoundscapeAudioOutput plays it, so
 * neither depends on the WebView, whose JavaScript is paused in the
 * background. The web side only sends settings and the volume.
 *
 * The web side is the only authority on whether a soundscape is playing: it
 * calls start() and stop() from the same effect that drives the engine. The
 * notification's stop control is reported back as a "stopRequested" event,
 * which the web side handles like any other control.
 */
@CapacitorPlugin(
    name = "BackgroundAudio",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class BackgroundAudioPlugin extends Plugin {
    /** The live plugin instance, for the service to report its stop control to. Null while no bridge is up. */
    private static BackgroundAudioPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        closeCurrent();
        if (instance == this) instance = null;
    }

    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title", "Soundscape");
        Intent intent = new Intent(getContext(), SoundscapePlaybackService.class)
            .setAction(SoundscapePlaybackService.ACTION_START)
            .putExtra(SoundscapePlaybackService.EXTRA_TITLE, title);
        ContextCompat.startForegroundService(getContext(), intent);
        // Android 13+ shows a foreground service's notification only with
        // this permission. The service runs either way, so playback does not
        // wait on the answer; asking once is enough, and a refusal only hides
        // the notification and its stop control.
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

    private SoundscapeAudioOutput output;
    private SoundscapeRenderer renderer;

    /** Whether the renderer can run on this device (its WebView provides the JavaScriptSandbox). */
    @PluginMethod
    public void isRendererSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", SoundscapeRenderer.isSupported());
        call.resolve(result);
    }

    /** Open the output and start the renderer (replacing any running). */
    @PluginMethod
    public void openRenderer(PluginCall call) {
        closeCurrent();
        // The renderer reads the output's playhead, and the output wakes
        // the renderer as it plays: each needs the other, so the output's
        // listener reaches the renderer through the field.
        output = new SoundscapeAudioOutput(new SoundscapeAudioOutput.Listener() {
            @Override
            public void onProgress() {
                SoundscapeRenderer current = renderer;
                if (current != null) current.wake();
            }

            @Override
            public void onStats(long playedFrames, long queuedFrames, long dryFrames, int dryEvents, int deviceUnderruns, int trackRestarts, int lastError) {
                JSObject data = new JSObject();
                data.put("sampleRate", output != null ? output.sampleRate : 0);
                data.put("playedFrames", playedFrames);
                data.put("trackRestarts", trackRestarts);
                data.put("lastError", lastError);
                data.put("queuedFrames", queuedFrames);
                data.put("dryFrames", dryFrames);
                data.put("dryEvents", dryEvents);
                data.put("deviceUnderruns", deviceUnderruns);
                notifyListeners("outputStats", data);
            }
        });
        renderer = new SoundscapeRenderer(getContext(), output, message -> {
            JSObject data = new JSObject();
            data.put("message", message);
            notifyListeners("rendererFailure", data);
        });
        call.resolve();
    }

    /** New settings: `configuration` is a ConfigureMessage as JSON. */
    @PluginMethod
    public void configure(PluginCall call) {
        SoundscapeRenderer current = renderer;
        String configuration = call.getString("configuration");
        if (current != null && configuration != null) current.configure(configuration);
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        SoundscapeAudioOutput current = output;
        if (current != null) {
            current.setVolume(call.getFloat("volume", 0f), call.getDouble("timeConstantSec", 0.08));
        }
        call.resolve();
    }

    @PluginMethod
    public void closeRenderer(PluginCall call) {
        closeCurrent();
        call.resolve();
    }

    private void closeCurrent() {
        if (renderer != null) {
            renderer.close();
            renderer = null;
        }
        if (output != null) {
            output.close();
            output = null;
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), SoundscapePlaybackService.class));
        call.resolve();
    }

    /** Called by the service when the listener presses its stop control. */
    static void reportStopRequested() {
        BackgroundAudioPlugin plugin = instance;
        if (plugin != null) plugin.notifyListeners("stopRequested", null);
    }
}
