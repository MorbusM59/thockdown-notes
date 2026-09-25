import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  AMBIENT_RAIN_DRIPS_MAX_PER_SEC,
  AMBIENT_RAIN_FIRST_INDEX,
  AMBIENT_THUNDER_FIRST_INDEX,
  AMBIENT_RAIN_SURFACE_ANCHORS,
  AMBIENT_WET_BUBBLE_CHANCE,
  createAmbientChannel,
  createAmbientRainChannel,
  createAmbientThunderChannel,
} from '../shared/ambientSound';
import { resolveAmbientSpace, resolveNoiseTone, toWorkletChannels } from '../shared/ambientSoundDsp';
import { buildNoiseLoops, createNoiseSource, type NoiseLoops } from '../shared/ambientNoiseLoops';
import { buildNoiseCycle } from '../shared/ambientNoiseCycle';

// The worklet's module-scope constants are not reachable from outside a vm
// script, so the test appends one line exposing the ones it checks.
const generatorSource = `${readFileSync(fileURLToPath(new URL('../../public/ambient-generator.js', import.meta.url)), 'utf8')}
;globalThis.__generatorConstants = { RAIN_SURFACE_ANCHORS, RAIN_DRIPS_MAX_PER_SEC, surfaceProfile, AUTHORED_LOW_LEVEL, AUTHORED_HIGH_LEVEL, WET_BUBBLE_CHANCE };`;

type TestProcessor = {
  channels: Array<{ id: string; eventAge: number; activeVoices: unknown[]; profile?: unknown }>;
  soloChannelId: string | null;
  makeSurfaceVoice: (profile: unknown, isDrip: boolean, character?: { wetness: number; resonance: number }) => GlassVoice;
  addVoice: (channel: unknown, isDrip: boolean, offset: number, at: number) => void;
  renderVoice: (voice: GlassVoice, out: Float64Array, length: number) => boolean;
  startCycle: (channel: { panTo: number; periodFactor: number; riseFactor: number }) => void;
  makeRainVoice: () => {
    bassModes: Array<{ frequency: number }>;
    bodyModes: Array<{ frequency: number }>;
    trebleModes: Array<{ frequency: number }>;
  };
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  eventDelayFrames: (ratePerSecond: number) => number;
  noiseLoop: (type: string) => Float32Array;
  process: (inputs: unknown[], outputs: Float32Array[][]) => boolean;
  startPeal: (channel: unknown) => void;
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
  | ReturnType<typeof createAmbientThunderChannel>
) & { cycle?: Float32Array; type?: string; space?: ReturnType<typeof resolveAmbientSpace>; tone?: ReturnType<typeof resolveNoiseTone> }

// A noise channel as the worklet receives it. `type` is what the worklet
// reads; in a full slot row toWorkletChannels replaces it with the slot's.
type NoiseOverrides = Partial<ReturnType<typeof createAmbientChannel>> & { type?: 'white' | 'pink' | 'brown' };

