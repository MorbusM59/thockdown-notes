package com.thockdown.soundscapes;

import android.content.Context;
import androidx.javascriptengine.IsolateStartupParameters;
import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.JavaScriptSandbox;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * The process's one JavaScriptSandbox, shared by everything that runs the
 * soundscape renderer: the live renderer (SoundscapeRenderer) and a clip
 * being rendered (ClipRenderer) may run at once, each in its own isolate.
 *
 * A process can be connected to only one sandbox at a time, so it is
 * counted rather than created per user: the first isolate opened connects
 * it, closing the last one disconnects it.
 */
final class SharedSandbox {
    private static JavaScriptSandbox sandbox;
    private static int users = 0;

    private SharedSandbox() {}

    static boolean isSupported() {
        return JavaScriptSandbox.isSupported();
    }

    /**
     * A new isolate with the renderer script (assets/soundscape-renderer.js)
     * already evaluated in it. Blocks; call from a worker thread. Each one
     * opened must be given back to `close`.
     */
    static JavaScriptIsolate openRendererIsolate(Context context) throws Exception {
        JavaScriptSandbox connected;
        synchronized (SharedSandbox.class) {
            if (sandbox == null) sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context.getApplicationContext()).get();
            users += 1;
            connected = sandbox;
        }
        try {
            IsolateStartupParameters parameters = new IsolateStartupParameters();
            if (connected.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE)) {
                // The convolution's spectra for an 8-second room are about 25 MB.
                parameters.setMaxHeapSizeBytes(256L * 1024 * 1024);
            }
            JavaScriptIsolate isolate = connected.createIsolate(parameters);
            isolate.evaluateJavaScriptAsync(readAsset(context, "soundscape-renderer.js")).get();
            return isolate;
        } catch (Exception error) {
            release();
            throw error;
        }
    }

    static void close(JavaScriptIsolate isolate) {
        try {
            isolate.close();
        } finally {
            release();
        }
    }

    private static synchronized void release() {
        users -= 1;
        if (users == 0 && sandbox != null) {
            sandbox.close();
            sandbox = null;
        }
    }

    private static String readAsset(Context context, String name) throws IOException {
        try (InputStream in = context.getAssets().open(name)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int read;
            while ((read = in.read(buffer)) > 0) bytes.write(buffer, 0, read);
            return bytes.toString(StandardCharsets.UTF_8.name());
        }
    }

    /** Samples as the renderer returns them: base64 of 16-bit little-endian interleaved stereo at half scale. */
    static short[] decodeHalfScale(String base64) {
        byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
        short[] samples = new short[bytes.length / 2];
        for (int index = 0; index < samples.length; index += 1) {
            samples[index] = (short) ((bytes[index * 2] & 0xff) | (bytes[(index * 2) + 1] << 8));
        }
        return samples;
    }
}
