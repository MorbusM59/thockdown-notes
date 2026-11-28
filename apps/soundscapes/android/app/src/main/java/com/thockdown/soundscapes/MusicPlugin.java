package com.thockdown.soundscapes;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * The Android side of the page's music (apps/soundscapes/src/nativeMusic.ts):
 * picking and scanning music folders (MusicFolders), the library's stored
 * documents and the playback, all in MusicSession, which outlives this
 * plugin (it goes with the activity). It forwards the page's calls and
 * passes the session's reports back as events while it exists:
 * `heard` ({ songId, seconds, frame, sampleRate, playing }), `spectrum`
 * ({ batches }, JSON text) and `failure` ({ message }); and plays the beat
 * delay calibration's loop (CalibrationLoop), reporting `loopHeard`.
 */
@CapacitorPlugin(name = "Music")
public class MusicPlugin extends Plugin {
    private MusicSession session;

    private final MusicSession.Listener listener = new MusicSession.Listener() {
        @Override
        public void onHeard(Integer songId, double seconds, long frame, int sampleRate, boolean playing, long heardNanos) {
            JSObject data = new JSObject();
            data.put("heardNanos", heardNanos);
            data.put("sentNanos", System.nanoTime());
            data.put("songId", songId);
            data.put("seconds", seconds);
            data.put("frame", frame);
            data.put("sampleRate", sampleRate);
            data.put("playing", playing);
            notifyListeners("heard", data);
        }

        @Override
        public void onSpectrum(String batchesJson) {
            JSObject data = new JSObject();
            data.put("batches", batchesJson);
            notifyListeners("spectrum", data);
        }

        @Override
        public void onFailure(String message) {
            JSObject data = new JSObject();
            data.put("message", message);
            notifyListeners("failure", data);
        }

        @Override
        public void onStage(String id) {
            JSObject data = new JSObject();
            data.put("id", id);
            // Retained: the page is paused while the car steps, and reads it on its return.
            notifyListeners("stage", data, true);
        }

        @Override
        public void onCatalog(String catalogJson) {
            JSObject data = new JSObject();
            data.put("catalog", catalogJson);
            // Retained, as a stage: the car changes the sets with the page paused.
            notifyListeners("catalog", data, true);
        }
    };

    /** The delay calibration's loop while it plays (CalibrationLoop), or null. */
    private CalibrationLoop loop = null;

    @Override
    public void load() {
        session = MusicSession.get(getContext());
        session.setListener(listener);
    }

    @Override
    protected void handleOnDestroy() {
        session.setListener(null);
        stopLoopNow();
    }

