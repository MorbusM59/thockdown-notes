/**
 * Renders the finished soundscape ahead of playback: the generator, then
 * the mix (space, mix gain, compressor; soundscapeMix.ts). Runs in a
 * dedicated worker (soundscapeRender.worker.ts) and keeps RENDER_LEAD_SEC
 * of finished stereo audio queued at the OUTPUT, so the output only plays
 * samples it already holds.
 *
 * The output is a plain queue of frames at absolute positions: the player
 * worklet on desktop (public/soundscape-player.js), Android's own audio
 * output on mobile (BackgroundAudioPlugin.java). On Android that is what
 * matters: the queue lives in the app's native process, outside the
 * WebView, so a stall or pause of the WebView's audio (heard on every
 * switch to another app) cannot reach what is already queued.
 *
 * PROTOCOL, over one MessagePort:
 * - to the output: `{ type: 'chunk', startFrame, left, right }`. A chunk
 *   whose startFrame lies before the end of what the output holds REPLACES
 *   everything from that frame on (see "Settings changes").
 * - from the output: `{ type: 'played', frame }`, the absolute position it
 *   has played (or committed to the device) up to. Rendering continues only
 *   on these reports, never on a timer, so nothing depends on how a
 *   platform throttles timers in a background app.
 *
 * SETTINGS CHANGES. Audio rendered ahead was rendered with the old
 * settings. A `configure` therefore picks a frame F a margin past what the
 * output has played (the margin is the output's: how far ahead of its
 * report it may already be committed), rewinds to F, and renders from there
 * with the new settings, crossfading equal-power from the old audio over
 * CROSSFADE_SEC. The old audio for that is the worker's own: it keeps a
 * history of what it sent. The crossfade is done here, once, so every
 * output stays a queue with nothing to compute.
 *
 * The generator and the mix are not rewound: they continue from the state
 * they reached rendering ahead. For sounds made of noise and random events
 * that is a different continuation of the same soundscape, and the
 * crossfade hides the seam.
 */
import type { SoundscapeSpaceSettings } from '../shared/soundscape';
import { BLOCK_FRAMES, type HostedGenerator } from './soundscapeGeneratorHost';
import { MIX_BLOCK } from './soundscapeMix';

/** How much finished audio to keep queued ahead of playback. */
export const RENDER_LEAD_SEC = 10;
/** Frames per chunk: the mix's block (2048), in the generator's own blocks. */
export const RENDER_CHUNK_FRAMES = MIX_BLOCK;
/** The crossfade from old audio to new on a settings change. */
export const CROSSFADE_SEC = 0.05;

export interface RenderedChunk {
  type: 'chunk';
  startFrame: number;
  left: Float32Array;
  right: Float32Array;
}

export interface ConfigureMessage {
  type: 'configure';
  /** For the generator, as built by toGeneratorConfiguration. */
  generator: unknown;
  space: SoundscapeSpaceSettings;
}

/** What follows the generator: SoundscapeMix, or a stand-in in tests. */
export interface MixStage {
  setSpace(space: SoundscapeSpaceSettings): void;
  /** One RENDER_CHUNK_FRAMES block of generator output into `out` (overwritten). */
  process(direct: [Float32Array, Float32Array], send: [Float32Array, Float32Array], out: [Float32Array, Float32Array]): void;
}

export class RenderAhead {
  private readonly leadFrames: number;
  private readonly marginFrames: number;
  private readonly crossfadeFrames: number;
  // What has been sent, by absolute frame, for crossfading from on a splice.
  private readonly historyLeft: Float32Array;
  private readonly historyRight: Float32Array;
  private writeFrame = 0;
  private playedFrame = 0;
  private configured = false;
  private scheduled = false;
  private fade: { from: number; frames: number } | null = null;

