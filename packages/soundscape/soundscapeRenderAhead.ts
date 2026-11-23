/**
 * The soundscape's render-ahead on Android: the generic engine
 * (@thockdown/audio/renderAhead.ts, which explains splices, rewinds,
 * transitions and rooms) with a SOUNDSCAPE VOICE, a hosted generator and
 * the mix after it (SoundscapeMix). The voice renders a chunk as
 * RENDER_CHUNK_FRAMES / BLOCK_FRAMES generator blocks, because the weather
 * steps once per 128-frame block and another block size is another sound,
 * then mixes the chunk in one pass. Its checkpoint is both halves' state.
 */
import {
  RenderAheadEngine,
  RENDER_CHUNK_FRAMES,
  type RenderedChunk,
  type RenderVoice,
} from '@thockdown/audio/renderAhead';
import type { SoundscapeSpaceSettings } from './soundscape';
import { BLOCK_FRAMES, type GeneratorSnapshot, type HostedGenerator } from './soundscapeGeneratorHost';

export {
  CROSSFADE_SEC,
  RENDER_CHUNK_FRAMES,
  RENDER_LEAD_SEC,
  ROOM_BUILD_LEAD_SEC,
  SPLICE_GRID_FRAMES,
  type RenderedChunk,
} from '@thockdown/audio/renderAhead';

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
  readonly roomPending: boolean;
  readonly roomPrepared: boolean;
  prepareRoom(): void;
  buildRoom(): void;
  /** One RENDER_CHUNK_FRAMES block of generator output into `out` (overwritten). */
  process(direct: [Float32Array, Float32Array], send: [Float32Array, Float32Array], out: [Float32Array, Float32Array]): void;
  snapshot(): unknown;
  restore(snapshot: unknown): void;
}

interface SoundscapeCheckpoint {
  generator: GeneratorSnapshot;
  mix: unknown;
}

/** One soundscape being rendered: a generator and the mix after it. */
export class SoundscapeVoice implements RenderVoice<ConfigureMessage> {
  // Reused for every chunk: the mix reads them and writes only `out`.
  private readonly direct: [Float32Array, Float32Array] = [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)];
  private readonly send: [Float32Array, Float32Array] = [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)];

  constructor(readonly generator: HostedGenerator, readonly mix: MixStage) {}

  configure(message: ConfigureMessage): void {
    this.generator.configure(message.generator);
    this.mix.setSpace(message.space);
  }

  get roomPending(): boolean { return this.mix.roomPending; }
  get roomPrepared(): boolean { return this.mix.roomPrepared; }
  prepareRoom(): void { this.mix.prepareRoom(); }
  buildRoom(): void { this.mix.buildRoom(); }

  render(left: Float32Array, right: Float32Array): void {
    const { direct, send } = this;
    // In the generator's own block size (see BLOCK_FRAMES), through views.
    for (let offset = 0; offset < RENDER_CHUNK_FRAMES; offset += BLOCK_FRAMES) {
      const view = (channel: Float32Array) => channel.subarray(offset, offset + BLOCK_FRAMES);
      this.generator.renderBlock({ direct: [view(direct[0]), view(direct[1])], send: [view(send[0]), view(send[1])] });
    }
    this.mix.process(direct, send, [left, right]);
  }

  snapshot(): SoundscapeCheckpoint {
    return { generator: this.generator.snapshot(), mix: this.mix.snapshot() };
  }

  restore(snapshot: unknown): void {
    const checkpoint = snapshot as SoundscapeCheckpoint;
    this.generator.restore(checkpoint.generator);
    this.mix.restore(checkpoint.mix);
  }
}

/** The engine over soundscape voices, built from a generator and its mix. */
export class RenderAhead extends RenderAheadEngine<ConfigureMessage> {
  constructor(
    generator: HostedGenerator,
    mix: MixStage,
    sampleRate: number,
    spliceMarginSec: number,
    send: (chunk: RenderedChunk, transfer: ArrayBuffer[]) => void,
    schedule: (work: () => void) => void,
    createVoice?: () => { generator: HostedGenerator; mix: MixStage },
  ) {
    super(
      new SoundscapeVoice(generator, mix),
      sampleRate,
      spliceMarginSec,
      send,
      schedule,
      createVoice && (() => {
        const voice = createVoice();
        return new SoundscapeVoice(voice.generator, voice.mix);
      }),
    );
  }
}
