import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUNDSCAPE_SETTINGS } from '../shared/soundscape';
import { toGeneratorConfiguration } from '../shared/soundscapeDsp';
import { generatorSource, noiseAt } from './soundscape-generator.harness';
import { BLOCK_FRAMES, createGeneratorBlock, hostGenerator, type HostedGenerator } from './soundscapeGeneratorHost';
import { RENDER_CHUNK_FRAMES, RENDER_LEAD_SEC, RenderAhead, type RenderedChunk } from './soundscapeRenderAhead';

const SAMPLE_RATE = 8000;
const LEAD_FRAMES = Math.round(RENDER_LEAD_SEC * SAMPLE_RATE);

/** A generator that counts the frames it is asked for and renders that count as its samples. */
function countingGenerator(): HostedGenerator & { configured: unknown[] } {
  let frame = 0;
  const configured: unknown[] = [];
  return {
    processor: null,
    configured,
    exports: undefined,
    configure: (message) => { configured.push(message); },
    renderBlock: (block) => {
      for (let index = 0; index < block.direct[0].length; index += 1) {
        for (const channel of [...block.direct, ...block.send]) channel[index] = frame + index;
      }
      frame += block.direct[0].length;
    },
    get frame() { return frame; },
  };
}

function setup(generator: HostedGenerator = countingGenerator()) {
  const sent: RenderedChunk[] = [];
  const tasks: Array<() => void> = [];
  const renderer = new RenderAhead(generator, SAMPLE_RATE, (chunk) => sent.push(chunk), (work) => tasks.push(work));
  /** Run scheduled work until none is left, as the worker's task queue would. */
  const drain = () => {
    let ran = 0;
    while (tasks.length > 0) {
      tasks.shift()!();
      ran += 1;
      if (ran > 10000) throw new Error('rendering never settled');
    }
  };
  return { renderer, sent, tasks, drain };
}

describe('render ahead', () => {
  it('renders nothing before the first configure', () => {
    const { tasks, sent } = setup();
    expect(tasks).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('fills the lead and then stops: the queue settles at the lead, not past it', () => {
    const { renderer, sent, tasks, drain } = setup();
    renderer.configure({ type: 'configure' });
    drain();
    const expectedChunks = Math.ceil(LEAD_FRAMES / RENDER_CHUNK_FRAMES);
    expect(sent).toHaveLength(expectedChunks);
    expect(renderer.queued).toBe(expectedChunks * RENDER_CHUNK_FRAMES);
    expect(tasks).toHaveLength(0);
  });

  it('keeps the lead topped up as playback consumes it, at every step', () => {
    const { renderer, sent, drain } = setup();
    renderer.configure({ type: 'configure' });
    drain();
    for (let step = 0; step < 50; step += 1) {
      renderer.consumed(1, RENDER_CHUNK_FRAMES);
      drain();
      expect(renderer.queued).toBeGreaterThanOrEqual(LEAD_FRAMES);
      expect(renderer.queued).toBeLessThan(LEAD_FRAMES + RENDER_CHUNK_FRAMES);
    }
    // The chunks are one continuous stream: each starts where the last ended.
    sent.forEach((chunk, index) => expect(chunk.channels[0][0]).toBe(index * RENDER_CHUNK_FRAMES));
  });

  it('starts a new generation on configure, and ignores consumption of an old one', () => {
    const { renderer, sent, drain } = setup();
    renderer.configure({ type: 'configure', n: 1 });
    drain();
    const before = sent.length;
    renderer.configure({ type: 'configure', n: 2 });
    expect(renderer.queued).toBe(0);
    drain();
    expect(sent.slice(before).every((chunk) => chunk.generation === 2)).toBe(true);
    const queued = renderer.queued;
    renderer.consumed(1, 10 * RENDER_CHUNK_FRAMES);
    expect(renderer.queued).toBe(queued);
  });

  it('applies a configure that arrives mid-fill before rendering the next chunk', () => {
    const { renderer, sent, tasks } = setup();
    renderer.configure({ type: 'configure', n: 1 });
    tasks.shift()!();
    tasks.shift()!();
    renderer.configure({ type: 'configure', n: 2 });
    tasks.shift()!();
    expect(sent.map((chunk) => chunk.generation)).toEqual([1, 1, 2]);
  });

  it('streams exactly what the generator renders directly', () => {
    // The real generator, through the renderer, against the same generator
    // rendered in one pass: render-ahead must not change a sample.
    const noise = noiseAt(SAMPLE_RATE);
    const options = { seed: 7, noiseLoops: noise.loops, noiseGains: noise.gains };
    const message = { type: 'configure', ...toGeneratorConfiguration(DEFAULT_SOUNDSCAPE_SETTINGS) };
    const streamed = hostGenerator(generatorSource, SAMPLE_RATE, options);
    const { renderer, sent, drain } = setup(streamed);
    renderer.configure(message);
    drain();
    const direct = hostGenerator(generatorSource, SAMPLE_RATE, options);
    direct.configure(message);
    const expected: number[] = [];
    for (let frame = 0; frame < sent.length * RENDER_CHUNK_FRAMES; frame += BLOCK_FRAMES) {
      const block = createGeneratorBlock(BLOCK_FRAMES);
      direct.renderBlock(block);
      expected.push(...block.direct[0]);
    }
    const joined = new Float32Array(expected.length);
    sent.forEach((chunk, index) => joined.set(chunk.channels[0], index * RENDER_CHUNK_FRAMES));
    // The default soundscape has gusts on, so this also holds the block
    // size: rendered in any other, the weather would step differently.
    expect(Array.from(joined)).toEqual(expected);
    expect(Math.max(...joined.map(Math.abs))).toBeGreaterThan(1e-3);
  });
});
