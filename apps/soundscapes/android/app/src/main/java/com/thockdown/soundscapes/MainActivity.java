package com.thockdown.soundscapes;

import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** How long the launch overlay takes to fade into the page once the page is ready. */
    private static final long LAUNCH_FADE_MS = 200;
    /** The launch image's width as a share of the screen's shorter side. */
    private static final float LAUNCH_IMAGE_WIDTH_FRACTION = 0.8f;

    /**
     * Covers the whole window from the first frame until the page is ready:
     * launch_image centred on launch_background. The system splash cannot
     * place an image of our choosing (it draws only an icon, and only when
     * the launcher asks for one), so the image is drawn here, by the app,
     * where it looks the same however the app was started.
     */
    private View launchOverlay;
    /** The WebView's accessibility importance before the overlay hid it, restored when it goes. */
    private int webViewAccessibility;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate, as the splash library requires. The system
        // splash (launch_background, no icon) is released on the app's first
        // frame, which is the launch overlay in the same colour.
        SplashScreen.installSplashScreen(this);
        // Local plugins must be registered before the bridge is created.
        registerPlugin(BackgroundAudioPlugin.class);
        registerPlugin(LaunchPlugin.class);
        super.onCreate(savedInstanceState);
        // The page draws its own scrollbar (src/PageScrollbar.tsx), the only
        // way it scrolls; the WebView's would be a second one beside it,
        // drawn by the view itself where the page's styles cannot reach it.
        getBridge().getWebView().setVerticalScrollBarEnabled(false);
        getBridge().getWebView().setHorizontalScrollBarEnabled(false);
        addLaunchOverlay();
    }

    private void addLaunchOverlay() {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(ContextCompat.getColor(this, R.color.launch_background));
        // Swallows touches meant for the page underneath while it is covered,
        // and hides that page from accessibility services the same way, so
        // TalkBack cannot reach controls that are not yet in their final state.
        // The overlay itself is decoration and is not announced either.
        overlay.setClickable(true);
        overlay.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        View webView = getBridge().getWebView();
        webViewAccessibility = webView.getImportantForAccessibility();
        webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);

        ImageView image = new ImageView(this);
        image.setImageResource(R.drawable.launch_image);
        image.setAdjustViewBounds(true);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        int shorterSide = Math.min(
            getResources().getDisplayMetrics().widthPixels,
            getResources().getDisplayMetrics().heightPixels
        );
        int width = Math.round(shorterSide * LAUNCH_IMAGE_WIDTH_FRACTION);
        overlay.addView(image, new FrameLayout.LayoutParams(width, width, Gravity.CENTER));

        // On the decor view, so it covers the system bars' area as well as the
        // content: the screen is one field until the overlay fades.
        ((ViewGroup) getWindow().getDecorView()).addView(
            overlay,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        launchOverlay = overlay;
    }

    /** Fades the launch overlay away (LaunchPlugin). Idempotent: a page reload reports again. */
    void releaseLaunchOverlay() {
        runOnUiThread(() -> {
            View overlay = launchOverlay;
            if (overlay == null) return;
            launchOverlay = null;
            getBridge().getWebView().setImportantForAccessibility(webViewAccessibility);
            overlay.animate()
                .alpha(0f)
                .setDuration(LAUNCH_FADE_MS)
                .withEndAction(() -> ((ViewGroup) overlay.getParent()).removeView(overlay));
        });
    }
}
