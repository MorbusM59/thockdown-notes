import { describe, expect, it } from 'vitest';
import { biquadCoefficients } from './brilliance';
import { MUSIC_MIX_BLOCK, MusicMix, type MusicStage } from './musicMix';

const RATE = 48000;
const BANDS = Array.from({ length: 31 }, (_, k) => ({ frequencyHz: 20 * 2 ** (k / 3), q: 1.5 }));
const STAGE: MusicStage = { eqGainsDb: BANDS.map((_, k) => (k % 5) - 2), reverbAmount: 0.3, size: 0.4, foliage: 0.2, width: 1.3 };

/** A deterministic stereo test song: two tones and noise, the sides different. */
function song(blocks: number): [Float32Array, Float32Array] {
  const n = blocks * MUSIC_MIX_BLOCK;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let seed = 1;
  for (let i = 0; i < n; i += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const noise = (seed / 2 ** 32 - 0.5) * 0.2;
    left[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE) + noise;
    right[i] = 0.3 * Math.sin((2 * Math.PI * 3300 * i) / RATE) - noise;
  }
  return [left, right];
}

function run(mix: MusicMix, input: [Float32Array, Float32Array], from: number, blocks: number): [Float32Array, Float32Array] {
  const out: [Float32Array, Float32Array] = [new Float32Array(blocks * MUSIC_MIX_BLOCK), new Float32Array(blocks * MUSIC_MIX_BLOCK)];
  const block: [Float32Array, Float32Array] = [new Float32Array(MUSIC_MIX_BLOCK), new Float32Array(MUSIC_MIX_BLOCK)];
  for (let b = 0; b < blocks; b += 1) {
    const at = (from + b) * MUSIC_MIX_BLOCK;
    mix.process([input[0].subarray(at, at + MUSIC_MIX_BLOCK), input[1].subarray(at, at + MUSIC_MIX_BLOCK)], block);
    out[0].set(block[0], b * MUSIC_MIX_BLOCK);
    out[1].set(block[1], b * MUSIC_MIX_BLOCK);
  }
  return out;
}

function magnitudeAt(c: ReturnType<typeof biquadCoefficients>, hz: number): number {
  const w = (2 * Math.PI * hz) / RATE;
  const num = [c.b0 + c.b1 * Math.cos(w) + c.b2 * Math.cos(2 * w), -(c.b1 * Math.sin(w) + c.b2 * Math.sin(2 * w))];
  const den = [1 + c.a1 * Math.cos(w) + c.a2 * Math.cos(2 * w), -(c.a1 * Math.sin(w) + c.a2 * Math.sin(2 * w))];
  return Math.hypot(...num) / Math.hypot(...den);
}

describe('biquad low- and high-pass, as Web Audio defines them', () => {
  it('reads Q as a resonance in dB: the gain at the cutoff is Q dB', () => {
    for (const kind of ['lowpass', 'highpass'] as const) {
      for (const q of [0.707, 3, -2]) {
        const c = biquadCoefficients(kind, 1000, q, 0, RATE);
        expect(20 * Math.log10(magnitudeAt(c, 1000))).toBeCloseTo(q, 6);
      }
    }
  });
  it('passes DC (low-pass) and blocks it (high-pass)', () => {
    expect(magnitudeAt(biquadCoefficients('lowpass', 1000, 0.707, 0, RATE), 0)).toBeCloseTo(1, 9);
    expect(magnitudeAt(biquadCoefficients('highpass', 1000, 0.707, 0, RATE), 0)).toBeCloseTo(0, 9);
  });
});

describe('MusicMix', () => {
  it('leaves the mono sum alone at every width', () => {
    const input = song(6);
    const sums = [0, 0.5, 1, 1.5].map((width) => {
      const mix = new MusicMix(RATE, BANDS);
      mix.setStage({ ...STAGE, width });
      mix.buildRoom();
      const [left, right] = run(mix, input, 0, 6);
      return left.map((value, i) => value + right[i]);
    });
    for (const sum of sums.slice(1)) {
      let worst = 0;
      sum.forEach((value, i) => { worst = Math.max(worst, Math.abs(value - sums[0][i])); });
      expect(worst).toBeLessThan(1e-5);
    }
  });

  it('folds to mono at width 0 above the bass', () => {
    const n = 8 * MUSIC_MIX_BLOCK;
    const tone = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 2000 * i) / RATE));
    const mix = new MusicMix(RATE, BANDS);
    mix.setStage({ eqGainsDb: BANDS.map(() => 0), reverbAmount: 0, size: 0.3, foliage: 0, width: 0 });
    mix.buildRoom();
    const [left, right] = run(mix, [tone, new Float32Array(n)], 0, 8);
    // Past the filters' settling, what is left of the side is the high-pass's
    // phase shift at 2 kHz (a few degrees), not the side itself.
    let difference = 0;
    let sum = 0;
    for (let i = n / 2; i < n; i += 1) { difference += (left[i] - right[i]) ** 2; sum += (left[i] + right[i]) ** 2; }
    expect(Math.sqrt(difference / sum)).toBeLessThan(0.15);
  });

  it('carries on exactly as before after a rewind (snapshot, restore)', () => {
    const input = song(10);
    const mix = new MusicMix(RATE, BANDS);
    mix.setStage(STAGE);
    mix.buildRoom();
    run(mix, input, 0, 3);
    const snapshot = mix.snapshot();
    const first = run(mix, input, 3, 5);
    // Something else happens in between: another stage, another room.
    mix.setStage({ ...STAGE, size: 0.9, width: 0.2, eqGainsDb: BANDS.map(() => 6) });
    mix.buildRoom();
    run(mix, input, 3, 2);
    mix.restore(snapshot);
    const again = run(mix, input, 3, 5);
    expect(Array.from(again[0])).toEqual(Array.from(first[0]));
    expect(Array.from(again[1])).toEqual(Array.from(first[1]));
  });

  it('records a new room rather than building it, and crossfades it in when built', () => {
    const mix = new MusicMix(RATE, BANDS);
    mix.setStage(STAGE);
    expect(mix.roomPending).toBe(true);
    mix.buildRoom();
    expect(mix.roomPending).toBe(false);
    mix.setStage({ ...STAGE, width: 0.5 });
    expect(mix.roomPending).toBe(false);
    mix.setStage({ ...STAGE, size: 0.8 });
    expect(mix.roomPending).toBe(true);
  });
});
