import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  AMBIENT_RAIN_DRIPS_MAX_PER_SEC,
  AMBIENT_RAIN_FIRST_INDEX,
  AMBIENT_RAIN_SURFACES,
  createAmbientChannel,
  createAmbientRainChannel,
} from '../shared/ambientSound';
import { toWorkletChannels } from '../shared/ambientSoundDsp';
import { buildNoiseCycle } from '../shared/ambientNoiseCycle';

// The worklet's module-scope constants are not reachable from outside a vm
// script, so the test appends one line exposing the ones it checks.
const generatorSource = `${readFileSync(fileURLToPath(new URL('../../public/ambient-generator.js', import.meta.url)), 'utf8')}
;globalThis.__generatorConstants = { RAIN_SURFACE_PROFILES, RAIN_DRIPS_MAX_PER_SEC };`;

type TestProcessor = {
  channels: Array<{ id: string; eventAge: number; activeVoices: unknown[]; profile?: unknown }>;
  soloChannelId: string | null;
  makeSurfaceVoice: (profile: unknown, isDrip: boolean) => { gain: number };
  makeRainVoice: () => {
    bassModes: Array<{ frequency: number }>;
    bodyModes: Array<{ frequency: number }>;
    trebleModes: Array<{ frequency: number }>;
  };
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  eventDelayFrames: (ratePerSecond: number) => number;
  noise: (channel: unknown) => number;
  process: (inputs: unknown[], outputs: Float32Array[][]) => boolean;
}

/**
 * A full slot row goes through the same `toWorkletChannels` the engine uses,
 * so the tests exercise the real output routing; a short noise-only list
 * (the noise tests' fixture) gets the noise routing directly.
 */
function toConfigure(channels: TestChannel[]): unknown[] {
  if (channels.length > AMBIENT_RAIN_FIRST_INDEX) {
    return toWorkletChannels(channels as Parameters<typeof toWorkletChannels>[0]);
  }
  return channels.map((channel) => ({ ...channel, outputIndex: -1 }));
}

type TestChannel = (
  | ReturnType<typeof createAmbientChannel>
  | ReturnType<typeof createAmbientRainChannel>
) & { cycle?: Float32Array }

function makeChannel(id: string, overrides: Partial<ReturnType<typeof createAmbientChannel>> = {}): TestChannel {
  const settings = {
    ...createAmbientChannel(id),
    volume: 1,
    type: 'white' as const,
    ...overrides,
  }
  return { ...settings, cycle: buildNoiseCycle(settings.ramp, settings.shape) }
}

function makeRainChannel(id: string, overrides: Partial<ReturnType<typeof createAmbientRainChannel>> = {}): TestChannel {
  return { ...createAmbientRainChannel(id), volume: 1, ...overrides };
}

function makeRainSlots(rain: TestChannel[]): TestChannel[] {
  return [
    ...Array.from({ length: AMBIENT_RAIN_FIRST_INDEX }, (_, index) => makeChannel(`noise-${index}`, { enabled: false })),
    ...rain,
  ];
}

type GeneratorConstants = {
  RAIN_SURFACE_PROFILES: Record<string, unknown>;
  RAIN_DRIPS_MAX_PER_SEC: number;
};

function createProcessor(seed: number, channels: TestChannel[], sampleRate = 12000) {
  let Processor!: new (options: unknown) => TestProcessor;
  let frame = 0;
  class WorkletProcessorStub {
    port = { onmessage: null as ((event: { data: unknown }) => void) | null };
  }
  const scope: Record<string, unknown> = {
    AudioWorkletProcessor: WorkletProcessorStub,
    sampleRate,
    get currentFrame() { return frame; },
    registerProcessor: (_name: string, processor: new (options: unknown) => TestProcessor) => { Processor = processor; },
  };
  runInNewContext(generatorSource, scope);
  const processor = new Processor!({ processorOptions: { seed } });
  processor.port.onmessage?.({ data: { type: 'configure', channels: toConfigure(channels) } });

  return {
    processor,
    constants: scope.__generatorConstants as GeneratorConstants,
    render(seconds: number) {
      const samples = { left: [] as number[], right: [] as number[], rain: [[], [], []] as number[][] };
      const endFrame = frame + Math.floor(seconds * sampleRate);
      while (frame < endFrame) {
        const blockLength = Math.min(128, endFrame - frame);
        const outputs = [
          [new Float32Array(blockLength), new Float32Array(blockLength)],
          [new Float32Array(blockLength)],
          [new Float32Array(blockLength)],
          [new Float32Array(blockLength)],
        ];
        processor.process([], outputs);
        samples.left.push(...outputs[0][0]);
        samples.right.push(...outputs[0][1]);
        for (let index = 0; index < samples.rain.length; index += 1) {
          samples.rain[index].push(...outputs[index + 1][0]);
        }
        frame += blockLength;
      }
      return samples;
    },
  };
}