function makeChannel(id: string, overrides: NoiseOverrides = {}): TestChannel {
  const settings = {
    ...createAmbientChannel(id),
    volume: 1,
    type: 'white' as const,
    ...overrides,
  }
  // Resolved as toWorkletChannels resolves them for a slot row.
  return {
    ...settings,
    cycle: buildNoiseCycle(settings.ramp, settings.shape),
    space: resolveAmbientSpace(settings.distance),
    tone: resolveNoiseTone(settings.filter, settings.type),
  }
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

/** A full slot row with every noise and rain layer off and these thunder layers. */
function makeThunderSlots(thunder: Array<Partial<ReturnType<typeof createAmbientThunderChannel>>>): TestChannel[] {
  return [
    ...Array.from({ length: AMBIENT_RAIN_FIRST_INDEX }, (_, index) => makeChannel(`noise-${index}`, { enabled: false })),
    ...Array.from({ length: AMBIENT_THUNDER_FIRST_INDEX - AMBIENT_RAIN_FIRST_INDEX }, (_, index) => makeRainChannel(`rain-${index}`, { enabled: false })),
    ...thunder.map((overrides, index) => ({ ...createAmbientThunderChannel(`thunder-${index}`), enabled: true, volume: 1, ...overrides })),
  ];
}

/** Share of the signal's energy above `hz`, by a one-pole high-pass. */
function highShare(samples: number[], sampleRate: number, hz: number): number {
  const a = Math.exp((-2 * Math.PI * hz) / sampleRate);
  let low = 0;
  let high = 0;
  let total = 0;
  for (const sample of samples) {
    low = (a * low) + ((1 - a) * sample);
    high += (sample - low) ** 2;
    total += sample * sample;
  }
  return total > 0 ? high / total : 0;
}

type Mode = { sin: number; cos: number; rotationSin: number; rotationCos: number; amplitude: number; decay: number };
type GlassVoice = {
  gain: number;
  age: number;
  startOffset?: number;
  durationFrames: number;
  transientAmplitude: number;
  bassModes: Mode[];
  bodyModes: Mode[];
  trebleModes: Mode[];
};

/** The parts of a worklet surface profile the tests read. */
type SurfaceProfile = {
  durationSec: number;
  click: { centerHz: number[] };
  bed: { gain: number; centerHz: number };
  treble: { count: number[] };
} & Record<string, unknown>;

type GeneratorConstants = {
  RAIN_SURFACE_ANCHORS: { name: string; at: number }[];
  surfaceProfile: (surface: number) => SurfaceProfile;
  AUTHORED_LOW_LEVEL: number;
  AUTHORED_HIGH_LEVEL: number;
  WET_BUBBLE_CHANCE: number;
  RAIN_DRIPS_MAX_PER_SEC: number;
};

// Built as the engine builds them, once per sample rate.
const loopsBySampleRate = new Map<number, NoiseLoops>();
function noiseLoopsAt(sampleRate: number): NoiseLoops {
  if (!loopsBySampleRate.has(sampleRate)) loopsBySampleRate.set(sampleRate, buildNoiseLoops(sampleRate));
  return loopsBySampleRate.get(sampleRate)!;
}

function createProcessor(seed: number, channels: TestChannel[], sampleRate = 12000, blockSize = 128) {
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
  // The same output layout the engine creates: noise direct, three rain
  // outputs, then the noise reverb send.
  const processor = new Processor!({ processorOptions: { seed, noiseLoops: noiseLoopsAt(sampleRate), noiseSendOutput: 4 } });
  processor.port.onmessage?.({ data: { type: 'configure', channels: toConfigure(channels) } });

  return {
    processor,
    constants: scope.__generatorConstants as GeneratorConstants,
    render(seconds: number) {
      const samples = {
        left: [] as number[], right: [] as number[], rain: [[], [], []] as number[][],
        sendLeft: [] as number[], sendRight: [] as number[],
      };
      const endFrame = frame + Math.floor(seconds * sampleRate);
      while (frame < endFrame) {
        const blockLength = Math.min(blockSize, endFrame - frame);
        const outputs = [
          [new Float32Array(blockLength), new Float32Array(blockLength)],
          [new Float32Array(blockLength)],
          [new Float32Array(blockLength)],
          [new Float32Array(blockLength)],
          [new Float32Array(blockLength), new Float32Array(blockLength)],
        ];
        processor.process([], outputs);
        samples.sendLeft.push(...outputs[4][0]);
        samples.sendRight.push(...outputs[4][1]);
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

/** A noise loop of constant 1, so a noise layer's output IS its level. */
const ONES = new Float32Array(4096).fill(1);

/** Largest magnitude; a spread of a long render overflows the call stack. */
function peakOf(samples: number[]): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

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
      generator.processor.noiseLoop = () => ONES;
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
    for (const generator of [mixed, soloOnly, disabledSolo]) generator.processor.noiseLoop = () => ONES;

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
      generator.processor.noiseLoop = () => ONES;
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
    // 0.5 s at 16 kHz repeats every 8000 samples, whatever the curve -- a
    // whole number of the 32-sample control segments, so the ramped level
    // lands on the same values each time round.
    for (const ramp of [0, 0.5, 1]) {
      const generator = createProcessor(5, [makeChannel('cycle', {
        modulationAmplitude: 1, periodSec: 0.5, ramp,
      })], 16000);
      generator.processor.noiseLoop = () => ONES;
      const level = generator.render(2).left;
      for (let index = 0; index + 8000 < level.length; index += 37) {
        expect(level[index + 8000]).toBeCloseTo(level[index], 3);
      }
    }
  });

  it('applies low-pass and high-pass filtering while the midpoint bypasses filtering', () => {
    const lowPass = createProcessor(19, [makeChannel('low-pass', { filter: 0, modulationAmplitude: 0 })], 48000);
    const dry = createProcessor(19, [makeChannel('dry', { filter: 0.5, modulationAmplitude: 0 })], 48000);
    const highPass = createProcessor(19, [makeChannel('high-pass', { filter: 1, modulationAmplitude: 0 })], 48000);
    for (const generator of [lowPass, dry, highPass]) generator.processor.noiseLoop = () => ONES;

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
    // Overlap is a property of the whole render, not of whichever instant it
    // stops on, so the most voices each layer held at once is what is checked.
    const mostVoices = [0, 0, 0];
    const chunks = Array.from({ length: 20 }, () => {
      const chunk = generator.render(0.05);
      generator.processor.channels.slice(-3).forEach((channel, index) => {
        mostVoices[index] = Math.max(mostVoices[index], channel.activeVoices.length);
      });
      return chunk;
    });
    const samples = {
      left: chunks.flatMap((chunk) => chunk.left),
      right: chunks.flatMap((chunk) => chunk.right),
      rain: [0, 1, 2].map((index) => chunks.flatMap((chunk) => chunk.rain[index])),
    };

    expect(mostVoices.every((count) => count > 1)).toBe(true);
    expect(samples.rain.every((side) => side.some((sample) => Math.abs(sample) > 0.001))).toBe(true);
    expect(samples.rain[0]).not.toEqual(samples.rain[1]);
    expect(samples.rain[1]).not.toEqual(samples.rain[2]);
    expect(samples.left.every((sample) => sample === 0)).toBe(true);
    expect(samples.right.every((sample) => sample === 0)).toBe(true);
  });

  it('varies resonant frequencies widely from drop to drop instead of repeating a fixed comb', () => {
    const generator = createProcessor(419, makeRainSlots([makeRainChannel('rain')]));
    const glass = generator.constants.surfaceProfile(1);
    const voices = Array.from({ length: 12 }, () => generator.processor.makeSurfaceVoice(glass, false) as unknown as ReturnType<TestProcessor['makeRainVoice']>);
    const bodyFrequencies = voices.flatMap((voice) => voice.bodyModes.map((mode) => mode.frequency));

    expect(new Set(bodyFrequencies.map((frequency) => Math.round(frequency))).size).toBeGreaterThan(20);
    expect(Math.max(...bodyFrequencies) - Math.min(...bodyFrequencies)).toBeGreaterThan(1500);
    expect(voices.every((voice) => voice.bassModes.length >= 1 && voice.trebleModes.length >= 1)).toBe(true);
  });

  describe('rain wetness and resonance', () => {
    const { processor, constants } = createProcessor(523, [], 48000);
    type Voice = GlassVoice & { bubble: unknown; splashAmplitude: number; sprayFrames: number[] };
    const voices = (surface: number, character: { wetness: number; resonance: number }, count = 400) => (
      Array.from({ length: count }, () => processor.makeSurfaceVoice(constants.surfaceProfile(surface), false, character) as Voice)
    );
    const decayTime = (mode: Mode) => -1 / (48000 * Math.log(mode.decay));

    it('sends a share of drops into water with wetness, each with a splash, spray and a bubble', () => {
      const dry = voices(0.5, { wetness: 0, resonance: 0.5 });
      const soaked = voices(0.5, { wetness: 1, resonance: 0.5 });
      expect(dry.every((voice) => voice.bubble === null && voice.splashAmplitude === 0)).toBe(true);
      const wet = soaked.filter((voice) => voice.bubble !== null);
      expect(wet.length / soaked.length).toBeGreaterThan(constants.WET_BUBBLE_CHANCE - 0.07);
      expect(wet.length / soaked.length).toBeLessThan(constants.WET_BUBBLE_CHANCE + 0.07);
      expect(wet.every((voice) => voice.splashAmplitude > 0 && voice.sprayFrames.length >= 1)).toBe(true);
    });

    it('damps the ring as the surface gets wetter', () => {
      const ring = (wetness: number) => voices(1, { wetness, resonance: 0.5 }, 60)
        .flatMap((voice) => voice.bassModes).reduce((sum, mode) => sum + decayTime(mode), 0);
      expect(ring(1)).toBeLessThan(ring(0) * 0.6);
    });

    it('rings not at all when dead, as authored in the middle, twice as long at the top', () => {
      expect(voices(1, { wetness: 0, resonance: 0 }, 20).every((voice) => (
        voice.bassModes.length + voice.bodyModes.length + voice.trebleModes.length === 0
      ))).toBe(true);
      const middle = createProcessor(7, [], 48000).processor;
      const top = createProcessor(7, [], 48000).processor;
      const authored = middle.makeSurfaceVoice(constants.surfaceProfile(1), false, { wetness: 0, resonance: 0.5 });
      const ringing = top.makeSurfaceVoice(constants.surfaceProfile(1), false, { wetness: 0, resonance: 1 });
      authored.bassModes.forEach((mode, index) => {
        expect(decayTime(ringing.bassModes[index])).toBeCloseTo(decayTime(mode) * 2, 6);
        expect(ringing.bassModes[index].amplitude).toBeCloseTo(mode.amplitude, 9);
      });
    });
  });

  it('has a synthesis profile for every rain surface the settings can name', () => {
    const { constants } = createProcessor(1, []);
    expect(constants.RAIN_SURFACE_ANCHORS.map(({ name, at }) => ({ name, at })))
      .toEqual(AMBIENT_RAIN_SURFACE_ANCHORS.map(({ name, at }) => ({ name, at })));
    expect(constants.RAIN_DRIPS_MAX_PER_SEC).toBe(AMBIENT_RAIN_DRIPS_MAX_PER_SEC);
  });

  // The glass surface is the original rain model and is meant to sound as it
  // always has. Its drops are drawn by the unchanged makeRainVoice; what this
  // pins is that the block renderer plays a drop's ringing modes exactly as
  // the original per-sample formula did -- body, plus the low and high banks
  // at the balance they were authored at (what the bass and treble sliders'
  // defaults were) -- at resonance 0.5 and wetness 0, the surface as it is.
  // (The click is white noise; its own test is below.)
  it('rings a glass drop exactly as the original per-sample formula did', () => {
    const generator = createProcessor(4242, [], 48000);
    const glass = generator.constants.surfaceProfile(1);
    const voice = generator.processor.makeSurfaceVoice(glass, false);
    voice.transientAmplitude = 0;
    voice.startOffset = 0;
    const reference = structuredClone(voice);
    const low = generator.constants.AUTHORED_LOW_LEVEL;
    const high = generator.constants.AUTHORED_HIGH_LEVEL;

    const rendered = new Float64Array(voice.durationFrames);
    for (let start = 0; start < voice.durationFrames; start += 128) {
      const block = new Float64Array(128);
      const alive = generator.processor.renderVoice(voice, block, 128);
      rendered.set(block.subarray(0, Math.min(128, voice.durationFrames - start)), start);
      if (!alive) break;
    }

    const ring = (modes: Mode[]) => {
      let sample = 0;
      for (const mode of modes) {
        sample += mode.sin * mode.amplitude;
        const nextSin = (mode.sin * mode.rotationCos) + (mode.cos * mode.rotationSin);
        mode.cos = (mode.cos * mode.rotationCos) - (mode.sin * mode.rotationSin);
        mode.sin = nextSin;
        mode.amplitude *= mode.decay;
      }
      return sample;
    };
    for (let index = 0; index < reference.durationFrames; index += 1) {
      const expected = ring(reference.bodyModes)
        + (ring(reference.bassModes) * low)
        + (ring(reference.trebleModes) * high);
      // A voice may retire early once it is below -100 dB; after that the
      // reference is too.
      expect(Math.abs(rendered[index] - expected)).toBeLessThan(1e-5);
    }
  });

  it('gives a glass drop a click that is white, starts at its drawn level and dies within milliseconds', () => {
    const generator = createProcessor(17, [], 48000);
    const glass = generator.constants.surfaceProfile(1);
    const voice = generator.processor.makeSurfaceVoice(glass, false);
    const level = voice.transientAmplitude;
    for (const bank of [voice.bassModes, voice.bodyModes, voice.trebleModes]) {
      for (const mode of bank) mode.amplitude = 0;
    }
    voice.startOffset = 0;
    const out = new Float64Array(128);
    generator.processor.renderVoice(voice, out, 128);
    const heard = level * generator.constants.AUTHORED_HIGH_LEVEL;
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(heard);
    expect(Math.max(...out.slice(0, 8).map(Math.abs))).toBeGreaterThan(heard * 0.2);
    // 0.65 ms time constant: after 2 ms (96 samples) it is under 5% of itself.
    expect(Math.max(...out.slice(96).map(Math.abs))).toBeLessThan(heard * 0.05);
  });

  // Rendering whole blocks per voice must not leave seams: the same seed
  // gives the same sound whatever size the blocks come in, which holds only
  // if every voice born mid-block starts on its exact frame and every stream
  // is drawn in time order. (It caught drops and drips being born in two
  // passes per block, which reordered the draws at block edges.) Noise is
  // exact. Rain may differ by what a voice still carries when it retires --
  // checked once per block, at -100 dB -- so the bound there is -80 dB.
  it('renders the same sound whatever the block size', () => {
    const layers = () => [
      ...Array.from({ length: AMBIENT_RAIN_FIRST_INDEX }, (_, index) => makeChannel(`noise-${index}`, {
        enabled: index < 2, type: index === 0 ? 'pink' : 'brown', movement: 0.8, periodSec: 0.6,
      })),
      makeRainChannel('glass', { surface: 1, wash: 0.4, drips: 0.5, dropsPerSecond: 40 }),
      makeRainChannel('street', { surface: 0.5, wash: 1, drips: 1, dropsPerSecond: 60 }),
      makeRainChannel('forest', { surface: 0, wash: 0.7, drips: 1, dropsPerSecond: 50 }),
    ];
    const large = createProcessor(88, layers(), 16000, 128).render(3);
    const small = createProcessor(88, layers(), 16000, 32).render(3);
    expect(small.left).toEqual(large.left);
    expect(small.right).toEqual(large.right);
    for (let index = 0; index < 3; index += 1) {
      const largest = Math.max(...small.rain[index].map((value, frame) => Math.abs(value - large.rain[index][frame])));
      expect(largest).toBeLessThan(1e-4);
      expect(Math.max(...large.rain[index].map(Math.abs))).toBeGreaterThan(0.1);
    }
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
    const zeroCrossingsPerSecond = (surface: number) => {
      const samples = createProcessor(29, makeRainSlots([
        makeRainChannel(String(surface), { surface, wash: 0, drips: 0, dropsPerSecond: 40, resonance: 0, wetness: 0 }),
      ]), 48000).render(3).rain[0];
      let crossings = 0;
      for (let index = 1; index < samples.length; index += 1) {
        if ((samples[index] >= 0) !== (samples[index - 1] >= 0)) crossings += 1;
      }
      return crossings / 3;
    };
    expect(zeroCrossingsPerSecond(0)).toBeLessThan(zeroCrossingsPerSecond(0.5) * 0.85);
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
      const addVoice = generator.processor.addVoice.bind(generator.processor);
      generator.processor.addVoice = (channel, isDrip, offset, at) => {
        if (isDrip) count += 1;
        addVoice(channel, isDrip, offset, at);
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
    for (const surface of [0, 0.25, 0.5, 0.75, 1]) {
      const samples = createProcessor(61, makeRainSlots([
        makeRainChannel(String(surface), { surface, wash: 1, drips: 1, dropsPerSecond: 60, wetness: 1, resonance: 1 }),
      ]), 48000).render(2).rain[0];
      expect(samples.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 8)).toBe(true);
      expect(rms(samples)).toBeGreaterThan(0.005);
    }
  });
  describe('movement', () => {
    // Records every cycle's draw by wrapping startCycle.
    function recordCycles(movement: number, seconds: number, sampleRate = 2000) {
      const generator = createProcessor(71, [makeChannel('moving', {
        modulationAmplitude: 1, periodSec: 0.5, movement,
      })], sampleRate);
      generator.processor.noiseLoop = () => ONES;
      const cycles: { panTo: number; periodFactor: number; riseFactor: number }[] = [];
      const startCycle = generator.processor.startCycle.bind(generator.processor);
      generator.processor.startCycle = (channel) => {
        startCycle(channel);
        cycles.push({ panTo: channel.panTo, periodFactor: channel.periodFactor, riseFactor: channel.riseFactor });
      };
      const samples = generator.render(seconds);
      return { cycles, samples };
    }

    it('sways to the other side of centre on every cycle, within its reach', () => {
      const { cycles } = recordCycles(1, 60);
      expect(cycles.length).toBeGreaterThan(50);
      for (let index = 1; index < cycles.length; index += 1) {
        expect(Math.sign(cycles[index].panTo)).toBe(-Math.sign(cycles[index - 1].panTo));
      }
      expect(cycles.every((cycle) => Math.abs(cycle.panTo) <= 0.6 + 1e-9)).toBe(true);
    });

    it('varies the length of each cycle while keeping the tempo it was given', () => {
      const { cycles } = recordCycles(1, 200);
      const factors = cycles.map((cycle) => cycle.periodFactor);
      expect(Math.min(...factors)).toBeLessThan(0.7);
      expect(Math.max(...factors)).toBeGreaterThan(1.4);
      // Symmetric in octaves: the mean log-factor is near zero.
      const meanOctaves = factors.reduce((sum, factor) => sum + Math.log2(factor), 0) / factors.length;
      expect(Math.abs(meanOctaves)).toBeLessThan(0.1);
    });

    it('never makes the level jump where one cycle hands over to the next', () => {
      // With the noise held at 1 the left output is the level times the
      // sway's gain; both move smoothly, so neighbouring samples stay close
      // even across cycle boundaries, where the new draw takes effect.
      const { samples } = recordCycles(1, 30);
      let largestStep = 0;
      for (let index = 1; index < samples.left.length; index += 1) {
        largestStep = Math.max(largestStep, Math.abs(samples.left[index] - samples.left[index - 1]));
      }
      expect(largestStep).toBeLessThan(0.05);
    });

    it('draws nothing and sways nowhere with no movement', () => {
      const { cycles, samples } = recordCycles(0, 10);
      expect(cycles.every((cycle) => cycle.panTo === 0 && cycle.periodFactor === 1 && cycle.riseFactor === 1)).toBe(true);
      expect(samples.left).toEqual(samples.right);
    });
  });
  it('does not render a silent layer, and a layer turned back up does not deliver the drops it missed', () => {
    const generator = createProcessor(29, makeRainSlots([makeRainChannel('rain', { volume: 0, dropsPerSecond: 60 })]));
    let births = 0;
    const addVoice = generator.processor.addVoice.bind(generator.processor);
    generator.processor.addVoice = (channel, isDrip, offset, at) => {
      births += 1;
      addVoice(channel, isDrip, offset, at);
    };
    generator.render(2);
    expect(births).toBe(0);
    generator.processor.port.onmessage?.({
      data: { type: 'configure', channels: toWorkletChannels(makeRainSlots([makeRainChannel('rain', { volume: 1, dropsPerSecond: 60 })]) as Parameters<typeof toWorkletChannels>[0]) },
    });
    generator.render(0.05);
    // 60 a second for 50 ms is about three; the two paused seconds are not owed.
    expect(births).toBeLessThan(15);
  });
  describe('noise loop', () => {
    const types = ['white', 'pink', 'brown'] as const;
    const loops = noiseLoopsAt(48000);

    // Brown noise moves by small steps, so a seam that jumped would stand out
    // against every other step in the loop; white is the control.
    it('crosses from its end back to its start like any other step', () => {
      for (const type of types) {
        const loop = loops[type];
        const steps = Array.from({ length: loop.length - 1 }, (_, index) => Math.abs(loop[index + 1] - loop[index])).sort((a, b) => a - b);
        const seam = Math.abs(loop[0] - loop[loop.length - 1]);
        expect(seam).toBeLessThanOrEqual(steps[Math.floor(steps.length * 0.999)]);
      }
    });

    it('is the same noise as generating it live, level for level', () => {
      for (const type of types) {
        const loop = loops[type];
        let seed = 7;
        const next = createNoiseSource(type, () => {
          seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
          return seed / 0x100000000;
        });
        const live = Array.from({ length: loop.length }, next);
        expect(Math.abs(rms(Array.from(loop)) - rms(live)) / rms(live)).toBeLessThan(0.1);
      }
    });

    it('is what every noise layer of that type reads, and a missing type plays silence', () => {
      const generator = createProcessor(12, [], 48000);
      expect(generator.processor.noiseLoop('pink')).toBe(loops.pink);
      const bare = createProcessor(12, [makeChannel('missing', { type: 'pink' })], 48000);
      (bare.processor as unknown as { noiseLoops: object }).noiseLoops = {};
      expect(bare.render(0.1).left.every((sample) => sample === 0)).toBe(true);
    });
  });

  describe('drop bank', () => {
    type RainState = { dropBank: unknown[]; activeVoices: { live: unknown }[] };
    const rainOf = (generator: ReturnType<typeof createProcessor>) => generator.processor.channels.at(-1) as unknown as RainState;

    // A fresh drop is one synthesised live (and recorded); the rest are
    // played back from the bank.
    function countFresh(generator: ReturnType<typeof createProcessor>) {
      const counts = { births: 0, fresh: 0 };
      const addVoice = generator.processor.addVoice.bind(generator.processor);
      const makeVoice = generator.processor.makeSurfaceVoice.bind(generator.processor);
      generator.processor.addVoice = (channel, isDrip, offset, at) => {
        counts.births += 1;
        addVoice(channel, isDrip, offset, at);
      };
      generator.processor.makeSurfaceVoice = (profile, isDrip) => {
        counts.fresh += 1;
        return makeVoice(profile, isDrip);
      };
      return counts;
    }

    it('records every drop while filling, then one in four, and holds no more than its size', () => {
      const generator = createProcessor(19, makeRainSlots([makeRainChannel('rain', { dropsPerSecond: 60, drips: 0, wash: 0 })]), 8000);
      generator.render(2);
      expect(rainOf(generator).dropBank.length).toBe(32);
      const counts = countFresh(generator);
      generator.render(60);
      expect(rainOf(generator).dropBank.length).toBe(32);
      expect(counts.fresh / counts.births).toBeGreaterThan(0.2);
      expect(counts.fresh / counts.births).toBeLessThan(0.3);
    });

    it('plays a recorded drop back exactly as it was recorded', () => {
      const generator = createProcessor(23, makeRainSlots([makeRainChannel('rain', { dropsPerSecond: 60, drips: 0, wash: 0 })]), 8000);
      generator.render(2);
      const entry = rainOf(generator).dropBank[0] as unknown as { samples: Float32Array; audibleLength: number };
      const out = new Float64Array(entry.audibleLength + 16);
      const voice = { live: null, entry, position: 0, startOffset: 16, level: 1 };
      (generator.processor as unknown as { playDrop: (v: unknown, o: Float64Array, n: number) => boolean }).playDrop(voice, out, out.length);
      expect(Array.from(out.subarray(0, 16)).every((value) => value === 0)).toBe(true);
      expect(Array.from(out.subarray(16))).toEqual(Array.from(entry.samples.subarray(0, entry.audibleLength)));
      // Only silence was cut: nothing past the playback length is audible.
      expect(Array.from(entry.samples.subarray(entry.audibleLength)).every((value) => Math.abs(value) <= 1e-5)).toBe(true);
    });

    it('empties when what a drop is recorded with changes, and not otherwise', () => {
      const slots = (changes: Partial<ReturnType<typeof createAmbientRainChannel>>) => makeRainSlots([makeRainChannel('rain', { dropsPerSecond: 60, ...changes })]);
      const generator = createProcessor(19, slots({}), 8000);
      generator.render(4);
      const configure = (changes: Partial<ReturnType<typeof createAmbientRainChannel>>) => generator.processor.port.onmessage?.({
        data: { type: 'configure', channels: toWorkletChannels(slots(changes) as Parameters<typeof toWorkletChannels>[0]) },
      });
      expect(rainOf(generator).dropBank.length).toBe(32);
      configure({ distance: 0.9, pan: 0.4, wash: 0.2, volume: 0.1 });
      expect(rainOf(generator).dropBank.length).toBe(32);
      for (const change of [{ wetness: 0.1 }, { resonance: 0.9 }, { surface: 1 }]) {
        configure(change);
        expect(rainOf(generator).dropBank.length).toBe(0);
        generator.render(4);
        expect(rainOf(generator).dropBank.length).toBe(32);
      }
    });

    it('keeps nothing recorded before the settings changed', () => {
      const slots = (resonance: number) => makeRainSlots([makeRainChannel('rain', { dropsPerSecond: 60, resonance })]);
      const generator = createProcessor(31, slots(0.4), 8000);
      generator.render(0.1);
      const before = new Set(rainOf(generator).dropBank);
      expect(before.size).toBeGreaterThan(0);
      generator.processor.port.onmessage?.({
        data: { type: 'configure', channels: toWorkletChannels(slots(0.9) as Parameters<typeof toWorkletChannels>[0]) },
      });
      generator.render(2);
      expect(rainOf(generator).dropBank.some((entry) => before.has(entry))).toBe(false);
    });

  });

  describe('noise width and distance', () => {
    const render = (overrides: NoiseOverrides) => createProcessor(41, [makeChannel('layer', {
      type: 'pink', modulationAmplitude: 0, volume: 0.5, ...overrides,
    })], 48000).render(1);
    const correlation = (a: number[], b: number[]) => {
      let ab = 0; let aa = 0; let bb = 0;
      for (let index = 0; index < a.length; index += 1) {
        ab += a[index] * b[index]; aa += a[index] * a[index]; bb += b[index] * b[index];
      }
      return ab / Math.sqrt(aa * bb);
    };

    it('narrows from two unrelated sides to one point without changing the level', () => {
      const wide = render({ width: 1 });
      const middle = render({ width: 0.5 });
      const point = render({ width: 0 });
      expect(Math.abs(correlation(wide.left, wide.right))).toBeLessThan(0.1);
      expect(correlation(middle.left, middle.right)).toBeGreaterThan(0.5);
      expect(point.left).toEqual(point.right);
      expect(Math.abs(rms(point.left) - rms(wide.left)) / rms(wide.left)).toBeLessThan(0.1);
    });

    it('moves the sound into the reverb and darkens it with distance', () => {
      const near = render({ distance: 0, type: 'white' });
      const far = render({ distance: 1, type: 'white' });
      // Direct sound falls, the reverb send rises.
      expect(rms(far.left)).toBeLessThan(rms(near.left) * 0.5);
      expect(rms(far.sendLeft)).toBeGreaterThan(rms(near.sendLeft) * 3);
      // Darker: white noise crosses zero far less often once low-passed.
      const crossings = (samples: number[]) => samples.reduce((count, value, index) => (
        index > 0 && (value >= 0) !== (samples[index - 1] >= 0) ? count + 1 : count), 0);
      expect(crossings(far.left)).toBeLessThan(crossings(near.left) * 0.5);
    });

    it('leaves a near, wide layer exactly as it was', () => {
      const plain = createProcessor(43, [makeChannel('layer', { type: 'brown' })], 16000).render(0.5);
      const explicit = createProcessor(43, [makeChannel('layer', { type: 'brown', distance: 0, width: 1 })], 16000).render(0.5);
      expect(explicit.left).toEqual(plain.left);
      expect(explicit.right).toEqual(plain.right);
    });
  });
  describe('tone', () => {
    const renderTone = (filter: number, type: 'white' | 'pink' | 'brown', seconds = 1) => createProcessor(51, [makeChannel('layer', {
      type, filter, modulationAmplitude: 0, volume: 0.5,
    })], 48000).render(seconds);

    // What makes the slider feel even: sweeping it changes the colour, not
    // the loudness -- for every noise type, across both halves.
    it('holds a layer near its loudness across the whole sweep', () => {
      for (const type of ['white', 'pink', 'brown'] as const) {
        const reference = rms(renderTone(0.5, type).left);
        for (const filter of [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 1]) {
          const decibels = 20 * Math.log10(rms(renderTone(filter, type).left) / reference);
          expect(Math.abs(decibels)).toBeLessThan(2);
        }
      }
    });

    it('darkens to the left and brightens to the right, a step at a time', () => {
      const crossings = (samples: number[]) => samples.reduce((count, value, index) => (
        index > 0 && (value >= 0) !== (samples[index - 1] >= 0) ? count + 1 : count), 0);
      const sweep = [0, 0.15, 0.3, 0.45, 0.5, 0.55, 0.7, 0.85, 1].map((filter) => crossings(renderTone(filter, 'pink', 0.5).left));
      for (let index = 1; index < sweep.length; index += 1) {
        expect(sweep[index]).toBeGreaterThan(sweep[index - 1]);
      }
    });

    it('does not reset the filter when the slider moves', () => {
      const generator = createProcessor(53, [makeChannel('layer', { type: 'white', filter: 0.2 })], 48000);
      const before = generator.render(0.2).left;
      generator.processor.port.onmessage?.({ data: { type: 'configure', channels: toConfigure([makeChannel('layer', { type: 'white', filter: 0.21 })]) } });
      const after = generator.render(0.01).left;
      // The first sample after the move continues from the last one before it.
      expect(Math.abs(after[0] - before.at(-1)!)).toBeLessThan(0.2);
    });
  });
  describe('surface scale', () => {
    const { constants } = createProcessor(1, [], 48000);
    const profile = constants.surfaceProfile;

    it('is each anchor exactly at its own position', () => {
      for (const anchor of constants.RAIN_SURFACE_ANCHORS) {
        expect(profile(anchor.at)).toEqual(anchor);
      }
    });

    it('blends pitch and time geometrically and the rest linearly between anchors', () => {
      const [forest, street] = constants.RAIN_SURFACE_ANCHORS as unknown as SurfaceProfile[];
      const halfway = profile(0.25);
      expect(halfway.click.centerHz[0]).toBeCloseTo(Math.sqrt(forest.click.centerHz[0] * street.click.centerHz[0]), 6);
      expect(halfway.durationSec).toBeCloseTo(Math.sqrt(forest.durationSec * street.durationSec), 9);
      expect(halfway.bed.gain).toBeCloseTo((forest.bed.gain + street.bed.gain) / 2, 9);
    });

    it('is the material only: standing water is the layer wetness, not part of the surface', () => {
      for (const at of [0, 0.25, 0.5, 0.75, 1]) {
        expect(JSON.stringify(profile(at))).not.toMatch(/bubble/i);
      }
      expect(constants.WET_BUBBLE_CHANCE).toBe(AMBIENT_WET_BUBBLE_CHANCE);
    });


    it('grows brighter, harder and longer-ringing from the leaves to the glass', () => {
      const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map(profile);
      for (let index = 1; index < steps.length; index += 1) {
        expect(steps[index].bed.centerHz).toBeGreaterThan(steps[index - 1].bed.centerHz);
      }
      // Ringing: the most treble modes a drop may have rises toward the glass.
      expect(steps[5].treble.count[1]).toBeGreaterThan(steps[3].treble.count[1]);
      expect(steps[3].treble.count[1]).toBeGreaterThan(steps[0].treble.count[1]);
    });
  });
});

describe('ambient thunder', () => {
  const rate = 8000;

  it('peals within seconds of starting, then is silent between peals', () => {
    const samples = createProcessor(5, makeThunderSlots([{ pealsPer10Min: 0.5, lengthSec: 4, distance: 0.8 }]), rate).render(30);
    const loud = samples.left.findIndex((value) => Math.abs(value) > 1e-3) / rate;
    expect(loud).toBeGreaterThan(3);
    expect(loud).toBeLessThan(13);
    // One peal lasting at most 4 s after its last rumble's stagger (under
    // 2 s), at an average of one every 20 minutes: the last stretch is
    // exactly silent.
    expect(samples.left.slice(-rate * 8).every((value) => value === 0)).toBe(true);
  });

  it('peals about as often as it is asked to', () => {
    const generator = createProcessor(17, makeThunderSlots([{ pealsPer10Min: 20, lengthSec: 4 }]), 1000);
    let peals = 0;
    const startPeal = generator.processor.startPeal.bind(generator.processor);
    generator.processor.startPeal = (channel) => { peals += 1; startPeal(channel); };
    generator.render(30 * 60);
    // 60 expected in half an hour; Poisson spread is about 8.
    expect(peals).toBeGreaterThan(40);
    expect(peals).toBeLessThan(80);
  });

  it('is brighter near than far', () => {
    const near = createProcessor(9, makeThunderSlots([{ distance: 0, lengthSec: 6 }]), rate).render(20).left;
    const far = createProcessor(9, makeThunderSlots([{ distance: 1, lengthSec: 6 }]), rate).render(20).left;
    expect(highShare(near, rate, 800)).toBeGreaterThan(5 * highShare(far, rate, 800));
  });

  /** RMS of consecutive 20 ms frames from the peal's first sound. */
  const frames = (samples: number[]) => {
    const start = samples.findIndex((value) => value !== 0);
    const size = rate / 50;
    const out: number[] = [];
    for (let at = start; at + size <= samples.length; at += size) out.push(rms(samples.slice(at, at + size)));
    return out;
  };

  it('rolls in: the loudest moment comes well after the first sound', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const levels = frames(createProcessor(seed, makeThunderSlots([{ lengthSec: 10, pealsPer10Min: 0.5 }]), rate).render(25).left);
      const peakFrame = levels.indexOf(Math.max(...levels));
      // 10 s long, peak at 22-40% of it; allow the loudest single stroke to
      // land a little early.
      expect(peakFrame * 0.02).toBeGreaterThan(1);
      // And the opening half second is well below the peak.
      expect(Math.max(...levels.slice(0, 25))).toBeLessThan(levels[peakFrame] * 0.4);
    }
  });

  it('gains structure with character: a cracking peal has many more sharp onsets than a rolling one', () => {
    // An onset: a 10 ms frame at least three times the level of the 30 ms
    // before it, within the body of the peal. Counted above 500 Hz: the
    // bed lives below that, and 10 ms frames of 100 Hz noise swing on their
    // own, so the full band cannot see a stroke from the bed's own jitter.
    const onsets = (character: number) => {
      let count = 0;
      for (const seed of [1, 2, 3]) {
        const raw = createProcessor(seed, makeThunderSlots([{ character, distance: 0.3, lengthSec: 10, pealsPer10Min: 0.5 }]), rate).render(25).left;
        const a = Math.exp((-2 * Math.PI * 500) / rate);
        let low = 0;
        const samples = raw.map((value) => {
          low = (a * low) + ((1 - a) * value);
          return value === 0 ? 0 : value - low;
        });
        const start = samples.findIndex((value) => value !== 0);
        const size = rate / 100;
        const levels: number[] = [];
        for (let at = start; at + size <= samples.length; at += size) levels.push(rms(samples.slice(at, at + size)));
        const loudest = Math.max(...levels);
        for (let index = 3; index < levels.length; index += 1) {
          const before = (levels[index - 1] + levels[index - 2] + levels[index - 3]) / 3;
          if (levels[index] > loudest * 0.1 && levels[index] > 3 * before) count += 1;
        }
      }
      return count;
    };
    const rolling = onsets(0);
    const cracking = onsets(1);
    expect(cracking).toBeGreaterThan(3 * Math.max(1, rolling));
  });

  it('never jumps from silence: the first 10 ms of a near peal stay quiet', () => {
    for (const seed of [1, 2, 3, 4]) {
      const samples = createProcessor(seed, makeThunderSlots([{ distance: 0 }]), rate).render(20).left;
      const start = samples.findIndex((value) => value !== 0);
      const peak = peakOf(samples);
      const opening = peakOf(samples.slice(start, start + (rate / 100)));
      expect(opening).toBeLessThan(peak * 0.5);
    }
  });

  it('holds a peal at its pan when spread is zero', () => {
    const samples = createProcessor(21, makeThunderSlots([{ pan: -1, spread: 0 }]), rate).render(20);
    expect(peakOf(samples.left)).toBeGreaterThan(1e-3);
    expect(peakOf(samples.right)).toBeLessThan(1e-9);
  });

  it('stays finite and bounded at every extreme, and renders the same whatever the block size', () => {
    const extremes = [
      { distance: 0, spread: 1, lengthSec: 30, pealsPer10Min: 20 },
      { distance: 1, spread: 0, lengthSec: 4, pealsPer10Min: 20 },
      { distance: 0.5, spread: 1, lengthSec: 30, pealsPer10Min: 0.5, pan: 1 },
    ];
    const large = createProcessor(33, makeThunderSlots(extremes), 6000, 128).render(16);
    const small = createProcessor(33, makeThunderSlots(extremes), 6000, 32).render(16);
    expect(small.left).toEqual(large.left);
    expect(small.right).toEqual(large.right);
    for (const value of [...large.left, ...large.right]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThan(4);
    }
    expect(peakOf(large.left)).toBeGreaterThan(0.01);
  });
});
