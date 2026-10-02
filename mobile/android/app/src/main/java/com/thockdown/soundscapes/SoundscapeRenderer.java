package com.thockdown.soundscapes;

import android.content.Context;
import androidx.javascriptengine.JavaScriptIsolate;
import java.util.concurrent.ConcurrentLinkedQueue;
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
 *
 * A configuration identical to the one in force is not applied: the web
 * page and the media controls (SoundscapeSession) can both send the same
 * soundscape, and applying it again would re-render from near the playhead
 * and crossfade it into a different take of itself.
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
    /** Settings changes not yet applied, in order: a configuration and, for a transition, its length (0 for a plain configure). */
    private final ConcurrentLinkedQueue<Object[]> pending = new ConcurrentLinkedQueue<>();
    private volatile boolean running = true;
    private boolean woken = false;
    /** The configuration in force; only the renderer's thread reads or writes it. */
    private String applied = null;

    SoundscapeRenderer(Context context, SoundscapeAudioOutput output, Listener listener) {
        this.context = context.getApplicationContext();
        this.output = output;
        this.listener = listener;
        thread = new Thread(this::run, "SoundscapeRenderer");
        thread.start();
    }

    /** New settings (a ConfigureMessage as JSON); applied before the next step. */
    void configure(String configurationJson) {
        pending.add(new Object[] { configurationJson, 0.0 });
        wake();
    }

    /** Change to `configurationJson` by a crossfade of `seconds` from what plays (RenderAhead's transition). */
    void transition(String configurationJson, double seconds) {
        pending.add(new Object[] { configurationJson, seconds });
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
        // Closed from its own thread when it reports a failure: it ends by itself.
        if (Thread.currentThread() == thread) return;
        try {
            thread.join(1000);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    private void run() {
        JavaScriptIsolate isolate = null;
        try {
            isolate = SharedSandbox.openRendererIsolate(context);
            JSONObject init = new JSONObject();
            init.put("sampleRate", output.sampleRate);
            init.put("seed", (int) (System.nanoTime() & 0x7fffffff));
            init.put("spliceMarginSec", output.committedSec() + SPLICE_SLACK_SEC);
            isolate.evaluateJavaScriptAsync("soundscapeInit(" + JSONObject.quote(init.toString()) + ")").get();

            while (running) {
                Object[] change;
                while ((change = pending.poll()) != null) {
                    String configuration = (String) change[0];
                    double seconds = (Double) change[1];
                    if (configuration.equals(applied)) continue;
                    applied = configuration;
                    // The playhead first, so a splice is measured from now.
                    isolate.evaluateJavaScriptAsync("soundscapeStep(" + output.playheadFrame() + ", 0)").get();
                    isolate.evaluateJavaScriptAsync(seconds > 0
                        ? "soundscapeTransition(" + JSONObject.quote(configuration) + ", " + seconds + ")"
                        : "soundscapeConfigure(" + JSONObject.quote(configuration) + ")").get();
                }
                String result = isolate.evaluateJavaScriptAsync(
                    "soundscapeStep(" + output.playheadFrame() + ", " + MAX_CHUNKS_PER_STEP + ")").get();
                JSONArray chunks = new JSONArray(result);
                for (int index = 0; index < chunks.length(); index += 1) {
                    JSONObject chunk = chunks.getJSONObject(index);
                    output.write(chunk.getLong("s"), SharedSandbox.decodeHalfScale(chunk.getString("d")));
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
            if (isolate != null) SharedSandbox.close(isolate);
        }
    }
}
