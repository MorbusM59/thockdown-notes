import { describe, expect, it } from 'vitest';
import { biquadCoefficients, brillianceCurve, BRILLIANCE_BANDS, StereoBiquad } from './soundscapeBrilliance';

const RATE = 48000;

/** `data` through the whole tone curve at `brilliance`, makeup included, as the mix applies it. */
function throughCurve(data: Float32Array, brilliance: number): Float32Array {
  const curve = brillianceCurve(brilliance, RATE);
  const out = data.slice();
  BRILLIANCE_BANDS.forEach((band, index) => {
    const filter = new StereoBiquad();
    filter.set(biquadCoefficients(band.kind, band.frequencyHz, band.q, curve.gainsDb[index], RATE));
    filter.process(0, out);
  });
  for (let index = 0; index < out.length; index += 1) out[index] *= curve.makeup;
  return out;
}

/** Steady-state level (dB) of a sine through one biquad. */
function sineLevelDb(kind: 'lowshelf' | 'highshelf' | 'peaking', frequency: number, q: number, gainDb: number, probeHz: number): number {
  const filter = new StereoBiquad();
  filter.set(biquadCoefficients(kind, frequency, q, gainDb, RATE));
  const data = new Float32Array(RATE);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.sin((2 * Math.PI * probeHz * index) / RATE);
  filter.process(0, data);
  let peak = 0;
  for (let index = data.length / 2; index < data.length; index += 1) peak = Math.max(peak, Math.abs(data[index]));
  return 20 * Math.log10(peak);
}

/** Brown noise (energy falling 6 dB an octave), low-passed at `cutoffHz`: a soundscape, dark or open. */
function soundscapeLikeNoise(cutoffHz: number): Float32Array {
  let seed = 7;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return ((seed / 0x100000000) * 2) - 1;
  };
  const pole = Math.exp((-2 * Math.PI * cutoffHz) / RATE);
  const data = new Float32Array(RATE);
  let brown = 0;
  let first = 0;
  let second = 0;
  for (let index = 0; index < data.length; index += 1) {
    brown = (0.998 * brown) + (0.02 * random());
    first = (pole * first) + ((1 - pole) * brown);
    second = (pole * second) + ((1 - pole) * first);
    data[index] = second;
  }
  return data;
}

/**
 * Energy of `data` in an octave-wide band around `centreHz`: an RBJ
 * band-pass, three times over, so a brown spectrum's weight below the band
 * does not leak in through the skirts and blur the measure.
 */
function bandEnergy(data: Float32Array, centreHz: number): number {
  const w0 = (2 * Math.PI * centreHz) / RATE;
  const alpha = Math.sin(w0) / (2 * 1.41);
  const a0 = 1 + alpha;
  const filter = new StereoBiquad();
  filter.set({ b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0 });
  const band = data.slice();
  filter.process(0, band);
  filter.process(1, band);
  const third = new StereoBiquad();
  third.set({ b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0 });
  third.process(0, band);
  let sum = 0;
  for (let index = band.length / 2; index < band.length; index += 1) sum += band[index] ** 2;
  return sum;
}

/** How far presence (3.5 kHz) stands above the muddy low mids (400 Hz), in dB: definition. */
function definitionDb(data: Float32Array): number {
  return 10 * Math.log10(bandEnergy(data, 3500) / bandEnergy(data, 400));
}

describe('brilliance', () => {
  it('is flat in the middle of the slider', () => {
    const neutral = brillianceCurve(0.5, RATE);
    for (const value of neutral.gainsDb) expect(value).toBeCloseTo(0, 9);
    expect(neutral.makeup).toBeCloseTo(1, 9);
  });

  it('takes each band to its crisp and soft gains at the ends', () => {
    expect(brillianceCurve(1, RATE).gainsDb).toEqual(BRILLIANCE_BANDS.map((band) => band.crispDb));
    expect(brillianceCurve(0, RATE).gainsDb).toEqual(BRILLIANCE_BANDS.map((band) => band.softDb));
  });

  it('crisps up even a dark, muffled soundscape, and softens it the other way, step by step', () => {
    // The case a top shelf alone failed: in a dense forest the highs are
    // already gone, and crisp measured duller than neutral.
    for (const cutoff of [3000, 12000]) {
      const noise = soundscapeLikeNoise(cutoff);
      let previous = -Infinity;
      for (const brilliance of [0, 0.25, 0.5, 0.75, 1]) {
        const definition = definitionDb(throughCurve(noise, brilliance));
        expect(definition).toBeGreaterThan(previous);
        previous = definition;
      }
      // Pronounced: presence over mud moves by well over ten decibels end to end.
      expect(definitionDb(throughCurve(noise, 1)) - definitionDb(throughCurve(noise, 0))).toBeGreaterThan(10);
    }
  });

  it('reaches each filter\'s gain where it should, as Chromium\'s filters do', () => {
    expect(sineLevelDb('highshelf', 8000, 0, 5, 20000)).toBeCloseTo(5, 0);
    expect(sineLevelDb('lowshelf', 100, 0, 4, 20)).toBeCloseTo(4, 0);
    expect(sineLevelDb('peaking', 3500, 0.8, 5, 3500)).toBeCloseTo(5, 1);
    expect(sineLevelDb('highshelf', 8000, 0, 5, 100)).toBeCloseTo(0, 1);
  });
});