    /** The system's folder picker; resolves `{ uri }`, or `{}` when the reader backs out. */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        Uri tree = result.getResultCode() == Activity.RESULT_OK && data != null ? data.getData() : null;
        JSObject out = new JSObject();
        if (tree != null) {
            // Kept across restarts: the songs are played from it later.
            getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            out.put("uri", tree.toString());
        }
        call.resolve(out);
    }

    /** Give a folder up: its grant is released. */
    @PluginMethod
    public void releaseFolder(PluginCall call) {
        try {
            getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(call.getString("uri", "")), Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (RuntimeException notHeld) {
            // Nothing held for it: already released.
        }
        call.resolve();
    }

    /** MusicFolders.listFolders, off the plugin's thread: `{ uri, folders: [ids] }` to `{ folders, paths }`. */
    @PluginMethod
    public void listFolders(PluginCall call) {
        Uri tree = Uri.parse(call.getString("uri", ""));
        List<String> folders = new ArrayList<>();
        JSArray list = call.getArray("folders", new JSArray());
        for (int index = 0; index < list.length(); index += 1) folders.add(list.optString(index));
        new Thread(() -> {
            try {
                call.resolve(JSObject.fromJSONObject(MusicFolders.listFolders(getContext(), tree, folders)));
            } catch (Exception error) {
                call.reject("Could not read the folder: " + error);
            }
        }, "MusicFolderList").start();
    }

    /**
     * MusicFolders.readSongs, off the plugin's thread: `{ reads: [{ path,
     * offset, length }], close: [paths] }` to `{ results: [{ size, data }] }`,
     * the songs in `close` closed after the reads.
     */
    @PluginMethod
    public void readSongRanges(PluginCall call) {
        JSArray list = call.getArray("reads", new JSArray());
        List<MusicFolders.SongRead> reads = new ArrayList<>();
        for (int index = 0; index < list.length(); index += 1) {
            JSONObject read = list.optJSONObject(index);
            if (read == null) continue;
            reads.add(new MusicFolders.SongRead(read.optString("path"), read.optLong("offset"), read.optInt("length")));
        }
        JSArray closeList = call.getArray("close", new JSArray());
        List<String> close = new ArrayList<>();
        for (int index = 0; index < closeList.length(); index += 1) close.add(closeList.optString(index));
        new Thread(() -> {
            try {
                JSONObject results = new JSONObject().put("results", MusicFolders.readSongs(getContext(), reads));
                MusicFolders.closeSongs(close);
                call.resolve(JSObject.fromJSONObject(results));
            } catch (Exception error) {
                call.reject("Could not read the songs: " + error);
            }
        }, "MusicSongRead").start();
    }

    /** `{ paths }`: the songs the page has finished reading, closed; no `paths` closes every song held. */
    @PluginMethod
    public void closeSongs(PluginCall call) {
        JSArray list = call.getArray("paths");
        List<String> paths = null;
        if (list != null) {
            paths = new ArrayList<>();
            for (int index = 0; index < list.length(); index += 1) paths.add(list.optString(index));
        }
        MusicFolders.closeSongs(paths);
        call.resolve();
    }

    /** The library's two documents as stored: `{ catalog, rotation }`, each JSON text. */
    @PluginMethod
    public void getLibrary(PluginCall call) {
        JSObject out = new JSObject();
        out.put("catalog", session.catalog());
        out.put("rotation", session.rotation());
        call.resolve(out);
    }

    /** `{ catalog }`: the page's whole catalog, as JSON text. */
    @PluginMethod
    public void setCatalog(PluginCall call) {
        session.setCatalog(call.getString("catalog", ""));
        call.resolve();
    }

    /** `{ stage }`: play (or carry on) with this soundstage, a MusicStage as JSON text. */
    @PluginMethod
    public void play(PluginCall call) {
        session.play(call.getString("stage", ""));
        call.resolve();
    }

    /** `{ stage }`: the soundstage, heard at once if music plays. */
    @PluginMethod
    public void setStageCycle(PluginCall call) {
        try {
            JSArray ids = call.getArray("ids", new JSArray());
            JSArray stages = call.getArray("stages", new JSArray());
            String[] idList = new String[Math.min(ids.length(), stages.length())];
            String[] stageList = new String[idList.length];
            for (int index = 0; index < idList.length; index += 1) {
                idList[index] = ids.getString(index);
                stageList[index] = stages.getString(index);
            }
            session.setStageCycle(idList, stageList, call.getString("activeId", ""));
            call.resolve();
        } catch (org.json.JSONException unreadable) {
            call.reject("Unreadable stage cycle");
        }
    }

    @PluginMethod
    public void setStage(PluginCall call) {
        session.setStage(call.getString("stage", ""));
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        session.pause();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        session.stop();
        call.resolve();
    }

    @PluginMethod
    public void skip(PluginCall call) {
        session.skip();
        call.resolve();
    }

    /** `{ direction }`: the previous (-1) or next (1) song of the pool's ring, from the song playing. */
    @PluginMethod
    public void jump(PluginCall call) {
        session.jump(call.getInt("direction", 1) < 0 ? -1 : 1);
        call.resolve();
    }

    /** `{ songId }`: play this song now, chosen from the list. */
    @PluginMethod
    public void choose(PluginCall call) {
        session.choose(call.getInt("songId", -1));
        call.resolve();
    }

    /** `{ seconds }`: go to this time in the song heard. */
    @PluginMethod
    public void seek(PluginCall call) {
        session.seek(call.getDouble("seconds", 0.0));
        call.resolve();
    }

    /** `{ bands }`: the visualizer's spectrum in this many log bands, sent as `spectrum` events; 0 stops it. */
    @PluginMethod
    public void setSpectrum(PluginCall call) {
        session.setSpectrum(call.getInt("bands", 0));
        call.resolve();
    }

    /** `{ on }`: the music channel in or out of the mix; out, the music pauses and nothing starts it (MusicSession.setChannel). */
    @PluginMethod
    public void setChannel(PluginCall call) {
        session.setChannel(Boolean.TRUE.equals(call.getBoolean("on", true)));
        call.resolve();
    }

    /** `{ volume }`: 0..1 as a gain (the page applies the app's volume curve). */
    @PluginMethod
    public void setVolume(PluginCall call) {
        session.setVolume(call.getFloat("volume", 1f));
        call.resolve();
    }

    /** The output's sample rate: the delay calibration's loop is decoded at it. */
    @PluginMethod
    public void getOutputRate(PluginCall call) {
        JSObject out = new JSObject();
        out.put("sampleRate", android.media.AudioTrack.getNativeOutputSampleRate(android.media.AudioManager.STREAM_MUSIC));
        call.resolve(out);
    }

    /**
     * `{ pcm }`: play the delay calibration's loop, base64 of interleaved
     * 16-bit stereo at half scale (OutputLane.HEADROOM), at the output's rate, over and over and heard alone,
     * reporting `loopHeard` ({ frame, sampleRate }) as it plays.
     */
    @PluginMethod
    public void playLoop(PluginCall call) {
        stopLoopNow();
        short[] pcm = SharedSandbox.decodeHalfScale(call.getString("pcm", ""));
        loop = new CalibrationLoop(pcm, (frame, sampleRate, heardNanos) -> {
            JSObject data = new JSObject();
            data.put("heardNanos", heardNanos);
            data.put("sentNanos", System.nanoTime());
            data.put("frame", frame);
            data.put("sampleRate", sampleRate);
            notifyListeners("loopHeard", data);
        });
        call.resolve();
    }

    @PluginMethod
    public void stopLoop(PluginCall call) {
        stopLoopNow();
        call.resolve();
    }

    private void stopLoopNow() {
        if (loop != null) loop.close();
        loop = null;
    }

    @PluginMethod
    public void getDiagnostics(PluginCall call) {
        JSObject out = new JSObject();
        out.put("text", session.diagnostics());
        call.resolve(out);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject out = new JSObject();
        out.put("playing", session.isPlaying());
        call.resolve(out);
    }
}
