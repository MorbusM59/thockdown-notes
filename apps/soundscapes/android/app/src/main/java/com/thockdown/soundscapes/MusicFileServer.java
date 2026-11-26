package com.thockdown.soundscapes;

import android.content.ContentResolver;
import android.content.Context;
import android.content.UriPermission;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves the reader's music files to the page, so the visualizer's beat
 * analysis (packages/visualizer/sound/musicDecodeStream.ts) reads and decodes
 * a song exactly as it does on the desktop: by range requests on a URL. The
 * URL is the page's own origin, `PATH` and the song's content URI
 * (`nativeMusicListening.ts`'s `songUrl`), answered here rather than by
 * Capacitor's local server.
 *
 * Only a document under a folder the reader picked (a persisted read grant,
 * MusicFolders) is served; anything else is a 404.
 */
final class MusicFileServer extends BridgeWebViewClient {
    /** Must match nativeMusicListening.ts's SONG_PATH. */
    static final String PATH = "/_music";

    private final Context context;

    MusicFileServer(Bridge bridge) {
        super(bridge);
        context = bridge.getContext().getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!PATH.equals(url.getPath())) return super.shouldInterceptRequest(view, request);
        String song = url.getQueryParameter("uri");
        if (song == null || !granted(Uri.parse(song))) return status(404, "Not Found");
        try {
            return serve(Uri.parse(song), request.getRequestHeaders().get("Range"));
        } catch (Exception unreadable) {
            return status(404, "Not Found");
        }
    }

    /** Whether `document` lies under a tree the reader granted. */
    private boolean granted(Uri document) {
        String path = document.toString();
        for (UriPermission permission : context.getContentResolver().getPersistedUriPermissions()) {
            if (permission.isReadPermission() && path.startsWith(permission.getUri().toString() + "/")) return true;
        }
        return false;
    }

    private WebResourceResponse serve(Uri document, String range) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        long length;
        try (AssetFileDescriptor file = resolver.openAssetFileDescriptor(document, "r")) {
            if (file == null) return status(404, "Not Found");
            length = file.getLength();
        }
        if (length < 0) return status(404, "Not Found");
        long first = 0;
        long last = length - 1;
        boolean partial = range != null && range.startsWith("bytes=");
        if (partial) {
            String[] bounds = range.substring("bytes=".length()).split(",")[0].split("-", 2);
            String start = bounds[0].trim();
            String end = bounds.length > 1 ? bounds[1].trim() : "";
            if (start.isEmpty()) {
                // A suffix: the last `end` bytes.
                first = Math.max(0, length - Long.parseLong(end));
            } else {
                first = Long.parseLong(start);
                if (!end.isEmpty()) last = Math.min(last, Long.parseLong(end));
            }
            if (first > last) {
                Map<String, String> headers = new HashMap<>();
                headers.put("Content-Range", "bytes */" + length);
                return new WebResourceResponse(null, null, 416, "Range Not Satisfiable", headers, null);
            }
        }
        InputStream in = open(resolver, document, first);
        if (in == null) return status(404, "Not Found");
        long skipped = position(in);
        for (; skipped < first; ) {
            long step = in.skip(first - skipped);
            if (step <= 0) {
                if (in.read() < 0) break;
                step = 1;
            }
            skipped += step;
        }
        long count = last - first + 1;
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", Long.toString(count));
        if (partial) headers.put("Content-Range", "bytes " + first + "-" + last + "/" + length);
        String type = resolver.getType(document);
        return new WebResourceResponse(
            type == null ? "application/octet-stream" : type,
            null,
            partial ? 206 : 200,
            partial ? "Partial Content" : "OK",
            headers,
            new Limited(in, count)
        );
    }

    /**
     * The file's stream, POSITIONED at `first` when the provider hands out a
     * seekable descriptor (a local file does), so a range deep into a long
     * track costs nothing to reach. Read past instead, the stream had to walk
     * every byte before it, every request: tens of megabytes deep into a long
     * mix, slow enough for the WebView to give up on the response ("Failed to
     * fetch"). A provider whose descriptor is a pipe gets a plain stream,
     * walked by the caller (`position` says how far it already is).
     */
    private static InputStream open(ContentResolver resolver, Uri document, long first) throws IOException {
        AssetFileDescriptor file = resolver.openAssetFileDescriptor(document, "r");
        if (file == null) return null;
        FileInputStream stream = file.createInputStream();
        try {
            FileChannel channel = stream.getChannel();
            channel.position(file.getStartOffset() + first);
            return new Positioned(stream, first);
        } catch (IOException notSeekable) {
            stream.close();
            return resolver.openInputStream(document);
        }
    }

    /** How far into the file `in` already stands. */
    private static long position(InputStream in) {
        return in instanceof Positioned ? ((Positioned) in).at : 0;
    }

    /** A stream already standing at byte `at` of its file. */
    private static final class Positioned extends FilterInputStream {
        final long at;

        Positioned(InputStream in, long at) {
            super(in);
            this.at = at;
        }
    }

    private static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", null, code, reason, new HashMap<>(), null);
    }

    /** At most `remaining` bytes of `in`, then its end. */
    private static final class Limited extends FilterInputStream {
        private long remaining;

        Limited(InputStream in, long remaining) {
            super(in);
            this.remaining = remaining;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int value = super.read();
            if (value >= 0) remaining -= 1;
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (remaining <= 0) return -1;
            int read = super.read(buffer, offset, (int) Math.min(length, remaining));
            if (read > 0) remaining -= read;
            return read;
        }
    }
}
