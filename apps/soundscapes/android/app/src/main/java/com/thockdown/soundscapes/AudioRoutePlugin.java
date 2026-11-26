package com.thockdown.soundscapes;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

/**
 * The Android side of src/audioRoute.ts: the name of the output the app's
 * media is played through, for the settings kept per output device (the
 * visualizer's beat delay), and a "change" event whenever it may have
 * changed. The system tells us when an output is connected or disconnected
 * (AudioDeviceCallback), which is when the media route changes; nothing is
 * polled.
 *
 * Which output plays media: from Android 13 the system says so
 * (getDevicesForAttributes); before it, the first present of the kinds media
 * is routed to ahead of the built-in speaker, in the system's own order of
 * preference (Bluetooth, then USB, then a wired headset).
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {

    private static final AudioAttributes MEDIA = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();

    /** The kinds media is routed to before the built-in speaker, most preferred first. */
    private static final int[] PREFERENCE = {
            AudioDeviceInfo.TYPE_BLE_HEADSET,
            AudioDeviceInfo.TYPE_BLE_SPEAKER,
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_USB_DEVICE,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_LINE_ANALOG,
            AudioDeviceInfo.TYPE_LINE_DIGITAL,
            AudioDeviceInfo.TYPE_HDMI,
    };

    private AudioManager audio;
    private String current = "";

    private final AudioDeviceCallback callback = new AudioDeviceCallback() {
        @Override
        public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
            refresh();
        }

        @Override
        public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            refresh();
        }
    };

    @Override
    public void load() {
        audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        current = resolve();
        // Registering reports every present device once, which refreshes to the same name.
        audio.registerAudioDeviceCallback(callback, new Handler(Looper.getMainLooper()));
    }

    @Override
    protected void handleOnDestroy() {
        audio.unregisterAudioDeviceCallback(callback);
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject result = new JSObject();
        result.put("name", current);
        call.resolve(result);
    }

    private void refresh() {
        String name = resolve();
        if (name.equals(current)) return;
        current = name;
        JSObject event = new JSObject();
        event.put("name", name);
        notifyListeners("change", event);
    }

    private String resolve() {
        AudioDeviceInfo device = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            List<android.media.AudioDeviceAttributes> routed = audio.getDevicesForAttributes(MEDIA);
            if (!routed.isEmpty()) device = find(routed.get(0).getType(), routed.get(0).getAddress());
        }
        if (device == null) {
            AudioDeviceInfo[] outputs = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            for (int type : PREFERENCE) {
                for (AudioDeviceInfo output : outputs) {
                    if (output.getType() == type) {
                        device = output;
                        break;
                    }
                }
                if (device != null) break;
            }
        }
        return device == null ? "Phone speaker" : nameOf(device);
    }

    /** The present output of `type` at `address` (any address when it is empty). */
    private AudioDeviceInfo find(int type, String address) {
        for (AudioDeviceInfo output : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (output.getType() != type) continue;
            if (address == null || address.isEmpty() || address.equals(output.getAddress())) return output;
        }
        return null;
    }

    /** A name a reader recognizes and two devices do not share: the kind, and the product for an external one. */
    private static String nameOf(AudioDeviceInfo device) {
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE:
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
                return "Phone speaker";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                // The product name of a jack is the phone's own model, which says nothing.
                return "Wired headphones";
            default:
                CharSequence product = device.getProductName();
                String kind = kindOf(device.getType());
                return product == null || product.length() == 0 ? kind : kind + ": " + product;
        }
    }

    private static String kindOf(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
            case AudioDeviceInfo.TYPE_BLE_SPEAKER:
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                return "Bluetooth";
            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
                return "USB";
            case AudioDeviceInfo.TYPE_HDMI:
                return "HDMI";
            default:
                return "Output";
        }
    }
}
