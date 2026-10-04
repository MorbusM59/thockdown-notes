package com.thockdown.soundscapes;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The Android side of src/launchHandover.ts: the page's one report that its
 * first themed frame is on screen, which is what releases the launch overlay
 * (MainActivity). Nothing else decides when the overlay goes, so the reader
 * never sees the page before it has its colours and its layout.
 */
@CapacitorPlugin(name = "Launch")
public class LaunchPlugin extends Plugin {

    @PluginMethod
    public void ready(PluginCall call) {
        ((MainActivity) getActivity()).releaseLaunchOverlay();
        call.resolve();
    }
}
