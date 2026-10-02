package com.thockdown.soundscapes;

import android.content.Context;
import android.util.Base64;
import androidx.javascriptengine.IsolateStartupParameters;
import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.JavaScriptSandbox;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Renders the soundscape in the app's own process, ahead of playback, into
 * SoundscapeAudioOutput.
 *
 * The renderer is the web build's own code (src/sound/soundscapeSandbox.ts,
 * built into assets/soundscape-renderer.js): the generator, the mix and the
 * render-ahead the desktop runs in a worker, run here in a
 * JavaScriptSandbox (androidx.javascriptengine), a V8 isolate the app owns
 * directly. It runs here and not in the WebView because a web page's
 * JavaScript, workers included, is paused once the app is in the
 * background, and the queue ran dry about ten seconds later; nothing about
 * a page's lifecycle reaches this isolate.
 *
 * Its thread waits for something to do rather than polling: the output's
 * progress (every REPORT_FRAMES played) or a new configuration wakes it; it
 * then steps the renderer with the true playhead, writes what comes back
 * into the output, and waits again once the renderer returns nothing (the
 * lead is full). Settings changes are spliced against that same playhead,
 * read in this process at the moment of the change, so the margin only has
 * to cover what the device has already been handed.
 */
final class SoundscapeRenderer {
    interface Listener {
        void onFailure(String message);
    }

    /** Chunks per call: about half a second at 48 kHz, well inside the isolate's return limit. */
    private static final int MAX_CHUNKS_PER_STEP = 12;
    /** Beyond what the device holds: a writer block of scheduling slack. */
    private static final double SPLICE_SLACK_SEC = 0.05;

    private final Context context;
    private final SoundscapeAudioOutput output;
    private final Listener listener;
    private final Thread thread;
    private final Object signal = new Object();
    private final AtomicReference<String> pendingConfiguration = new AtomicReference<>(null);
    private volatile boolean running = true;
    private boolean woken = false;

    SoundscapeRenderer(Context context, SoundscapeAudioOutput output, Listener listener) {
        this.context = context.getApplicationContext();
        this.output = output;
        this.listener = listener;
        thread = new Thread(this::run, "SoundscapeRenderer");
        thread.start();
    }

    /** Whether this device's WebView can provide the sandbox the renderer runs in. */
    static boolean isSupported() {
        return JavaScriptSandbox.isSupported();
    }

    /** New settings (a ConfigureMessage as JSON); applied before the next step. */
    void configure(String configurationJson) {
        pendingConfiguration.set(configurationJson);
        wake();
    }

    /** Called by the output as it plays. */
    void wake() {
        synchronized (signal) {
            woken = true;
            signal.notifyAll();
        }
    }

    void close() {
        running = false;
        wake();
        try {
            thread.join(1000);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private void run() {
        JavaScriptSandbox sandbox = null;
        JavaScriptIsolate isolate = null;
        try {
            sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context).get();
            IsolateStartupParameters parameters = new IsolateStartupParameters();
            if (sandbox.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE)) {
                // The convolution's spectra for an 8-second room are about 25 MB.
                parameters.setMaxHeapSizeBytes(256L * 1024 * 1024);
            }
            isolate = sandbox.createIsolate(parameters);
            isolate.evaluateJavaScriptAsync(readAsset("soundscape-renderer.js")).get();
            JSONObject init = new JSONObject();
            init.put("sampleRate", output.sampleRate);
            init.put("seed", (int) (System.nanoTime() & 0x7fffffff));
            init.put("spliceMarginSec", output.committedSec() + SPLICE_SLACK_SEC);
            isolate.evaluateJavaScriptAsync("soundscapeInit(" + JSONObject.quote(init.toString()) + ")").get();

            while (running) {
                String configuration = pendingConfiguration.getAndSet(null);
                if (configuration != null) {
                    // The playhead first, so the splice is measured from now.
                    isolate.evaluateJavaScriptAsync("soundscapeStep(" + output.playheadFrame() + ", 0)").get();
                    isolate.evaluateJavaScriptAsync("soundscapeConfigure(" + JSONObject.quote(configuration) + ")").get();
                }
                String result = isolate.evaluateJavaScriptAsync(
                    "soundscapeStep(" + output.playheadFrame() + ", " + MAX_CHUNKS_PER_STEP + ")").get();
                JSONArray chunks = new JSONArray(result);
                for (int index = 0; index < chunks.length(); index += 1) {
                    JSONObject chunk = chunks.getJSONObject(index);
                    output.write(chunk.getLong("s"), decode(chunk.getString("d")));
                }
                if (chunks.length() > 0) continue;
                synchronized (signal) {
                    while (running && !woken) signal.wait();
                    woken = false;
                }
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } catch (Exception error) {
            if (running) listener.onFailure("Soundscape renderer stopped: " + error);
        } finally {
            if (isolate != null) isolate.close();
            if (sandbox != null) sandbox.close();
        }
    }

    private String readAsset(String name) throws IOException {
        try (InputStream in = context.getAssets().open(name)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int read;
            while ((read = in.read(buffer)) > 0) bytes.write(buffer, 0, read);
            return bytes.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static short[] decode(String base64) {
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        short[] samples = new short[bytes.length / 2];
        for (int index = 0; index < samples.length; index += 1) {
            samples[index] = (short) ((bytes[index * 2] & 0xff) | (bytes[(index * 2) + 1] << 8));
        }
        return samples;
    }
}
