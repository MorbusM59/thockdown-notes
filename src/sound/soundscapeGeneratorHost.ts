/**
 * Runs the soundscape generator (src/sound/soundscape-generator.js) outside an
 * AudioWorklet: in the render-ahead worker (soundscapeRender.worker.ts) and
 * in the test harness (soundscape-generator.harness.ts).
 *
 * The generator is written as an AudioWorkletProcessor and reads four names
 * an AudioWorkletGlobalScope provides: the `AudioWorkletProcessor` base
 * class, `registerProcessor`, `sampleRate`, and `currentFrame` (the number of
 * frames rendered so far, which it schedules events against). Its source is
 * evaluated here inside a function that defines those four itself, so the
 * same file runs unchanged wherever it is hosted; `currentFrame` advances by
 * each block this host renders.
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
  /** The value of `exportsExpression`, evaluated in the generator's scope. */
  readonly exports: unknown;
}

interface Evaluated {
  Processor: new (options: unknown) => {
    port: { onmessage: ((event: { data: unknown }) => void) | null };
    process(inputs: unknown[], outputs: Float32Array[][]): boolean;
  };
  advance(frames: number): void;
  frame(): number;
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
      exports: (${exportsExpression}),
    };
  `) as (sampleRate: number) => Evaluated;
  const scope = evaluate(sampleRate);
  const processor = new scope.Processor({ processorOptions: options });
  return {
    processor,
    configure(message) {
      processor.port.onmessage?.({ data: message });
    },
    renderBlock(block) {
      processor.process([], [block.direct, block.send]);
      scope.advance(block.direct[0].length);
    },
    get frame() {
      return scope.frame();
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
