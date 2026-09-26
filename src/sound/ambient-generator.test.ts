import { describe, expect, it } from 'vitest';
import {
  AMBIENT_RAIN_DRIPS_MAX_PER_SEC,
  AMBIENT_RAIN_SURFACE_ANCHORS,
  ambientFaderGain,
  rainDropsPerSecond,
  type AmbientChannelSettings,
} from '../shared/ambientSound';
import { chimeTubeFrequencies } from '../shared/ambientSoundDsp';
import { buildNoiseLoops, createNoiseSource } from '../shared/ambientNoiseLoops';
import { createProcessor, layer, noiseAt, peak, rms, type Rendered } from './ambient-generator.harness';

// Tests here assert properties no tuning can falsify -- a level that holds,
// a rate that follows its slider, a rendering that does not depend on the
// block size. How any of it SOUNDS is for a listener, not for these.

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

function correlation(a: number[], b: number[]): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let index = 0; index < a.length; index += 1) {
    ab += a[index] * b[index];
    aa += a[index] * a[index];
    bb += b[index] * b[index];
  }
  return ab / Math.sqrt(aa * bb);
}

const everything = (out: Rendered) => [...out.left, ...out.right, ...out.sendLeft, ...out.sendRight];

/** Hold the scene's gust at `gust` (-1..1) instead of letting the weather move it. */
function holdGust(generator: ReturnType<typeof createProcessor>, gust: number) {
  generator.processor.advanceWeather = function advanceWeather(this: { gust: number }) { this.gust = gust; };
}

const KINDS = ['noise', 'rain', 'thunder', 'water', 'fire', 'chimes'] as const;
/** A layer of each kind that sounds within a couple of seconds. */
const busy = (kind: (typeof KINDS)[number]) => (kind === 'thunder' ? layer('thunder', { share: 1, randomness: 0 }) : layer(kind));

