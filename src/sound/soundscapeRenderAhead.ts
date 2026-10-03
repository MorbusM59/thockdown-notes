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
 *
 * TRANSITIONS. A `transition` is a change from one soundscape to another
 * heard as one: an equal-power crossfade of any length (the mobile app's
 * schedule uses a minute, a change of soundscape half a second) from what
 * was playing to a NEW VOICE -- a fresh generator and mix built for the new
 * settings. It is spliced at the same frame a `configure` would be, so it is
 * heard as soon as a settings change is. The old side of the fade is what
 * the output already holds from that frame on, taken from the history (a
 * snapshot, since the history is overwritten as rendering continues), and
 * past the end of it the old voice CARRYING ON from where it had rendered
 * to -- it cannot be rewound, and need not be: its continuation is the
 * same sound. When the fade is over the old side is dropped. A transition
 * during a transition fades from the blend being heard, so nothing jumps.
 * A `configure` during a transition goes to the new voice, as the settings
 * now in force.
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

/** A generator and the mix after it: one soundscape being rendered. */
export interface RenderVoice {
  generator: HostedGenerator;
  mix: MixStage;
}

type Stereo = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

/** Audio by absolute frame: fills `left`/`right` with the frames from `start` on. */
interface AudioSource {
  read(start: number, left: Float32Array, right: Float32Array): void;
}

/**
 * A voice as a stream: it renders in whole chunks, carries on from where it
 * got to whatever frame is asked for (the generator is never rewound), and
 * keeps what a partial read left over.
 */
class VoiceSource implements AudioSource {
  private spareLeft = new Float32Array(0);
  private spareRight = new Float32Array(0);
  private spareAt = 0;

  constructor(readonly voice: RenderVoice) {}

  read(_start: number, left: Float32Array, right: Float32Array): void {
    let filled = 0;
    while (filled < left.length) {
      if (this.spareAt >= this.spareLeft.length) {
        [this.spareLeft, this.spareRight] = renderVoice(this.voice);
        this.spareAt = 0;
      }
      const take = Math.min(left.length - filled, this.spareLeft.length - this.spareAt);
      left.set(this.spareLeft.subarray(this.spareAt, this.spareAt + take), filled);
      right.set(this.spareRight.subarray(this.spareAt, this.spareAt + take), filled);
      this.spareAt += take;
      filled += take;
    }
  }
}

/** What the output already holds from `from` to `end`, then `rest` carrying on. */
class HeldSource implements AudioSource {
  constructor(
    private readonly left: Float32Array,
    private readonly right: Float32Array,
    private readonly from: number,
    private readonly rest: AudioSource,
  ) {}

  read(start: number, left: Float32Array, right: Float32Array): void {
    const end = this.from + this.left.length;
    const held = Math.max(0, Math.min(left.length, end - start));
    for (let index = 0; index < held; index += 1) {
      left[index] = this.left[start + index - this.from];
      right[index] = this.right[start + index - this.from];
    }
    if (held < left.length) this.rest.read(start + held, left.subarray(held), right.subarray(held));
  }
}

/** An equal-power crossfade from `from` to `to` over `frames` from `start`; `to` alone after it. */
class BlendSource implements AudioSource {
  constructor(
    readonly from: AudioSource,
    readonly to: VoiceSource,
    readonly start: number,
    readonly frames: number,
  ) {}

  done(frame: number): boolean {
    return frame >= this.start + this.frames;
  }

  read(start: number, left: Float32Array, right: Float32Array): void {
    this.to.read(start, left, right);
    if (this.done(start)) return;
    const oldLeft = new Float32Array(left.length);
    const oldRight = new Float32Array(right.length);
    this.from.read(start, oldLeft, oldRight);
    for (let index = 0; index < left.length; index += 1) {
      // Equal-power: the two soundscapes are uncorrelated.
      const t = Math.min(1, Math.max(0, (start + index - this.start + 1) / this.frames));
      const into = Math.sin(t * Math.PI * 0.5);
      const out = Math.cos(t * Math.PI * 0.5);
      left[index] = (left[index] * into) + (oldLeft[index] * out);
      right[index] = (right[index] * into) + (oldRight[index] * out);
    }
  }
}

