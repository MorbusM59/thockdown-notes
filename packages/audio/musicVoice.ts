/**
 * THE MUSIC as a render-ahead voice (renderAhead.ts): songs, one after
 * another as ONE CONTINUOUS STREAM at the output's rate, through the music's
 * processing (musicMix.ts). Android only, like the engine: the songs are
 * decoded natively, resampled to the output's rate (resampler.ts) and
 * appended here as they are needed.
 *
 * THE STREAM (MusicInput) is addressed by STREAM FRAME, counted from the
 * voice's start, and holds the audio from a little behind the playhead to
 * as far as the decoder has got. Each song begins at a CUE: the stream
 * frame its first sample sits at, with the song's id, so the output's
 * position can be told as a song and a time in it. One song simply follows
 * another, with no gap and nothing computed at the join.
 *
 * Rendering reads the stream in order, one chunk per call, so a stream frame
 * and an output frame differ by a constant (until the engine resumes after
 * the output ran dry, renderAhead.ts's `played`): a voice's checkpoint is its
 * READ POSITION plus the mix's state, and a rewind is exact.
 *
 * A SKIP or a SEEK is a settings change like any other (`cut: true`): the
 * engine splices it a margin past the playhead, rewinding the voice to the
 * splice, and the voice then drops the stream from its read position on.
 * The new audio, from the new song or the new place in the same song, is
 * appended from there, and the engine's crossfade (CROSSFADE_SEC) takes
 * the listener across.
 *
 * NOT READY while less than a chunk is waiting past the read position and
 * the stream has not ENDED: the engine then stops rather than render
 * silence, and resumes on `poke` once more has been appended. A stream that
 * has ended (nothing more to play) renders silence, so the room's tail and
 * a fade still reach the output.
 */
import { MusicMix, MUSIC_MIX_BLOCK, type MusicEqBand, type MusicMixSnapshot, type MusicStage } from './musicMix';
import { RENDER_CHUNK_FRAMES, type RenderVoice } from './renderAhead';

/** One song's start in the stream. */
export interface MusicCue {
  /** The stream frame its first sample sits at. */
  frame: number;
  songId: number;
  /** How far into the song that sample is (a seek starts past its beginning), in output frames. */
  offsetFrames: number;
}

/** The songs as one stream at the output's rate (see THE STREAM above). */
export class MusicInput {
  /** The stream frame `left[0]` holds. */
  private base = 0;
  private left = new Float32Array(0);
  private right = new Float32Array(0);
  /** Frames held, from `base`. */
  private length = 0;
  private readonly cues: MusicCue[] = [];
  /** Nothing more will be appended (until a cut). */
  ended = false;

  /** The stream frame after the last one appended. */
  get end(): number {
    return this.base + this.length;
  }

  /** The next audio appended is `songId`'s, from `offsetFrames` into it. */
  cue(songId: number, offsetFrames = 0): void {
    this.cues.push({ frame: this.end, songId, offsetFrames });
    this.ended = false;
  }

  append(left: Float32Array, right: Float32Array): void {
    const needed = this.length + left.length;
    if (needed > this.left.length) {
      const grown = Math.max(needed, this.left.length * 2, RENDER_CHUNK_FRAMES);
      const nextLeft = new Float32Array(grown);
      const nextRight = new Float32Array(grown);
      nextLeft.set(this.left.subarray(0, this.length));
      nextRight.set(this.right.subarray(0, this.length));
      this.left = nextLeft;
      this.right = nextRight;
    }
    this.left.set(left, this.length);
    this.right.set(right, this.length);
    this.length = needed;
  }

  /** Copy `frames` from stream frame `from` into `left`/`right`, silence where nothing is held. */
  read(from: number, left: Float32Array, right: Float32Array): void {
    for (let index = 0; index < left.length; index += 1) {
      const at = from + index - this.base;
      const inside = at >= 0 && at < this.length;
      left[index] = inside ? this.left[at] : 0;
      right[index] = inside ? this.right[at] : 0;
    }
  }

  /** Drop everything from stream frame `frame` on, cues included: what follows will be appended afresh. */
  cut(frame: number): void {
    this.length = Math.max(0, Math.min(this.length, frame - this.base));
    while (this.cues.length > 0 && this.cues[this.cues.length - 1].frame >= frame) this.cues.pop();
    this.ended = false;
  }

  /** Nothing before stream frame `frame` will be read again. */
  forget(frame: number): void {
    const drop = Math.min(this.length, frame - this.base);
    if (drop <= 0) return;
    this.left.copyWithin(0, drop, this.length);
    this.right.copyWithin(0, drop, this.length);
    this.length -= drop;
    this.base += drop;
    // Keep the cue of the song still playing at `frame`.
    while (this.cues.length > 1 && this.cues[1].frame <= frame) this.cues.shift();
  }

  /** The stream frame of the first cue after `frame`, or null. */
  nextCue(frame: number): number | null {
    for (const cue of this.cues) if (cue.frame > frame) return cue.frame;
    return null;
  }

  /** The song playing at stream frame `frame` and how far into it, or null before the first cue. */
  at(frame: number): { songId: number; offsetFrames: number } | null {
    for (let index = this.cues.length - 1; index >= 0; index -= 1) {
      const cue = this.cues[index];
      if (cue.frame <= frame) return { songId: cue.songId, offsetFrames: cue.offsetFrames + frame - cue.frame };
    }
    return null;
  }
}

/** What a configure carries: the soundstage, and whether the stream is cut at the splice (a skip or a seek). */
export interface MusicSettings {
  stage: MusicStage;
  cut?: boolean;
}

interface MusicVoiceSnapshot {
  readFrame: number;
  mix: MusicMixSnapshot;
}

export class MusicVoice implements RenderVoice<MusicSettings> {
  readonly input = new MusicInput();
  private readonly mix: MusicMix;
  /** The stream frame the next chunk is read from. */
  private readFrame = 0;
  private readonly chunk: [Float32Array, Float32Array];

  constructor(sampleRate: number, bands: readonly MusicEqBand[]) {
    if (RENDER_CHUNK_FRAMES !== MUSIC_MIX_BLOCK) throw new Error('A render chunk must be one block of the music mix');
    this.mix = new MusicMix(sampleRate, bands);
    this.chunk = [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)];
  }

  /** The stream frame the next chunk is read from. */
  get position(): number {
    return this.readFrame;
  }

  configure(settings: MusicSettings): void {
    this.mix.setStage(settings.stage);
    if (settings.cut) this.input.cut(this.readFrame);
  }

  get roomPending(): boolean { return this.mix.roomPending; }
  get roomPrepared(): boolean { return this.mix.roomPrepared; }
  prepareRoom(): void { this.mix.prepareRoom(); }
  buildRoom(): void { this.mix.buildRoom(); }

  get ready(): boolean {
    return this.input.ended || this.input.end - this.readFrame >= RENDER_CHUNK_FRAMES;
  }

  render(left: Float32Array, right: Float32Array): void {
    this.input.read(this.readFrame, this.chunk[0], this.chunk[1]);
    this.mix.process(this.chunk, [left, right]);
    this.readFrame += RENDER_CHUNK_FRAMES;
  }

  snapshot(): MusicVoiceSnapshot {
    return { readFrame: this.readFrame, mix: this.mix.snapshot() };
  }

  restore(snapshot: unknown): void {
    const checkpoint = snapshot as MusicVoiceSnapshot;
    this.readFrame = checkpoint.readFrame;
    this.mix.restore(checkpoint.mix);
  }
}
