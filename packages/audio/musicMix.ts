/**
 * THE MUSIC'S PROCESSING as a block renderer, for a platform that cannot run
 * it as Web Audio nodes (Android, where music is rendered ahead in the app's
 * service like the soundscape: apps/soundscapes/README.md). It is the
 * desktop player's graph (packages/visualizer/sound/MusicPlayerService.ts),
 * stage for stage and from the same numbers:
 *
 *   song -> EQ bank -> foliage low-pass -+-> dry (1 - amount) ------+-> stereo width -> out
 *                                        +-> room -> wet (amount) --+
 *
 * - EQ: one peaking biquad per band, in the order given, at the gains the
 *   soundstage's curve was fitted to (`fitEqBandGains`); the bands' centres
 *   and Q are the caller's (`EQ_BAND_FREQUENCIES_HZ`, `EQ_BAND_Q`), so this
 *   module knows nothing about how the curve is drawn.
 * - The near low-pass of the room's FOLIAGE (`foliageNearCutoffHz`): the
 *   whole track among the trees, not only its reverb.
 * - The ROOM (room.ts), convolved per side by the same partitioned
 *   convolution as the soundscape's, mixed dry/wet by the reverb amount.
 * - STEREO WIDTH (stereoWidth.ts's rule): L + g x HP(S), R - g x HP(S).
 *
 * Every biquad is computed with Chromium's own coefficients (brilliance.ts's
 * `biquadCoefficients`, a low- or high-pass's Q read as dB as Web Audio
 * defines it), so the two platforms differ only by rounding.
 *
 * What is NOT here, on purpose: the VOLUME and the shared LIMITER. Both act
 * on what the listener hears now, and anything in a renderer is heard only
 * after its lead; the platform applies them where the sound is played (on
 * desktop the volume sits before the room, which is the same thing: every
 * stage after it is linear).
 *
 * A change of stage is taken at a block's start; the dry/wet and width move
 * linearly across that block, and new EQ coefficients take effect at once:
 * the renderer splices every change in a crossfade (soundscapeRenderAhead.ts
 * keeps the same discipline for the soundscape), so nothing steps audibly.
 * A new ROOM is only recorded (`roomPending`), as the soundscape's mix does,
 * because building it takes longer than a splice's margin: the renderer
 * calls `buildRoom` once it can afford to, and the room crossfades in over
 * ROOM_CROSSFADE_SEC.
 */
import { biquadCoefficients, StereoBiquad, type StereoBiquadSnapshot } from './brilliance';
import { BLOCK, PartitionedConvolver, type ConvolverSnapshot, type PreparedImpulse } from './partitionedConvolver';
import { buildRoomImpulseResponse, foliageNearCutoffHz, roomKey, roomPreDelaySec, ROOM_CROSSFADE_SEC, ROOM_MAX_LENGTH_SEC, type RoomShape } from './room';
import { STEREO_WIDTH_BASS_HZ, stereoWidthSideGain } from './stereoWidth';

/** Frames per `process` call: the convolution's block. */
export const MUSIC_MIX_BLOCK = BLOCK;

/** A Web Audio low- or high-pass's Q for a Butterworth response (stereoWidth.ts and the foliage filter use it). */
const BUTTERWORTH_Q = Math.SQRT1_2;

/** One EQ band's fixed filter: its centre and (linear) Q. */
export interface MusicEqBand {
  frequencyHz: number;
  q: number;
}

/** A soundstage as the processing takes it: every music setting but the volume. */
export interface MusicStage {
  /** Each band's gain in dB, in the bands' order. */
  eqGainsDb: ArrayLike<number>;
  /** 0..1: the reverb's wet share. */
  reverbAmount: number;
  /** The room (room.ts). */
  size: number;
  foliage: number;
  /** stereoWidth.ts's width (0 mono to 1.5). */
  width: number;
}

/** The mix's state at one block; opaque outside this module. */
export interface MusicMixSnapshot {
  readonly eq: readonly StereoBiquadSnapshot[];
  readonly foliage: StereoBiquadSnapshot;
  readonly sideHighPass: StereoBiquadSnapshot;
  readonly convolvers: readonly [ConvolverSnapshot, ConvolverSnapshot];
  readonly roomKey: string | null;
  readonly pendingRoom: RoomShape | null;
  readonly eqGainsDb: Float64Array;
  readonly foliageAmount: number;
  readonly wet: number;
  readonly wetTarget: number;
  readonly side: number;
  readonly sideTarget: number;
}

