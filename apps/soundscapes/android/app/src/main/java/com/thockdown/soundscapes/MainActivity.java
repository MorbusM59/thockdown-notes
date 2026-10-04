package com.thockdown.soundscapes;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge is created.
        registerPlugin(BackgroundAudioPlugin.class);
        super.onCreate(savedInstanceState);
        // The page draws its own scrollbar (mobile/src/PageScrollbar.tsx), the
        // only way it scrolls; the WebView's would be a second one beside it,
        // drawn by the view itself where the page's styles cannot reach it.
        getBridge().getWebView().setVerticalScrollBarEnabled(false);
        getBridge().getWebView().setHorizontalScrollBarEnabled(false);
    }
}
