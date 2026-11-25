/**
 * Renders finished audio ahead of playback, from a VOICE (RenderVoice: the
 * soundscape's generator and mix, @thockdown/soundscape/soundscapeRenderAhead.ts;
 * a song and the music's processing, to come), and keeps
 * RENDER_LEAD_SEC of finished stereo audio queued at the OUTPUT, so the
 * output only plays samples it already holds. ANDROID ONLY: it runs in the
 * app's native service (soundscapeSandbox.ts, SoundscapeRenderer.java) and
 * the output is Android's own (AudioOutput.java, OutputLane.java), so a stall or
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
 * THE REWIND is exact: the voice goes back to the state it
 * was in at F (a CHECKPOINT of it is taken before every chunk is
 * rendered), so from F on the audio is what it would have been had the
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
 * -- for the soundscape it copies the generator's running state, some
 * thousand small objects,
 * and the lead holds a checkpoint per grid point -- and the cost of the
 * coarser grid is only that a change is heard up to one grid point later. A rewind
 * never goes back past where the output can still be reached (the margin
 * only moves forward), so a checkpoint behind it is dropped as the output
 * plays, and a checkpoint past a rewind's frame is dropped by the rewind.
 *
 * TRANSITIONS. A `transition` is a change from one soundscape to another
 * heard as one: an equal-power crossfade of any length (the mobile app's
 * schedule uses a minute, a change of soundscape half a second) from what
 * was playing to a NEW VOICE built for the new
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
 * A voice may not be READY: a song's input is decoded elsewhere and handed
 * over as it is needed, so the voice can be waiting for it. Rendering then
 * stops until `poke` says more has arrived, rather than rendering silence
 * the output would play.
 *
 * THE ROOM is the one expensive part of a change: a new space (its size,
 * damping or echoes) means building an impulse response and transforming
 * it, around a tenth of a second of work, which is longer than a splice's
 * margin. Done on the spot, it ran the output dry after every step of a
 * room slider, because the splice had just discarded everything queued
 * past the margin. So a voice only RECORDS a new room (RenderVoice.roomPending)
 * and this renderer builds it when it can afford to: once at least
 * ROOM_BUILD_LEAD_SEC is queued again, which is more than the build takes.
 * The build is in two halves: preparing the response (the expensive part,
 * RenderVoice.prepareRoom) and installing it. Between them the renderer waits
 * for the output to report its playhead again, because the output played on
 * while the response was prepared, and a splice placed from the playhead
 * known before would land in audio already heard: a cut with no crossfade.
 * Then it rewinds to as near the playhead as the output allows (the request
 * is part of the voice's checkpoints, so the rewind keeps it) and builds the
 * room there, so the
 * room is heard within a few tenths of a second of being asked for, never
 * at the end of the lead. A newer room asked for before then replaces the
 * pending one, so a slider dragged across builds only the rooms it can
 * keep up with. A transition's new voice has a room of its own to build,
 * so its blend starts the same way, once that room is ready. The first
 * room is built at once: nothing is playing yet.
 */
import { BLOCK } from './partitionedConvolver';

/** How much finished audio to keep queued ahead of playback. */
export const RENDER_LEAD_SEC = 10;
/** Frames per chunk: the convolution's block (2048), which both kinds of voice process in. */
export const RENDER_CHUNK_FRAMES = BLOCK;
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

/**
 * One thing being rendered, configured with settings of type C: the
 * soundscape's generator and mix, or a song and the music's processing.
 */