describe('the ambient worklet', () => {
  it('uses the same fader law as the settings', () => {
    const { constants } = createProcessor([]);
    for (const position of [0, 0.01, 0.25, 0.5, 0.75, 1]) {
      expect(constants.faderGain(position)).toBeCloseTo(ambientFaderGain(position), 12);
    }
  });

  it('renders every kind finite and bounded, and silent at fader 0', () => {
    for (const kind of KINDS) {
      const out = createProcessor([busy(kind)], { sampleRate: 8000 }).render(14);
      expect(everything(out).every(Number.isFinite)).toBe(true);
      expect(peak(out.left)).toBeGreaterThan(1e-3);
      expect(peak(out.left)).toBeLessThan(8);
      const silent = createProcessor([{ ...busy(kind), volume: 0 } as AmbientChannelSettings], { sampleRate: 8000 }).render(2);
      expect(everything(silent).every((value) => value === 0)).toBe(true);
    }
  });

  it('stays finite and bounded at every control extreme', () => {
    const extremes: AmbientChannelSettings[] = [
      layer('noise', { colour: 0, brightnessHz: 80, focus: 1, depth: 1, periodSec: 0.5, curve: 1, skew: 0.1, sweep: 1, variation: 1, sway: 1, width: 0, distance: 1, weather: 1 }, 1),
      layer('noise', { colour: 1, brightnessHz: 18000, focus: 1, depth: 1, periodSec: 0.5, curve: 0, skew: 0.9, sweep: -1, variation: 1, sway: 1, width: 1, weather: 1 }, 2),
      layer('rain', { intensity: 1, surface: 0.25, mix: 0.5, drips: 1, wetness: 1, resonance: 1, pan: -1, weather: 1 }, 1),
      layer('rain', { intensity: 1, surface: 0.75, mix: 1, drips: 1, wetness: 0, resonance: 0, pan: 1, weather: 1 }, 2),
      layer('water', { flow: 1, size: 1, turbulence: 1, pan: 1 }, 1),
      layer('water', { flow: 1, size: 0, turbulence: 1, pan: -1 }, 2),
      layer('fire', { size: 1, crackle: 1, pops: 1, weather: 1 }, 1),
      layer('chimes', { pitchHz: 1500, tubes: 8, ringSec: 15, activity: 1, hardness: 1, weather: 1 }, 1),
      layer('chimes', { pitchHz: 150, tubes: 3, ringSec: 1, activity: 1, hardness: 0 }, 2),
    ];
    const generator = createProcessor(extremes, { sampleRate: 16000, weather: { gustiness: 1, paceSec: 2 } });
    const out = generator.render(12);
    expect(everything(out).every(Number.isFinite)).toBe(true);
    expect(peak(out.left)).toBeLessThan(30);
  });

  it('renders the same whatever the block size', () => {
    for (const kind of KINDS) {
      // Thunder's first peal comes 4-12 s in.
      const render = (blockSize: number) => createProcessor([busy(kind)], { sampleRate: 6000, blockSize, weather: { gustiness: 0, paceSec: 2 } }).render(kind === 'thunder' ? 14 : 6);
      const large = render(128);
      const small = render(32);
      // Equal but for the order sums are taken in: voices that retire at a
      // block's end are dropped from a list in a different order, which
      // moves the last bit of a float and nothing a listener could hear.
      const worst = (a: number[], b: number[]) => a.reduce((max, value, index) => Math.max(max, Math.abs(value - b[index])), 0);
      expect(worst(small.left, large.left)).toBeLessThan(1e-6);
      expect(worst(small.sendRight, large.sendRight)).toBeLessThan(1e-6);
      expect(peak(large.left)).toBeGreaterThan(1e-3);
    }
  });

  it('plays each layer at its own level: another layer does not change it', () => {
    const rain = layer('rain');
    const alone = createProcessor([rain], { sampleRate: 8000 }).render(3);
    // A second layer, silent: if levels were shared out across the enabled
    // layers, the rain would come out quieter beside it.
    const beside = createProcessor([rain, layer('noise', { volume: 0 })], { sampleRate: 8000 }).render(3);
    expect(beside.left).toEqual(alone.left);
  });

  it('omits disabled layers and plays only the soloed one', () => {
    const noise = layer('noise');
    const fire = layer('fire');
    const noiseAlone = createProcessor([noise], { sampleRate: 8000 }).render(2);
    const withDisabled = createProcessor([noise, { ...fire, enabled: false }], { sampleRate: 8000 }).render(2);
    expect(withDisabled.left).toEqual(noiseAlone.left);
    // The fire soloed sounds exactly as the fire with the noise silenced:
    // the noise still runs, but none of it is heard.
    const soloed = createProcessor([noise, { ...fire, solo: true }], { sampleRate: 8000 }).render(2);
    const fireOnly = createProcessor([{ ...noise, volume: 0 }, fire], { sampleRate: 8000 }).render(2);
    expect(soloed.left).toEqual(fireOnly.left);
    expect(peak(soloed.left)).toBeGreaterThan(0);
  });

  it('moves every kind into the space and darkens it with distance, by one rule', () => {
    for (const kind of ['noise', 'rain', 'water', 'fire', 'chimes'] as const) {
      const at = (distance: number) => createProcessor([layer(kind, { distance } as never)], { sampleRate: 16000 }).render(8);
      const near = at(0);
      const far = at(1);
      const sendShare = (out: Rendered) => rms(out.sendLeft) / rms(out.left);
      expect(sendShare(far)).toBeGreaterThan(4 * sendShare(near));
      expect(rms(far.left)).toBeLessThan(rms(near.left));
      expect(highShare(far.left, 16000, 3000)).toBeLessThan(highShare(near.left, 16000, 3000));
    }
  });
});

describe('the weather', () => {
  it('leaves a layer that does not follow it exactly as it was', () => {
    const noise = layer('noise', { weather: 0 });
    const calm = createProcessor([noise], { sampleRate: 8000, weather: { gustiness: 0, paceSec: 4 } }).render(6);
    const squall = createProcessor([noise], { sampleRate: 8000, weather: { gustiness: 1, paceSec: 2 } }).render(6);
    expect(squall.left).toEqual(calm.left);
  });

  it('moves between gusts and lulls at about its pace, and only as far as the gustiness', () => {
    const generator = createProcessor([], { sampleRate: 4000, weather: { gustiness: 0.5, paceSec: 4 } });
    const gusts: number[] = [];
    for (let block = 0; block < 4000; block += 1) {
      generator.render(128 / 4000);
      gusts.push(generator.processor.gust);
    }
    expect(Math.max(...gusts.map(Math.abs))).toBeLessThanOrEqual(0.5);
    expect(Math.max(...gusts) - Math.min(...gusts)).toBeGreaterThan(0.3);
  });

  it('makes a noise layer louder and brighter in a gust and quieter and darker in a lull', () => {
    const noise = layer('noise', { weather: 1, brightnessHz: 1500, depth: 0 });
    const at = (gust: number) => {
      const generator = createProcessor([noise], { sampleRate: 16000 });
      holdGust(generator, gust);
      return generator.render(3).left;
    };
    const gust = at(1);
    const lull = at(-1);
    expect(rms(gust)).toBeGreaterThan(1.5 * rms(lull));
    expect(highShare(gust, 16000, 2000)).toBeGreaterThan(highShare(lull, 16000, 2000));
  });

  it('makes rain heavier, chimes busier and thunder sooner in a gust', () => {
    const rainAt = (gust: number) => {
      const generator = createProcessor([layer('rain', { intensity: 0.5, weather: 1 })], { sampleRate: 8000 });
      holdGust(generator, gust);
      generator.render(0.1);
      return generator.processor.channels[0].dropsPerSecond as number;
    };
    expect(rainAt(1)).toBeCloseTo(rainDropsPerSecond(0.8), 6);
    expect(rainAt(-1)).toBeCloseTo(rainDropsPerSecond(0.2), 6);

    const strikeRate = (gust: number) => {
      const generator = createProcessor([layer('chimes', { activity: 0.4, weather: 1 })], { sampleRate: 4000 });
      holdGust(generator, gust);
      generator.render(0.05);
      return generator.processor.chimeStrikeRate(generator.processor.channels[0]);
    };
    expect(strikeRate(1) / strikeRate(0)).toBeCloseTo(4, 6);
    expect(strikeRate(0) / strikeRate(-1)).toBeCloseTo(4, 6);

    const peals = (gust: number) => {
      const generator = createProcessor([layer('thunder', { share: 0.3, lengthSec: 4, randomness: 0, weather: 1 })], { sampleRate: 1000 });
      holdGust(generator, gust);
      let count = 0;
      const start = generator.processor.startPeal.bind(generator.processor);
      generator.processor.startPeal = (...args: unknown[]) => { count += 1; start(...args); };
      generator.render(300);
      return count;
    };
    expect(peals(1)).toBeGreaterThan(1.8 * peals(0));
  });
});

