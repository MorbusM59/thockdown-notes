package com.thockdown.soundscapes;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The Android side of src/displayScale.ts: the x n mode (MainActivity's
 * applyDisplayScale), read and set by the page, kept by the activity.
 */
@CapacitorPlugin(name = "DisplayScale")
public class DisplayScalePlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        JSObject result = new JSObject();
        result.put("scale", ((MainActivity) getActivity()).displayScale());
        call.resolve(result);
    }

    @PluginMethod
    public void set(PluginCall call) {
        Integer scale = call.getInt("scale");
        if (scale == null || scale < MainActivity.MIN_DISPLAY_SCALE || scale > MainActivity.MAX_DISPLAY_SCALE) {
            call.reject("scale must be a whole number from " + MainActivity.MIN_DISPLAY_SCALE + " to " + MainActivity.MAX_DISPLAY_SCALE);
            return;
        }
        ((MainActivity) getActivity()).setDisplayScale(scale);
        call.resolve();
    }
}