/** One chunk of `voice`'s finished audio. */
function renderVoice(voice: RenderVoice): Stereo {
  const direct: [Float32Array, Float32Array] = [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)];
  const send: [Float32Array, Float32Array] = [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)];
  // In the generator's own block size (see BLOCK_FRAMES), through views.
  for (let offset = 0; offset < RENDER_CHUNK_FRAMES; offset += BLOCK_FRAMES) {
    const view = (channel: Float32Array) => channel.subarray(offset, offset + BLOCK_FRAMES);
    voice.generator.renderBlock({ direct: [view(direct[0]), view(direct[1])], send: [view(send[0]), view(send[1])] });
  }
  const out: Stereo = [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)];
  voice.mix.process(direct, send, out);
  return out;
}

export class RenderAhead {
  private readonly sampleRate: number;
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
  /** The voice the settings in force are rendered by: a `configure` goes to it. */
  private voice: VoiceSource;
  /** What is rendered: that voice, or a transition's blend into it. */
  private source: AudioSource;

  /**
   * @param spliceMarginSec how far past its last `played` report the
   *   output may already have committed audio it can no longer replace.
   * @param send delivers a chunk to the output, transferring its buffers.
   * @param schedule runs `work` as a separate task, after any messages that
   *   are already waiting, so a `configure` arriving mid-fill is applied
   *   before the next chunk rather than after the whole lead.
   * @param createVoice builds a fresh voice for a `transition`; without it
   *   a transition is an ordinary `configure`.
   */
  constructor(
    generator: HostedGenerator,
    mix: MixStage,
    sampleRate: number,
    spliceMarginSec: number,
    private readonly send: (chunk: RenderedChunk, transfer: ArrayBuffer[]) => void,
    private readonly schedule: (work: () => void) => void,
    private readonly createVoice?: () => RenderVoice,
  ) {
    this.voice = new VoiceSource({ generator, mix });
    this.source = this.voice;
    this.sampleRate = sampleRate;
    this.leadFrames = Math.round(RENDER_LEAD_SEC * sampleRate);
    this.marginFrames = Math.round(spliceMarginSec * sampleRate);
    this.crossfadeFrames = Math.max(1, Math.round(CROSSFADE_SEC * sampleRate));
    const historyFrames = this.leadFrames + (2 * RENDER_CHUNK_FRAMES);
    this.historyLeft = new Float32Array(historyFrames);
    this.historyRight = new Float32Array(historyFrames);
  }

  /** Apply new settings from a frame as near to now as the output allows. */
  configure(message: ConfigureMessage): void {
    this.voice.voice.generator.configure(message.generator);
    this.voice.voice.mix.setSpace(message.space);
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

  /**
   * Change to `message` over `seconds`, as a crossfade from the soundscape
   * playing to a new voice (see TRANSITIONS above). A transition already
   * under way is completed at once, its new voice becoming the old one.
   */
  transition(message: ConfigureMessage, seconds: number): void {
    if (!this.createVoice || !this.configured) {
      this.configure(message);
      return;
    }
    const voice = new VoiceSource(this.createVoice());
    voice.voice.generator.configure(message.generator);
    voice.voice.mix.setSpace(message.space);
    const spliceAt = this.playedFrame + this.marginFrames;
    let from = this.source;
    if (spliceAt < this.writeFrame) {
      // What the output holds from the splice on, copied: the history is
      // overwritten as rendering continues.
      const size = this.historyLeft.length;
      const heldLeft = new Float32Array(this.writeFrame - spliceAt);
      const heldRight = new Float32Array(heldLeft.length);
      for (let index = 0; index < heldLeft.length; index += 1) {
        const slot = (spliceAt + index) % size;
        heldLeft[index] = this.historyLeft[slot];
        heldRight[index] = this.historyRight[slot];
      }
      from = new HeldSource(heldLeft, heldRight, spliceAt, this.source);
      this.writeFrame = spliceAt;
      // The blend replaces a settings change's splice still under way.
      this.fade = null;
    }
    const start = Math.max(spliceAt, this.writeFrame);
    this.source = new BlendSource(from, voice, start, Math.max(1, Math.round(seconds * this.sampleRate)));
    this.voice = voice;
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
    const start = this.writeFrame;
    const left = new Float32Array(RENDER_CHUNK_FRAMES);
    const right = new Float32Array(RENDER_CHUNK_FRAMES);
    this.source.read(start, left, right);
    // A blend that is over is the new voice alone; the old side is dropped.
    if (this.source instanceof BlendSource && this.source.done(start + RENDER_CHUNK_FRAMES)) this.source = this.source.to;

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
