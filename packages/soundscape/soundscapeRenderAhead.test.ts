import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUNDSCAPE_SETTINGS, SOUNDSCAPE_FACTORY_PRESETS } from './soundscape';
import { toGeneratorConfiguration } from './soundscapeDsp';
import { generatorSource, noiseAt } from './soundscape-generator.harness';
import { hostGenerator, type HostedGenerator } from './soundscapeGeneratorHost';
import { SoundscapeMix } from './soundscapeMix';
import {
  CROSSFADE_SEC,
  RENDER_CHUNK_FRAMES,
  RENDER_LEAD_SEC,
  ROOM_BUILD_LEAD_SEC,
  RenderAhead,
  SPLICE_GRID_FRAMES,
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
    snapshot: () => ({ frame, state: {} }),
    restore: (snapshot) => { frame = snapshot.frame; },
  };
}

/** Passes the direct sound through untouched. */
const identityMix: MixStage = {
  setSpace: () => {},
  roomPending: false,
  buildRoom: () => {},
  process: (direct, _send, out) => { out[0].set(direct[0]); out[1].set(direct[1]); },
  snapshot: () => null,
  restore: () => {},
};

/** The first point of the splice grid a margin past `played`: where a change is heard from. */
const spliceAt = (played: number) => Math.ceil((played + MARGIN_FRAMES) / SPLICE_GRID_FRAMES) * SPLICE_GRID_FRAMES;

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

  it('splices a settings change at the first chunk a margin past the playhead, rewinding the generator to that frame', () => {
    const { renderer, sent, drain } = setup();
    renderer.configure(CONFIGURE);
    drain();
    const played = 3 * RENDER_CHUNK_FRAMES + 100;
    renderer.played(played);
    drain();
    const before = sent.length;
    renderer.configure(CONFIGURE);
    drain();
    const splice = sent[before];
    const at = spliceAt(played);
    expect(splice.startFrame).toBe(at);
    // The generator went back to the splice frame, so the change carries on
    // the frame count rather than jumping to where rendering ahead had got:
    // what the output hears is one unbroken count, crossfade included.
    const out = heard(sent);
    expect(out.length).toBeGreaterThan(at + FADE_FRAMES);
    for (let frame = 0; frame < out.length; frame += 1) expect(out[frame]).toBeCloseTo(frame, 1);
  });

  it('turning one channel off changes nothing else: from the splice on, the rest plays exactly as if the change had been made live there', () => {
    // A soundscape with slow structure in every layer -- gusts, swells, a
    // thunder peal, chimes, rain -- where carrying on from the wrong moment is heard.
    const preset = SOUNDSCAPE_FACTORY_PRESETS.find((candidate) => candidate.id === 'stormy-night')!;
    const removed = 'rain-1';
    const without = { ...preset.settings, channels: preset.settings.channels.map((channel) => (channel.id === removed ? { ...channel, enabled: false } : channel)) };
    expect(preset.settings.channels.find((channel) => channel.id === removed)?.enabled).toBe(true);
    const message = (settings: typeof preset.settings): ConfigureMessage => ({
      type: 'configure', generator: { type: 'configure', ...toGeneratorConfiguration(settings) }, space: settings.space,
    });
    const noise = noiseAt(SAMPLE_RATE);
    const voice = () => ({
      generator: hostGenerator(generatorSource, SAMPLE_RATE, { seed: 7, noiseLoops: noise.loops, noiseGains: noise.gains }),
      mix: new SoundscapeMix(SAMPLE_RATE),
    });

    // Rendered ahead, the change arriving with a whole lead queued.
    const played = 3 * SAMPLE_RATE;
    const { generator, mix } = voice();
    const { renderer, sent, drain } = setup(generator, mix);
    renderer.configure(message(preset.settings));
    drain();
    for (let at = RENDER_CHUNK_FRAMES; at <= played; at += RENDER_CHUNK_FRAMES) { renderer.played(at); drain(); }
    renderer.played(played);
    drain();
    renderer.configure(message(without));
    for (let at = played; at <= played + LEAD_FRAMES; at += RENDER_CHUNK_FRAMES) { renderer.played(at); drain(); }
    const out = heard(sent);
    const at = spliceAt(played);

    // The same voice, the change made live at that frame.
    const start = () => {
      const started = voice();
      started.generator.configure(message(preset.settings).generator);
      started.mix.setSpace(preset.settings.space);
      started.mix.buildRoom();
      return started;
    };
    const render = (live: ReturnType<typeof voice>, frames: number, settings: typeof preset.settings | null) => {
      if (settings) { live.generator.configure(message(settings).generator); live.mix.setSpace(settings.space); }
      const result: number[] = [];
      for (let done = 0; done < frames; done += RENDER_CHUNK_FRAMES) {
        const block = { direct: [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)] as [Float32Array, Float32Array], send: [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)] as [Float32Array, Float32Array] };
        for (let offset = 0; offset < RENDER_CHUNK_FRAMES; offset += 128) {
          const view = (channel: Float32Array) => channel.subarray(offset, offset + 128);
          live.generator.renderBlock({ direct: [view(block.direct[0]), view(block.direct[1])], send: [view(block.send[0]), view(block.send[1])] });
        }
        const chunk: [Float32Array, Float32Array] = [new Float32Array(RENDER_CHUNK_FRAMES), new Float32Array(RENDER_CHUNK_FRAMES)];
        live.mix.process(block.direct, block.send, chunk);
        result.push(...chunk[0]);
      }
      return result;
    };
    const live = start();
    const before = render(live, at, null);
    const after = render(live, out.length - at, without);

    for (let frame = 0; frame < at; frame += 1) expect(out[frame]).toBe(before[frame]);
    for (let frame = at + FADE_FRAMES; frame < out.length; frame += 1) {
      if (out[frame] !== after[frame - at]) expect.fail(`frame ${frame}: ${out[frame]} rendered ahead, ${after[frame - at]} live`);
    }
    // And the channel was audible, so there was something to remove.
    expect(out.length - at).toBeGreaterThan(5 * SAMPLE_RATE);
    const kept = render(start(), out.length, null).slice(at);
    const difference = after.reduce((sum, value, index) => sum + ((value - kept[index]) ** 2), 0);
    expect(Math.sqrt(difference / after.length)).toBeGreaterThan(1e-3);
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

  it('renders every factory soundscape finite, bounded and audible through the real mix', () => {
    const noise = noiseAt(SAMPLE_RATE);
    for (const preset of SOUNDSCAPE_FACTORY_PRESETS) {
      const generator = hostGenerator(generatorSource, SAMPLE_RATE, { seed: 7, noiseLoops: noise.loops, noiseGains: noise.gains });
      const { renderer, sent, drain } = setup(generator, new SoundscapeMix(SAMPLE_RATE));
      renderer.configure({
        type: 'configure',
        generator: { type: 'configure', ...toGeneratorConfiguration(preset.settings) },
        space: preset.settings.space,
      });
      drain();
      const out = heard(sent);
      expect(out.every(Number.isFinite), preset.id).toBe(true);
      const peak = Math.max(...Array.from(out, Math.abs));
      expect(peak, preset.id).toBeGreaterThan(1e-3);
      expect(peak, preset.id).toBeLessThan(4);
    }
  });

  it('transitions to a new voice by an equal-power crossfade spliced a margin past the playhead, then plays the new voice alone', () => {
    /** A generator whose every sample is `value`. */
    const constant = (value: number): HostedGenerator => ({
      processor: null,
      exports: undefined,
      configure: () => {},
      renderBlock: (block) => { for (const channel of [...block.direct, ...block.send]) channel.fill(value); },
      frame: 0,
      snapshot: () => ({ frame: 0, state: {} }),
      restore: () => {},
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
    const from = spliceAt(0);
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
      snapshot: () => ({ frame: 0, state: {} }),
      restore: () => {},
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

  it('builds a new room only with enough queued to cover the build, then splices it in at the playhead', () => {
    /** A mix whose room is its space's size, recording how much the output held at each build. */
    const builtAtQueued: number[] = [];
    let renderer: RenderAhead | null = null;
    let playedNow = 0;
    const roomAt = new Map<number, number | null>();
    let built: number | null = null;
    let pending: number | null = null;
    const roomMix: MixStage = {
      setSpace: (space) => { pending = space.size === built ? null : space.size; },
      get roomPending() { return pending !== null; },
      buildRoom: () => {
        if (pending === null) return;
        // What the output still holds: everything sent, a splice's chunk not having replaced any of it yet.
        if (renderer) builtAtQueued.push(Math.max(0, ...sent.map((chunk) => chunk.startFrame + chunk.left.length)) - playedNow);
        built = pending;
        pending = null;
      },
      process: (direct, send, out) => {
        // The counting generator's first sample is the chunk's frame: which room each frame was last rendered in.
        roomAt.set(direct[0][0], built);
        identityMix.process(direct, send, out);
      },
      snapshot: () => ({ built, pending }),
      restore: (snapshot) => ({ built, pending } = snapshot as { built: number | null; pending: number | null }),
    };
    const sent: RenderedChunk[] = [];
    const tasks: Array<() => void> = [];
    const created = new RenderAhead(countingGenerator(), roomMix, SAMPLE_RATE, MARGIN_SEC, (chunk) => sent.push(chunk), (work) => tasks.push(work));
    renderer = created;
    const drain = () => { while (tasks.length > 0) tasks.shift()!(); };
    renderer.configure(CONFIGURE);
    drain();
    expect(builtAtQueued).toEqual([0]);
    const playedAt = 4 * RENDER_CHUNK_FRAMES;
    playedNow = playedAt;
    renderer.played(playedAt);
    drain();
    const firstAfter = sent.length;
    // A room change: nothing is built on the spot, with only the margin queued.
    renderer.configure({ ...CONFIGURE, space: { ...CONFIGURE.space, size: CONFIGURE.space.size + 0.1 } });
    expect(builtAtQueued).toHaveLength(1);
    drain();
    expect(builtAtQueued).toHaveLength(2);
    expect(builtAtQueued[1]).toBeGreaterThanOrEqual(Math.round(ROOM_BUILD_LEAD_SEC * SAMPLE_RATE));
    // Once built it is heard from the playhead's margin, not after the refilled lead.
    const newRoom = CONFIGURE.space.size + 0.1;
    const end = Math.max(...sent.map((chunk) => chunk.startFrame));
    for (let frame = 0; frame <= end; frame += RENDER_CHUNK_FRAMES) {
      expect(roomAt.get(frame), `frame ${frame}`).toBe(frame < spliceAt(playedAt) ? CONFIGURE.space.size : newRoom);
    }
    expect(sent.length).toBeGreaterThan(firstAfter);
  });
});
