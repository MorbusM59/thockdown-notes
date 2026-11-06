/**
 * BRILLIANCE (brilliance.ts) played LIVE through the browser's own
 * BiquadFilterNodes: one filter per BRILLIANCE_BANDS entry, then the makeup
 * gain that holds the loudness as heard. What every desktop consumer of
 * brilliance uses (the soundscape's mix, the music player); Android's
 * soundscape renders the same bands in JavaScript (StereoBiquad).
 *
 *   input -> band 1 -> ... -> band n -> makeup (output)
 *
 * The makeup is computed over a brown spectrum (brillianceCurve), which is
 * what a soundscape is; on music, whose spectrum falls more slowly, the
 * crisp end reads a little louder than neutral and the soft end a little
 * quieter. Cost: three biquads and a gain, constant whatever the setting.
 */
import { brillianceCurve, BRILLIANCE_BANDS } from './brilliance';

/** The neutral setting: every band flat. */
export const BRILLIANCE_NEUTRAL = 0.5;
/** The glide on the tone when brilliance changes, so a slider never steps. */
export const BRILLIANCE_GLIDE_SEC = 0.05;

export class LiveBrilliance {
  readonly input: AudioNode;
  readonly output: GainNode;
  private readonly bands: BiquadFilterNode[];
  private value: number | null = null;

  constructor(private readonly context: BaseAudioContext) {
    this.bands = BRILLIANCE_BANDS.map((band) => {
      const filter = context.createBiquadFilter();
      filter.type = band.kind;
      filter.frequency.value = band.frequencyHz;
      if (band.kind === 'peaking') filter.Q.value = band.q;
      return filter;
    });
    this.output = context.createGain();
    for (let index = 1; index < this.bands.length; index += 1) this.bands[index - 1].connect(this.bands[index]);
    this.bands[this.bands.length - 1].connect(this.output);
    this.input = this.bands[0];
  }

  /** Glide the tone to `value` with time constant `seconds` (at once, for the first setting). */
  set(value: number, seconds = BRILLIANCE_GLIDE_SEC): void {
    if (value === this.value) return;
    const curve = brillianceCurve(value, this.context.sampleRate);
    const now = this.context.currentTime;
    const targets: Array<[AudioParam, number]> = [
      ...this.bands.map((filter, index): [AudioParam, number] => [filter.gain, curve.gainsDb[index]]),
      [this.output.gain, curve.makeup],
    ];
    for (const [param, target] of targets) {
      param.cancelScheduledValues(now);
      if (this.value === null) param.setValueAtTime(target, now);
      else param.setTargetAtTime(target, now, seconds);
    }
    this.value = value;
  }

  dispose(): void {
    for (const filter of this.bands) filter.disconnect();
    this.output.disconnect();
  }
}
