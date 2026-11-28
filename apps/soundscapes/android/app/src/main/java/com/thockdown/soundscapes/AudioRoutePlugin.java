package com.thockdown.soundscapes;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The Android side of src/audioRoute.ts, over AudioConnection: the name of
 * the output media plays through (for the settings kept per output device,
 * the visualizer's beat delay), the connection state and the outputs the
 * listener can pick, and a "change" event whenever any of them may have
 * changed. Nothing is polled: AudioConnection hears the system's device
 * callback and its becoming-noisy broadcast.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {
    private AudioConnection connection;
    private final AudioConnection.Listener listener = () -> notifyListeners("change", state());

    @Override
    public void load() {
        connection = AudioConnection.get(getContext());
        connection.addListener(listener);
    }

    @Override
    protected void handleOnDestroy() {
        connection.removeListener(listener);
    }

    @PluginMethod
    public void get(PluginCall call) {
        call.resolve(state());
    }

    /** Connected again: on the output `id`, or with none given on the system's route. */
    @PluginMethod
    public void resume(PluginCall call) {
        connection.resume(call.getInt("id", -1));
        call.resolve();
    }

    private JSObject state() {
        AudioConnection.Output active = connection.active();
        JSObject result = new JSObject();
        result.put("name", connection.activeName());
        result.put("connected", connection.isConnected());
        JSArray outputs = new JSArray();
        for (AudioConnection.Output output : connection.outputs()) {
            JSObject entry = new JSObject();
            entry.put("id", output.id);
            entry.put("kind", output.kind);
            entry.put("name", output.name);
            entry.put("active", active != null && active.id == output.id);
            outputs.put(entry);
        }
        result.put("outputs", outputs);
        return result;
    }
}
