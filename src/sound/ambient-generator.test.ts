import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createAmbientChannel } from '../shared/ambientSound';
import { buildAmbientEnvelope } from '../shared/ambientSoundDsp';

const generatorSource = readFileSync(fileURLToPath(new URL('../../public/ambient-generator.js', import.meta.url)), 'utf8');

type TestProcessor = {
  channels: Array<{ id: string; eventAge: number }>;
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  eventDelayFrames: (ratePerSecond: number) => number;
  envelopeAt: (channel: unknown, progress: number) => number;
  noise: (channel: unknown) => number;
  process: (inputs: unknown[], outputs: Float32Array[][]) => boolean;
}

type TestChannel = ReturnType<typeof createAmbientChannel> & { envelope: Float32Array }

function makeChannel(id: string, overrides: Partial<ReturnType<typeof createAmbientChannel>> = {}): TestChannel {
  const settings = {
    ...createAmbientChannel(id),
    volume: 1,
    type: 'white' as const,
    ...overrides,
  }
  return { ...settings, envelope: buildAmbientEnvelope(settings.ramp, settings.shape) }
}

function createProcessor(seed: number, channels: TestChannel[], sampleRate = 12000) {
  let Processor!: new (options: unknown) => TestProcessor;
  let frame = 0;
  class WorkletProcessorStub {
    port = { onmessage: null as ((event: { data: unknown }) => void) | null };
  }
  const scope = {
    AudioWorkletProcessor: WorkletProcessorStub,
    sampleRate,
    get currentFrame() { return frame; },
    registerProcessor: (_name: string, processor: new (options: unknown) => TestProcessor) => { Processor = processor; },
  };
  runInNewContext(generatorSource, scope);
  const processor = new Processor!({ processorOptions: { seed } });
  processor.port.onmessage?.({ data: { type: 'configure', channels } });

  return {
    processor,
    render(seconds: number) {
      const samples = { left: [] as number[], right: [] as number[] };
      const endFrame = frame + Math.floor(seconds * sampleRate);
      while (frame < endFrame) {
        const blockLength = Math.min(128, endFrame - frame);
        const outputs = [[new Float32Array(blockLength), new Float32Array(blockLength)]];
        processor.process([], outputs);
        samples.left.push(...outputs[0][0]);
        samples.right.push(...outputs[0][1]);
        frame += blockLength;
      }
      return samples;
    },
  };
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
      generator.processor.noise = () => 1;
    }

    const expected = enabledOnly.render(0.2);
    const actual = withDisabled.render(0.2);
    expect(withDisabled.processor.channels.map((channel) => channel.id)).toEqual(['enabled']);
    expect(actual.left).toEqual(expected.left);
    expect(actual.right).toEqual(expected.right);
  });

  it('uses modulation amplitude and period to shape continuous noise', () => {
    const unmodulatedGenerator = createProcessor(119, [makeChannel('unmodulated', {
      modulationAmplitude: 0,
      modulationPeriodSec: 0.5,
    })]);
    const modulatedGenerator = createProcessor(119, [makeChannel('modulated', {
      modulationAmplitude: 1,
      modulationPeriodSec: 0.5,
    })]);
    const slowerGenerator = createProcessor(119, [makeChannel('slower', {
      modulationAmplitude: 1,
      modulationPeriodSec: 1,
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

  it('spaces burst events randomly and increases their average rate with density', () => {
    const lowDensity = createProcessor(211, [makeChannel('low', {
      modulationPeriodSec: 0,
      densityPer10Sec: 1,
      speedSec: 0,
    })], 1000);
    const highDensity = createProcessor(211, [makeChannel('high', {
      modulationPeriodSec: 0,
      densityPer10Sec: 100,
      speedSec: 0,
    })], 1000);
    const lowDelay = lowDensity.processor.eventDelayFrames.bind(lowDensity.processor);
    const highDelay = highDensity.processor.eventDelayFrames.bind(highDensity.processor);
    let randomDelayCount = 0;
    const randomDelays = Array.from({ length: 8 }, () => {
      randomDelayCount += 1;
      return highDelay(5);
    });
    let lowBurstStarts = 0;
    let highBurstStarts = 0;
    const countStarts = (generator: ReturnType<typeof createProcessor>, counter: () => void) => {
      const envelopeAt = generator.processor.envelopeAt.bind(generator.processor);
      generator.processor.envelopeAt = (channel, progress) => {
        if (progress === 0) counter();
        return envelopeAt(channel, progress);
      };
    };
    countStarts(lowDensity, () => { lowBurstStarts += 1; });
    countStarts(highDensity, () => { highBurstStarts += 1; });
    lowDensity.processor.eventDelayFrames = lowDelay;
    highDensity.processor.eventDelayFrames = highDelay;
    lowDensity.render(10);
    highDensity.render(10);
    expect(randomDelayCount).toBe(8);
    expect(new Set(randomDelays).size).toBeGreaterThan(1);
    expect(highBurstStarts).toBeGreaterThan(50);
    expect(highBurstStarts).toBeGreaterThan(lowBurstStarts * 10);
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
});