describe('noise layers', () => {
  const rate = 16000;
  const steady = (overrides: Partial<Extract<AmbientChannelSettings, { kind: 'noise' }>>) => layer('noise', { depth: 0, variation: 0, ...overrides });

  it('darkens from white through pink to brown', () => {
    const share = (colour: number) => highShare(createProcessor([steady({ colour })], { sampleRate: rate }).render(3).left, rate, 1000);
    expect(share(1)).toBeGreaterThan(share(0.5));
    expect(share(0.5)).toBeGreaterThan(share(0));
  });

  it('holds its loudness across colour, and across the filter at any focus', () => {
    const level = (overrides: Parameters<typeof steady>[0]) => rms(createProcessor([steady(overrides)], { sampleRate: rate }).render(4).left);
    const reference = level({ colour: 0.5 });
    for (const colour of [0, 0.25, 0.75, 1]) {
      expect(20 * Math.log10(level({ colour }) / reference)).toBeLessThan(3);
      expect(20 * Math.log10(level({ colour }) / reference)).toBeGreaterThan(-3);
    }
    for (const focus of [0, 0.5, 1]) {
      for (const brightnessHz of [200, 1000, 5000]) {
        const db = 20 * Math.log10(level({ colour: 0.5, focus, brightnessHz }) / reference);
        expect(Math.abs(db)).toBeLessThan(4);
      }
    }
  });

  it('focuses into a band around its brightness', () => {
    // Energy within a narrow band at the brightness (a two-pole band-pass,
    // Q 4), as a share of all of it.
    const inBand = (samples: number[], hz: number) => {
      const g = Math.tan((Math.PI * hz) / rate);
      const k = 1 / 4;
      const a1 = 1 / (1 + (g * (g + k)));
      let s1 = 0;
      let s2 = 0;
      const band = samples.map((input) => {
        const v3 = input - s2;
        const v1 = (a1 * s1) + (g * a1 * v3);
        const v2 = s2 + (g * a1 * s1) + (g * g * a1 * v3);
        s1 = (2 * v1) - s1;
        s2 = (2 * v2) - s2;
        return v1 * k;
      });
      return (rms(band) / rms(samples)) ** 2;
    };
    const share = (focus: number) => inBand(createProcessor([steady({ colour: 1, brightnessHz: 1500, focus })], { sampleRate: rate }).render(4).left, 1500);
    expect(share(1)).toBeGreaterThan(3 * share(0));
  });

  it('repeats its level exactly once per period with no variation', () => {
    const period = 2;
    const generator = createProcessor([layer('noise', { depth: 1, periodSec: period, variation: 0 })], { sampleRate: 4000 });
    const levels: number[] = [];
    for (let step = 0; step < 4000 * period * 2; step += 32) {
      generator.render(32 / 4000);
      levels.push(generator.processor.channels[0].level);
    }
    const perPeriod = (4000 * period) / 32;
    for (let index = 0; index < perPeriod; index += 7) {
      expect(levels[index + perPeriod]).toBeCloseTo(levels[index], 3);
    }
  });

  it('opens its filter as the swell rises when it sweeps, and closes it when it sweeps the other way', () => {
    // Brightness at the swell's peak against its trough.
    const peakOverTrough = (sweep: number) => {
      const generator = createProcessor([layer('noise', { colour: 1, brightnessHz: 1200, depth: 0.9, periodSec: 4, curve: 0.5, skew: 0.5, sweep, variation: 0 })], { sampleRate: rate });
      const out = generator.render(8).left;
      const phases: number[] = [];
      const window = rate / 10;
      const shares: Array<{ level: number; share: number }> = [];
      for (let at = 0; at + window <= out.length; at += window) {
        const slice = out.slice(at, at + window);
        shares.push({ level: rms(slice), share: highShare(slice, rate, 2400) });
        phases.push(at);
      }
      shares.sort((a, b) => a.level - b.level);
      const quiet = shares.slice(0, 10).reduce((sum, item) => sum + item.share, 0);
      const loud = shares.slice(-10).reduce((sum, item) => sum + item.share, 0);
      return loud / quiet;
    };
    expect(peakOverTrough(1)).toBeGreaterThan(1.5);
    expect(peakOverTrough(-1)).toBeLessThan(0.7);
  });

  // The swell must follow its curve smoothly whatever else rides on it. The
  // level is traced per control segment and its corners measured: the
  // largest change of slope between neighbouring segments, relative to the
  // typical slope. The filter's loudness compensation (with sweep) and the
  // weather (a new gust target) each once put corners several times the
  // cycle's own into it, heard as the swell moving in sections.
  it('follows its curve without corners, with the filter sweeping and the weather gusting', () => {
    const worstCorner = (overrides: Partial<Extract<AmbientChannelSettings, { kind: 'noise' }>>, gustiness = 0) => {
      const generator = createProcessor([layer('noise', { depth: 0.6, periodSec: 12, variation: 0, ...overrides })], { sampleRate: 8000, weather: { gustiness, paceSec: 12 } });
      const levels: number[] = [];
      for (let segment = 0; segment < (8000 * 60) / 32; segment += 1) {
        generator.render(32 / 8000);
        levels.push(generator.processor.channels[0].level);
      }
      const slopes = levels.slice(1).map((value, index) => value - levels[index]);
      const typical = slopes.reduce((sum, value) => sum + Math.abs(value), 0) / slopes.length;
      return Math.max(...slopes.slice(1).map((value, index) => Math.abs(value - slopes[index]) / typical));
    };
    const plain = worstCorner({});
    expect(worstCorner({ sweep: 1, brightnessHz: 1200 })).toBeLessThan(2 * plain);
    expect(worstCorner({ sweep: -1, brightnessHz: 3000, focus: 0.6 })).toBeLessThan(2 * plain);
    expect(worstCorner({ weather: 1 }, 0.4)).toBeLessThan(2 * plain);
  });

  it('varies each cycle\'s length around its period, keeping the tempo', () => {
    const generator = createProcessor([layer('noise', { variation: 1 })], { sampleRate: 4000 });
    const channel = generator.processor.channels[0];
    const factors = Array.from({ length: 3000 }, () => {
      generator.processor.startCycle(channel);
      return Math.log2(channel.periodFactor);
    });
    expect(Math.max(...factors)).toBeLessThanOrEqual(1);
    expect(Math.min(...factors)).toBeGreaterThanOrEqual(-1);
    expect(factors.reduce((sum, value) => sum + value, 0) / factors.length).toBeCloseTo(0, 1);
  });

  it('sways to the other side of centre on every cycle, within its reach, and nowhere at 0', () => {
    const generator = createProcessor([layer('noise', { sway: 1 })], { sampleRate: 4000 });
    const channel = generator.processor.channels[0];
    let last = 0;
    for (let index = 0; index < 50; index += 1) {
      generator.processor.startCycle(channel);
      expect(Math.abs(channel.panTo)).toBeLessThanOrEqual(0.8);
      if (last !== 0) expect(Math.sign(channel.panTo)).toBe(-Math.sign(last));
      last = channel.panTo;
    }
    const still = createProcessor([layer('noise', { sway: 0, variation: 1 })], { sampleRate: 4000 });
    const stillChannel = still.processor.channels[0];
    still.processor.startCycle(stillChannel);
    expect(stillChannel.panTo).toBe(0);
  });

  it('narrows from two unrelated sides to one point without changing its level', () => {
    const at = (width: number) => createProcessor([steady({ width })], { sampleRate: rate }).render(3);
    const wide = at(1);
    const point = at(0);
    expect(Math.abs(correlation(wide.left, wide.right))).toBeLessThan(0.1);
    expect(correlation(point.left, point.right)).toBeGreaterThan(0.99);
    expect(rms(point.left) / rms(wide.left)).toBeGreaterThan(0.9);
    expect(rms(point.left) / rms(wide.left)).toBeLessThan(1.1);
  });
});

