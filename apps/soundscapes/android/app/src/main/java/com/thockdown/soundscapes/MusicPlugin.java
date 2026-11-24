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
import java.util.HashSet;
import java.util.Set;

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
        public void onHeard(Integer songId, double seconds, long frame, int sampleRate, boolean playing) {
            JSObject data = new JSObject();
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

    /** MusicFolders.scan on a worker thread: `{ uri, known: [paths] }` to `{ added, paths }`. */
    @PluginMethod
    public void scanFolder(PluginCall call) {
        Uri tree = Uri.parse(call.getString("uri", ""));
        Set<String> known = new HashSet<>();
        JSArray list = call.getArray("known", new JSArray());
        for (int index = 0; index < list.length(); index += 1) known.add(list.optString(index));
        new Thread(() -> {
            try {
                call.resolve(JSObject.fromJSONObject(MusicFolders.scan(getContext(), tree, known)));
            } catch (Exception error) {
                call.reject("Could not read the folder: " + error);
            }
        }, "MusicFolderScan").start();
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
        loop = new CalibrationLoop(pcm, (frame, sampleRate) -> {
            JSObject data = new JSObject();
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