export interface RenderVoice<C> {
  /** Take settings from the next chunk on; a new room is only recorded (roomPending), to be built by buildRoom. */
  configure(settings: C): void;
  /** A room has been asked for and not built yet. */
  readonly roomPending: boolean;
  /** The pending room is transformed already (or none is pending), so buildRoom is cheap. */
  readonly roomPrepared: boolean;
  /** Transform the pending room without installing it: the expensive part of a change. */
  prepareRoom(): void;
  /** Install the pending room and crossfade it in from here on (preparing it first if needed). */
  buildRoom(): void;
  /** Whether the next chunk can be rendered now (see the file's comment on READY); always, when absent. */
  readonly ready?: boolean;
  /** One RENDER_CHUNK_FRAMES chunk into `left`/`right` (overwritten). */
  render(left: Float32Array, right: Float32Array): void;
  /** The whole state at this chunk, room requests included (see THE REWIND above). */
  snapshot(): unknown;
  /** Return to a `snapshot`, which stays usable. */
  restore(snapshot: unknown): void;
}

/**
 * Audio by absolute frame, read a chunk at a time, in order, on the grid of
 * RENDER_CHUNK_FRAMES -- except after a `rewind`, which a read then starts from.
 */
interface AudioSource {
  /** The next chunk can be rendered now. */
  readonly ready: boolean;
  /** The chunk from absolute frame `start` into `left`/`right`. */
  read(start: number, left: Float32Array, right: Float32Array): void;
  /** Go back to `frame` (on the grid): render from there as from there the first time, forgetting what came after. */
  rewind(frame: number): void;
  /** Nothing will be rewound to before `frame`. */
  forget(before: number): void;
  /**
   * The next read starts at `frame` (on the grid), past where reading had
   * got: the frames between were never heard (see `played`), and the voice
   * carries on from its state as it is, with nothing to rewind to before.
   */
  resumeAt(frame: number): void;
}

/** A voice as a stream, with a checkpoint at every point of the splice grid it renders past, so it can be rewound there. */
class VoiceSource<C> implements AudioSource {
  /** The frame the voice renders next; null until its first read. */
  private next: number | null = null;
  private readonly checkpoints = new Map<number, unknown>();

  constructor(readonly voice: RenderVoice<C>) {}

  get ready(): boolean {
    return this.voice.ready ?? true;
  }

  read(start: number, left: Float32Array, right: Float32Array): void {
    if (this.next !== null && start !== this.next) {
      throw new Error(`A voice at frame ${this.next} was asked for frame ${start}`);
    }
    if (start % SPLICE_GRID_FRAMES === 0) {
      this.checkpoints.set(start, this.voice.snapshot());
    }
    this.voice.render(left, right);
    this.next = start + RENDER_CHUNK_FRAMES;
  }

  rewind(frame: number): void {
    // Not started, or not got that far: nothing to go back on.
    if (this.next === null || frame >= this.next) return;
    if (!this.checkpoints.has(frame)) throw new Error(`A voice has no checkpoint at frame ${frame}`);
    this.voice.restore(this.checkpoints.get(frame));
    for (const at of this.checkpoints.keys()) if (at > frame) this.checkpoints.delete(at);
    this.next = frame;
  }

  forget(before: number): void {
    for (const at of this.checkpoints.keys()) if (at < before) this.checkpoints.delete(at);
  }

  resumeAt(frame: number): void {
    this.checkpoints.clear();
    if (this.next !== null) this.next = frame;
  }
}

/** An equal-power crossfade from `from` to `to` over `frames` from `start`; `to` alone after it. */
class BlendSource<C> implements AudioSource {
  constructor(
    readonly from: AudioSource,
    readonly to: VoiceSource<C>,
    readonly start: number,
    readonly frames: number,
  ) {}

  get ready(): boolean {
    return this.to.ready && (this.done(this.start + this.frames) || this.from.ready);
  }

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

  resumeAt(frame: number): void {
    this.to.resumeAt(frame);
  }
}