describe('noise loops', () => {
  const types = ['white', 'pink', 'brown'] as const;
  const loops = buildNoiseLoops(48000);
  const randomFrom = (start: number) => {
    let seed = start;
    return () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
  };

  it('cross from their end back to their start like any other step', () => {
    for (const type of types) {
      const loop = loops[type];
      const steps = Array.from({ length: loop.length - 1 }, (_, index) => Math.abs(loop[index + 1] - loop[index])).sort((a, b) => a - b);
      expect(Math.abs(loop[0] - loop[loop.length - 1])).toBeLessThanOrEqual(steps[Math.floor(steps.length * 0.999)]);
    }
  });

  it('are Paul Kellet\'s pink filter exactly at the rate it was fitted for', () => {
    const next = createNoiseSource('pink', randomFrom(5), 44100);
    const random = randomFrom(5);
    const b = [0, 0, 0, 0, 0, 0, 0];
    for (let index = 0; index < 20000; index += 1) {
      const white = (random() * 2) - 1;
      b[0] = (0.99886 * b[0]) + (white * 0.0555179);
      b[1] = (0.99332 * b[1]) + (white * 0.0750759);
      b[2] = (0.969 * b[2]) + (white * 0.153852);
      b[3] = (0.8665 * b[3]) + (white * 0.3104856);
      b[4] = (0.55 * b[4]) + (white * 0.5329522);
      b[5] = (-0.7616 * b[5]) - (white * 0.016898);
      const expected = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + (white * 0.5362)) * 0.11;
      b[6] = white * 0.115926;
      expect(next()).toBeCloseTo(expected, 9);
    }
  });

  it('are brought to one audible level, so colour can move between them', () => {
    const { loops: rateLoops, gains } = noiseAt(16000);
    for (const type of types) {
      const loop = rateLoops[type];
      const pole = Math.exp((-2 * Math.PI * 20) / 16000);
      let low = 0;
      let power = 0;
      for (const sample of loop) {
        low = (pole * low) + ((1 - pole) * sample);
        power += (sample - low) ** 2;
      }
      expect(Math.sqrt(power / loop.length) * gains[type]).toBeCloseTo(0.25, 6);
    }
  });
});

