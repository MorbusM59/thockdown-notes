package com.thockdown.soundscapes;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.util.Collections;
import java.util.List;
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
        ContentResolver resolver = context.getContentResolver();
        JSONArray folders = new JSONArray();
        JSONArray paths = new JSONArray();
        List<String> parents = folderIds.isEmpty()
            ? Collections.singletonList(DocumentsContract.getTreeDocumentId(treeUri))
            : folderIds;
        String[] columns = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_MIME_TYPE };
        for (String parent : parents) {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parent);
            try (Cursor cursor = resolver.query(children, columns, null, null, null)) {
                if (cursor == null) continue;
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
