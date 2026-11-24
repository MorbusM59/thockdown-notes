package com.thockdown.soundscapes;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The reader's MUSIC FOLDERS, chosen through the system's folder picker
 * (the Storage Access Framework): the app is granted that folder tree and
 * nothing else, so it needs no media or storage permission. The grant is
 * made persistent when the folder is picked (BackgroundAudioPlugin), so the
 * songs stay playable after a restart.
 *
 * A SCAN walks a tree and lists its audio files as the catalog's songs are
 * written (apps/soundscapes/src/musicLibrary.ts, the desktop's
 * MusicSongEntry fields): the document's URI as the path, and the title,
 * artist, album and duration from the file's tags, read by the platform
 * (MediaMetadataRetriever). Reading tags costs a few tens of milliseconds a
 * file, so files the catalog already holds are passed over, and a scan
 * reports its progress as it goes (the phone's indexing bar).
 */
final class MusicFolders {
    private MusicFolders() {}

    /** How far a scan has got: `done` of the `total` new files described. */
    interface Progress {
        void onProgress(int done, int total);
    }

    /** At most this often a scan reports its progress, plus once at each phase's end. */
    private static final long PROGRESS_INTERVAL_MS = 100;

    /**
     * The audio files under `treeUri`, as `{ filePath, title, artist, album,
     * durationSec }`, except those whose path is in `known`; and every path
     * found, `known` or not, as `paths`, so the page can tell what has gone.
     *
     * Two passes, so the progress has a total: the tree is LISTED first
     * (cheap: the total of new files counts up while `done` stays 0), then
     * each new file is DESCRIBED (its tags read, the slow part).
     */
    static JSONObject scan(Context context, Uri treeUri, Set<String> known, Progress progress) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        JSONArray paths = new JSONArray();
        ArrayList<String> fresh = new ArrayList<>();
        ArrayDeque<String> folders = new ArrayDeque<>();
        folders.add(DocumentsContract.getTreeDocumentId(treeUri));
        String[] columns = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_MIME_TYPE };
        long reported = 0;
        while (!folders.isEmpty()) {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, folders.poll());
            try (Cursor cursor = resolver.query(children, columns, null, null, null)) {
                if (cursor == null) continue;
                while (cursor.moveToNext()) {
                    String id = cursor.getString(0);
                    String mime = cursor.getString(1);
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        folders.add(id);
                        continue;
                    }
                    if (mime == null || !mime.startsWith("audio/")) continue;
                    String path = DocumentsContract.buildDocumentUriUsingTree(treeUri, id).toString();
                    paths.put(path);
                    if (!known.contains(path)) fresh.add(path);
                }
            }
            long now = SystemClock.uptimeMillis();
            if (now - reported >= PROGRESS_INTERVAL_MS) {
                reported = now;
                progress.onProgress(0, fresh.size());
            }
        }
        int total = fresh.size();
        progress.onProgress(0, total);
        reported = SystemClock.uptimeMillis();
        JSONArray added = new JSONArray();
        for (int index = 0; index < total; index += 1) {
            added.put(describe(context, Uri.parse(fresh.get(index))));
            long now = SystemClock.uptimeMillis();
            if (now - reported >= PROGRESS_INTERVAL_MS || index + 1 == total) {
                reported = now;
                progress.onProgress(index + 1, total);
            }
        }
        return new JSONObject().put("added", added).put("paths", paths);
    }

    private static JSONObject describe(Context context, Uri uri) throws Exception {
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