describe('rain', () => {
  it('has a synthesis profile for every surface the settings can name', () => {
    const { constants } = createProcessor([]);
    expect(constants.RAIN_SURFACE_ANCHORS.map(({ name, at }: { name: string; at: number }) => ({ name, at })))
      .toEqual(AMBIENT_RAIN_SURFACE_ANCHORS.map(({ name, at }) => ({ name, at })));
    expect(constants.RAIN_DRIPS_MAX_PER_SEC).toBe(AMBIENT_RAIN_DRIPS_MAX_PER_SEC);
    // Every anchor carries every field the blend reads.
    const keys = (value: object): string[] => Object.entries(value).flatMap(([key, inner]) => (
      inner && typeof inner === 'object' && !Array.isArray(inner) ? keys(inner).map((sub) => `${key}.${sub}`) : [key]
    )).sort();
    const first = keys(constants.RAIN_SURFACE_ANCHORS[0]);
    for (const anchor of constants.RAIN_SURFACE_ANCHORS) expect(keys(anchor)).toEqual(first);
  });

  it('falls at the rate its intensity sets, and washes louder as it gets heavier', () => {
    const births = (intensity: number) => {
      const generator = createProcessor([layer('rain', { intensity, drips: 0 })], { sampleRate: 4000 });
      let count = 0;
      const add = generator.processor.addVoice.bind(generator.processor);
      generator.processor.addVoice = (...args: unknown[]) => { count += 1; add(...args); };
      generator.render(40);
      return count / 40;
    };
    for (const intensity of [0.2, 0.6]) {
      expect(births(intensity) / rainDropsPerSecond(intensity)).toBeGreaterThan(0.8);
      expect(births(intensity) / rainDropsPerSecond(intensity)).toBeLessThan(1.2);
    }
    const wash = (intensity: number) => rms(createProcessor([layer('rain', { intensity, mix: 0 })], { sampleRate: 8000 }).render(4).left);
    expect(wash(1)).toBeGreaterThan(3 * wash(0));
  });

  describe('wetness and resonance', () => {
    const generator = createProcessor([], { sampleRate: 48000, seed: 523 });
    const { processor, constants } = generator;
    const voices = (surface: number, character: { wetness: number; resonance: number }, count = 400) => (
      Array.from({ length: count }, () => processor.makeSurfaceVoice(constants.surfaceProfile(surface), false, character))
    );
    const decayTime = (mode: { decay: number }) => -1 / (48000 * Math.log(mode.decay));

    it('sends a share of drops into water with wetness, each with a splash, spray and a bubble', () => {
      const dry = voices(0.5, { wetness: 0, resonance: 0.5 });
      const soaked = voices(0.5, { wetness: 1, resonance: 0.5 });
      expect(dry.every((voice: { bubble: unknown }) => voice.bubble === null)).toBe(true);
      const wet = soaked.filter((voice: { bubble: unknown }) => voice.bubble !== null);
      expect(wet.length / soaked.length).toBeGreaterThan(constants.WET_BUBBLE_CHANCE - 0.07);
      expect(wet.length / soaked.length).toBeLessThan(constants.WET_BUBBLE_CHANCE + 0.07);
    });

    it('damps the ring as the surface gets wetter', () => {
      const ring = (wetness: number) => voices(1, { wetness, resonance: 0.5 }, 60)
        .flatMap((voice: { bassModes: Array<{ decay: number }> }) => voice.bassModes)
        .reduce((sum: number, mode: { decay: number }) => sum + decayTime(mode), 0);
      expect(ring(1)).toBeLessThan(ring(0) * 0.6);
    });

    it('rings not at all when dead', () => {
      expect(voices(1, { wetness: 0, resonance: 0 }, 20).every((voice: { bassModes: unknown[]; bodyModes: unknown[]; trebleModes: unknown[] }) => (
        voice.bassModes.length + voice.bodyModes.length + voice.trebleModes.length === 0
      ))).toBe(true);
    });
  });

  describe('drop bank', () => {
    const rainOf = (generator: ReturnType<typeof createProcessor>) => generator.processor.channels[0];

    it('records every drop while filling, then one in four, and holds no more than its size', () => {
      const generator = createProcessor([layer('rain', { intensity: 0.9, drips: 0, mix: 1 })], { sampleRate: 8000, seed: 19 });
      generator.render(2);
      expect(rainOf(generator).dropBank.length).toBe(32);
      const counts = { births: 0, fresh: 0 };
      const add = generator.processor.addVoice.bind(generator.processor);
      const make = generator.processor.makeSurfaceVoice.bind(generator.processor);
      generator.processor.addVoice = (...args: unknown[]) => { counts.births += 1; add(...args); };
      generator.processor.makeSurfaceVoice = (...args: unknown[]) => { counts.fresh += 1; return make(...args); };
      generator.render(30);
      expect(counts.fresh / counts.births).toBeGreaterThan(0.2);
      expect(counts.fresh / counts.births).toBeLessThan(0.3);
    });

    it('empties when what a drop is recorded with changes, and not for intensity, placement or the weather', () => {
      const base = layer('rain', { intensity: 0.9 });
      const generator = createProcessor([base], { sampleRate: 8000, weather: { gustiness: 1, paceSec: 2 } });
      generator.render(4);
      expect(rainOf(generator).dropBank.length).toBe(32);
      generator.configure([{ ...base, intensity: 0.4, distance: 0.9, pan: 0.4, mix: 0.9, volume: 0.1, weather: 1 }]);
      generator.render(4);
      expect(rainOf(generator).dropBank.length).toBe(32);
      generator.configure([{ ...base, surface: 1 }]);
      expect(rainOf(generator).dropBank.length).toBe(0);
    });
  });

  it('fills the field in the centre and is all on one side at the edge', () => {
    const centre = createProcessor([layer('rain', { pan: 0, distance: 0, drips: 0, intensity: 0.9 })], { sampleRate: 8000 }).render(12);
    expect(rms(centre.left) / rms(centre.right)).toBeGreaterThan(0.75);
    expect(rms(centre.left) / rms(centre.right)).toBeLessThan(1.33);
    expect(correlation(centre.left, centre.right)).toBeLessThan(0.6);
    const edge = createProcessor([layer('rain', { pan: -1, distance: 0 })], { sampleRate: 8000 }).render(6);
    expect(peak(edge.right)).toBeLessThan(1e-6);
  });
});

