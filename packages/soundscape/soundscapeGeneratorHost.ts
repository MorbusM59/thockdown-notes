/**
 * Runs the soundscape generator (packages/soundscape/soundscape-generator.js) outside an
 * AudioWorklet: in Android's render-ahead renderer (soundscapeSandbox.ts,
 * soundscapeRenderAhead.ts) and in the test harness
 * (soundscape-generator.harness.ts). The desktop runs it in a real
 * AudioWorklet (soundscapeLivePlayback.ts).
 *
 * The generator is written as an AudioWorkletProcessor and reads four names
 * an AudioWorkletGlobalScope provides: the `AudioWorkletProcessor` base
 * class, `registerProcessor`, `sampleRate`, and `currentFrame` (the number of
 * frames rendered so far, which it schedules events against). Its source is
 * evaluated here inside a function that defines those four itself, so the
 * same file runs unchanged wherever it is hosted; `currentFrame` advances by
 * each block this host renders.
 *
 * Hosted, the generator is REWINDABLE: `snapshot` copies its whole state and
 * `restore` returns to it, which is what lets the render-ahead apply a
 * settings change from a frame it has already rendered past
 * (soundscapeRenderAhead.ts, THE REWIND). What nothing writes again is
 * shared rather than copied: the noise loops, every configuration (frozen
 * on its way in), and every recording (the generator stops recycling them
 * when hosted -- see its header).
 *
 * Render in blocks of BLOCK_FRAMES, the render quantum an AudioWorklet uses,
 * to get the sound the generator was tuned in. Its layers render the same
 * samples whatever the block length (soundscape-generator.test.ts asserts
 * that, with gusts off), but the weather -- the gust every layer follows --
 * steps once per block (advanceWeather), so with gusts on a longer block is a
 * coarser gust.
 */

export const BLOCK_FRAMES = 128;

export interface GeneratorOptions {
  seed: number;
  noiseLoops: unknown;
  noiseGains: unknown;
}

/**
 * One block's output, all four channels the same length: the direct sound
 * and the reverb send, each stereo. Overwritten by renderBlock.
 */
export interface GeneratorBlock {
  direct: [Float32Array, Float32Array];
  send: [Float32Array, Float32Array];
}

export interface HostedGenerator {
  /** The processor itself, for tests that observe its state. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly processor: any;
  /** Apply a `configure` message, as the engine builds it (toGeneratorConfiguration). */
  configure(message: unknown): void;
  /** Render the next block's frames into `block` and advance `frame` by its length. */
  renderBlock(block: GeneratorBlock): void;
  /** Frames rendered so far: the generator's `currentFrame`. */
  readonly frame: number;
  /**
   * The generator's whole state at this frame, frame included, to `restore`
   * later: what lets the render-ahead apply a settings change from a frame
   * it has already rendered past (soundscapeRenderAhead.ts). Unaffected by
   * anything rendered after it, and may be restored more than once.
   */
  snapshot(): GeneratorSnapshot;
  /** Return to a `snapshot`: render on from its frame exactly as the generator did from there. */
  restore(snapshot: GeneratorSnapshot): void;
  /** The value of `exportsExpression`, evaluated in the generator's scope. */
  readonly exports: unknown;
}

/** A HostedGenerator's state at one frame; opaque outside this module. */
export interface GeneratorSnapshot {
  readonly frame: number;
  readonly state: Record<string, unknown>;
}

/**
 * The processor's own properties a snapshot leaves out: its port (it holds
 * the message handler, bound to this processor), and what is never written
 * after construction and so can be shared rather than copied -- the noise
 * loops, their gains, and the set of recordings that copies share.
 */
const UNCOPIED_PROPERTIES = new Set(['port', 'noiseLoops', 'noiseGains', 'recordedBuffers']);

/** Whether a typed array's buffer is never written again, and so is shared by every copy rather than copied. */
type SharedBuffers = (buffer: ArrayBufferLike) => boolean;

/**
 * A copy of `value`'s graph: plain objects, arrays and typed arrays, with
 * every object that was reached twice copied once and reached twice (a
 * channel's `stream` is also the processor's while it renders; a recording's
 * `samples` is a view of its `buffer`). Not copied, because nothing writes
 * them: a FROZEN object (a configuration, see `immutableConfiguration`), and
 * a typed array whose buffer `shared` names. Anything else -- a function, a
 * Map, a class instance -- throws: the generator's state is plain data, and
 * a copy that silently shared something else would let two timelines write
 * into one object.
 */