export class MusicMix {
  private readonly eq: StereoBiquad[];
  private readonly foliage = new StereoBiquad();
  /** The width stage's high-pass on the side signal: one channel of a stereo biquad. */
  private readonly sideHighPass = new StereoBiquad();
  private readonly convolvers: [PartitionedConvolver, PartitionedConvolver];
  private readonly wetLeft = new Float32Array(MUSIC_MIX_BLOCK);
  private readonly wetRight = new Float32Array(MUSIC_MIX_BLOCK);
  private readonly sideBuffer = new Float32Array(MUSIC_MIX_BLOCK);
  private roomKey: string | null = null;
  private pendingRoom: RoomShape | null = null;
  /** The pending room transformed ahead (prepareRoom), by its key; depends on nothing but the room, so a rewind keeps it. */
  private prepared: { key: string; responses: [PreparedImpulse, PreparedImpulse] } | null = null;
  private eqGainsDb: Float64Array;
  private foliageAmount = Number.NaN;
  /** NaN until the first stage, which is then taken at once rather than glided to. */
  private wet = Number.NaN;
  private wetTarget = 0;
  private side = Number.NaN;
  private sideTarget = 0;

  constructor(private readonly sampleRate: number, private readonly bands: readonly MusicEqBand[]) {
    this.eq = bands.map(() => new StereoBiquad());
    this.eqGainsDb = new Float64Array(bands.length).fill(Number.NaN);
    this.sideHighPass.set(biquadCoefficients('highpass', STEREO_WIDTH_BASS_HZ, BUTTERWORTH_Q, 0, sampleRate));
    const maxImpulse = Math.ceil((ROOM_MAX_LENGTH_SEC + roomPreDelaySec(1)) * sampleRate) + 1;
    this.convolvers = [new PartitionedConvolver(maxImpulse), new PartitionedConvolver(maxImpulse)];
  }

  /** Take a stage from the next block on (see the file's comment for how each part moves). */
  setStage(stage: MusicStage): void {
    this.bands.forEach((band, index) => {
      const gain = stage.eqGainsDb[index] ?? 0;
      if (gain === this.eqGainsDb[index]) return;
      this.eqGainsDb[index] = gain;
      this.eq[index].set(biquadCoefficients('peaking', band.frequencyHz, band.q, gain, this.sampleRate));
    });
    if (stage.foliage !== this.foliageAmount) {
      this.foliageAmount = stage.foliage;
      this.foliage.set(biquadCoefficients('lowpass', foliageNearCutoffHz(stage.foliage), BUTTERWORTH_Q, 0, this.sampleRate));
    }
    this.wetTarget = stage.reverbAmount;
    if (Number.isNaN(this.wet)) this.wet = this.wetTarget;
    this.sideTarget = stereoWidthSideGain(stage.width);
    if (Number.isNaN(this.side)) this.side = this.sideTarget;
    const room: RoomShape = { size: stage.size, foliage: stage.foliage, reflections: false };
    this.pendingRoom = roomKey(room) === this.roomKey ? null : room;
  }

  /** The whole state at this block, room requests included, to `restore` later (the render-ahead's rewind). */
  snapshot(): MusicMixSnapshot {
    return {
      eq: this.eq.map((filter) => filter.snapshot()),
      foliage: this.foliage.snapshot(),
      sideHighPass: this.sideHighPass.snapshot(),
      convolvers: [this.convolvers[0].snapshot(), this.convolvers[1].snapshot()],
      roomKey: this.roomKey,
      pendingRoom: this.pendingRoom,
      eqGainsDb: this.eqGainsDb.slice(),
      foliageAmount: this.foliageAmount,
      wet: this.wet,
      wetTarget: this.wetTarget,
      side: this.side,
      sideTarget: this.sideTarget,
    };
  }

