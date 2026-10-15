/**
 * Renders the finished soundscape ahead of playback: the generator, then
 * the mix (space, mix gain, compressor; soundscapeMix.ts), and keeps
 * RENDER_LEAD_SEC of finished stereo audio queued at the OUTPUT, so the
 * output only plays samples it already holds. ANDROID ONLY: it runs in the
 * app's native service (soundscapeSandbox.ts, SoundscapeRenderer.java) and
 * the output is Android's own (SoundscapeAudioOutput.java), so a stall or
 * pause of the WebView, heard on every switch to another app, cannot reach
 * what is already queued. Offline clips render through it too
 * (ClipRenderer.java). The desktop does not render ahead: it plays live
 * (soundscapeLivePlayback.ts), because a settings change rendered ahead has
 * to discard and re-render the lead, which a slider moved continuously turns
 * into a remote, delayed control.
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
 * report it may already be committed), rounded up to the SPLICE GRID, rewinds to F,
 * and renders from there with the new settings, crossfading linearly from
 * the old audio over CROSSFADE_SEC. The old audio for that is the
 * renderer's own: it keeps a history of what it sent. The crossfade is done
 * here, once, so every output stays a queue with nothing to compute.
 *
 * THE REWIND is exact: the generator and the mix go back to the state they
 * were in at F (a CHECKPOINT of both is taken before every chunk is
 * rendered), so from F on the soundscape is what it would have been had the
 * change been made live at F. Everything the change does not touch carries
 * on sample for sample -- turning one channel off removes that channel and
 * nothing else. They used to carry on from the state they had reached
 * rendering ahead instead, a whole lead (ten seconds) later: every slow
 * thing in the soundscape -- the weather's gusts, a noise layer's swell, a
 * thunder peal, the chimes' pattern -- jumped ten seconds at every change,
 * which turned removing one channel into a different soundscape. Since old
 * and new are the same audio wherever the change does not reach, the fade
 * is linear: equal-power would swell everything else by 3 dB halfway.
 *
 * Splices land on a grid of SPLICE_GRID_FRAMES, and a voice keeps a
 * checkpoint at every point of it it renders past: any frame a splice can
 * choose. The grid is coarser than a chunk because a checkpoint is not free
 * -- it copies the generator's running state, some thousand small objects,
 * and the lead holds a checkpoint per grid point -- and the cost of the
 * coarser grid is only that a change is heard up to one grid point later. A rewind
 * never goes back past where the output can still be reached (the margin
 * only moves forward), so a checkpoint behind it is dropped as the output
 * plays, and a checkpoint past a rewind's frame is dropped by the rewind.
 *
 * TRANSITIONS. A `transition` is a change from one soundscape to another
 * heard as one: an equal-power crossfade of any length (the mobile app's
 * schedule uses a minute, a change of soundscape half a second) from what
 * was playing to a NEW VOICE -- a fresh generator and mix built for the new
 * settings. It is spliced at the same frame a `configure` would be, so it is
 * heard as soon as a settings change is. The old side of the fade is what
 * was playing, rewound to that frame, so it is exactly what the output
 * already holds up to the end of the queue and carries on from there. When
 * the fade is over, and no rewind can reach back into it any more, the old
 * side is dropped. A transition during a transition fades from the blend
 * being heard, so nothing jumps. A `configure` during a transition goes to
 * the new voice, as the settings now in force; one waiting to start (its
 * room not built yet) takes it with no splice, being not yet heard.
 *
 * THE ROOM is the one expensive part of a change: a new space (its size,
 * damping or echoes) means building an impulse response and transforming
 * it, around a tenth of a second of work, which is longer than a splice's
 * margin. Done on the spot, it ran the output dry after every step of a
 * room slider, because the splice had just discarded everything queued
 * past the margin. So the mix only RECORDS a new room (MixStage.roomPending)
 * and this renderer builds it when it can afford to: once at least
 * ROOM_BUILD_LEAD_SEC is queued again, which is more than the build takes.
 * Then it rewinds to as near the playhead as the output allows (the request
 * is part of the mix's checkpoints, so the rewind keeps it) and builds the
 * room there, so the
 * room is heard within a few tenths of a second of being asked for, never
 * at the end of the lead. A newer room asked for before then replaces the
 * pending one, so a slider dragged across builds only the rooms it can
 * keep up with. A transition's new voice has a room of its own to build,
 * so its blend starts the same way, once that room is ready. The first
 * room is built at once: nothing is playing yet.
 */
import type { SoundscapeSpaceSettings } from './soundscape';
import { BLOCK_FRAMES, type GeneratorSnapshot, type HostedGenerator } from './soundscapeGeneratorHost';
import { MIX_BLOCK } from './soundscapeMix';

