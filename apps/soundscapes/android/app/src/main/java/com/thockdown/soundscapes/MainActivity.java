package com.thockdown.soundscapes;

import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
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

    static final int MIN_DISPLAY_SCALE = 1;
    static final int MAX_DISPLAY_SCALE = 2;
    private static final String DISPLAY_PREFERENCES = "display";
    private static final String DISPLAY_SCALE_KEY = "scale";
    /**
     * The visualizer's x n mode (applied only while it is open): the WebView is laid out at 1/n of its parent and drawn n
     * times larger, into a hardware layer of its own size. The page sees a
     * screen n times smaller, so everything on it is n times larger and
     * there are n squared fewer pixels to draw: every filter, mask and
     * canvas costs that much less. Making things larger inside the page
     * (desktop's double mode) cannot do that, since a WebView always
     * rasterizes at the screen's own resolution.
     */
    private int displayScale = MIN_DISPLAY_SCALE;
    private static final String LANDSCAPE_KEY = "landscape";
    /**
     * The visualizer's orientation, a switch the reader turns rather than the
     * phone's sensor: portrait or landscape, either way up. It applies only
     * while the visualizer is open (visualizerOpen); the rest of the app is
     * always portrait, the manifest's default.
     */
    private boolean landscape = false;
    private boolean visualizerOpen = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate, as the splash library requires. The system
        // splash (launch_background, no icon) is released on the app's first
        // frame, which is the launch overlay in the same colour.
        SplashScreen.installSplashScreen(this);
        // Local plugins must be registered before the bridge is created.
        registerPlugin(BackgroundAudioPlugin.class);
        registerPlugin(MusicPlugin.class);
        registerPlugin(LaunchPlugin.class);
        registerPlugin(DisplayPlugin.class);
        super.onCreate(savedInstanceState);
        // The music files, served to the page for the visualizer's beat analysis.
        getBridge().setWebViewClient(new MusicFileServer(getBridge()));
        // The page draws its own scrollbar (src/PageScrollbar.tsx), the only
        // way it scrolls; the WebView's would be a second one beside it,
        // drawn by the view itself where the page's styles cannot reach it.
        getBridge().getWebView().setVerticalScrollBarEnabled(false);
        getBridge().getWebView().setHorizontalScrollBarEnabled(false);
        addLaunchOverlay();
        SharedPreferences display = getSharedPreferences(DISPLAY_PREFERENCES, MODE_PRIVATE);
        displayScale = Math.max(MIN_DISPLAY_SCALE, Math.min(MAX_DISPLAY_SCALE, display.getInt(DISPLAY_SCALE_KEY, MIN_DISPLAY_SCALE)));
        landscape = display.getBoolean(LANDSCAPE_KEY, false);
        View webView = getBridge().getWebView();
        ((View) webView.getParent()).addOnLayoutChangeListener((parent, l, t, r, b, ol, ot, or, ob) -> {
            if (r - l != or - ol || b - t != ob - ot) applyDisplayScale();
        });
        applyDisplayScale();
    }

    int displayScale() {
        return displayScale;
    }

    void setDisplayScale(int scale) {
        displayScale = scale;
        SharedPreferences.Editor editor = getSharedPreferences(DISPLAY_PREFERENCES, MODE_PRIVATE).edit();
        editor.putInt(DISPLAY_SCALE_KEY, scale).apply();
        runOnUiThread(this::applyDisplayScale);
    }

    boolean landscape() {
        return landscape;
    }

    void setLandscape(boolean value) {
        landscape = value;
        getSharedPreferences(DISPLAY_PREFERENCES, MODE_PRIVATE).edit().putBoolean(LANDSCAPE_KEY, value).apply();
        runOnUiThread(this::applyOrientation);
    }

    void setVisualizerOpen(boolean open) {
        visualizerOpen = open;
        runOnUiThread(() -> {
            applyOrientation();
            applySystemBars();
            applyDisplayScale();
        });
    }

    /**
     * The visualizer is the whole screen: the status bar and the navigation
     * bar are hidden while it is open. A swipe in from the screen's edge
     * brings them back over the scene for a moment, and the system hides
     * them again on its own (Android's immersive mode; how long they stay is
     * the system's, not the app's to set).
     */
    private void applySystemBars() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (visualizerOpen) {
            bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            bars.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            bars.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    private void applyOrientation() {
        setRequestedOrientation(visualizerOpen && landscape
            ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    }

    /** Sizes and scales the WebView for the current x n mode against its parent's size. */
    private void applyDisplayScale() {
        View webView = getBridge().getWebView();
        View parent = (View) webView.getParent();
        // Only the visualizer is drawn at x n; the rest of the app always at x1.
        int n = visualizerOpen ? displayScale : MIN_DISPLAY_SCALE;
        ViewGroup.LayoutParams params = webView.getLayoutParams();
        int width = parent.getWidth();
        int height = parent.getHeight();
        if (n == 1 || width == 0 || height == 0) {
            params.width = ViewGroup.LayoutParams.MATCH_PARENT;
            params.height = ViewGroup.LayoutParams.MATCH_PARENT;
        } else {
            // Rounded up, so the scaled view always reaches the far edges.
            params.width = (width + n - 1) / n;
            params.height = (height + n - 1) / n;
        }
        webView.setLayoutParams(params);
        webView.setPivotX(0);
        webView.setPivotY(0);
        webView.setScaleX(n);
        webView.setScaleY(n);
        // Without a layer of its own the WebView would rasterize through the
        // scale at full resolution and save nothing.
        webView.setLayerType(n == 1 ? View.LAYER_TYPE_NONE : View.LAYER_TYPE_HARDWARE, null);
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
        // The width is fixed and the height follows the image's own aspect
        // ratio (adjustViewBounds). The height is still bounded by the screen,
        // so an image taller than the screen allows is scaled down to fit it
        // (FIT_CENTER) and then draws narrower than this width.
        overlay.addView(image, new FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

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
