/**
 * Renders a soundscape ahead of playback, so the audio thread only has to
 * copy finished samples (see soundscape-player.js) and a CPU stall from
 * another app has seconds of finished audio to play through rather than one
 * output buffer.
 *
 * Runs in a dedicated worker (soundscapeRender.worker.ts), off the audio
 * thread and off the main thread. It renders RENDER_CHUNK_FRAMES at a time
 * and sends each chunk straight to the player, until RENDER_LEAD_SEC of
 * audio is queued there and not yet played. The player reports what it has
 * played (`consumed`), and each report lets rendering continue: nothing here
 * runs on a timer, so nothing depends on how a platform throttles timers in
 * a background app.
 *
 * GENERATIONS. Audio rendered ahead was rendered with the settings of the
 * moment, so a `configure` starts a new generation: the count of queued
 * frames starts again from zero, rendering restarts at once with the new
 * settings, and every chunk carries its generation so the player can
 * crossfade from the old audio to the new and discard the rest of the old.
 * A slider is therefore heard within one chunk plus the crossfade, not after
 * the lead; the cost is that the lead rebuilds from zero after each change.
 * Consumption reported for an older generation is ignored.
 *
 * The generator itself is not reset: it continues from the state it reached
 * rendering ahead. For sounds made of noise and random events that is a
 * different continuation of the same soundscape, and the crossfade hides
 * the seam.
 */
import { BLOCK_FRAMES, type HostedGenerator } from './soundscapeGeneratorHost';

/** How much finished audio to keep queued ahead of playback. */
export const RENDER_LEAD_SEC = 10;
/**
 * Frames per chunk. Small enough that the first chunk after a change is
 * ready within a few milliseconds of work, large enough that the message
 * rate stays low (about 23 a second at 48 kHz).
 */
export const RENDER_CHUNK_FRAMES = 16 * BLOCK_FRAMES;

/**
 * A chunk of rendered audio: direct left, direct right, send left, send
 * right, each RENDER_CHUNK_FRAMES long.
 */
export interface RenderedChunk {
  type: 'chunk';
  generation: number;
  channels: [Float32Array, Float32Array, Float32Array, Float32Array];
}

export class RenderAhead {
  private generation = 0;
  private queuedFrames = 0;
  private configured = false;
  private scheduled = false;
  private readonly leadFrames: number;

  /**
   * @param send delivers a chunk to the player, transferring its buffers.
   * @param schedule runs `work` as a separate task, after any messages that
   *   are already waiting, so a `configure` arriving mid-render is applied
   *   before the next chunk rather than after the whole lead.
   */
  constructor(
    private readonly generator: HostedGenerator,
    sampleRate: number,
    private readonly send: (chunk: RenderedChunk, transfer: ArrayBuffer[]) => void,
    private readonly schedule: (work: () => void) => void,
  ) {
    this.leadFrames = Math.round(RENDER_LEAD_SEC * sampleRate);
  }

  /** Apply new settings and start a new generation from them. */
  configure(message: unknown): void {
    this.generator.configure(message);
    this.generation += 1;
    this.queuedFrames = 0;
    this.configured = true;
    this.pump();
  }

  /** The player has played `frames` of `generation`. */
  consumed(generation: number, frames: number): void {
    if (generation !== this.generation) return;
    this.queuedFrames = Math.max(0, this.queuedFrames - frames);
    this.pump();
  }

  /** Frames queued at the player and not yet played, for the current generation. */
  get queued(): number {
    return this.queuedFrames;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  private pump(): void {
    if (this.scheduled || !this.configured || this.queuedFrames >= this.leadFrames) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      this.renderChunk();
      this.pump();
    });
  }

  private renderChunk(): void {
    if (this.queuedFrames >= this.leadFrames) return;
    const channels: RenderedChunk['channels'] = [
      new Float32Array(RENDER_CHUNK_FRAMES),
      new Float32Array(RENDER_CHUNK_FRAMES),
      new Float32Array(RENDER_CHUNK_FRAMES),
      new Float32Array(RENDER_CHUNK_FRAMES),
    ];
    // In the worklet's block size (see BLOCK_FRAMES), written straight into
    // the chunk through views.
    for (let offset = 0; offset < RENDER_CHUNK_FRAMES; offset += BLOCK_FRAMES) {
      const view = (channel: Float32Array) => channel.subarray(offset, offset + BLOCK_FRAMES);
      this.generator.renderBlock({
        direct: [view(channels[0]), view(channels[1])],
        send: [view(channels[2]), view(channels[3])],
      });
    }
    this.queuedFrames += RENDER_CHUNK_FRAMES;
    this.send(
      { type: 'chunk', generation: this.generation, channels },
      channels.map((channel) => channel.buffer as ArrayBuffer),
    );
  }
}