describe('thunder', () => {
  const steady = (overrides: Partial<Extract<AmbientChannelSettings, { kind: 'thunder' }>>) => layer('thunder', { randomness: 0, ...overrides });
  const countPeals = (generator: ReturnType<typeof createProcessor>) => {
    let peals = 0;
    const start = generator.processor.startPeal.bind(generator.processor);
    generator.processor.startPeal = (...args: unknown[]) => { peals += 1; start(...args); };
    return () => peals;
  };

  it('peals within seconds of starting, then is silent for as long as its share says', () => {
    const out = createProcessor([steady({ share: 0.01, lengthSec: 4, distance: 0.8 })], { sampleRate: 8000, seed: 5 }).render(30);
    const first = out.left.findIndex((value) => Math.abs(value) > 1e-4) / 8000;
    expect(first).toBeGreaterThan(3);
    expect(first).toBeLessThan(13);
    expect(out.left.slice(-8000 * 8).every((value) => value === 0)).toBe(true);
  });

  it('spaces peals by the share: as long silent as sounding at the middle, no pause at the top, never at zero', () => {
    const peals = (share: number) => {
      const generator = createProcessor([steady({ share, lengthSec: 4 })], { sampleRate: 1000, seed: 17, weather: { gustiness: 0, paceSec: 10 } });
      const count = countPeals(generator);
      generator.render(100);
      return count();
    };
    expect(peals(0)).toBe(0);
    expect(peals(0.5)).toBeGreaterThanOrEqual(12);
    expect(peals(0.5)).toBeLessThanOrEqual(13);
    expect(peals(1)).toBeGreaterThanOrEqual(23);
    expect(peals(1)).toBeLessThanOrEqual(25);
  });

  it('is brighter near than far', () => {
    const near = createProcessor([steady({ distance: 0, lengthSec: 6, share: 0.01 })], { sampleRate: 8000, seed: 9 }).render(20).left;
    const far = createProcessor([steady({ distance: 1, lengthSec: 6, share: 0.01 })], { sampleRate: 8000, seed: 9 }).render(20).left;
    expect(highShare(near, 8000, 300)).toBeGreaterThan(2 * highShare(far, 8000, 300));
  });

  it('never jumps from silence: the first 10 ms of a near peal stay quiet', () => {
    for (const seed of [1, 2, 3]) {
      const out = createProcessor([steady({ distance: 0, share: 0.01 })], { sampleRate: 8000, seed }).render(20).left;
      const start = out.findIndex((value) => value !== 0);
      expect(peak(out.slice(start, start + 80))).toBeLessThan(peak(out) * 0.5);
    }
  });

  it('holds a peal at its pan when spread is zero', () => {
    const out = createProcessor([steady({ pan: -1, spread: 0, share: 0.01 })], { sampleRate: 8000, seed: 21 }).render(20);
    expect(peak(out.left)).toBeGreaterThan(1e-3);
    expect(peak(out.right)).toBeLessThan(1e-9);
  });
});

