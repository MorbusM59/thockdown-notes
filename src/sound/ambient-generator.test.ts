import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildAmbientEnvelopeBank, resolveAmbientTextureProfile } from '../shared/ambientSoundDsp';

const generatorSource = readFileSync(new URL('../../public/ambient-generator.js', import.meta.url), 'utf8');

function createProcessor(seed: number, texture: number, envelopes = buildAmbientEnvelopeBank(texture)) {
  let Processor: new (options: unknown) => { port: { onmessage: ((event: { data: unknown }) => void) | null }; process: (inputs: unknown[], outputs: Float32Array[][]) => boolean };
  let frame = 0;
  class WorkletProcessorStub {
    port = { onmessage: null as ((event: { data: unknown }) => void) | null };
  }
  const scope = {
    AudioWorkletProcessor: WorkletProcessorStub,
    sampleRate: 12000,
    get currentFrame() { return frame; },
    registerProcessor: (_name: string, processor: typeof Processor) => { Processor = processor; },
  };
  runInNewContext(generatorSource, scope);
  const processor = new Processor!({ processorOptions: { seed } });
  const layers = Object.fromEntries(['wind', 'ocean', 'rain'].map((layerId) => [layerId, {
    texture,
    profile: resolveAmbientTextureProfile(texture),
    envelopes: envelopes.map((entry) => Array.from(entry)),
  }]));
  processor.port.onmessage?.({ data: { type: 'configure', layers } });

  return {
    render(seconds: number) {
      const samples: number[][] = [[], [], []];
      const endFrame = frame + Math.floor(seconds * scope.sampleRate);
      while (frame < endFrame) {
        const blockLength = Math.min(128, endFrame - frame);
        const outputs = Array.from({ length: 3 }, () => [new Float32Array(blockLength), new Float32Array(blockLength)]);
        processor.process([], outputs);
        outputs.forEach((output, layerIndex) => samples[layerIndex].push(...output[0]));
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
  it('generates three finite, bounded, non-silent stereo noise layers', () => {
    const samples = createProcessor(73, 0.2).render(0.4);
    expect(samples).toHaveLength(3);
    for (const layer of samples) {
      expect(layer.some((sample) => Math.abs(sample) > 0.001)).toBe(true);
      expect(layer.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1)).toBe(true);
    }
    expect(samples[0]).not.toEqual(samples[1]);
  });

  it('uses the shared curve envelope bank to shape irregular one-shot energy', () => {
    const active = createProcessor(119, 1).render(4);
    const silentEnvelopes = buildAmbientEnvelopeBank(1).map((envelope) => new Float32Array(envelope.length));
    const withoutEvents = createProcessor(119, 1, silentEnvelopes).render(4);
    const activeEnergy = rms(active[0]);
    const baseEnergy = rms(withoutEvents[0]);
    expect(activeEnergy).toBeGreaterThan(baseEnergy);
  });
});