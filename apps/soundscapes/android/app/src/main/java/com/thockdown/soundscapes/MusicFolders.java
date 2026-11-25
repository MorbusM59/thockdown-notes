package com.thockdown.soundscapes;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
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
 * artist, album and duration from the file's tags, read by the platform
 * (MediaMetadataRetriever). Reading tags costs a few tens of milliseconds a
 * file, so files the catalog already holds are passed over, and the page
 * asks for the rest in batches, showing its progress between them.
 */
final class MusicFolders {
    private MusicFolders() {}

    /**
     * How many folders are listed, or songs described, at once. Both are
     * round trips to the documents provider (and, for a song, the platform's
     * media extractor probing the file) that spend most of their time
     * waiting rather than computing, so a few at a time on separate threads
     * divide the wall time by about this much: one at a time, 3,500 songs
     * took minutes on a device.
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

    /** `describe` for each of `uris`, PARALLEL at a time, in their order. */
    static JSONArray describeAll(Context context, List<Uri> uris) throws Exception {
        JSONArray added = new JSONArray();
        for (JSONObject song : eachInParallel(uris, (uri) -> describe(context, uri))) added.put(song);
        return added;
    }

    /** A song as the catalog writes it, `{ filePath, title, artist, album, durationSec }`, from its tags. */
    static JSONObject describe(Context context, Uri uri) throws Exception {
        JSONObject song = new JSONObject().put("filePath", uri.toString());
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(context, uri);
            song.put("title", text(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)));
            song.put("artist", text(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)));
            song.put("album", text(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)));
            String duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            song.put("durationSec", duration == null ? 0 : Long.parseLong(duration) / 1000.0);
        } catch (RuntimeException unreadable) {
            // Tags that cannot be read are empty, as the desktop has them for a file with none.
            song.put("title", "").put("artist", "").put("album", "").put("durationSec", 0);
        } finally {
            retriever.release();
        }
        return song;
    }

    private static String text(String value) {
        return value == null ? "" : value.trim();
    }
}