describe('water', () => {
  const births = (overrides: Partial<Extract<AmbientChannelSettings, { kind: 'water' }>>, seconds = 20) => {
    const generator = createProcessor([layer('water', overrides)], { sampleRate: 8000 });
    const times: number[] = [];
    const make = generator.processor.makeBubble.bind(generator.processor);
    generator.processor.makeBubble = (...args: unknown[]) => { times.push(generator.frame); return make(...args); };
    generator.render(seconds);
    return times;
  };

  it('bubbles faster as it flows harder', () => {
    expect(births({ flow: 1, turbulence: 0 }).length).toBeGreaterThan(5 * births({ flow: 0.2, turbulence: 0 }).length);
  });

  it('keeps its average flow at any turbulence, but clumps it into bursts', () => {
    const counts = (turbulence: number) => {
      const times = births({ flow: 0.6, turbulence }, 40);
      const windows = new Array(400).fill(0);
      for (const frame of times) windows[Math.min(399, Math.floor(frame / 800))] += 1;
      const mean = windows.reduce((sum, value) => sum + value, 0) / windows.length;
      const variance = windows.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / windows.length;
      return { mean, spread: variance / mean };
    };
    const even = counts(0);
    const tumbling = counts(1);
    expect(tumbling.mean / even.mean).toBeGreaterThan(0.7);
    expect(tumbling.mean / even.mean).toBeLessThan(1.4);
    expect(tumbling.spread).toBeGreaterThan(3 * even.spread);
  });

  it('sounds lower with larger bubbles', () => {
    const share = (size: number) => highShare(createProcessor([layer('water', { size, flow: 0.7 })], { sampleRate: 16000 }).render(6).left, 16000, 2500);
    expect(share(1)).toBeLessThan(share(0));
  });
});

