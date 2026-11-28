package com.thockdown.soundscapes;

import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * A seek lands where it was asked, measured on the platform's own decoder:
 * the audio a SongDecoder opened at a time gives is the audio a decoder
 * opened at the start gives at that time. The fixture is a VBR MP3 with no
 * Xing table (two minutes of silence, then a minute of seeded noise, so its
 * bitrate changes by an order of magnitude), the case where the extractor's
 * own seek is an estimate: before SongDecoder stepped MP3s from the start, a
 * seek into the noise came back as different audio (or silence) while the
 * music's clock reported the time asked for.
 */
@RunWith(AndroidJUnit4.class)
public class SongDecoderSeekTest {
    private static final String FIXTURE = "vbr-no-toc.mp3";
    /** Seconds into the noise; the silence before it is what throws an estimate off. */
    private static final double SEEK_SEC = 150;
    /** Frames compared after the seek. */
    private static final int COMPARED = 4096;

    private static Uri fixture() throws Exception {
        Context test = InstrumentationRegistry.getInstrumentation().getContext();
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File file = new File(app.getCacheDir(), FIXTURE);
        try (InputStream in = test.getAssets().open(FIXTURE); FileOutputStream out = new FileOutputStream(file)) {
            byte[] buffer = new byte[65536];
            for (int read; (read = in.read(buffer)) > 0; ) out.write(buffer, 0, read);
        }
        return Uri.fromFile(file);
    }

    /** `count` left-channel samples from frame `from` of `decoder`'s output on. */
    private static short[] read(SongDecoder decoder, long from, int count) {
        short[] taken = new short[count];
        long position = 0;
        int filled = 0;
        while (filled < count && !decoder.finished()) {
            short[] stereo = decoder.next();
            for (int frame = 0; frame < stereo.length / 2 && filled < count; frame += 1, position += 1) {
                if (position >= from) taken[filled++] = stereo[frame * 2];
            }
        }
        assertTrue("decoded " + filled + " of " + count, filled == count);
        return taken;
    }

    @Test
    public void aSeekLandsOnTheTimeItReports() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Uri uri = fixture();
        short[] sequential;
        int rate;
        try (SongDecoder whole = new SongDecoder(app, uri, 0)) {
            rate = whole.sampleRate();
            sequential = read(whole, Math.round(SEEK_SEC * rate), COMPARED);
        }
        short[] seeked;
        // The cost of stepping, measured: an open at SEEK_SEC, reported per packet
        // stepped and extrapolated to a resume 30 minutes into a 128 kbps 44.1 kHz
        // MP3 (38.3 packets a second). Read from the instrumentation log in CI.
        long began = System.nanoTime();
        try (SongDecoder timed = new SongDecoder(app, uri, (long) (SEEK_SEC * 1_000_000))) {
            long openNanos = System.nanoTime() - began;
            double packets = SEEK_SEC * rate / 576.0;
            double perPacketMs = openNanos / 1e6 / packets;
            android.util.Log.i("SongDecoderSeekTest", String.format(java.util.Locale.ROOT,
                    "open at %.0f s: %.1f ms for %.0f packets, %.4f ms a packet; a resume at 30 min would take %.0f ms",
                    SEEK_SEC, openNanos / 1e6, packets, perPacketMs, perPacketMs * 1800 * 38.28));
        }
        try (SongDecoder jumped = new SongDecoder(app, uri, (long) (SEEK_SEC * 1_000_000))) {
            seeked = read(jumped, 0, COMPARED);
        }
        // Noise against noise: the same audio correlates near 1, any other moment (or silence) near 0.
        double cross = 0, a = 0, b = 0;
        for (int index = 0; index < COMPARED; index += 1) {
            cross += (double) sequential[index] * seeked[index];
            a += (double) sequential[index] * sequential[index];
            b += (double) seeked[index] * seeked[index];
        }
        double correlation = cross / Math.sqrt(Math.max(1e-9, a * b));
        assertTrue("energy " + a + " / " + b, a > 0 && b > 0);
        assertTrue("seeked audio correlates " + correlation + " with the audio at " + SEEK_SEC + " s", correlation > 0.9);
    }
}