const GLASS_DIGEST = '99d0ac51e88924f2e118c28bfc40cf804f59cdf77955e13eeeeabb63d58b7083';

function rms(samples: number[]): number {
  return Math.sqrt(samples.reduce((sum, sample) => sum + (sample * sample), 0) / samples.length);
}

describe('ambient AudioWorklet generator', () => {
  it('mixes dynamic channels into one finite, bounded, non-silent stereo output', () => {
    const generator = createProcessor(73, [
      makeChannel('white', { type: 'white' }),
      makeChannel('pink', { type: 'pink' }),
      makeChannel('brown', { type: 'brown' }),
    ]);
    const samples = generator.render(0.4);
    expect(generator.processor.channels).toHaveLength(3);
    for (const side of [samples.left, samples.right]) {
      expect(side.some((sample) => Math.abs(sample) > 0.001)).toBe(true);
      expect(side.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 2.2)).toBe(true);
    }
    expect(samples.left).not.toEqual(samples.right);
  });

  it('omits disabled channels from the active mix without changing enabled output', () => {
    const enabledOnly = createProcessor(83, [makeChannel('enabled')]);
    const withDisabled = createProcessor(83, [
      makeChannel('enabled'),
      makeChannel('disabled', { enabled: false }),
    ]);
    for (const generator of [enabledOnly, withDisabled]) {
      generator.processor.noise = () => 1;
    }

    const expected = enabledOnly.render(0.2);
    const actual = withDisabled.render(0.2);
    expect(withDisabled.processor.channels.map((channel) => channel.id)).toEqual(['enabled']);
    expect(actual.left).toEqual(expected.left);
    expect(actual.right).toEqual(expected.right);
  });

  it('passes only the soloed channel without disabling the other channels', () => {
    const mixed = createProcessor(97, [
      makeChannel('first', { modulationAmplitude: 0 }),
      makeChannel('solo', { solo: true, modulationAmplitude: 0 }),
    ]);
    const soloOnly = createProcessor(97, [makeChannel('solo', { solo: true, modulationAmplitude: 0 })]);
    const disabledSolo = createProcessor(97, [
      makeChannel('disabled-solo', { enabled: false, solo: true }),
      makeChannel('other', { modulationAmplitude: 0 }),
    ]);
    for (const generator of [mixed, soloOnly, disabledSolo]) generator.processor.noise = () => 1;

    const mixedOutput = mixed.render(0.2);
    const soloOutput = soloOnly.render(0.2);
    const silentOutput = disabledSolo.render(0.2);
    expect(mixed.processor.soloChannelId).toBe('solo');
    expect(mixed.processor.channels.map((channel) => channel.id)).toEqual(['first', 'solo']);
    expect(mixedOutput.left).toEqual(soloOutput.left);
    expect(silentOutput.left.every((sample) => sample === 0)).toBe(true);
  });

  it('uses modulation amplitude and period to shape continuous noise', () => {
    const unmodulatedGenerator = createProcessor(119, [makeChannel('unmodulated', {
      modulationAmplitude: 0,
      periodSec: 0.5,
    })]);
    const modulatedGenerator = createProcessor(119, [makeChannel('modulated', {
      modulationAmplitude: 1,
      periodSec: 0.5,
    })]);
    const slowerGenerator = createProcessor(119, [makeChannel('slower', {
      modulationAmplitude: 1,
      periodSec: 1,
    })]);
    for (const generator of [unmodulatedGenerator, modulatedGenerator, slowerGenerator]) {
      generator.processor.noise = () => 1;
    }
    const unmodulated = unmodulatedGenerator.render(2);
    const modulated = modulatedGenerator.render(2);
    const slower = slowerGenerator.render(2);
    expect(Math.min(...modulated.left)).toBeLessThan(0.001);
    expect(Math.max(...modulated.left)).toBeGreaterThan(1.99);
    expect(rms(modulated.left)).toBeGreaterThan(rms(unmodulated.left));
    expect(modulated.left).not.toEqual(slower.left);
  });

  it('repeats its level exactly once per period', () => {
    // With the noise itself held at 1, the output IS the level. A period of
    // 0.5 s at 1000 Hz repeats every 500 samples, whatever the curve.
    for (const ramp of [0, 0.5, 1]) {
      const generator = createProcessor(5, [makeChannel('cycle', {
        modulationAmplitude: 1, periodSec: 0.5, ramp,
      })], 1000);
      generator.processor.noise = () => 1;
      const level = generator.render(2).left;
      for (let index = 0; index + 500 < level.length; index += 37) {
        expect(level[index + 500]).toBeCloseTo(level[index], 2);
      }
    }
  });

  it('applies low-pass and high-pass filtering while the midpoint bypasses filtering', () => {
    const lowPass = createProcessor(19, [makeChannel('low-pass', { filter: 0, modulationAmplitude: 0 })], 48000);
    const dry = createProcessor(19, [makeChannel('dry', { filter: 0.5, modulationAmplitude: 0 })], 48000);
    const highPass = createProcessor(19, [makeChannel('high-pass', { filter: 1, modulationAmplitude: 0 })], 48000);
    for (const generator of [lowPass, dry, highPass]) generator.processor.noise = () => 1;

    const lowPassSamples = lowPass.render(0.5).left;
    const drySamples = dry.render(0.5).left;
    const highPassSamples = highPass.render(0.5).left;
    expect(lowPassSamples.at(-1)).toBeGreaterThan(0.99);
    expect(drySamples.every((sample) => sample === 1)).toBe(true);
    expect(Math.abs(highPassSamples.at(-1) ?? 1)).toBeLessThan(0.001);
  });

  it('synthesizes overlapping rain impacts on three independent output buses', () => {
    const generator = createProcessor(307, makeRainSlots([
      makeRainChannel('rain-near', { dropsPerSecond: 50, distance: 0 }),
      makeRainChannel('rain-middle', { dropsPerSecond: 36, distance: 0.5 }),
      makeRainChannel('rain-far', { dropsPerSecond: 24, distance: 1 }),
    ]));
    const samples = generator.render(1);

    expect(generator.processor.channels.slice(-3).every((channel) => channel.activeVoices.length > 1)).toBe(true);
    expect(samples.rain.every((side) => side.some((sample) => Math.abs(sample) > 0.001))).toBe(true);
    expect(samples.rain[0]).not.toEqual(samples.rain[1]);
    expect(samples.rain[1]).not.toEqual(samples.rain[2]);
    expect(samples.left.every((sample) => sample === 0)).toBe(true);
    expect(samples.right.every((sample) => sample === 0)).toBe(true);
  });

  it('varies resonant frequencies widely from drop to drop instead of repeating a fixed comb', () => {
    const generator = createProcessor(419, makeRainSlots([makeRainChannel('rain')]));
    const voices = Array.from({ length: 12 }, () => generator.processor.makeRainVoice());
    const bodyFrequencies = voices.flatMap((voice) => voice.bodyModes.map((mode) => mode.frequency));

    expect(new Set(bodyFrequencies.map((frequency) => Math.round(frequency))).size).toBeGreaterThan(20);
    expect(Math.max(...bodyFrequencies) - Math.min(...bodyFrequencies)).toBeGreaterThan(1500);
    expect(voices.every((voice) => voice.bassModes.length >= 1 && voice.trebleModes.length >= 1)).toBe(true);
  });

  it('mixes bass and treble gains as independent impact components', () => {
    const render = (bassGain: number, trebleGain: number) => createProcessor(523, makeRainSlots([
      makeRainChannel('rain-mix', { dropsPerSecond: 22, bassGain, trebleGain }),
    ])).render(1).rain[0];
    const full = render(1, 1);
    const noBass = render(0, 1);
    const noTreble = render(1, 0);
    const trebleContribution = full.map((sample, index) => sample - noBass[index]);
    const bassContribution = full.map((sample, index) => sample - noTreble[index]);

    expect(rms(trebleContribution)).toBeGreaterThan(0.001);
    expect(rms(bassContribution)).toBeGreaterThan(0.001);
    expect(noBass).not.toEqual(noTreble);
  });
  it('has a synthesis profile for every rain surface the settings can name', () => {
    const { constants } = createProcessor(1, []);
    expect(Object.keys(constants.RAIN_SURFACE_PROFILES).sort()).toEqual([...AMBIENT_RAIN_SURFACES].sort());
    expect(constants.RAIN_DRIPS_MAX_PER_SEC).toBe(AMBIENT_RAIN_DRIPS_MAX_PER_SEC);
  });

  // The glass surface is the original rain model and its sound is meant to
  // stay exactly as it was. This pins a hash of a rendered glass layer: it
  // was taken from the generator before surfaces existed (verified equal,
  // sample for sample), so a change here is a change to the glass sound.
  it('renders the glass surface exactly as the original rain model did', () => {
    const generator = createProcessor(4242, makeRainSlots([
      makeRainChannel('glass', {
        surface: 'glass', wash: 0, drips: 0, volume: 0.3, dropsPerSecond: 30, bassGain: 0.6, trebleGain: 0.5,
      }),
    ]), 48000);
    const samples = Float32Array.from(generator.render(1).rain[0]);
    const digest = createHash('sha256').update(Buffer.from(samples.buffer)).digest('hex');
    expect(digest).toBe(GLASS_DIGEST);
  });

  it('routes each rain layer to the output its slot position names', () => {
    const generator = createProcessor(11, makeRainSlots([
      makeRainChannel('first', { enabled: false }),
      makeRainChannel('second', { enabled: false }),
      makeRainChannel('third', { dropsPerSecond: 40 }),
    ]));
    const samples = generator.render(0.5);
    expect(samples.rain[0].every((sample) => sample === 0)).toBe(true);
    expect(samples.rain[1].every((sample) => sample === 0)).toBe(true);
    expect(rms(samples.rain[2])).toBeGreaterThan(0.001);
  });

  it('gives the forest a darker impact than the street', () => {
    const zeroCrossingsPerSecond = (surface: 'street' | 'forest') => {
      const samples = createProcessor(29, makeRainSlots([
        makeRainChannel(surface, { surface, wash: 0, drips: 0, dropsPerSecond: 40, bassGain: 0 }),
      ]), 48000).render(3).rain[0];
      let crossings = 0;
      for (let index = 1; index < samples.length; index += 1) {
        if ((samples[index] >= 0) !== (samples[index - 1] >= 0)) crossings += 1;
      }
      return crossings / 3;
    };
    expect(zeroCrossingsPerSecond('forest')).toBeLessThan(zeroCrossingsPerSecond('street') * 0.85);
  });

  it('fills the gaps between drops with the wash, and only when asked', () => {
    // Share of 20 ms windows carrying audible sound: a bed is continuous,
    // sparse drops are not.
    const coverage = (wash: number) => {
      const samples = createProcessor(37, makeRainSlots([
        makeRainChannel('bed', { wash, drips: 0, dropsPerSecond: 1 }),
      ]), 12000).render(4).rain[0];
      const window = 240;
      let loud = 0;
      let windows = 0;
      for (let start = 0; start + window <= samples.length; start += window) {
        windows += 1;
        if (rms(samples.slice(start, start + window)) > 0.002) loud += 1;
      }
      return loud / windows;
    };
    expect(coverage(1)).toBeGreaterThan(0.95);
    expect(coverage(0)).toBeLessThan(0.3);
  });

  it('drops large drips at the rate the drips control sets', () => {
    const countDrips = (drips: number) => {
      const generator = createProcessor(53, makeRainSlots([
        makeRainChannel('drips', { drips, wash: 0, dropsPerSecond: 1 }),
      ]), 2000);
      let count = 0;
      const makeVoice = generator.processor.makeSurfaceVoice.bind(generator.processor);
      generator.processor.makeSurfaceVoice = (profile, isDrip) => {
        if (isDrip) count += 1;
        return makeVoice(profile, isDrip);
      };
      generator.render(40);
      return count;
    };
    expect(countDrips(0)).toBe(0);
    const full = countDrips(1);
    expect(full).toBeGreaterThan(AMBIENT_RAIN_DRIPS_MAX_PER_SEC * 40 * 0.7);
    expect(full).toBeLessThan(AMBIENT_RAIN_DRIPS_MAX_PER_SEC * 40 * 1.3);
  });

  it('stays finite and bounded on every surface at every control extreme', () => {
    for (const surface of AMBIENT_RAIN_SURFACES) {
      const samples = createProcessor(61, makeRainSlots([
        makeRainChannel(surface, { surface, wash: 1, drips: 1, dropsPerSecond: 60, bassGain: 1, trebleGain: 1 }),
      ]), 48000).render(2).rain[0];
      expect(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 8)).toBe(true);
      expect(rms(samples)).toBeGreaterThan(0.005);
    }
  });
});