describe('fire', () => {
  it('crackles at the rate its slider sets, and pops only when asked', () => {
    const bursts = (overrides: Partial<Extract<AmbientChannelSettings, { kind: 'fire' }>>) => {
      const generator = createProcessor([layer('fire', overrides)], { sampleRate: 8000 });
      let count = 0;
      const spawn = generator.processor.spawnBurst.bind(generator.processor);
      generator.processor.spawnBurst = (...args: unknown[]) => { count += 1; spawn(...args); };
      generator.render(30);
      return count;
    };
    expect(bursts({ crackle: 1, pops: 0 })).toBeGreaterThan(8 * bursts({ crackle: 0.2, pops: 0 }));
    const popsOf = (pops: number) => {
      const generator = createProcessor([layer('fire', { crackle: 0, pops })], { sampleRate: 8000 });
      return generator.processor.channels[0].nextPopFrame;
    };
    expect(popsOf(0)).toBe(Infinity);
    expect(Number.isFinite(popsOf(0.5))).toBe(true);
  });

  it('roars louder and lower as it grows', () => {
    const low = (size: number) => {
      const out = createProcessor([layer('fire', { size, crackle: 0, pops: 0 })], { sampleRate: 8000 }).render(6).left;
      return rms(out) * (1 - highShare(out, 8000, 300));
    };
    expect(low(1)).toBeGreaterThan(2 * low(0));
  });
});

describe('chimes', () => {
  it('tunes its tubes up a pentatonic scale, each ringing the modes of a free bar', () => {
    const tubes = chimeTubeFrequencies(400, 5);
    expect(tubes.map((hz) => 12 * Math.log2(hz / 400))).toEqual([0, 2, 4, 7, 9].map((value) => expect.closeTo(value, 9)));
    const generator = createProcessor([layer('chimes', { pitchHz: 400, tubes: 5 })], { sampleRate: 48000 });
    const tube = generator.processor.channels[0].tubeState[0];
    const frequencyOf = (oscillator: { rotationSin: number; rotationCos: number }) => (Math.atan2(oscillator.rotationSin, oscillator.rotationCos) * 48000) / (2 * Math.PI);
    const fundamental = frequencyOf(tube.oscillators[0]);
    generator.constants.CHIME_MODE_RATIOS.forEach((ratio: number, mode: number) => {
      expect(frequencyOf(tube.oscillators[mode * 2]) / fundamental).toBeCloseTo(ratio, 6);
      // The doublet's partner, a fraction of a hertz above.
      const split = frequencyOf(tube.oscillators[(mode * 2) + 1]) - frequencyOf(tube.oscillators[mode * 2]);
      expect(split).toBeGreaterThan(0.1);
      expect(split).toBeLessThan(1.5);
    });
  });

  it('adds a strike to a ringing tube without a jump in its output', () => {
    const generator = createProcessor([layer('chimes', { activity: 0 })], { sampleRate: 48000 });
    const channel = generator.processor.channels[0];
    const tube = channel.tubeState[0];
    generator.processor.strikeTube(channel, tube, 1);
    const left = new Float64Array(500);
    const right = new Float64Array(500);
    generator.processor.renderTubes(channel, left, right, 0, 250);
    const before = tube.oscillators.map((oscillator: { sin: number; amplitude: number }) => oscillator.sin * oscillator.amplitude);
    generator.processor.strikeTube(channel, tube, 1);
    const after = tube.oscillators.map((oscillator: { sin: number; amplitude: number }) => oscillator.sin * oscillator.amplitude);
    after.forEach((value: number, index: number) => expect(value).toBeCloseTo(before[index], 12));
    generator.processor.renderTubes(channel, left, right, 250, 500);
    let jump = 0;
    for (let index = 1; index < 500; index += 1) jump = Math.max(jump, Math.abs(left[index] - left[index - 1]));
    expect(jump).toBeLessThan(peak(Array.from(left)) * 0.5);
  });

  it('rings its upper modes harder with a hard clapper', () => {
    const upperShare = (hardness: number) => {
      const generator = createProcessor([layer('chimes', { hardness, activity: 0 })], { sampleRate: 48000, seed: 3 });
      const channel = generator.processor.channels[0];
      const tube = channel.tubeState[0];
      generator.processor.strikeTube(channel, tube, 1);
      const amplitudes = tube.oscillators.map((oscillator: { amplitude: number }) => oscillator.amplitude);
      const fundamental = amplitudes[0] + amplitudes[1];
      return (amplitudes.slice(2).reduce((sum: number, value: number) => sum + value, 0)) / fundamental;
    };
    expect(upperShare(1)).toBeGreaterThan(2 * upperShare(0));
  });

  it('keeps its tubes ringing through a retune', () => {
    const base = layer('chimes', { activity: 0, pitchHz: 400 });
    const generator = createProcessor([base], { sampleRate: 16000 });
    const channel = generator.processor.channels[0];
    generator.processor.strikeTube(channel, channel.tubeState[0], 1);
    const before = channel.tubeState[0].oscillators[0].amplitude;
    generator.configure([{ ...base, pitchHz: 600 }]);
    expect(generator.processor.channels[0].tubeState[0].oscillators[0].amplitude).toBe(before);
  });
});
