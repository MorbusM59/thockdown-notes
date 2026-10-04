package com.thockdown.soundscapes;

import android.animation.ObjectAnimator;
import android.os.Bundle;
import android.view.View;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** How long the splash takes to fade into the page once the page is ready. */
    private static final long SPLASH_FADE_MS = 200;

    /**
     * Whether the page has reported its first themed frame (LaunchPlugin).
     * Read by the splash on each frame it draws; written once, on the main
     * thread, so no synchronisation is needed.
     */
    private boolean pageReady = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate, as the splash library requires. The splash
        // stays until the page says it is ready rather than until the window's
        // first frame, which is an empty WebView.
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        splash.setKeepOnScreenCondition(() -> !pageReady);
        splash.setOnExitAnimationListener((view) -> {
            ObjectAnimator fade = ObjectAnimator.ofFloat(view.getView(), View.ALPHA, 1f, 0f);
            fade.setDuration(SPLASH_FADE_MS);
            fade.addListener(new android.animation.AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(android.animation.Animator animation) {
                    view.remove();
                }
            });
            fade.start();
        });
        // Local plugins must be registered before the bridge is created.
        registerPlugin(BackgroundAudioPlugin.class);
        registerPlugin(LaunchPlugin.class);
        super.onCreate(savedInstanceState);
        // The page draws its own scrollbar (src/PageScrollbar.tsx), the only
        // way it scrolls; the WebView's would be a second one beside it,
        // drawn by the view itself where the page's styles cannot reach it.
        getBridge().getWebView().setVerticalScrollBarEnabled(false);
        getBridge().getWebView().setHorizontalScrollBarEnabled(false);
    }

    /** Lets the splash go (LaunchPlugin). Idempotent: a page reload reports again. */
    void releaseSplash() {
        runOnUiThread(() -> pageReady = true);
    }
}
