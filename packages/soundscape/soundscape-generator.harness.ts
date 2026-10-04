import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSoundscapeChannel, SOUNDSCAPE_CHANNEL_ROSTER, DEFAULT_SOUNDSCAPE_WEATHER, type SoundscapeChannelSettings, type SoundscapeWeatherSettings } from './soundscape';
import { toGeneratorChannel } from './soundscapeDsp';
import { buildNoiseLoops, noiseLoopGains, type NoiseLoops } from './soundscapeNoiseLoops';
import { createGeneratorBlock, hostGenerator } from './soundscapeGeneratorHost';

export const generatorSource = readFileSync(fileURLToPath(new URL('./soundscape-generator.js', import.meta.url)), 'utf8');
/** The generator's constants the tests compare against the app's own. */
const GENERATOR_EXPORTS = '{ RAIN_SURFACE_ANCHORS, surfaceProfile, faderGain, WET_BUBBLE_CHANCE, RAIN_DRIPS_MAX_PER_SEC, CHIME_MATERIALS, chimeMaterial, FIRE_POP, partGain, waterRadiusBounds }';

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
  const noise = noiseAt(sampleRate);
  const generator = hostGenerator(generatorSource, sampleRate, {
    seed,
    noiseLoops: loops ?? noise.loops,
    noiseGains: loops ? { brown: 1, pink: 1, white: 1 } : noise.gains,
  }, GENERATOR_EXPORTS);
  const configure = (next: SoundscapeChannelSettings[], nextWeather = weather, level = 1) => {
    generator.configure({ type: 'configure', channels: next.map(toGeneratorChannel), weather: nextWeather, level });
  };
  configure(channels);
  return {
    processor: generator.processor,
    configure,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constants: generator.exports as any,
    get frame() { return generator.frame; },
    render(seconds: number): Rendered {
      const out: Rendered = { left: [], right: [], sendLeft: [], sendRight: [] };
      const end = generator.frame + Math.floor(seconds * sampleRate);
      while (generator.frame < end) {
        const block = createGeneratorBlock(Math.min(blockSize, end - generator.frame));
        generator.renderBlock(block);
        for (let i = 0; i < block.direct[0].length; i += 1) {
          out.left.push(block.direct[0][i]); out.right.push(block.direct[1][i]);
          out.sendLeft.push(block.send[0][i]); out.sendRight.push(block.send[1][i]);
        }
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
