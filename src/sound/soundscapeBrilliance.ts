/**
 * BRILLIANCE: how sharply the whole soundscape is heard, as one tone curve
 * on the finished mix, AFTER the compressor. Before it, the bass lift drove
 * the compressor on a soundscape whose energy is nearly all low (most of
 * them), and the gain it took back took the sparkle with it: crisp measured
 * duller than neutral. It is not part of
 * the place (size and foliage are, soundscapeSpace.ts): a dense forest
 * heard with high brilliance keeps its crisp near rain.
 *
 * The slider runs from SOFT AND WARM (0) through NEUTRAL (0.5, flat) to
 * CRISP AND CHISELLED (1), as four bands (BRILLIANCE_BANDS), the same on
 * both platforms -- the desktop's BiquadFilterNodes (soundscapeLivePlayback.ts)
 * and Android's StereoBiquad below (soundscapeMix.ts), whose coefficients are
 * Chromium's own (Biquad.cpp: a shelf's slope is fixed at S = 1, a peak's Q
 * is linear). Both build their filters from that one list.
 * A MAKEUP gain then holds the loudness as heard (brillianceCurve), so the
 * slider changes the character and not the volume -- otherwise it would
 * read as a second volume control.
 */

export type BiquadKind = 'lowshelf' | 'highshelf' | 'peaking';

/** One band of the tone curve: its filter is fixed, only its gain moves with the slider. */
export interface BrillianceBand {
  kind: BiquadKind;
  frequencyHz: number;
  /** A peak's Q (linear); unused by a shelf, whose slope is fixed. */
  q: number;
  /** The band's gain at full crisp (brilliance 1) and full soft (brilliance 0), in dB; flat at 0.5. */
  crispDb: number;
  softDb: number;
}

/**
 * The bands, in the order they are applied. Crisp is BOOM (a bass shelf),
 * DEFINITION (the 400 Hz region where sounds smear into each other, cut),
 * PRESENCE (around 3.5 kHz, where the ear reads detail -- it is there even
 * in a dark, foliage-muffled soundscape, where a shelf at the top would
 * have nothing to lift) and AIR (a shelf from 8 kHz). Soft is the mirror:
 * a little warmth in the bass and low mids, presence and air taken away.
 */
export const BRILLIANCE_BANDS: readonly BrillianceBand[] = [
  { kind: 'lowshelf', frequencyHz: 100, q: 0, crispDb: 4, softDb: 1.5 },
  { kind: 'peaking', frequencyHz: 400, q: 1, crispDb: -3, softDb: 1.5 },
  { kind: 'peaking', frequencyHz: 3500, q: 0.8, crispDb: 5, softDb: -4 },
  { kind: 'highshelf', frequencyHz: 8000, q: 0, crispDb: 5, softDb: -6 },
];

export interface BrillianceCurve {
  /** Each band's gain in dB, in BRILLIANCE_BANDS' order. */
  gainsDb: number[];
  /** Linear gain that keeps the curve's loudness at unity. */
  makeup: number;
}

/** Normalised biquad coefficients (a0 = 1), as Chromium computes them. */
export interface BiquadCoefficients { b0: number; b1: number; b2: number; a1: number; a2: number }

