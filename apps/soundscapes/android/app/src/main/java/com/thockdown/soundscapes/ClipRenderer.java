package com.thockdown.soundscapes;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import androidx.javascriptengine.JavaScriptIsolate;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Renders a clip of a soundscape to an AAC file (.m4a), offline: the same
 * renderer the live playback runs (assets/soundscape-renderer.js), in its own
 * isolate of the shared sandbox, stepped as fast as it renders rather than
 * as fast as anything plays. What it renders is the configuration it is
 * given, at the soundscape's own level: the listener's volume is how loud
 * they hear it, not part of the soundscape.
 *
 * The renderer returns samples at half scale (SoundscapeAudioOutput's
 * HEADROOM); they are scaled back and clipped at full scale, as the live
 * output does at full volume. The clip fades in over FADE_IN_SEC and out
 * over FADE_OUT_SEC, so it neither starts nor stops on a click.
 *
 * AAC in an MPEG-4 container, because that is what every Android version
 * the app supports can encode (Opus files need Android 10) and every player
 * can play.
 */
final class ClipRenderer {
    interface Listener {
        void onProgress(double fraction);
        void onFinished(File file);
        void onFailure(String message);
    }

    private static final int SAMPLE_RATE = 48000;
    private static final int CHANNELS = 2;
    private static final int BIT_RATE = 192000;
    private static final int MAX_CHUNKS_PER_STEP = 12;
    private static final double FADE_IN_SEC = 0.05;
    private static final double FADE_OUT_SEC = 2;
    private static final long TIMEOUT_US = 10000;

    private final Thread thread;
    private volatile boolean cancelled = false;

    ClipRenderer(Context context, String configuration, double seconds, File destination, Listener listener) {
        thread = new Thread(() -> run(context, configuration, seconds, destination, listener), "ClipRenderer");
        thread.start();
    }

    /** Stop rendering; the listener hears nothing more and the partial file is deleted. */
    void cancel() {
        cancelled = true;
    }

    private void run(Context context, String configuration, double seconds, File destination, Listener listener) {
        JavaScriptIsolate isolate = null;
        MediaCodec encoder = null;
        MediaMuxer muxer = null;
        boolean muxerStarted = false;
        try {
            isolate = SharedSandbox.openRendererIsolate(context);
            JSONObject init = new JSONObject();
            init.put("sampleRate", SAMPLE_RATE);
            init.put("seed", (int) (System.nanoTime() & 0x7fffffff));
            // Nothing is playing it, so nothing is committed past a splice.
            init.put("spliceMarginSec", 0);
            isolate.evaluateJavaScriptAsync("soundscapeInit(" + JSONObject.quote(init.toString()) + ")").get();
            isolate.evaluateJavaScriptAsync("soundscapeConfigure(" + JSONObject.quote(configuration) + ")").get();

            MediaFormat format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, CHANNELS);
            format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            format.setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE);
            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();
            muxer = new MediaMuxer(destination.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int track = -1;

            long total = Math.round(seconds * SAMPLE_RATE);
            long fadeIn = Math.round(FADE_IN_SEC * SAMPLE_RATE);
            long fadeOut = Math.round(FADE_OUT_SEC * SAMPLE_RATE);
            long rendered = 0;
            long queuedFrames = 0;
            boolean inputDone = false;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            ByteBuffer pending = null;
            double reported = -1;

            while (true) {
                if (cancelled) throw new InterruptedException();
                // Render more when nothing is waiting to be encoded.
                if (!inputDone && (pending == null || !pending.hasRemaining())) {
                    if (rendered >= total) {
                        int index = encoder.dequeueInputBuffer(TIMEOUT_US);
                        if (index >= 0) {
                            encoder.queueInputBuffer(index, 0, 0, timeUs(queuedFrames), MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        }
                    } else {
                        // Reporting everything rendered as played keeps the
                        // renderer's lead ahead of what it has returned.
                        String result = isolate.evaluateJavaScriptAsync(
                            "soundscapeStep(" + rendered + ", " + MAX_CHUNKS_PER_STEP + ")").get();
                        JSONArray chunks = new JSONArray(result);
                        int frames = 0;
                        short[][] decoded = new short[chunks.length()][];
                        for (int index = 0; index < chunks.length(); index += 1) {
                            decoded[index] = SharedSandbox.decodeHalfScale(chunks.getJSONObject(index).getString("d"));
                            frames += decoded[index].length / CHANNELS;
                        }
                        int take = (int) Math.min(frames, total - rendered);
                        ByteBuffer pcm = ByteBuffer.allocate(take * CHANNELS * 2).order(ByteOrder.LITTLE_ENDIAN);
                        int written = 0;
                        for (short[] samples : decoded) {
                            for (int frame = 0; frame < samples.length / CHANNELS && written < take; frame += 1, written += 1) {
                                long at = rendered + written;
                                double gain = SoundscapeAudioOutput.HEADROOM
                                    * Math.min(1, Math.min((at + 1) / (double) fadeIn, (total - at) / (double) fadeOut));
                                for (int channel = 0; channel < CHANNELS; channel += 1) {
                                    long value = Math.round(samples[(frame * CHANNELS) + channel] * gain);
                                    pcm.putShort((short) Math.max(-32768, Math.min(32767, value)));
                                }
                            }
                        }
                        pcm.flip();
                        pending = pcm;
                        rendered += take;
                    }
                }
                // Feed what was rendered to the encoder.
                if (pending != null && pending.hasRemaining()) {
                    int index = encoder.dequeueInputBuffer(TIMEOUT_US);
                    if (index >= 0) {
                        ByteBuffer input = encoder.getInputBuffer(index);
                        input.clear();
                        int size = Math.min(input.remaining(), pending.remaining());
                        int limit = pending.limit();
                        pending.limit(pending.position() + size);
                        input.put(pending);
                        pending.limit(limit);
                        encoder.queueInputBuffer(index, 0, size, timeUs(queuedFrames), 0);
                        queuedFrames += size / (CHANNELS * 2);
                    }
                }
                // Write what the encoder has finished.
                int out = encoder.dequeueOutputBuffer(info, inputDone ? TIMEOUT_US : 0);
                if (out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    track = muxer.addTrack(encoder.getOutputFormat());
                    muxer.start();
                    muxerStarted = true;
                } else if (out >= 0) {
                    ByteBuffer encoded = encoder.getOutputBuffer(out);
                    boolean config = (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0;
                    if (!config && info.size > 0 && muxerStarted) muxer.writeSampleData(track, encoded, info);
                    encoder.releaseOutputBuffer(out, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                }
                double fraction = (double) queuedFrames / total;
                if (fraction - reported >= 0.01) {
                    reported = fraction;
                    listener.onProgress(fraction);
                }
            }
            muxer.stop();
            muxerStarted = false;
            muxer.release();
            muxer = null;
            listener.onFinished(destination);
        } catch (InterruptedException cancelledOrInterrupted) {
            destination.delete();
        } catch (Exception error) {
            destination.delete();
            if (!cancelled) listener.onFailure("Clip could not be rendered: " + error);
        } finally {
            if (encoder != null) {
                try {
                    encoder.stop();
                } catch (RuntimeException ignored) {
                    // Already stopped or never started.
                }
                encoder.release();
            }
            if (muxer != null) {
                try {
                    if (muxerStarted) muxer.stop();
                } catch (RuntimeException ignored) {
                    // The file is being deleted anyway.
                }
                muxer.release();
            }
            if (isolate != null) SharedSandbox.close(isolate);
        }
    }

    private static long timeUs(long frames) {
        return frames * 1000000L / SAMPLE_RATE;
    }
}