  /** Return to a `snapshot`: process on from its block exactly as the mix did from there. */
  restore(snapshot: MusicMixSnapshot): void {
    snapshot.eq.forEach((filter, index) => this.eq[index].restore(filter));
    this.foliage.restore(snapshot.foliage);
    this.sideHighPass.restore(snapshot.sideHighPass);
    this.convolvers[0].restore(snapshot.convolvers[0]);
    this.convolvers[1].restore(snapshot.convolvers[1]);
    this.roomKey = snapshot.roomKey;
    this.pendingRoom = snapshot.pendingRoom;
    this.eqGainsDb = snapshot.eqGainsDb.slice();
    this.foliageAmount = snapshot.foliageAmount;
    this.wet = snapshot.wet;
    this.wetTarget = snapshot.wetTarget;
    this.side = snapshot.side;
    this.sideTarget = snapshot.sideTarget;
  }

  get roomPending(): boolean {
    return this.pendingRoom !== null;
  }

  /** The pending room is transformed already, so buildRoom is cheap (or no room is pending). */
  get roomPrepared(): boolean {
    return this.pendingRoom === null || this.prepared?.key === roomKey(this.pendingRoom);
  }

  /** Build and transform the pending room's response without installing it: the expensive part of buildRoom. */
  prepareRoom(): void {
    const room = this.pendingRoom;
    if (room === null || this.roomPrepared) return;
    const [left, right] = buildRoomImpulseResponse(room, this.sampleRate);
    this.prepared = { key: roomKey(room), responses: [this.convolvers[0].prepareImpulse(left), this.convolvers[1].prepareImpulse(right)] };
  }

  /** Install the pending room and crossfade it in over ROOM_CROSSFADE_SEC (at once, for the first). */
  buildRoom(): void {
    this.prepareRoom();
    const room = this.pendingRoom;
    if (room === null || this.prepared === null) return;
    this.pendingRoom = null;
    const first = this.roomKey === null;
    this.roomKey = roomKey(room);
    const [left, right] = this.prepared.responses;
    this.prepared = null;
    const fade = first ? 0 : Math.round(ROOM_CROSSFADE_SEC * this.sampleRate);
    this.convolvers[0].setImpulse(left, fade);
    this.convolvers[1].setImpulse(right, fade);
  }

  /**
   * Process one MUSIC_MIX_BLOCK of the song (`input`, left and right; a mono
   * song is given as the same samples on both) into `out` (overwritten).
   * Before the first room is built the wet path is silent.
   */
  process(input: readonly [Float32Array, Float32Array], out: [Float32Array, Float32Array]): void {
    const [left, right] = out;
    left.set(input[0]);
    right.set(input[1]);
    for (const filter of this.eq) {
      filter.process(0, left);
      filter.process(1, right);
    }
    this.foliage.process(0, left);
    this.foliage.process(1, right);

    if (this.roomKey === null) {
      this.wetLeft.fill(0);
      this.wetRight.fill(0);
    } else {
      this.convolvers[0].process(left, this.wetLeft);
      this.convolvers[1].process(right, this.wetRight);
    }
    const wetFrom = Number.isNaN(this.wet) ? this.wetTarget : this.wet;
    const wetStep = (this.wetTarget - wetFrom) / MUSIC_MIX_BLOCK;
    for (let index = 0; index < MUSIC_MIX_BLOCK; index += 1) {
      const wet = wetFrom + (wetStep * (index + 1));
      left[index] = ((1 - wet) * left[index]) + (wet * this.wetLeft[index]);
      right[index] = ((1 - wet) * right[index]) + (wet * this.wetRight[index]);
    }
    this.wet = this.wetTarget;

    // Width: the side, high-passed, added to the left and taken from the
    // right, so the mono sum is untouched at every width. The filter runs
    // at width 1 too, so its memory is current when the width moves.
    const side = this.sideBuffer;
    for (let index = 0; index < MUSIC_MIX_BLOCK; index += 1) side[index] = 0.5 * (left[index] - right[index]);
    this.sideHighPass.process(0, side);
    const sideFrom = Number.isNaN(this.side) ? this.sideTarget : this.side;
    const sideStep = (this.sideTarget - sideFrom) / MUSIC_MIX_BLOCK;
    if (sideFrom !== 0 || sideStep !== 0) {
      for (let index = 0; index < MUSIC_MIX_BLOCK; index += 1) {
        const added = (sideFrom + (sideStep * (index + 1))) * side[index];
        left[index] += added;
        right[index] -= added;
      }
    }
    this.side = this.sideTarget;
  }
}
