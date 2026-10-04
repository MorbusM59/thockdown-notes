/**
 * The soundscape's mix on Android, after the generator: the space (a
 * convolution of the generator's send with the soundscape's impulse
 * response), the mix gain, brilliance (soundscapeBrilliance.ts) and the bus
 * compressor -- in JavaScript, because Android renders ahead in a sandbox
 * with no Web Audio (soundscapeRenderAhead.ts). The desktop builds the same
 * chain from the browser's own nodes (soundscapeLivePlayback.ts), from the
 * numbers exported here, and the two were measured equal (apps/soundscapes/README.md).
 *
 *   direct --------------------------------------+
 *   send -> space (convolution) x return gain ---+-> x MIX_GAIN -> compressor -> brilliance -> out
 *
 * What it does NOT do is the listener's master volume and the on/off fade:
 * those are applied by the output, live, so they never wait on the audio
 * already rendered ahead.
 */
import type { SoundscapeSpaceSettings } from './soundscape';
import { biquadCoefficients, brillianceCurve, BRILLIANCE_BANDS, StereoBiquad } from './soundscapeBrilliance';
import { buildSoundscapeImpulseResponse, soundscapeRoomKey, spacePreDelaySec, SPACE_MAX_LENGTH_SEC } from './soundscapeSpace';
import { DynamicsCompressor, type CompressorSettings } from './dynamicsCompressor';
import { BLOCK, PartitionedConvolver } from './partitionedConvolver';

/** The block the mix processes: the convolver's. */
export const MIX_BLOCK = BLOCK;

/**
 * Mix level at a soundscape volume of 1, ahead of the compressor.
 *
 * Keeping a soundscape out of the compressor is the soundscape's own volume
 * (SoundscapeSettings.volume), applied in the generator and set per
 * soundscape: a natural environment has no compression, and a compressor
 * working on a soundscape is heard as every layer ducking whenever one of
 * them peaks. Measured through the Web Audio graph this mix replaced (42 s
 * per seed), at this gain Thunderstorm peaked at +7.3 dBFS and was
 * compressed 71-87% of the time; the knee begins at -14 dBFS, so it needs
 * roughly -24 dB of its own volume to stay clear of it.
 */
export const SOUNDSCAPE_MIX_GAIN = 0.5;
/** The space's return at `amount` 1. */
export const SOUNDSCAPE_SPACE_RETURN = 1.2;
/** How long a new space takes to fade in over the old. */
export const SPACE_CROSSFADE_SEC = 0.35;

/**
 * Gentle, for a soundscape whose own volume leaves it loud enough to reach
 * it (see SOUNDSCAPE_MIX_GAIN). A low ratio and a wide knee turn a peak down
 * a little rather than clamping it, and a slow release lets the level drift
 * back rather than breathe after every peak. The knee begins at -14 dBFS
 * (-8 threshold minus half the 12 dB knee).
 */
export const BUS_COMPRESSOR: CompressorSettings = {
  thresholdDb: -8,
  kneeDb: 12,
  ratio: 3,
  attackSec: 0.02,
  releaseSec: 0.8,
};


export class SoundscapeMix {
  private readonly convolvers: [PartitionedConvolver, PartitionedConvolver];
  private readonly compressor: DynamicsCompressor;
  private readonly wetLeft = new Float32Array(MIX_BLOCK);
  private readonly wetRight = new Float32Array(MIX_BLOCK);
  /** The room built and heard; null before the first. */
  private spaceKey: string | null = null;
  private pendingRoom: SoundscapeSpaceSettings | null = null;
  private returnGain = 0;
  private returnTarget = 0;
  /** Brilliance (soundscapeBrilliance.ts): a filter per band on the mix, then the makeup that keeps its loudness. */
  private readonly toneFilters = BRILLIANCE_BANDS.map(() => new StereoBiquad());
  private brilliance: number | null = null;
  private makeup = 1;
  private makeupTarget = 1;

  constructor(private readonly sampleRate: number) {
    const maxImpulse = Math.ceil((SPACE_MAX_LENGTH_SEC + spacePreDelaySec(1)) * sampleRate) + 1;
    this.convolvers = [new PartitionedConvolver(maxImpulse), new PartitionedConvolver(maxImpulse)];
    this.compressor = new DynamicsCompressor(BUS_COMPRESSOR, sampleRate);
  }

  /**
   * Take a space: a changed amount glides over the next block; a changed
   * ROOM is only recorded, because building it is the expensive part of a
   * change, and the renderer decides when it can afford to (buildRoom; see
   * soundscapeRenderAhead.ts, THE ROOM). A newer room replaces one not yet built.
   */
  setSpace(space: SoundscapeSpaceSettings): void {
    this.returnTarget = SOUNDSCAPE_SPACE_RETURN * space.amount;
    if (space.brilliance !== this.brilliance) {
      const curve = brillianceCurve(space.brilliance, this.sampleRate);
      BRILLIANCE_BANDS.forEach((band, index) => {
        this.toneFilters[index].set(biquadCoefficients(band.kind, band.frequencyHz, band.q, curve.gainsDb[index], this.sampleRate));
      });
      if (this.brilliance === null) this.makeup = curve.makeup;
      this.makeupTarget = curve.makeup;
      this.brilliance = space.brilliance;
    }
    const key = soundscapeRoomKey(space);
    this.pendingRoom = key === this.spaceKey ? null : { ...space };
  }

  get roomPending(): boolean {
    return this.pendingRoom !== null;
  }

  /** Build the pending room and crossfade it in over SPACE_CROSSFADE_SEC (at once, for the first). */
  buildRoom(): void {
    const space = this.pendingRoom;
    if (space === null) return;
    this.pendingRoom = null;
    const first = this.spaceKey === null;
    this.spaceKey = soundscapeRoomKey(space);
    const [left, right] = buildSoundscapeImpulseResponse(space, this.sampleRate);
    const fade = first ? 0 : Math.round(SPACE_CROSSFADE_SEC * this.sampleRate);
    this.convolvers[0].setImpulse(left, fade);
    this.convolvers[1].setImpulse(right, fade);
    if (first) this.returnGain = this.returnTarget;
  }

  /** Mix one MIX_BLOCK of generator output into `out` (overwritten). */
  process(direct: [Float32Array, Float32Array], send: [Float32Array, Float32Array], out: [Float32Array, Float32Array]): void {
    this.convolvers[0].process(send[0], this.wetLeft);
    this.convolvers[1].process(send[1], this.wetRight);
    const from = this.returnGain;
    const step = (this.returnTarget - from) / MIX_BLOCK;
    for (let index = 0; index < MIX_BLOCK; index += 1) {
      const wet = from + (step * (index + 1));
      out[0][index] = SOUNDSCAPE_MIX_GAIN * (direct[0][index] + (wet * this.wetLeft[index]));
      out[1][index] = SOUNDSCAPE_MIX_GAIN * (direct[1][index] + (wet * this.wetRight[index]));
    }
    this.returnGain = this.returnTarget;
    this.compressor.process(out[0], out[1]);
    for (const filter of this.toneFilters) {
      filter.process(0, out[0]);
      filter.process(1, out[1]);
    }
    const makeupFrom = this.makeup;
    const makeupStep = (this.makeupTarget - makeupFrom) / MIX_BLOCK;
    for (let index = 0; index < MIX_BLOCK; index += 1) {
      const gain = makeupFrom + (makeupStep * (index + 1));
      out[0][index] *= gain;
      out[1][index] *= gain;
    }
    this.makeup = this.makeupTarget;
  }
}
