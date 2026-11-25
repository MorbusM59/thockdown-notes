package com.thockdown.soundscapes;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.system.Os;
import android.util.Base64;
import android.provider.DocumentsContract;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The reader's MUSIC FOLDERS, chosen through the system's folder picker
 * (the Storage Access Framework): the app is granted that folder tree and
 * nothing else, so it needs no media or storage permission. The grant is
 * made persistent when the folder is picked (BackgroundAudioPlugin), so the
 * songs stay playable after a restart.
 *
 * A SCAN walks a tree, a few folders a call (`listFolders`), and lists its
 * audio files as the catalog's songs are written (apps/soundscapes/src/musicLibrary.ts, the desktop's
 * MusicSongEntry fields): the document's URI as the path, and the title,
 * artist, album and duration from the file's tags. The tags are read by the
 * PAGE, with the desktop's own readers, from byte ranges served here
 * (`readSongs`): a handful of small reads a song, where the platform's media
 * extractor probed every file whole and took minutes for a large library.
 */
final class MusicFolders {
    private MusicFolders() {}

    /**
     * How many folders are listed, or song ranges read, at once. Both are
     * round trips to the documents provider (listing a folder, opening a
     * song) that spend most of their time waiting rather than computing, so
     * a few at a time on separate threads divide the wall time by about this
     * much.
     */
    private static final int PARALLEL = 4;
    private static final ExecutorService WORKERS = Executors.newFixedThreadPool(PARALLEL, (task) -> {
        Thread thread = new Thread(task, "MusicFolderWork");
        thread.setDaemon(true);
        return thread;
    });

    /** `work` for each of `items`, PARALLEL at a time, the results in the items' order. */
    private static <T, R> List<R> eachInParallel(List<T> items, ItemWork<T, R> work) throws Exception {
        List<Future<R>> futures = new ArrayList<>(items.size());
        for (T item : items) futures.add(WORKERS.submit(() -> work.apply(item)));
        List<R> results = new ArrayList<>(items.size());
        for (Future<R> future : futures) {
            try {
                results.add(future.get());
            } catch (ExecutionException failed) {
                Throwable cause = failed.getCause();
                throw cause instanceof Exception ? (Exception) cause : failed;
            }
        }
        return results;
    }

    private interface ItemWork<T, R> {
        R apply(T item) throws Exception;
    }

    /**
     * One step of walking a tree: the children of the folders `folderIds`
     * (document ids within `treeUri`; none means the tree's own root), as the
     * subfolders found, `folders`, for a later step, and the audio files
     * found, `paths`. The PAGE walks the tree a few folders a call, so it can
     * show the count growing while a large tree is listed: every child query
     * is a round trip to the folder's documents provider, and a whole library
     * listed in one call held the Songs dock's indexing bar at nothing for as
     * long as that took.
     */
    static JSONObject listFolders(Context context, Uri treeUri, List<String> folderIds) throws Exception {
        List<String> parents = folderIds.isEmpty()
            ? Collections.singletonList(DocumentsContract.getTreeDocumentId(treeUri))
            : folderIds;
        JSONArray folders = new JSONArray();
        JSONArray paths = new JSONArray();
        for (JSONObject children : eachInParallel(parents, (parent) -> childrenOf(context, treeUri, parent))) {
            JSONArray found = children.getJSONArray("folders");
            for (int index = 0; index < found.length(); index += 1) folders.put(found.getString(index));
            JSONArray files = children.getJSONArray("paths");
            for (int index = 0; index < files.length(); index += 1) paths.put(files.getString(index));
        }
        return new JSONObject().put("folders", folders).put("paths", paths);
    }

    /** One folder's subfolders and audio files, `{ folders, paths }`: one query to the documents provider. */
    private static JSONObject childrenOf(Context context, Uri treeUri, String parent) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        JSONArray folders = new JSONArray();
        JSONArray paths = new JSONArray();
        String[] columns = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_MIME_TYPE };
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parent);
        try (Cursor cursor = resolver.query(children, columns, null, null, null)) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String id = cursor.getString(0);
                    String mime = cursor.getString(1);
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        folders.put(id);
                        continue;
                    }
                    if (mime == null || !mime.startsWith("audio/")) continue;
                    paths.put(DocumentsContract.buildDocumentUriUsingTree(treeUri, id).toString());
                }
            }
        }
        return new JSONObject().put("folders", folders).put("paths", paths);
    }

    /**
     * SONG READS, for the page's tag and duration readers
     * (packages/visualizer/shared/audioTags.ts, audioDuration.ts, the same
     * code the desktop reads its files with): the page asks for byte ranges
     * of many songs in one call (apps/soundscapes/src/songFacts.ts), and each
     * is one positional read of the song's file, opened once through the
     * documents provider and held until the page closes it.
     */
    private static final Map<String, ParcelFileDescriptor> OPEN_SONGS = new ConcurrentHashMap<>();

    /** One range asked for: `{ path, offset, length }`. */
    static final class SongRead {
        final String path;
        final long offset;
        final int length;

        SongRead(String path, long offset, int length) {
            this.path = path;
            this.offset = offset;
            this.length = length;
        }
    }

    /** The largest range one read answers; the readers ask for far less. */
    private static final int MAX_READ_BYTES = 1 << 20;

    /**
     * Each of `reads`, PARALLEL at a time, in their order: `{ size, data }`
     * (the file's length and the bytes, base64, fewer at the end of the
     * file), or `{ size: -1 }` for a file that cannot be opened or read.
     */
    static JSONArray readSongs(Context context, List<SongRead> reads) throws Exception {
        JSONArray results = new JSONArray();
        for (JSONObject result : eachInParallel(reads, (read) -> readSong(context, read))) results.put(result);
        return results;
    }

    private static JSONObject readSong(Context context, SongRead read) throws Exception {
        try {
            ParcelFileDescriptor file = openSong(context, read.path);
            long size = file.getStatSize();
            int wanted = (int) Math.max(0, Math.min(Math.min(read.length, MAX_READ_BYTES), size - read.offset));
            byte[] bytes = new byte[wanted];
            int got = 0;
            while (got < wanted) {
                int step = Os.pread(file.getFileDescriptor(), bytes, got, wanted - got, read.offset + got);
                if (step <= 0) break;
                got += step;
            }
            return new JSONObject().put("size", size).put("data", Base64.encodeToString(bytes, 0, got, Base64.NO_WRAP));
        } catch (Exception unreadable) {
            return new JSONObject().put("size", -1);
        }
    }

    /** The song at `path`, opened on its first read. Two reads racing to open it open it once. */
    private static ParcelFileDescriptor openSong(Context context, String path) throws Exception {
        ParcelFileDescriptor held = OPEN_SONGS.get(path);
        if (held != null) return held;
        synchronized (OPEN_SONGS) {
            held = OPEN_SONGS.get(path);
            if (held != null) return held;
            ParcelFileDescriptor opened = context.getContentResolver().openFileDescriptor(Uri.parse(path), "r");
            if (opened == null) throw new IllegalStateException("No file for " + path);
            OPEN_SONGS.put(path, opened);
            return opened;
        }
    }

    /** Close the songs at `paths`, or every song held when `paths` is null. */
    static void closeSongs(List<String> paths) {
        List<String> closing = paths == null ? new ArrayList<>(OPEN_SONGS.keySet()) : paths;
        for (String path : closing) {
            ParcelFileDescriptor file = OPEN_SONGS.remove(path);
            if (file == null) continue;
            try {
                file.close();
            } catch (Exception ignored) {
                // Closing a descriptor the provider already dropped: nothing is held either way.
            }
        }
    }
}
