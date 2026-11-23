package com.thockdown.soundscapes;

/**
 * The app's shared output limiter, as the desktop has it at the end of its
 * one audio graph (packages/soundscape/audioOutputBus.ts: a
 * DynamicsCompressorNode at threshold -1 dBFS, knee 0, ratio 20, attack
 * 3 ms, release 80 ms), applied here to the sum of everything the app plays
 * (AudioOutput) before it reaches the device.
 *
 * The static curve and the makeup gain are Chromium's for a knee of 0
 * (packages/audio/dynamicsCompressor.ts has the general form): unity below
 * the threshold, the ratio above it, in dB, and a makeup of
 * (1 / curve(0 dBFS))^0.6. The gain reduction is smoothed in dB at the
 * attack and release time constants, and the signal is delayed LOOKAHEAD_SEC
 * so the gain has reacted by the time a peak passes, as in the soundscape's
 * renderer. Those dynamics are simpler than Chromium's (no adaptive
 * release): on a low tone driven well past the threshold the reduction
 * relaxes between peaks, so a peak can pass up to about half a dB over
 * full scale (measured: a 100 Hz sine at +5.8 dBFS peaks at 1.054), which
 * the output's conversion to 16 bits then clips.
 */
final class OutputLimiter {
    private static final float THRESHOLD_DB = -1f;
    private static final float RATIO = 20f;
    private static final double ATTACK_SEC = 0.003;
    private static final double RELEASE_SEC = 0.08;
    private static final double LOOKAHEAD_SEC = 0.006;

    private final float attackCoefficient;
    private final float releaseCoefficient;
    private final float makeup;
    private final float linearThreshold = (float) Math.pow(10, THRESHOLD_DB / 20);
    private final float[] delayLeft;
    private final float[] delayRight;
    private int delayIndex = 0;
    private float reductionDb = 0f;

    OutputLimiter(int sampleRate) {
        attackCoefficient = (float) Math.exp(-1 / (ATTACK_SEC * sampleRate));
        releaseCoefficient = (float) Math.exp(-1 / (RELEASE_SEC * sampleRate));
        makeup = (float) Math.pow(1 / Math.pow(10, curveDb(0) / 20), 0.6);
        int delay = Math.max(1, (int) Math.round(LOOKAHEAD_SEC * sampleRate));
        delayLeft = new float[delay];
        delayRight = new float[delay];
    }

    /** The static curve: output level in dB for an input level in dB. */
    static float curveDb(float inputDb) {
        return inputDb <= THRESHOLD_DB ? inputDb : THRESHOLD_DB + ((inputDb - THRESHOLD_DB) / RATIO);
    }

    /** Limit `frames` interleaved stereo frames of `samples` in place. */
    void process(float[] samples, int frames) {
        int delayLength = delayLeft.length;
        for (int index = 0; index < frames; index += 1) {
            float l = samples[index * 2];
            float r = samples[(index * 2) + 1];
            float level = Math.max(Math.abs(l), Math.abs(r));
            // Below the threshold the curve is unity: no logarithm needed.
            float target = 0f;
            if (level > linearThreshold) {
                float levelDb = (float) (20 * Math.log10(level));
                target = levelDb - curveDb(levelDb);
            }
            float coefficient = target > reductionDb ? attackCoefficient : releaseCoefficient;
            reductionDb = target + (coefficient * (reductionDb - target));
            // Fully released: the makeup alone, no power to compute.
            float gain = reductionDb < 1e-4f ? makeup : makeup * (float) Math.pow(10, -reductionDb / 20);
            samples[index * 2] = delayLeft[delayIndex] * gain;
            samples[(index * 2) + 1] = delayRight[delayIndex] * gain;
            delayLeft[delayIndex] = l;
            delayRight[delayIndex] = r;
            delayIndex = (delayIndex + 1) % delayLength;
        }
    }
}
