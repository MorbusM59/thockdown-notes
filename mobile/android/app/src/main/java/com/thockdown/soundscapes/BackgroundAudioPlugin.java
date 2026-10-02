package com.thockdown.soundscapes;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.util.Base64;
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
 * the background or the screen is off. And it is the soundscape's OUTPUT
 * (openOutput/write/setVolume/closeOutput; SoundscapeAudioOutput): the web
 * side renders the finished audio ahead in a worker and hands it here, and
 * it is played from this process, outside the WebView, by the platform's
 * own audio output.
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
        closeCurrentOutput();
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

    /** Open the output (replacing any open one); resolves with its `sampleRate`. */
    @PluginMethod
    public void openOutput(PluginCall call) {
        closeCurrentOutput();
        output = new SoundscapeAudioOutput(new SoundscapeAudioOutput.Listener() {
            @Override
            public void onPlayed(long frame) {
                JSObject data = new JSObject();
                data.put("frame", frame);
                notifyListeners("played", data);
            }

            @Override
            public void onStats(long queuedFrames, long dryFrames, int dryEvents, int deviceUnderruns) {
                JSObject data = new JSObject();
                data.put("queuedFrames", queuedFrames);
                data.put("dryFrames", dryFrames);
                data.put("dryEvents", dryEvents);
                data.put("deviceUnderruns", deviceUnderruns);
                notifyListeners("outputStats", data);
            }
        });
        JSObject result = new JSObject();
        result.put("sampleRate", output.sampleRate);
        call.resolve(result);
    }

    /** Queue `data` (base64 of interleaved 16-bit little-endian stereo) at `startFrame`. */
    @PluginMethod
    public void write(PluginCall call) {
        SoundscapeAudioOutput current = output;
        Double startFrame = call.getDouble("startFrame");
        String data = call.getString("data");
        if (current == null || startFrame == null || data == null) {
            call.resolve();
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        short[] samples = new short[bytes.length / 2];
        for (int index = 0; index < samples.length; index += 1) {
            samples[index] = (short) ((bytes[index * 2] & 0xff) | (bytes[(index * 2) + 1] << 8));
        }
        current.write(startFrame.longValue(), samples);
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
    public void closeOutput(PluginCall call) {
        closeCurrentOutput();
        call.resolve();
    }

    private void closeCurrentOutput() {
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
