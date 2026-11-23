package com.thockdown.soundscapes;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The Android side of src/display.ts: the x n mode (MainActivity's
 * applyDisplayScale) and the screen's orientation, chosen by the reader
 * rather than by the phone's sensor. Both are kept by the activity.
 */
@CapacitorPlugin(name = "Display")
public class DisplayPlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        MainActivity activity = (MainActivity) getActivity();
        JSObject result = new JSObject();
        result.put("scale", activity.displayScale());
        result.put("landscape", activity.landscape());
        call.resolve(result);
    }

    @PluginMethod
    public void setScale(PluginCall call) {
        Integer scale = call.getInt("scale");
        if (scale == null || scale < MainActivity.MIN_DISPLAY_SCALE || scale > MainActivity.MAX_DISPLAY_SCALE) {
            call.reject("scale must be a whole number from " + MainActivity.MIN_DISPLAY_SCALE + " to " + MainActivity.MAX_DISPLAY_SCALE);
            return;
        }
        ((MainActivity) getActivity()).setDisplayScale(scale);
        call.resolve();
    }

    @PluginMethod
    public void setLandscape(PluginCall call) {
        Boolean landscape = call.getBoolean("landscape");
        if (landscape == null) {
            call.reject("landscape must be true or false");
            return;
        }
        ((MainActivity) getActivity()).setLandscape(landscape);
        call.resolve();
    }
}
