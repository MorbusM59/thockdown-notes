package com.thockdown.soundscapes;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;

/**
 * One song decoded to 16-bit interleaved STEREO PCM at the file's own rate,
 * a slice at a time, by the platform's decoders (MediaExtractor and
 * MediaCodec): every format the device can play, with no codec shipped in
 * the app. The music renderer resamples it to the output's rate
 * (packages/audio/resampler.ts).
 *
 * Mono is played on both sides; of more than two channels the first two are
 * taken (front left and right in every standard layout).
 *
 * A SEEK goes to the sync point at or before the time asked for, steps over
 * the packets up to a preroll before it without decoding them, and the
 * decoder then drops what precedes the time itself, so a seek lands where it
 * was asked whatever the format's sync spacing or seek index.
 */
final class SongDecoder implements AutoCloseable {
    private static final long TIMEOUT_US = 10_000;
    /**
     * Decoded, and dropped, before a seek's time: enough for every codec's
     * state to settle (an MP3's bit reservoir, AAC's and Vorbis's overlapped
     * blocks, Opus's 80 ms preroll).
     */
    private static final long SEEK_PREROLL_US = 500_000;

    private final MediaExtractor extractor = new MediaExtractor();
    private final MediaCodec codec;
    private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
    private int sampleRate;
    private int channels;
    private boolean inputDone = false;
    private boolean outputDone = false;
    /** Output before this time (microseconds) is dropped: where a seek asked to land. */
    private long dropBeforeUs = 0;

    SongDecoder(Context context, Uri uri, long startUs) throws Exception {
        // Whatever is opened before a failure is released with it: a song that
        // cannot be decoded is passed over (MusicRenderer.startSong), and a
        // codec left open by each one would use up the device's decoders, so
        // every song after would fail too.
        MediaCodec opened = null;
        try {
            extractor.setDataSource(context, uri, null);
            int track = -1;
            MediaFormat format = null;
            for (int index = 0; index < extractor.getTrackCount(); index += 1) {
                MediaFormat candidate = extractor.getTrackFormat(index);
                String mime = candidate.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = index;
                    format = candidate;
                    break;
                }
            }
            if (format == null) throw new IllegalArgumentException("No audio in " + uri);
            extractor.selectTrack(track);
            sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            opened = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            opened.configure(format, null, null, 0);
            opened.start();
            if (startUs > 0) {
                extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                // A file with no seek index (a VBR MP3 without a Xing table,
                // a WebM without cues) can land far before the time, even at
                // its start. The packets up to a preroll before the time are
                // stepped over unread rather than decoded and dropped, which
                // on a long mix took minutes of silence.
                long prerollFrom = startUs - SEEK_PREROLL_US;
                while (extractor.getSampleTime() >= 0 && extractor.getSampleTime() < prerollFrom) {
                    if (!extractor.advance()) break;
                }
                dropBeforeUs = startUs;
            }
        } catch (Exception error) {
            if (opened != null) opened.release();
            extractor.release();
            throw error;
        }
        codec = opened;
    }

    /** The file's sample rate; the decoder's output format may correct it once decoding starts. */
    int sampleRate() {
        return sampleRate;
    }

    boolean finished() {
        return outputDone;
    }

    /**
     * The next decoded audio, interleaved stereo, or an empty array when
     * the decoder had nothing ready yet (call again) or the song is over
     * (`finished`).
     */
    short[] next() {
        feedInput();
        while (!outputDone) {
            int index = codec.dequeueOutputBuffer(info, TIMEOUT_US);
            if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                MediaFormat format = codec.getOutputFormat();
                sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                continue;
            }
            if (index < 0) return new short[0];
            if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
            ByteBuffer buffer = codec.getOutputBuffer(index);
            short[] stereo = new short[0];
            if (buffer != null && info.size > 0) {
                buffer.position(info.offset);
                buffer.limit(info.offset + info.size);
                ShortBuffer samples = buffer.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer();
                int frames = samples.remaining() / Math.max(1, channels);
                int skip = 0;
                if (info.presentationTimeUs < dropBeforeUs) {
                    skip = (int) Math.min(frames, ((dropBeforeUs - info.presentationTimeUs) * sampleRate) / 1_000_000L);
                }
                stereo = new short[(frames - skip) * 2];
                for (int frame = skip; frame < frames; frame += 1) {
                    short left = samples.get(frame * channels);
                    short right = channels > 1 ? samples.get((frame * channels) + 1) : left;
                    stereo[(frame - skip) * 2] = left;
                    stereo[((frame - skip) * 2) + 1] = right;
                }
            }
            codec.releaseOutputBuffer(index, false);
            if (stereo.length > 0 || outputDone) return stereo;
        }
        return new short[0];
    }

    private void feedInput() {
        while (!inputDone) {
            int index = codec.dequeueInputBuffer(0);
            if (index < 0) return;
            ByteBuffer buffer = codec.getInputBuffer(index);
            int size = buffer == null ? -1 : extractor.readSampleData(buffer, 0);
            if (size < 0) {
                codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                inputDone = true;
                return;
            }
            codec.queueInputBuffer(index, 0, size, extractor.getSampleTime(), 0);
            extractor.advance();
        }
    }

    @Override
    public void close() {
        try {
            codec.stop();
        } catch (RuntimeException ignored) {
            // Already stopped by an error; it is released below either way.
        }
        codec.release();
        extractor.release();
    }
}