  /**
   * @param spliceMarginSec how far past its last `played` report the
   *   output may already have committed audio it can no longer replace.
   * @param send delivers a chunk to the output, transferring its buffers.
   * @param schedule runs `work` as a separate task, after any messages that
   *   are already waiting, so a `configure` arriving mid-fill is applied
   *   before the next chunk rather than after the whole lead.
   */
  constructor(
    private readonly generator: HostedGenerator,
    private readonly mix: MixStage,
    sampleRate: number,
    spliceMarginSec: number,
    private readonly send: (chunk: RenderedChunk, transfer: ArrayBuffer[]) => void,
    private readonly schedule: (work: () => void) => void,
  ) {
    this.leadFrames = Math.round(RENDER_LEAD_SEC * sampleRate);
    this.marginFrames = Math.round(spliceMarginSec * sampleRate);
    this.crossfadeFrames = Math.max(1, Math.round(CROSSFADE_SEC * sampleRate));
    const historyFrames = this.leadFrames + (2 * RENDER_CHUNK_FRAMES);
    this.historyLeft = new Float32Array(historyFrames);
    this.historyRight = new Float32Array(historyFrames);
  }

  /** Apply new settings from a frame as near to now as the output allows. */
  configure(message: ConfigureMessage): void {
    this.generator.configure(message.generator);
    this.mix.setSpace(message.space);
    if (this.configured) {
      const spliceAt = this.playedFrame + this.marginFrames;
      if (spliceAt < this.writeFrame) {
        this.writeFrame = spliceAt;
        this.fade = { from: spliceAt, frames: this.crossfadeFrames };
      }
    }
    this.configured = true;
    this.pump();
  }

  /** The output has played up to `frame`. */
  played(frame: number): void {
    this.playedFrame = Math.max(this.playedFrame, frame);
    this.pump();
  }

  /** Frames sent and not yet reported played. */
  get queued(): number {
    return this.writeFrame - this.playedFrame;
  }

  private pump(): void {
    if (this.scheduled || !this.configured || this.queued >= this.leadFrames) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      if (this.queued < this.leadFrames) this.renderChunk();
      this.pump();
    });
  }

  private renderChunk(): void {
    const direct: [Float32Array, Float32Array] = [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)];
    const send: [Float32Array, Float32Array] = [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)];
    // In the generator's own block size (see BLOCK_FRAMES), through views.
    for (let offset = 0; offset < RENDER_CHUNK_FRAMES; offset += BLOCK_FRAMES) {
      const view = (channel: Float32Array) => channel.subarray(offset, offset + BLOCK_FRAMES);
      this.generator.renderBlock({ direct: [view(direct[0]), view(direct[1])], send: [view(send[0]), view(send[1])] });
    }
    const left = new Float32Array(RENDER_CHUNK_FRAMES);
    const right = new Float32Array(RENDER_CHUNK_FRAMES);
    this.mix.process(direct, send, [left, right]);

    const start = this.writeFrame;
    const size = this.historyLeft.length;
    for (let index = 0; index < RENDER_CHUNK_FRAMES; index += 1) {
      const frame = start + index;
      const slot = frame % size;
      const fade = this.fade;
      if (fade && frame < fade.from + fade.frames) {
        // Equal-power: old and new are uncorrelated, so their powers add.
        const t = (frame - fade.from + 1) / fade.frames;
        const into = Math.sin(t * Math.PI * 0.5);
        const out = Math.cos(t * Math.PI * 0.5);
        left[index] = (left[index] * into) + (this.historyLeft[slot] * out);
        right[index] = (right[index] * into) + (this.historyRight[slot] * out);
      }
      this.historyLeft[slot] = left[index];
      this.historyRight[slot] = right[index];
    }
    if (this.fade && start + RENDER_CHUNK_FRAMES >= this.fade.from + this.fade.frames) this.fade = null;
    this.writeFrame += RENDER_CHUNK_FRAMES;
    this.send({ type: 'chunk', startFrame: start, left, right }, [left.buffer, right.buffer]);
  }
}
