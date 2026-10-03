import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUNDSCAPE_SETTINGS } from '../shared/soundscape';
import { toGeneratorConfiguration } from '../shared/soundscapeDsp';
import { generatorSource, noiseAt } from './soundscape-generator.harness';
import { hostGenerator, type HostedGenerator } from './soundscapeGeneratorHost';
import { SoundscapeMix } from './soundscapeMix';
import {
  CROSSFADE_SEC,
  RENDER_CHUNK_FRAMES,
  RENDER_LEAD_SEC,
  RenderAhead,
  type ConfigureMessage,
  type MixStage,
  type RenderedChunk,
} from './soundscapeRenderAhead';

const SAMPLE_RATE = 8000;
const LEAD_FRAMES = Math.round(RENDER_LEAD_SEC * SAMPLE_RATE);
const MARGIN_SEC = 0.25;
const MARGIN_FRAMES = Math.round(MARGIN_SEC * SAMPLE_RATE);
const FADE_FRAMES = Math.round(CROSSFADE_SEC * SAMPLE_RATE);
const CONFIGURE: ConfigureMessage = { type: 'configure', generator: {}, space: DEFAULT_SOUNDSCAPE_SETTINGS.space };

/** A generator whose every sample is its own frame count, so its output says when it was rendered. */
function countingGenerator(): HostedGenerator {
  let frame = 0;
  return {
    processor: null,
    exports: undefined,
    configure: () => {},
    renderBlock: (block) => {
      for (let index = 0; index < block.direct[0].length; index += 1) {
        for (const channel of [...block.direct, ...block.send]) channel[index] = frame + index;
      }
      frame += block.direct[0].length;
    },
    get frame() { return frame; },
  };
}

/** Passes the direct sound through untouched. */
const identityMix: MixStage = {
  setSpace: () => {},
  process: (direct, _send, out) => { out[0].set(direct[0]); out[1].set(direct[1]); },
};

function setup(generator: HostedGenerator = countingGenerator(), mix: MixStage = identityMix) {
  const sent: RenderedChunk[] = [];
  const tasks: Array<() => void> = [];
  const renderer = new RenderAhead(generator, mix, SAMPLE_RATE, MARGIN_SEC, (chunk) => sent.push(chunk), (work) => tasks.push(work));
  /** Run scheduled work until none is left, as the worker's task queue would. */
  const drain = () => {
    let ran = 0;
    while (tasks.length > 0) {
      tasks.shift()!();
      ran += 1;
      if (ran > 100000) throw new Error('rendering never settled');
    }
  };
  return { renderer, sent, tasks, drain };
}

/** What an output holding these chunks plays, by the output's rule: a chunk replaces everything from its start on. */
function heard(chunks: RenderedChunk[]): Float32Array {
  const end = Math.max(...chunks.map((chunk) => chunk.startFrame + chunk.left.length));
  const out = new Float32Array(end);
  let queuedEnd = 0;
  for (const chunk of chunks) {
    out.fill(0, chunk.startFrame, queuedEnd);
    out.set(chunk.left, chunk.startFrame);
    queuedEnd = chunk.startFrame + chunk.left.length;
  }
  return out.subarray(0, queuedEnd);
}