/** How much finished audio to keep queued ahead of playback. */
export const RENDER_LEAD_SEC = 10;
/** Frames per chunk: the mix's block (2048), in the generator's own blocks. */
export const RENDER_CHUNK_FRAMES = MIX_BLOCK;
/** The crossfade from old audio to new on a settings change. */
export const CROSSFADE_SEC = 0.05;
/**
 * Where a splice may land (see THE REWIND above): every second chunk, about
 * 85 ms at 48 kHz. A voice's checkpoints are taken there.
 */
export const SPLICE_GRID_FRAMES = 2 * RENDER_CHUNK_FRAMES;
/** How much must be queued before a new room is built (see THE ROOM above): more than a build takes. */
export const ROOM_BUILD_LEAD_SEC = 0.5;

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
  /** Take a space; a new room is only recorded (roomPending), to be built by buildRoom. */
  setSpace(space: SoundscapeSpaceSettings): void;
  /** A room has been asked for and not built yet. */
  readonly roomPending: boolean;
  /** Build the pending room and crossfade it in from here on: the expensive part of a change. */
  buildRoom(): void;
  /** One RENDER_CHUNK_FRAMES block of generator output into `out` (overwritten). */
  process(direct: [Float32Array, Float32Array], send: [Float32Array, Float32Array], out: [Float32Array, Float32Array]): void;
  /** The whole state at this block, room requests included (see THE REWIND above). */
  snapshot(): unknown;
  /** Return to a `snapshot`, which stays usable. */
  restore(snapshot: unknown): void;
}

/** A generator and the mix after it: one soundscape being rendered. */
export interface RenderVoice {
  generator: HostedGenerator;
  mix: MixStage;
}

type Stereo = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

/**
 * Audio by absolute frame, read a chunk at a time, in order, on the grid of
 * RENDER_CHUNK_FRAMES -- except after a `rewind`, which a read then starts from.
 */
interface AudioSource {
  /** The chunk from absolute frame `start` into `left`/`right`. */
  read(start: number, left: Float32Array, right: Float32Array): void;
  /** Go back to `frame` (on the grid): render from there as from there the first time, forgetting what came after. */
  rewind(frame: number): void;
  /** Nothing will be rewound to before `frame`. */
  forget(before: number): void;
}

/** A voice's state before one chunk at a point of the splice grid (see THE REWIND above). */
interface Checkpoint {
  generator: GeneratorSnapshot;
  mix: unknown;
}

/** A voice as a stream, with a checkpoint at every point of the splice grid it renders past, so it can be rewound there. */
class VoiceSource implements AudioSource {
  /** The frame the voice renders next; null until its first read. */
  private next: number | null = null;
  private readonly checkpoints = new Map<number, Checkpoint>();

  constructor(readonly voice: RenderVoice) {}

  read(start: number, left: Float32Array, right: Float32Array): void {
    if (this.next !== null && start !== this.next) {
      throw new Error(`A voice at frame ${this.next} was asked for frame ${start}`);
    }
    if (start % SPLICE_GRID_FRAMES === 0) {
      this.checkpoints.set(start, { generator: this.voice.generator.snapshot(), mix: this.voice.mix.snapshot() });
    }
    const [chunkLeft, chunkRight] = renderVoice(this.voice);
    left.set(chunkLeft);
    right.set(chunkRight);
    this.next = start + RENDER_CHUNK_FRAMES;
  }

  rewind(frame: number): void {
    // Not started, or not got that far: nothing to go back on.
    if (this.next === null || frame >= this.next) return;
    const checkpoint = this.checkpoints.get(frame);
    if (!checkpoint) throw new Error(`A voice has no checkpoint at frame ${frame}`);
    this.voice.generator.restore(checkpoint.generator);
    this.voice.mix.restore(checkpoint.mix);
    for (const at of this.checkpoints.keys()) if (at > frame) this.checkpoints.delete(at);
    this.next = frame;
  }