export function biquadCoefficients(kind: BiquadKind, frequencyHz: number, q: number, gainDb: number, sampleRate: number): BiquadCoefficients {
  const a = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * Math.min(frequencyHz, sampleRate * 0.499)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  let b0: number; let b1: number; let b2: number; let a0: number; let a1: number; let a2: number;
  if (kind === 'peaking') {
    const alpha = sin / (2 * q);
    b0 = 1 + (alpha * a); b1 = -2 * cos; b2 = 1 - (alpha * a);
    a0 = 1 + (alpha / a); a1 = -2 * cos; a2 = 1 - (alpha / a);
  } else {
    // Shelf slope S = 1: alpha = sin/2 * sqrt((A + 1/A)(1/S - 1) + 2).
    const k = 2 * Math.sqrt(a) * (sin / 2) * Math.SQRT2;
    if (kind === 'lowshelf') {
      b0 = a * ((a + 1) - ((a - 1) * cos) + k);
      b1 = 2 * a * ((a - 1) - ((a + 1) * cos));
      b2 = a * ((a + 1) - ((a - 1) * cos) - k);
      a0 = (a + 1) + ((a - 1) * cos) + k;
      a1 = -2 * ((a - 1) + ((a + 1) * cos));
      a2 = (a + 1) + ((a - 1) * cos) - k;
    } else {
      b0 = a * ((a + 1) + ((a - 1) * cos) + k);
      b1 = -2 * a * ((a - 1) + ((a + 1) * cos));
      b2 = a * ((a + 1) + ((a - 1) * cos) - k);
      a0 = (a + 1) - ((a - 1) * cos) + k;
      a1 = 2 * ((a - 1) - ((a + 1) * cos));
      a2 = (a + 1) - ((a - 1) * cos) - k;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Power gain of a biquad at `frequencyHz`. */
function powerAt(c: BiquadCoefficients, frequencyHz: number, sampleRate: number): number {
  const w = (2 * Math.PI * frequencyHz) / sampleRate;
  const re = (z: number[]) => z[0] + (z[1] * Math.cos(w)) + (z[2] * Math.cos(2 * w));
  const im = (z: number[]) => -(z[1] * Math.sin(w)) - (z[2] * Math.sin(2 * w));
  const num = [c.b0, c.b1, c.b2];
  const den = [1, c.a1, c.a2];
  return ((re(num) ** 2) + (im(num) ** 2)) / ((re(den) ** 2) + (im(den) ** 2));
}

/** A-weighting's power gain at `f`: how much less loud the ear finds the low end and the very top. */
function aWeightPower(f: number): number {
  const f2 = f * f;
  const numerator = (12194 ** 2) * (f2 * f2);
  const denominator = (f2 + (20.6 ** 2)) * Math.sqrt((f2 + (107.7 ** 2)) * (f2 + (737.9 ** 2))) * (f2 + (12194 ** 2));
  return (numerator / denominator) ** 2;
}

/** Each band's gain for a brilliance (0..1), and the makeup that keeps the loudness. */
export function brillianceCurve(brilliance: number, sampleRate: number): BrillianceCurve {
  const b = Number.isFinite(brilliance) ? Math.max(0, Math.min(1, brilliance)) : 0.5;
  const u = (2 * b) - 1;
  const gainsDb = BRILLIANCE_BANDS.map((band) => (u >= 0 ? band.crispDb * u : band.softDb * -u));
  const filters = BRILLIANCE_BANDS.map((band, index) => biquadCoefficients(band.kind, band.frequencyHz, band.q, gainsDb[index], sampleRate));
  // Loudness as heard: the curve's mean power over a BROWN spectrum (energy
  // falling 6 dB an octave, as wind, water, rain and fire mostly do), each
  // frequency weighted as loud as the ear finds it (A-weighting). Weighted
  // by power alone, the bass lift dominated and the makeup took the sparkle
  // back down with it.
  const points = 96;
  let sum = 0;
  let weights = 0;
  for (let index = 0; index < points; index += 1) {
    const frequency = 30 * ((16000 / 30) ** (index / (points - 1)));
    const weight = aWeightPower(frequency) / frequency;
    sum += weight * filters.reduce((product, filter) => product * powerAt(filter, frequency, sampleRate), 1);
    weights += weight;
  }
  return { gainsDb, makeup: 1 / Math.sqrt(sum / weights) };
}

/** One stereo biquad (direct form I), for the Android mix. */
export class StereoBiquad {
  private c: BiquadCoefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  private readonly state = [new Float64Array(4), new Float64Array(4)];

  set(coefficients: BiquadCoefficients): void {
    this.c = coefficients;
  }

  process(channel: 0 | 1, data: Float32Array): void {
    const { b0, b1, b2, a1, a2 } = this.c;
    const s = this.state[channel];
    let [x1, x2, y1, y2] = s;
    for (let index = 0; index < data.length; index += 1) {
      const x = data[index];
      const y = (b0 * x) + (b1 * x1) + (b2 * x2) - (a1 * y1) - (a2 * y2);
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      data[index] = y;
    }
    s[0] = x1; s[1] = x2; s[2] = y1; s[3] = y2;
  }
}
