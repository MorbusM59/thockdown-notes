import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createSoundscapeChannel, SOUNDSCAPE_CHANNEL_ROSTER, DEFAULT_SOUNDSCAPE_WEATHER, type SoundscapeChannelSettings, type SoundscapeWeatherSettings } from '../shared/soundscape';
import { toWorkletChannel } from '../shared/soundscapeDsp';
import { buildNoiseLoops, noiseLoopGains, type NoiseLoops } from '../shared/soundscapeNoiseLoops';

export const generatorSource = `${readFileSync(fileURLToPath(new URL('../../public/soundscape-generator.js', import.meta.url)), 'utf8')}
;globalThis.__generator = { RAIN_SURFACE_ANCHORS, surfaceProfile, faderGain, WET_BUBBLE_CHANCE, RAIN_DRIPS_MAX_PER_SEC, CHIME_MATERIALS, chimeMaterial, FIRE_POP, partGain, waterRadiusBounds };`;

const loopsByRate = new Map<number, { loops: NoiseLoops; gains: Record<string, number> }>();
export function noiseAt(sampleRate: number) {
  if (!loopsByRate.has(sampleRate)) {
    const loops = buildNoiseLoops(sampleRate);
    loopsByRate.set(sampleRate, { loops, gains: noiseLoopGains(loops, sampleRate) });
  }
  return loopsByRate.get(sampleRate)!;
}

export interface Rendered { left: number[]; right: number[]; sendLeft: number[]; sendRight: number[] }

export function createProcessor(
  channels: SoundscapeChannelSettings[],
  { seed = 1, sampleRate = 16000, blockSize = 128, weather = DEFAULT_SOUNDSCAPE_WEATHER as SoundscapeWeatherSettings, loops }: { seed?: number; sampleRate?: number; blockSize?: number; weather?: SoundscapeWeatherSettings; loops?: NoiseLoops } = {},
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Processor!: new (options: unknown) => any;
  let frame = 0;
  class WorkletProcessorStub { port = { onmessage: null as ((event: { data: unknown }) => void) | null }; }
  const scope: Record<string, unknown> = {
    AudioWorkletProcessor: WorkletProcessorStub,
    sampleRate,
    get currentFrame() { return frame; },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerProcessor: (_name: string, processor: any) => { Processor = processor; },
  };
  runInNewContext(generatorSource, scope);
  const noise = noiseAt(sampleRate);
  const processor = new Processor({ processorOptions: { seed, noiseLoops: loops ?? noise.loops, noiseGains: loops ? { brown: 1, pink: 1, white: 1 } : noise.gains } });
  const configure = (next: SoundscapeChannelSettings[], nextWeather = weather) => {
    processor.port.onmessage?.({ data: { type: 'configure', channels: next.map(toWorkletChannel), weather: nextWeather } });
  };
  configure(channels);
  return {
    processor,
    configure,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constants: scope.__generator as any,
    get frame() { return frame; },
    render(seconds: number): Rendered {
      const out: Rendered = { left: [], right: [], sendLeft: [], sendRight: [] };
      const end = frame + Math.floor(seconds * sampleRate);
      while (frame < end) {
        const length = Math.min(blockSize, end - frame);
        const outputs = [[new Float32Array(length), new Float32Array(length)], [new Float32Array(length), new Float32Array(length)]];
        processor.process([], outputs);
        for (let i = 0; i < length; i += 1) {
          out.left.push(outputs[0][0][i]); out.right.push(outputs[0][1][i]);
          out.sendLeft.push(outputs[1][0][i]); out.sendRight.push(outputs[1][1][i]);
        }
        frame += length;
      }
      return out;
    },
  };
}

/** One roster channel of `kind`, enabled at fader 1, near and centred, with overrides. */
export function layer<K extends SoundscapeChannelSettings['kind']>(kind: K, overrides: Partial<Extract<SoundscapeChannelSettings, { kind: K }>> = {}, number = 1) {
  const entry = SOUNDSCAPE_CHANNEL_ROSTER.filter((item) => item.kind === kind)[number - 1];
  return createSoundscapeChannel(entry.id, kind, { enabled: true, volume: 1, ...overrides } as never);
}

export function rms(samples: number[]): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}
export function peak(samples: number[]): number {
  let max = 0;
  for (const sample of samples) max = Math.max(max, Math.abs(sample));
  return max;
}