describe('render ahead', () => {
  it('renders nothing before the first configure', () => {
    const { tasks, sent } = setup();
    expect(tasks).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('fills the lead and then stops: the queue settles at the lead, not past it', () => {
    const { renderer, sent, tasks, drain } = setup();
    renderer.configure(CONFIGURE);
    drain();
    expect(sent).toHaveLength(Math.ceil(LEAD_FRAMES / RENDER_CHUNK_FRAMES));
    expect(tasks).toHaveLength(0);
    expect(renderer.queued).toBeGreaterThanOrEqual(LEAD_FRAMES);
  });

  it('keeps the lead topped up as the output plays, in one contiguous stream', () => {
    const { renderer, sent, drain } = setup();
    renderer.configure(CONFIGURE);
    drain();
    for (let played = RENDER_CHUNK_FRAMES; played <= 50 * RENDER_CHUNK_FRAMES; played += RENDER_CHUNK_FRAMES) {
      renderer.played(played);
      drain();
      expect(renderer.queued).toBeGreaterThanOrEqual(LEAD_FRAMES);
      expect(renderer.queued).toBeLessThan(LEAD_FRAMES + RENDER_CHUNK_FRAMES);
    }
    sent.forEach((chunk, index) => {
      expect(chunk.startFrame).toBe(index * RENDER_CHUNK_FRAMES);
      expect(chunk.left[0]).toBe(index * RENDER_CHUNK_FRAMES);
    });
  });

  it('splices a settings change in a margin past the playhead, crossfading equal-power from what was queued', () => {
    const { renderer, sent, drain } = setup();
    renderer.configure(CONFIGURE);
    drain();
    const played = 3 * RENDER_CHUNK_FRAMES + 100;
    renderer.played(played);
    drain();
    const aheadOf = sent.at(-1)!.startFrame + RENDER_CHUNK_FRAMES;
    const before = sent.length;
    renderer.configure(CONFIGURE);
    drain();
    const splice = sent[before];
    const at = played + MARGIN_FRAMES;
    expect(splice.startFrame).toBe(at);
    // The generator went on from where it had got to rendering ahead; the
    // old audio at the same frames is the frame count itself.
    for (let index = 0; index < FADE_FRAMES; index += 1) {
      const t = (index + 1) / FADE_FRAMES;
      const expected = ((aheadOf + index) * Math.sin(t * Math.PI / 2)) + ((at + index) * Math.cos(t * Math.PI / 2));
      expect(splice.left[index]).toBeCloseTo(expected, 0);
    }
    for (let index = FADE_FRAMES; index < RENDER_CHUNK_FRAMES; index += 1) expect(splice.left[index]).toBe(aheadOf + index);
    // And the output heard everything before the splice point untouched.
    const out = heard(sent);
    for (let frame = 0; frame < at; frame += 1) expect(out[frame]).toBe(frame);
  });

  it('applies a change with no splice when nothing is queued past the margin', () => {
    const { renderer, sent, tasks } = setup();
    renderer.configure(CONFIGURE);
    tasks.shift()!();
    // Everything sent has been played: the margin reaches past it.
    renderer.played(RENDER_CHUNK_FRAMES);
    renderer.configure(CONFIGURE);
    tasks.shift()!();
    expect(sent.map((chunk) => chunk.startFrame)).toEqual([0, RENDER_CHUNK_FRAMES]);
    expect(sent[1].left[0]).toBe(RENDER_CHUNK_FRAMES);
  });

  it('renders the real soundscape finite, bounded and audible through the real mix', () => {
    const noise = noiseAt(SAMPLE_RATE);
    const generator = hostGenerator(generatorSource, SAMPLE_RATE, { seed: 7, noiseLoops: noise.loops, noiseGains: noise.gains });
    const { renderer, sent, drain } = setup(generator, new SoundscapeMix(SAMPLE_RATE));
    renderer.configure({
      type: 'configure',
      generator: { type: 'configure', ...toGeneratorConfiguration(DEFAULT_SOUNDSCAPE_SETTINGS) },
      space: DEFAULT_SOUNDSCAPE_SETTINGS.space,
    });
    drain();
    const out = heard(sent);
    expect(out.every(Number.isFinite)).toBe(true);
    const peak = Math.max(...Array.from(out, Math.abs));
    expect(peak).toBeGreaterThan(1e-3);
    expect(peak).toBeLessThan(4);
  });

  it('transitions to a new voice by an equal-power crossfade spliced a margin past the playhead, then plays the new voice alone', () => {
    /** A generator whose every sample is `value`. */
    const constant = (value: number): HostedGenerator => ({
      processor: null,
      exports: undefined,
      configure: () => {},
      renderBlock: (block) => { for (const channel of [...block.direct, ...block.send]) channel.fill(value); },
      frame: 0,
    });
    const sent: RenderedChunk[] = [];
    const tasks: Array<() => void> = [];
    const renderer = new RenderAhead(
      constant(1), identityMix, SAMPLE_RATE, MARGIN_SEC, (chunk) => sent.push(chunk), (work) => tasks.push(work),
      () => ({ generator: constant(-1), mix: identityMix }),
    );
    const drain = () => { while (tasks.length > 0) tasks.shift()!(); };
    renderer.configure(CONFIGURE);
    drain();
    const from = MARGIN_FRAMES;
    const fadeFrames = 3 * RENDER_CHUNK_FRAMES;
    renderer.transition(CONFIGURE, fadeFrames / SAMPLE_RATE);
    // Play through the fade and a little past it.
    for (let played = 0; played <= LEAD_FRAMES + fadeFrames + RENDER_CHUNK_FRAMES; played += RENDER_CHUNK_FRAMES) {
      renderer.played(played);
      drain();
    }
    const out = heard(sent);
    // Nothing before the transition point is touched.
    expect(Array.from(out.subarray(0, from)).every((value) => value === 1)).toBe(true);
    // Through the fade: old * cos + new * sin, the old being 1 and the new -1.
    for (const index of [0, fadeFrames / 2, fadeFrames - 1]) {
      const t = (index + 1) / fadeFrames;
      expect(out[from + index]).toBeCloseTo(Math.cos(t * Math.PI / 2) - Math.sin(t * Math.PI / 2), 5);
    }
    // After it, the new voice alone.
    expect(Array.from(out.subarray(from + fadeFrames)).every((value) => value === -1)).toBe(true);
  });

  it('a transition during a transition fades from the blend being heard, without a jump, wherever the output is', () => {
    const constant = (value: number): HostedGenerator => ({
      processor: null,
      exports: undefined,
      configure: () => {},
      renderBlock: (block) => { for (const channel of [...block.direct, ...block.send]) channel.fill(value); },
      frame: 0,
    });
    const values = [-1, 0.5];
    const sent: RenderedChunk[] = [];
    const tasks: Array<() => void> = [];
    const renderer = new RenderAhead(
      constant(1), identityMix, SAMPLE_RATE, MARGIN_SEC, (chunk) => sent.push(chunk), (work) => tasks.push(work),
      () => ({ generator: constant(values.shift()!), mix: identityMix }),
    );
    const drain = () => { while (tasks.length > 0) tasks.shift()!(); };
    renderer.configure(CONFIGURE);
    drain();
    const longFade = 2 * LEAD_FRAMES;
    renderer.transition(CONFIGURE, longFade / SAMPLE_RATE);
    drain();
    // Part-way through the first fade, and part-way through the lead.
    const playedAt = 3 * RENDER_CHUNK_FRAMES;
    renderer.played(playedAt);
    drain();
    renderer.transition(CONFIGURE, longFade / SAMPLE_RATE);
    for (let played = playedAt; played <= 3 * LEAD_FRAMES; played += RENDER_CHUNK_FRAMES) {
      renderer.played(played);
      drain();
    }
    const out = heard(sent);
    // Equal-power fades over two leads move a sample by far less than this per frame.
    let largestStep = 0;
    for (let index = 1; index < out.length; index += 1) largestStep = Math.max(largestStep, Math.abs(out[index] - out[index - 1]));
    expect(largestStep).toBeLessThan(1e-3);
  });
});