  forget(before: number): void {
    for (const at of this.checkpoints.keys()) if (at < before) this.checkpoints.delete(at);
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

  rewind(frame: number): void {
    this.from.rewind(frame);
    this.to.rewind(frame);
  }

  forget(before: number): void {
    this.from.forget(before);
    this.to.forget(before);
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
  /** A transition waiting for its voice's room (see THE ROOM above), then blended in over `frames`. */
  private pendingBlend: { voice: VoiceSource; frames: number } | null = null;
  private readonly roomLeadFrames: number;

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
    this.roomLeadFrames = Math.round(ROOM_BUILD_LEAD_SEC * sampleRate);
    const historyFrames = this.leadFrames + (2 * RENDER_CHUNK_FRAMES);
    this.historyLeft = new Float32Array(historyFrames);
    this.historyRight = new Float32Array(historyFrames);
  }

  /** Apply new settings from a frame as near to now as the output allows. */
  configure(message: ConfigureMessage): void {
    // Back to that frame first: the checkpoint restored there predates the change.
    // A transition's voice still waiting to start is not heard yet: it takes the change as it is.
    if (this.configured && this.pendingBlend === null) this.splice();
    this.voice.voice.generator.configure(message.generator);
    this.voice.voice.mix.setSpace(message.space);
    // Nothing plays yet: the first room is built now.
    if (!this.configured) this.voice.voice.mix.buildRoom();
    this.configured = true;
    this.pump();
  }

  /** The first point of the splice grid a margin past the playhead: where a change can be heard from. */
  private spliceFrame(): number {
    return Math.ceil((this.playedFrame + this.marginFrames) / SPLICE_GRID_FRAMES) * SPLICE_GRID_FRAMES;
  }

  /** Rewind to as near the playhead as the output allows, crossfading from what it holds (see THE REWIND above). */
  private splice(): void {
    const spliceAt = this.spliceFrame();
    if (spliceAt < this.writeFrame) {
      this.source.rewind(spliceAt);
      this.writeFrame = spliceAt;
      this.fade = { from: spliceAt, frames: this.crossfadeFrames };
    }
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
    // Settings from now on go to the new voice; it is heard once its room is built.
    this.voice = voice;
    this.pendingBlend = { voice, frames: Math.max(1, Math.round(seconds * this.sampleRate)) };
    this.pump();
  }

  /** Blend into the pending transition's voice from as near the playhead as the output allows. */
  private startBlend(voice: VoiceSource, frames: number): void {
    const spliceAt = this.spliceFrame();
    if (spliceAt < this.writeFrame) {
      // The old side from the splice on is what the output holds, rendered again.
      this.source.rewind(spliceAt);
      this.writeFrame = spliceAt;
      // The blend replaces a settings change's crossfade the rewind undid.
      this.fade = null;
    }
    this.source = new BlendSource(this.source, voice, this.writeFrame, frames);
  }

  /** Room work waiting (see THE ROOM above). */
  private get roomWork(): boolean {
    return this.pendingBlend !== null || this.voice.voice.mix.roomPending;
  }

  /** Build what is pending, then splice it in: the current voice's new room, or a transition's voice. */
  private doRoomWork(): void {
    const blend = this.pendingBlend;
    this.pendingBlend = null;
    if (blend) {
      blend.voice.voice.mix.buildRoom();
      this.startBlend(blend.voice, blend.frames);
      return;
    }
    // Rewound first, so the room is built into the mix as it was at the splice.
    this.splice();
    this.voice.voice.mix.buildRoom();
  }

  /** The output has played up to `frame`. */
  played(frame: number): void {
    this.playedFrame = Math.max(this.playedFrame, frame);
    const reachable = this.spliceFrame();
    // A blend no rewind can reach back into any more is its new voice alone.
    while (this.source instanceof BlendSource && this.source.done(reachable)) this.source = this.source.to;
    this.source.forget(reachable);
    this.pump();
  }

  /** Frames sent and not yet reported played. */
  get queued(): number {
    return this.writeFrame - this.playedFrame;
  }

  private pump(): void {
    if (this.scheduled || !this.configured) return;
    if (this.queued >= this.leadFrames && !this.roomWork) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      // Room work only with enough queued to cover it; rendering first otherwise.
      if (this.roomWork && this.queued >= Math.min(this.roomLeadFrames, this.leadFrames)) this.doRoomWork();
      else if (this.queued < this.leadFrames) this.renderChunk();
      this.pump();
    });
  }

  private renderChunk(): void {
    const start = this.writeFrame;
    const left = new Float32Array(RENDER_CHUNK_FRAMES);
    const right = new Float32Array(RENDER_CHUNK_FRAMES);
    this.source.read(start, left, right);

    const size = this.historyLeft.length;
    for (let index = 0; index < RENDER_CHUNK_FRAMES; index += 1) {
      const frame = start + index;
      const slot = frame % size;
      const fade = this.fade;
      if (fade && frame < fade.from + fade.frames) {
        // Linear: old and new are the same audio wherever the change does not reach (see THE REWIND above).
        const into = (frame - fade.from + 1) / fade.frames;
        left[index] = (left[index] * into) + (this.historyLeft[slot] * (1 - into));
        right[index] = (right[index] * into) + (this.historyRight[slot] * (1 - into));
      }
      this.historyLeft[slot] = left[index];
      this.historyRight[slot] = right[index];
    }
    if (this.fade && start + RENDER_CHUNK_FRAMES >= this.fade.from + this.fade.frames) this.fade = null;
    this.writeFrame += RENDER_CHUNK_FRAMES;
    this.send({ type: 'chunk', startFrame: start, left, right }, [left.buffer, right.buffer]);
  }
}
