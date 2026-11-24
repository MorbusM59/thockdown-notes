package com.thockdown.soundscapes;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.util.ArrayDeque;
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
 * file, so files the catalog already holds are passed over, and the page
 * asks for the rest in batches, showing its progress between them.
 */
final class MusicFolders {
    private MusicFolders() {}

    /**
     * The audio files under `treeUri`: every path found as `paths`, so the
     * page can tell what has gone, and those not in `known` as `fresh`, for
     * the page to have described (`describe`) in batches. Listing is cheap;
     * reading tags is the slow part, so the page drives that loop itself and
     * knows its progress by construction (the Songs dock's indexing bar).
     */
    static JSONObject list(Context context, Uri treeUri, Set<String> known) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        JSONArray paths = new JSONArray();
        JSONArray fresh = new JSONArray();
        ArrayDeque<String> folders = new ArrayDeque<>();
        folders.add(DocumentsContract.getTreeDocumentId(treeUri));
        String[] columns = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_MIME_TYPE };
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
                    if (!known.contains(path)) fresh.put(path);
                }
            }
        }
        return new JSONObject().put("paths", paths).put("fresh", fresh);
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
