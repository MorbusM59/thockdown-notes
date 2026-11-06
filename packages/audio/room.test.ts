import { describe, expect, it } from 'vitest';
import { buildRoomImpulseResponse, roomDecaySec } from './room';

describe('the room', () => {
  const rate = 16000;
  const energyAfter = (data: Float32Array, fromSec: number) => {
    let energy = 0;
    for (let index = Math.floor(fromSec * rate); index < data.length; index += 1) energy += data[index] * data[index];
    return energy;
  };

  const ir = (size: number, foliage: number) => buildRoomImpulseResponse({ size, foliage }, rate);
  /** Share of energy in the high band, by first difference (a rough high-pass). */
  const brightness = (data: Float32Array) => {
    let diff = 0;
    let total = 0;
    for (let index = 1; index < data.length; index += 1) {
      diff += (data[index] - data[index - 1]) ** 2;
      total += data[index] ** 2;
    }
    return diff / total;
  };
  const crest = (data: Float32Array) => {
    let peak = 0;
    let sum = 0;
    for (const value of data) {
      peak = Math.max(peak, Math.abs(value));
      sum += value * value;
    }
    return peak / Math.sqrt(sum / data.length);
  };

  it('decays to about -60 dB at the decay time its size gives, with no foliage', () => {
    for (const size of [0.2, 0.6]) {
      const [left] = ir(size, 0);
      const decay = roomDecaySec(size);
      const window = (atSec: number) => energyAfter(left.subarray(0, Math.floor((atSec + 0.05) * rate)), atSec);
      const drop = 10 * Math.log10(window(decay * 0.5) / window(decay * 0.25));
      expect(drop).toBeLessThan(-8);
      expect(drop).toBeGreaterThan(-25);
    }
  });

  it('starts after a pre-delay, and its two sides are unrelated', () => {
    const [left, right] = ir(0.8, 0.5);
    expect(left.subarray(0, 32).every((value) => Math.abs(value) < 1e-12)).toBe(true);
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let index = 0; index < left.length; index += 1) {
      ab += left[index] * right[index];
      aa += left[index] * left[index];
      bb += right[index] * right[index];
    }
    expect(Math.abs(ab / Math.sqrt(aa * bb))).toBeLessThan(0.15);
  });

  it('is darker at every step of foliage, at any size', () => {
    // At the app's own rate: at 16 kHz the open end of the low-pass sits
    // above Nyquist and the first steps cannot differ.
    const at48k = (size: number, foliage: number) => buildRoomImpulseResponse({ size, foliage }, 48000);
    for (const size of [0.1, 0.8]) {
      let previous = Infinity;
      for (const foliage of [0, 0.25, 0.5, 0.75, 1]) {
        const value = brightness(at48k(size, foliage)[0]);
        expect(value).toBeLessThan(previous);
        previous = value;
      }
      // Pronounced, not a nuance: dense is a fraction of bare.
      expect(brightness(at48k(size, 1)[0])).toBeLessThan(0.05 * brightness(at48k(size, 0)[0]));
    }
  });

  it('is calibrated from the tail without foliage, so foliage takes energy away', () => {
    const power = (foliage: number) => {
      const [left, right] = ir(0.5, foliage);
      let sum = 0;
      for (let index = 0; index < left.length; index += 1) sum += (left[index] ** 2) + (right[index] ** 2);
      return sum;
    };
    expect(power(1)).toBeLessThan(0.7 * power(0));
  });

  it('keeps a dense large space long and present rather than dead: a forest is not a padded room', () => {
    const forest = ir(0.8, 1)[0];
    const paddedRoom = ir(0.05, 1)[0];
    expect(energyAfter(forest, 1)).toBeGreaterThan(50 * energyAfter(paddedRoom, 1));
  });

  it('spaces its reflections by size, and turns them from clicks into a soft wash with foliage', () => {
    // A bare valley's first reflection stands out of its tail as a spike; a
    // bare room's comes far sooner.
    const firstSpike = (data: Float32Array) => {
      const rms = Math.sqrt(data.reduce((sum, value) => sum + (value * value), 0) / data.length);
      return data.findIndex((value) => Math.abs(value) > 12 * rms);
    };
    const valleyAt = firstSpike(ir(0.95, 0)[0]);
    const roomAt = firstSpike(ir(0.05, 0)[0]);
    expect(valleyAt).toBeGreaterThan(0.3 * rate);
    expect(roomAt).toBeGreaterThan(0);
    expect(roomAt).toBeLessThan(0.1 * rate);
    // Foliage smears them: the response's peaks sink into its body.
    expect(crest(ir(0.95, 1)[0])).toBeLessThan(0.5 * crest(ir(0.95, 0)[0]));
  });
});
