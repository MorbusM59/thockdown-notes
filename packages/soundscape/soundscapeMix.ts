/**
 * The soundscape's mix on Android, after the generator: the space (a
 * convolution of the generator's send with the soundscape's impulse
 * response), the mix gain, brilliance (@thockdown/audio/brilliance.ts) and the bus
 * compressor -- in JavaScript, because Android renders ahead in a sandbox
 * with no Web Audio (soundscapeRenderAhead.ts). The desktop builds the same
 * chain from the browser's own nodes (soundscapeLivePlayback.ts), from the
 * numbers exported here, and the two were measured equal (apps/soundscapes/README.md).
 *
 *   direct x direct gain -----------------------+
 *   send -> space (convolution) x return gain ---+-> x MIX_GAIN -> compressor -> brilliance -> out
 *
 * What it does NOT do is the listener's master volume and the on/off fade:
 * those are applied by the output, live, so they never wait on the audio
 * already rendered ahead.
 */
import type { SoundscapeSpaceSettings } from './soundscape';
import { biquadCoefficients, brillianceCurve, BRILLIANCE_BANDS, StereoBiquad } from '@thockdown/audio/brilliance';
import { buildRoomImpulseResponse, roomKey, roomPreDelaySec, ROOM_CROSSFADE_SEC, ROOM_MAX_LENGTH_SEC } from '@thockdown/audio/room';
import { DynamicsCompressor, type CompressorSettings, type CompressorSnapshot } from './dynamicsCompressor';
import { BLOCK, PartitionedConvolver, type ConvolverSnapshot } from './partitionedConvolver';
import type { StereoBiquadSnapshot } from '@thockdown/audio/brilliance';

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
/** How much of the DIRECT sound `amount` 1 takes away: amount is a dry/wet balance, not only a return level. */
export const SOUNDSCAPE_SPACE_DRY_DUCK = 0.6;

/**
 * What the space's AMOUNT does, on both platforms: the room's return rises
 * and the direct sound falls with it, so 0 is bone dry and 1 is mostly room.
 * A return alone was nearly inaudible, because a reverberated noise layer
 * sounds like the same noise a little louder.
 */
export function soundscapeSpaceGains(amount: number): { direct: number; wet: number } {
  const a = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
  return { direct: 1 - (SOUNDSCAPE_SPACE_DRY_DUCK * a), wet: SOUNDSCAPE_SPACE_RETURN * a };
}

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


/** The mix's state at one block; opaque outside this module. */
export interface MixSnapshot {
  readonly convolvers: readonly [ConvolverSnapshot, ConvolverSnapshot];
  readonly compressor: CompressorSnapshot;
  readonly toneFilters: readonly StereoBiquadSnapshot[];
  readonly spaceKey: string | null;
  readonly pendingRoom: SoundscapeSpaceSettings | null;
  readonly returnGain: number;
  readonly returnTarget: number;
  readonly directGain: number;
  readonly directTarget: number;
  readonly brilliance: number | null;
  readonly makeup: number;
  readonly makeupTarget: number;
}

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
  /** NaN until the first space, which is then taken at once rather than glided to from nothing. */
  private directGain = Number.NaN;
  private directTarget = 1;
  /** Brilliance (@thockdown/audio/brilliance.ts): a filter per band on the mix, then the makeup that keeps its loudness. */
  private readonly toneFilters = BRILLIANCE_BANDS.map(() => new StereoBiquad());
  private brilliance: number | null = null;
  private makeup = 1;
  private makeupTarget = 1;

  constructor(private readonly sampleRate: number) {
    const maxImpulse = Math.ceil((ROOM_MAX_LENGTH_SEC + roomPreDelaySec(1)) * sampleRate) + 1;
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
    const gains = soundscapeSpaceGains(space.amount);
    this.returnTarget = gains.wet;
    this.directTarget = gains.direct;
    if (Number.isNaN(this.directGain)) this.directGain = gains.direct;
    if (space.brilliance !== this.brilliance) {
      const curve = brillianceCurve(space.brilliance, this.sampleRate);
      BRILLIANCE_BANDS.forEach((band, index) => {
        this.toneFilters[index].set(biquadCoefficients(band.kind, band.frequencyHz, band.q, curve.gainsDb[index], this.sampleRate));
      });
      if (this.brilliance === null) this.makeup = curve.makeup;
      this.makeupTarget = curve.makeup;
      this.brilliance = space.brilliance;
    }
    const key = roomKey(space);
    this.pendingRoom = key === this.spaceKey ? null : { ...space };
  }

  /** The whole state at this block, room requests included, to `restore` later (the render-ahead's rewind). */
  snapshot(): MixSnapshot {
    return {
      convolvers: [this.convolvers[0].snapshot(), this.convolvers[1].snapshot()],
      compressor: this.compressor.snapshot(),
      toneFilters: this.toneFilters.map((filter) => filter.snapshot()),
      spaceKey: this.spaceKey,
      pendingRoom: this.pendingRoom,
      returnGain: this.returnGain,
      returnTarget: this.returnTarget,
      directGain: this.directGain,
      directTarget: this.directTarget,
      brilliance: this.brilliance,
      makeup: this.makeup,
      makeupTarget: this.makeupTarget,
    };
  }

  /** Return to a `snapshot`: process on from its block exactly as the mix did from there. */
  restore(snapshot: MixSnapshot): void {
    this.convolvers[0].restore(snapshot.convolvers[0]);
    this.convolvers[1].restore(snapshot.convolvers[1]);
    this.compressor.restore(snapshot.compressor);
    snapshot.toneFilters.forEach((filter, index) => this.toneFilters[index].restore(filter));
    this.spaceKey = snapshot.spaceKey;
    this.pendingRoom = snapshot.pendingRoom;
    this.returnGain = snapshot.returnGain;
    this.returnTarget = snapshot.returnTarget;
    this.directGain = snapshot.directGain;
    this.directTarget = snapshot.directTarget;
    this.brilliance = snapshot.brilliance;
    this.makeup = snapshot.makeup;
    this.makeupTarget = snapshot.makeupTarget;
  }

  get roomPending(): boolean {
    return this.pendingRoom !== null;
  }

  /** Build the pending room and crossfade it in over ROOM_CROSSFADE_SEC (at once, for the first). */
  buildRoom(): void {
    const space = this.pendingRoom;
    if (space === null) return;
    this.pendingRoom = null;
    const first = this.spaceKey === null;
    this.spaceKey = roomKey(space);
    const [left, right] = buildRoomImpulseResponse(space, this.sampleRate);
    const fade = first ? 0 : Math.round(ROOM_CROSSFADE_SEC * this.sampleRate);
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
    const directFrom = Number.isNaN(this.directGain) ? this.directTarget : this.directGain;
    const directStep = (this.directTarget - directFrom) / MIX_BLOCK;
    for (let index = 0; index < MIX_BLOCK; index += 1) {
      const wet = from + (step * (index + 1));
      const dry = directFrom + (directStep * (index + 1));
      out[0][index] = SOUNDSCAPE_MIX_GAIN * ((dry * direct[0][index]) + (wet * this.wetLeft[index]));
      out[1][index] = SOUNDSCAPE_MIX_GAIN * ((dry * direct[1][index]) + (wet * this.wetRight[index]));
    }
    this.returnGain = this.returnTarget;
    this.directGain = this.directTarget;
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
