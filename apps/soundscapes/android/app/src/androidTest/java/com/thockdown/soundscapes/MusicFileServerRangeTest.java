package com.thockdown.soundscapes;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * MusicFileServer answers the beat analysis's range requests through a REAL
 * WebView, which is what the page's fetch goes through: the bytes the page
 * receives for a range, near the start, deep into a long file and at its end,
 * are exactly the file's bytes there. The WebView's own handling of a Range
 * header on an intercepted response is what no reading of our code can check.
 */
@RunWith(AndroidJUnit4.class)
public class MusicFileServerRangeTest {
    /** A long mix's size: about 100 minutes at 256 kbps. */
    private static final long LENGTH = 192L * 1024 * 1024;

    /** The file's byte at `index`: different at nearby and distant positions alike, so a shifted range cannot match. */
    private static int byteAt(long index) {
        return (int) (((index * 2654435761L) >>> 13) ^ (index >>> 20)) & 0xff;
    }

    /** Asked ranges, inclusive; the last reaches past the end, as a reader asking for a whole block does. */
    private static final long[][] RANGES = {
        { 0, 9 },
        { 4096, 4096 + 2 * 1024 * 1024 - 1 },
        { 150_000_000L, 150_000_000L + 8 * 1024 * 1024 - 1 },
        { LENGTH - 1000, LENGTH + 4095 },
    };

    @SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
    @Test
    public void everyRangeArrivesExactly() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file = new File(context.getCacheDir(), "long-mix.bin");
        write(file);
        Uri uri = Uri.fromFile(file);
        CountDownLatch done = new CountDownLatch(1);
        String[] report = new String[1];
        StringBuilder script = new StringBuilder("<script>(async () => { const out = []; for (const [a, b] of ")
            .append(new JSONArray(RANGES).toString().replace("\"", ""))
            .append(") { try { const r = await fetch('/_music', { headers: { Range: `bytes=${a}-${b}` } });")
            .append(" const bytes = new Uint8Array(await r.arrayBuffer());")
            .append(" out.push({ status: r.status, length: bytes.length, head: Array.from(bytes.subarray(0, 16)), tail: Array.from(bytes.subarray(Math.max(0, bytes.length - 16))) });")
            .append(" } catch (e) { out.push({ error: String(e) }) } } probe.report(JSON.stringify(out)) })()</script>");
        String page = script.toString();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView web = new WebView(context);
            web.getSettings().setJavaScriptEnabled(true);
            web.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void report(String json) {
                    report[0] = json;
                    done.countDown();
                }
            }, "probe");
            web.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    if (MusicFileServer.PATH.equals(request.getUrl().getPath())) {
                        try {
                            return MusicFileServer.respond(context.getContentResolver(), uri, request.getRequestHeaders().get("Range"));
                        } catch (Exception failure) {
                            throw new RuntimeException(failure);
                        }
                    }
                    return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(page.getBytes(StandardCharsets.UTF_8)));
                }
            });
            web.loadUrl("https://probe.test/");
        });
        assertTrue("the page reported", done.await(120, TimeUnit.SECONDS));
        JSONArray results = new JSONArray(report[0]);
        for (int index = 0; index < RANGES.length; index += 1) {
            long first = RANGES[index][0];
            long last = Math.min(RANGES[index][1], LENGTH - 1);
            JSONObject result = results.getJSONObject(index);
            String what = "range " + first + "-" + RANGES[index][1] + ": " + result;
            assertEquals(what, 206, result.optInt("status"));
            assertEquals(what, last - first + 1, result.getLong("length"));
            JSONArray head = result.getJSONArray("head");
            for (int at = 0; at < head.length(); at += 1) assertEquals(what, byteAt(first + at), head.getInt(at));
            JSONArray tail = result.getJSONArray("tail");
            for (int at = 0; at < tail.length(); at += 1) assertEquals(what, byteAt(last - tail.length() + 1 + at), tail.getInt(at));
        }
        file.delete();
    }

    private static void write(File file) throws Exception {
        byte[] block = new byte[1 << 20];
        try (FileOutputStream out = new FileOutputStream(file)) {
            for (long at = 0; at < LENGTH; at += block.length) {
                for (int index = 0; index < block.length; index += 1) block[index] = (byte) byteAt(at + index);
                out.write(block);
            }
        }
    }
}