export class RenderAheadEngine<C> {
  private readonly sampleRate: number;
  private readonly leadFrames: number;
  private readonly marginFrames: number;
  private readonly crossfadeFrames: number;
  // What has been sent, by absolute frame, for crossfading from on a splice.
  private readonly historyLeft: Float32Array;
  private readonly historyRight: Float32Array;
  private writeFrame = 0;
  /**
   * The end of the furthest chunk sent. A rewind moves `writeFrame` back
   * while the output still holds what was sent past it, so only this says
   * whether the output has played everything it was given.
   */
  private sentEnd = 0;
  private playedFrame = 0;
  private configured = false;
  private scheduled = false;
  /** A room was just prepared; nothing more until the output reports its playhead (doRoomWork). */
  private awaitingPlayhead = false;
  private fade: { from: number; frames: number } | null = null;
  /** The voice the settings in force are rendered by: a `configure` goes to it. */
  private voice: VoiceSource<C>;
  /** What is rendered: that voice, or a transition's blend into it. */
  private source: AudioSource;
  /** A transition waiting for its voice's room (see THE ROOM above), then blended in over `frames`. */
  private pendingBlend: { voice: VoiceSource<C>; frames: number } | null = null;
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
    voice: RenderVoice<C>,
    sampleRate: number,
    spliceMarginSec: number,
    private readonly send: (chunk: RenderedChunk, transfer: ArrayBuffer[]) => void,
    private readonly schedule: (work: () => void) => void,
    private readonly createVoice?: () => RenderVoice<C>,
  ) {
    this.voice = new VoiceSource(voice);
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
  configure(message: C): void {
    // Back to that frame first: the checkpoint restored there predates the change.
    // A transition's voice still waiting to start is not heard yet: it takes the change as it is.
    if (this.configured && this.pendingBlend === null) this.splice();
    this.voice.voice.configure(message);
    // Nothing plays yet: the first room is built now.
    if (!this.configured) this.voice.voice.buildRoom();
    this.configured = true;
    this.pump();
  }

  /**
   * Render again from as near the playhead as the output allows, with
   * nothing changed: the rewind reproduces the audio already sent sample for
   * sample, so this only hands it out again, for a listener that has started
   * reading the chunks (the visualizer's spectrum) and would otherwise wait a
   * whole lead for its first one.
   */
  rerender(): void {
    if (!this.configured) return
    if (this.pendingBlend === null) this.splice()
    this.pump()
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
  transition(message: C, seconds: number): void {
    if (!this.createVoice || !this.configured) {
      this.configure(message);
      return;
    }
    const voice = new VoiceSource(this.createVoice());
    voice.voice.configure(message);
    // Settings from now on go to the new voice; it is heard once its room is built.
    this.voice = voice;
    this.pendingBlend = { voice, frames: Math.max(1, Math.round(seconds * this.sampleRate)) };
    this.pump();
  }

  /**
   * Start `message` afresh, from silence: a new voice, with nothing of what
   * was rendered before carried over, heard from as near the playhead as the
   * output allows. For playing again after a pause, where the output holds
   * the soundscape from before the pause and the listener has heard silence
   * since: a `configure` would carry the old channels on and fade them out,
   * and a `transition` would crossfade from them, so the old soundscape
   * would be heard first. What the output still holds before the splice is
   * the output's to drop (it fades in from silence after a pause anyway).
   */
  restart(message: C): void {
    if (!this.createVoice || !this.configured) {
      this.configure(message);
      return;
    }
    const voice = new VoiceSource(this.createVoice());
    voice.voice.configure(message);
    // Built at once, as a first room is: nothing is being heard to cover for.
    voice.voice.buildRoom();
    this.voice = voice;
    this.source = voice;
    this.pendingBlend = null;
    this.fade = null;
    this.writeFrame = Math.min(this.writeFrame, this.spliceFrame());
    this.pump();
  }

  /** Blend into the pending transition's voice from as near the playhead as the output allows. */
  private startBlend(voice: VoiceSource<C>, frames: number): void {
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
    return this.pendingBlend !== null || this.voice.voice.roomPending;
  }

  /** Build what is pending, then splice it in: the current voice's new room, or a transition's voice. */
  private doRoomWork(): void {
    // The expensive half first, on its own: while it runs the output plays
    // on, so the playhead this renderer knows goes stale. Splicing on it
    // would land the splice in audio already heard, a cut with no crossfade.
    // So the install waits for the output to report where it is again.
    const target = (this.pendingBlend?.voice ?? this.voice).voice;
    if (!target.roomPrepared) {
      target.prepareRoom();
      this.awaitingPlayhead = true;
      return;
    }
    const blend = this.pendingBlend;
    this.pendingBlend = null;
    if (blend) {
      blend.voice.voice.buildRoom();
      this.startBlend(blend.voice, blend.frames);
      return;
    }
    // Rewound first, so the room is built into the voice as it was at the splice.
    this.splice();
    this.voice.voice.buildRoom();
  }

  /**
   * The output has played up to `frame`. If it has played past the frame
   * the next chunk would be rendered at, rendering RESUMES a margin past the
   * playhead: audio rendered for frames already gone by would only be
   * dropped, and catching up through them at a little over real time kept
   * the output silent for as long as it had been behind, divided by the
   * margin by which rendering beats real time (a song chosen while its file
   * was still opening started ten minutes later). The voice carries on from
   * where it was, so a song resumes where it stopped.
   *
   * The test is against `writeFrame`, not `sentEnd`. They differ after a
   * rewind whose new audio was not ready (a cut to a song still being
   * opened): the output then plays what it still holds past the rewind, and
   * once it has passed the rewind point every chunk rendered from there is
   * for a frame already gone. Testing `sentEnd` waited for the output to
   * run out of that old audio first and then, if the voice became ready in
   * between, never resumed at all.
   */
  played(frame: number): void {
    this.playedFrame = Math.max(this.playedFrame, frame);
    this.awaitingPlayhead = false;
    if (this.writeFrame < this.playedFrame) this.resume();
    const reachable = this.spliceFrame();
    // A blend no rewind can reach back into any more is its new voice alone.
    while (this.source instanceof BlendSource && this.source.done(reachable)) this.source = this.source.to;
    this.source.forget(reachable);
    this.pump();
  }

  private resume(): void {
    const at = this.spliceFrame();
    // A transition cut off by the gap ends there: its new voice goes on alone.
    if (this.source instanceof BlendSource) this.source = this.source.to;
    this.source.resumeAt(at);
    // Where the output still holds audio past `at` (a rewind's old side),
    // the history is that audio and the resumed stream crossfades from it;
    // past everything sent, it fades in from silence.
    if (this.sentEnd <= at) {
      this.historyLeft.fill(0);
      this.historyRight.fill(0);
    }
    this.writeFrame = at;
    this.sentEnd = Math.max(this.sentEnd, at);
    this.fade = { from: at, frames: this.crossfadeFrames };
  }

  /** The frame the next chunk is rendered at. */
  get written(): number {
    return this.writeFrame;
  }

  /** More input has arrived for a voice that was not READY: render on. */
  poke(): void {
    this.pump();
  }

  /** Frames sent and not yet reported played. */
  get queued(): number {
    return this.writeFrame - this.playedFrame;
  }

  private pump(): void {
    if (this.scheduled || this.awaitingPlayhead || !this.configured) return;
    if (this.queued >= this.leadFrames && !this.roomWork) return;
    if (!this.roomWork && !this.source.ready) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      // Room work only with enough queued to cover it; rendering first otherwise.
      if (this.roomWork && this.queued >= Math.min(this.roomLeadFrames, this.leadFrames)) this.doRoomWork();
      else if (this.queued < this.leadFrames && this.source.ready) this.renderChunk();
      else if (!this.source.ready) return;
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
    this.sentEnd = Math.max(this.sentEnd, this.writeFrame);
    this.send({ type: 'chunk', startFrame: start, left, right }, [left.buffer, right.buffer]);
  }
}
