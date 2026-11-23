/**
 * A STREAMING SAMPLE-RATE CONVERTER for stereo audio: a song decoded at its
 * own rate (44.1 kHz, 48 kHz, ...) brought to the output's, a block at a
 * time, with no seam between blocks. Android's decoders hand over PCM at the
 * file's rate and the app's output runs at one rate for the soundscape and
 * the music together, so the conversion is ours.
 *
 * Band-limited interpolation: every output sample is the input convolved
 * with a Kaiser-windowed sinc centred on the output sample's position in
 * the input, TAPS_PER_SIDE input samples either side. Its cutoff is the
 * lower of the two Nyquist frequencies (times CUTOFF_SHARE, so the
 * transition band sits below it and nothing aliases back into hearing).
 * The kernel is tabulated at PHASES fractional positions and read with
 * linear interpolation between neighbouring phases, so no sine or Bessel
 * function is evaluated per sample.
 *
 * Equal rates pass through untouched, at no cost.
 *
 * Output position is exact: the input position of output frame n is
 * n x inRate / outRate, kept as a whole input frame plus a fraction in
 * integer units of outRate, so no rounding accumulates over an hour.
 */

const TAPS_PER_SIDE = 24;
const PHASES = 512;
const KAISER_BETA = 8;
/** Of the lower Nyquist frequency: the passband edge's share, the rest a transition band. */
const CUTOFF_SHARE = 0.92;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 40; k += 1) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

/** The kernel at offsets (j - TAPS_PER_SIDE + 1 - phase/PHASES) for j in 0..2*TAPS_PER_SIDE, per phase 0..PHASES. */
function buildKernel(cutoff: number): Float32Array {
  const width = 2 * TAPS_PER_SIDE;
  const table = new Float32Array((PHASES + 1) * width);
  const norm = besselI0(KAISER_BETA);
  for (let phase = 0; phase <= PHASES; phase += 1) {
    const fraction = phase / PHASES;
    for (let j = 0; j < width; j += 1) {
      const t = (j - TAPS_PER_SIDE + 1) - fraction;
      const x = t / TAPS_PER_SIDE;
      const window = Math.abs(x) >= 1 ? 0 : besselI0(KAISER_BETA * Math.sqrt(1 - (x * x))) / norm;
      const arg = Math.PI * cutoff * t;
      const sinc = t === 0 ? 1 : Math.sin(arg) / arg;
      table[(phase * width) + j] = cutoff * sinc * window;
    }
  }
  return table;
}

export class StreamResampler {
  private readonly kernel: Float32Array | null;
  /** Input not yet consumed, history included, per side. */
  private bufferLeft = new Float32Array(0);
  private bufferRight = new Float32Array(0);
  /** Frames in the buffers. */
  private length = 0;
  /** The next output frame's input position: buffer index `position` plus `fraction` / outRate. */
  private position: number;
  private fraction = 0;

  constructor(readonly inRate: number, readonly outRate: number) {
    if (inRate === outRate) {
      this.kernel = null;
      this.position = 0;
      return;
    }
    this.kernel = buildKernel(CUTOFF_SHARE * Math.min(1, outRate / inRate));
    // Silence before the first sample, so the first output is centred on it.
    this.position = TAPS_PER_SIDE - 1;
    this.length = TAPS_PER_SIDE - 1;
    this.bufferLeft = new Float32Array(TAPS_PER_SIDE * 4);
    this.bufferRight = new Float32Array(TAPS_PER_SIDE * 4);
  }

  /** Convert the next block of input; returns what output it completes (possibly none). */
  push(left: Float32Array, right: Float32Array): [Float32Array, Float32Array] {
    if (!this.kernel) return [left.slice(), right.slice()];
    this.append(left, right);
    return this.drain(this.length - TAPS_PER_SIDE - 1);
  }

  /** The end of the input: convert what is left, as if silence followed. */
  finish(): [Float32Array, Float32Array] {
    if (!this.kernel) return [new Float32Array(0), new Float32Array(0)];
    const pad = new Float32Array(TAPS_PER_SIDE);
    this.append(pad, pad);
    return this.drain(this.length - TAPS_PER_SIDE - 1);
  }

  private append(left: Float32Array, right: Float32Array): void {
    const needed = this.length + left.length;
    if (needed > this.bufferLeft.length) {
      const grown = Math.max(needed, this.bufferLeft.length * 2);
      const nextLeft = new Float32Array(grown);
      const nextRight = new Float32Array(grown);
      nextLeft.set(this.bufferLeft.subarray(0, this.length));
      nextRight.set(this.bufferRight.subarray(0, this.length));
      this.bufferLeft = nextLeft;
      this.bufferRight = nextRight;
    }
    this.bufferLeft.set(left, this.length);
    this.bufferRight.set(right, this.length);
    this.length = needed;
  }

  /** Every output frame centred at or before buffer index `lastCentre` (its kernel reaches `lastCentre` + TAPS_PER_SIDE). */
  private drain(lastCentre: number): [Float32Array, Float32Array] {
    const kernel = this.kernel!;
    const width = 2 * TAPS_PER_SIDE;
    const { inRate, outRate } = this;
    const step = Math.floor(inRate / outRate);
    const stepFraction = inRate % outRate;
    // How many outputs fit: positions up to lastCentre.
    let count = 0;
    {
      let position = this.position;
      let fraction = this.fraction;
      while (position <= lastCentre) {
        count += 1;
        position += step;
        fraction += stepFraction;
        if (fraction >= outRate) { fraction -= outRate; position += 1; }
      }
    }
    const outLeft = new Float32Array(count);
    const outRight = new Float32Array(count);
    const bufferLeft = this.bufferLeft;
    const bufferRight = this.bufferRight;
    for (let n = 0; n < count; n += 1) {
      const exact = (this.fraction / outRate) * PHASES;
      const phase = Math.floor(exact);
      const blend = exact - phase;
      const rowA = phase * width;
      const rowB = rowA + width;
      const first = this.position - TAPS_PER_SIDE + 1;
      let sumLeft = 0;
      let sumRight = 0;
      for (let j = 0; j < width; j += 1) {
        const weight = kernel[rowA + j] + (blend * (kernel[rowB + j] - kernel[rowA + j]));
        sumLeft += weight * bufferLeft[first + j];
        sumRight += weight * bufferRight[first + j];
      }
      outLeft[n] = sumLeft;
      outRight[n] = sumRight;
      this.position += step;
      this.fraction += stepFraction;
      if (this.fraction >= outRate) { this.fraction -= outRate; this.position += 1; }
    }
    // Drop what no later output reaches back to.
    const keepFrom = Math.max(0, this.position - TAPS_PER_SIDE + 1);
    if (keepFrom > 0) {
      this.bufferLeft.copyWithin(0, keepFrom, this.length);
      this.bufferRight.copyWithin(0, keepFrom, this.length);
      this.length -= keepFrom;
      this.position -= keepFrom;
    }
    return [outLeft, outRight];
  }
}