function copyGraph(value: unknown, copies: Map<object, unknown>, shared: SharedBuffers): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') throw new Error('A generator snapshot cannot copy a function');
    return value;
  }
  const known = copies.get(value);
  if (known !== undefined) return known;
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) throw new Error('A generator snapshot cannot copy a DataView');
    const view = value as unknown as { buffer: ArrayBufferLike; byteOffset: number; length: number; constructor: new (buffer: ArrayBufferLike, offset: number, length: number) => unknown };
    if (shared(view.buffer)) return value;
    let buffer = copies.get(view.buffer) as ArrayBufferLike | undefined;
    if (!buffer) {
      buffer = view.buffer.slice(0);
      copies.set(view.buffer, buffer);
    }
    const copy = new view.constructor(buffer, view.byteOffset, view.length);
    copies.set(value, copy);
    return copy;
  }
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    const copy: unknown[] = new Array(value.length);
    copies.set(value, copy);
    for (let index = 0; index < value.length; index += 1) copy[index] = copyGraph(value[index], copies, shared);
    return copy;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`A generator snapshot cannot copy a ${(value as object).constructor?.name ?? 'class instance'}`);
  }
  const copy: Record<string, unknown> = Object.create(prototype);
  copies.set(value, copy);
  for (const key of Object.keys(value)) copy[key] = copyGraph((value as Record<string, unknown>)[key], copies, shared);
  return copy;
}

/**
 * A configure message as the generator is given it: a copy, frozen all the
 * way down, its typed arrays (a noise layer's cycle and tone table) added to
 * `tables`. The generator keeps references into it -- a channel's space
 * table, its cycle -- and never writes them, so every snapshot can share
 * them; frozen, a write would throw (the generator is a class, so strict)
 * rather than quietly change what an earlier snapshot holds.
 */
function immutableConfiguration(value: unknown, tables: WeakSet<ArrayBufferLike>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) {
    const copy = (value as unknown as { slice(): ArrayBufferView }).slice();
    tables.add(copy.buffer);
    return copy;
  }
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  for (const key of Object.keys(value)) (copy as Record<string, unknown>)[key] = immutableConfiguration((value as Record<string, unknown>)[key], tables);
  return Object.freeze(copy);
}

interface Evaluated {
  Processor: new (options: unknown) => {
    port: { onmessage: ((event: { data: unknown }) => void) | null };
    process(inputs: unknown[], outputs: Float32Array[][]): boolean;
  };
  advance(frames: number): void;
  frame(): number;
  setFrame(frame: number): void;
  exports: unknown;
}

/**
 * Evaluate `source` (the generator's text) and construct its processor.
 * `exportsExpression`, when given, is evaluated after the source in the
 * same scope, so a test can read the generator's own constants.
 */
export function hostGenerator(
  source: string,
  sampleRate: number,
  options: GeneratorOptions,
  exportsExpression = 'undefined',
): HostedGenerator {
  const evaluate = new Function('__sampleRate', `
    const sampleRate = __sampleRate;
    let currentFrame = 0;
    class AudioWorkletProcessor {
      constructor() { this.port = { onmessage: null, postMessage() {} }; }
    }
    let __processor = null;
    const registerProcessor = (_name, processor) => { __processor = processor; };
    ${source}
    ;return {
      Processor: __processor,
      advance(frames) { currentFrame += frames; },
      frame() { return currentFrame; },
      setFrame(frame) { currentFrame = frame; },
      exports: (${exportsExpression}),
    };
  `) as (sampleRate: number) => Evaluated;
  const scope = evaluate(sampleRate);
  // Rewindable: its recordings are never recycled, so snapshots can share them.
  const processor = new scope.Processor({ processorOptions: { ...options, rewindable: true } }) as unknown as Record<string, unknown> & {
    port: { onmessage: ((event: { data: unknown }) => void) | null };
    process(inputs: unknown[], outputs: Float32Array[][]): boolean;
    recordedBuffers: WeakSet<ArrayBufferLike> | null;
  };
  const tables = new WeakSet<ArrayBufferLike>();
  const shared: SharedBuffers = (buffer) => tables.has(buffer) || (processor.recordedBuffers?.has(buffer) ?? false);
  const ownState = (): Record<string, unknown> => {
    const state: Record<string, unknown> = {};
    for (const key of Object.keys(processor)) if (!UNCOPIED_PROPERTIES.has(key)) state[key] = processor[key];
    return state;
  };
  return {
    processor,
    configure(message) {
      processor.port.onmessage?.({ data: immutableConfiguration(message, tables) });
    },
    renderBlock(block) {
      processor.process([], [block.direct, block.send]);
      scope.advance(block.direct[0].length);
    },
    get frame() {
      return scope.frame();
    },
    snapshot() {
      return { frame: scope.frame(), state: copyGraph(ownState(), new Map(), shared) as Record<string, unknown> };
    },
    restore(snapshot) {
      for (const key of Object.keys(ownState())) delete processor[key];
      Object.assign(processor, copyGraph(snapshot.state, new Map(), shared));
      scope.setFrame(snapshot.frame);
    },
    exports: scope.exports,
  };
}

export function createGeneratorBlock(frames: number): GeneratorBlock {
  return {
    direct: [new Float32Array(frames), new Float32Array(frames)],
    send: [new Float32Array(frames), new Float32Array(frames)],
  };
}
