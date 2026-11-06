/**
 * STEREO WIDTH: how far a stereo signal spreads, as a mid/side gain on
 * everything above the bass. 1 leaves the signal exactly as it was, 0 folds
 * it to mono, and above 1 the difference between the sides is turned up.
 *
 * Mid and side: M = (L + R) / 2, S = (L - R) / 2, and width scales S. Written
 * as what it ADDS to each side, L' = L + (w - 1) * HP(S) and
 * R' = R - (w - 1) * HP(S), so that:
 * - at w = 1 the stage is the identity, sample for sample, whatever the
 *   filter does (nothing is added);
 * - L' + R' = L + R at EVERY width, so a mono sum (a phone speaker, a
 *   club's mono sub) hears no change at all, which is the one guarantee a
 *   width control on music has to keep;
 * - only the side ABOVE STEREO_WIDTH_BASS_HZ is touched (HP is a
 *   second-order high-pass): bass mixed wide sounds hollow and loses its
 *   punch, so the low end keeps whatever width the recording gave it.
 *
 * What width cannot do: a mono recording has no side, so there is nothing to
 * scale; widening a mono source needs decorrelation, which is what a room
 * (room.ts, independent noise per side) supplies. Past about 1.5 the centre
 * (voice, kick, snare) thins and the sides start to sound phasey, so the
 * control stops there (STEREO_WIDTH_MAX).
 *
 * Cost: a splitter, a merger, four gains and one biquad -- the cheapest
 * stage in any chain it joins, constant whatever the width.
 */
import { clamp } from '@thockdown/interaction/clamp';

export const STEREO_WIDTH_MIN = 0;
export const STEREO_WIDTH_MAX = 1.5;
export const STEREO_WIDTH_NEUTRAL = 1;
/** Below this the side is left alone, so the bass stays where the recording put it. */
export const STEREO_WIDTH_BASS_HZ = 150;
/** The glide on a change of width, so a slider never steps. */
const WIDTH_GLIDE_SEC = 0.03;

/** A width as the stage takes it: inside the control's range, the neutral width for anything unreadable. */
export function sanitizeStereoWidth(width: unknown): number {
  return typeof width === 'number' && Number.isFinite(width)
    ? clamp(width, STEREO_WIDTH_MIN, STEREO_WIDTH_MAX)
    : STEREO_WIDTH_NEUTRAL;
}

/** What the stage adds to each side, as a share of the (high-passed) side: w - 1. */
export function stereoWidthSideGain(width: number): number {
  return sanitizeStereoWidth(width) - STEREO_WIDTH_NEUTRAL;
}

export class StereoWidth {
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  private readonly sideGain: GainNode;
  private readonly nodes: AudioNode[];

  constructor(private readonly context: BaseAudioContext, width = STEREO_WIDTH_NEUTRAL) {
    // Exactly two channels in, so a mono source is up-mixed to L = R (no side) rather than left on one side.
    this.input = context.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';
    const split = context.createChannelSplitter(2);
    this.output = context.createChannelMerger(2);
    const halfLeft = context.createGain();
    halfLeft.gain.value = 0.5;
    const halfRight = context.createGain();
    halfRight.gain.value = -0.5;
    const highPass = context.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = STEREO_WIDTH_BASS_HZ;
    highPass.Q.value = Math.SQRT1_2;
    highPass.channelCount = 1;
    highPass.channelCountMode = 'explicit';
    this.sideGain = context.createGain();
    this.sideGain.gain.value = stereoWidthSideGain(width);
    const negate = context.createGain();
    negate.gain.value = -1;

    this.input.connect(split);
    split.connect(this.output, 0, 0);
    split.connect(this.output, 1, 1);
    split.connect(halfLeft, 0);
    split.connect(halfRight, 1);
    halfLeft.connect(highPass);
    halfRight.connect(highPass);
    highPass.connect(this.sideGain);
    this.sideGain.connect(this.output, 0, 0);
    this.sideGain.connect(negate);
    negate.connect(this.output, 0, 1);
    this.nodes = [this.input, split, halfLeft, halfRight, highPass, this.sideGain, negate, this.output];
  }

  setWidth(width: number): void {
    this.sideGain.gain.setTargetAtTime(stereoWidthSideGain(width), this.context.currentTime, WIDTH_GLIDE_SEC);
  }

  dispose(): void {
    for (const node of this.nodes) node.disconnect();
  }
}
