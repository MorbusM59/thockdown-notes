/**
 * A stereo compressor for the soundscape's bus, run in the render worker
 * (soundscapeMix.ts) in place of the DynamicsCompressorNode it replaced.
 *
 * Its STATIC CURVE and MAKEUP GAIN are Chromium's (DynamicsCompressorKernel),
 * because those decide the level everything is heard at:
 * - unity below the threshold; a knee from the threshold UP to
 *   `threshold + knee` (not centred on the threshold, as the specification's
 *   prose suggests) shaped `t + (1 - e^(-k(x - t))) / k` in linear terms,
 *   with k chosen so the slope at the knee's top is 1/ratio; above it, the
 *   ratio, in dB;
 * - makeup gain of (1 / curve(0 dBFS))^0.6.
 * Its DYNAMICS are simpler than Chromium's (no adaptive release): the gain
 * reduction is smoothed in dB at the attack and release time constants,
 * and the signal is delayed 6 ms so the gain reacts in time to a peak.
 *
 * Measured against the node it replaced, on the same generator output
 * through the old graph and through soundscapeMix (apps/soundscapes/README.md): the
 * difference is in the dynamics only, and the soundscapes are kept out of
 * the knee by their own volumes, so it is rarely engaged.
 */

export interface CompressorSettings {
  thresholdDb: number;
  kneeDb: number;
  ratio: number;
  attackSec: number;
  releaseSec: number;
}

const LOOKAHEAD_SEC = 0.006;

export class DynamicsCompressor {
  private readonly attackCoefficient: number;
  private readonly releaseCoefficient: number;
  private readonly makeup: number;
  private readonly delayLeft: Float32Array;
  private readonly delayRight: Float32Array;
  private delayIndex = 0;
  private reductionDb = 0;

  private readonly linearThreshold: number;
  private readonly kneeTop: number;
  private readonly kneeTopOutputDb: number;
  private readonly k: number;

  constructor(private readonly settings: CompressorSettings, sampleRate: number) {
    this.linearThreshold = Math.pow(10, settings.thresholdDb / 20);
    this.kneeTop = Math.pow(10, (settings.thresholdDb + settings.kneeDb) / 20);
    this.k = this.kAtSlope(1 / settings.ratio);
    this.kneeTopOutputDb = 20 * Math.log10(this.kneeCurve(this.kneeTop, this.k));
    this.attackCoefficient = Math.exp(-1 / (settings.attackSec * sampleRate));
    this.releaseCoefficient = Math.exp(-1 / (settings.releaseSec * sampleRate));
    const fullRangeDb = this.curveDb(0);
    this.makeup = Math.pow(1 / Math.pow(10, fullRangeDb / 20), 0.6);
    const delay = Math.max(1, Math.round(LOOKAHEAD_SEC * sampleRate));
    this.delayLeft = new Float32Array(delay);
    this.delayRight = new Float32Array(delay);
  }

  /** The static curve: output level in dB for an input level in dB. */
  curveDb(inputDb: number): number {
    const x = Math.pow(10, inputDb / 20);
    if (x < this.kneeTop) return 20 * Math.log10(this.kneeCurve(x, this.k));
    const kneeTopDb = this.settings.thresholdDb + this.settings.kneeDb;
    return this.kneeTopOutputDb + ((inputDb - kneeTopDb) / this.settings.ratio);
  }

  private kneeCurve(x: number, k: number): number {
    if (x < this.linearThreshold) return x;
    return this.linearThreshold + ((1 - Math.exp(-k * (x - this.linearThreshold))) / k);
  }

  /** The knee's slope in dB/dB at `x`, measured over a 0.1% step as Chromium does. */
  private slopeAt(x: number, k: number): number {
    if (x < this.linearThreshold) return 1;
    const x2 = x * 1.001;
    const toDb = (value: number) => 20 * Math.log10(value);
    return (toDb(this.kneeCurve(x2, k)) - toDb(this.kneeCurve(x, k))) / (toDb(x2) - toDb(x));
  }

  /** The k whose knee ends with slope `slope`: Chromium's geometric bisection. */
  private kAtSlope(slope: number): number {
    let low = 0.1;
    let high = 10000;
    let k = 5;
    for (let step = 0; step < 15; step += 1) {
      if (this.slopeAt(this.kneeTop, k) < slope) high = k;
      else low = k;
      k = Math.sqrt(low * high);
    }
    return k;
  }

  /** Compress `left`/`right` in place. */
  process(left: Float32Array, right: Float32Array): void {
    const delayLeft = this.delayLeft;
    const delayRight = this.delayRight;
    const delayLength = delayLeft.length;
    for (let index = 0; index < left.length; index += 1) {
      const l = left[index];
      const r = right[index];
      const level = Math.max(Math.abs(l), Math.abs(r));
      const levelDb = level > 1e-9 ? 20 * Math.log10(level) : -180;
      const targetReductionDb = levelDb - this.curveDb(levelDb);
      const coefficient = targetReductionDb > this.reductionDb ? this.attackCoefficient : this.releaseCoefficient;
      this.reductionDb = targetReductionDb + (coefficient * (this.reductionDb - targetReductionDb));
      const gain = this.makeup * Math.pow(10, -this.reductionDb / 20);
      left[index] = delayLeft[this.delayIndex] * gain;
      right[index] = delayRight[this.delayIndex] * gain;
      delayLeft[this.delayIndex] = l;
      delayRight[this.delayIndex] = r;
      this.delayIndex = (this.delayIndex + 1) % delayLength;
    }
  }
}
