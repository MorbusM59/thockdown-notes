import { describe, expect, it } from 'vitest';
import { isNearMiss, typoMarks } from './typoMarks';

const marked = (word: string, target: string) => typoMarks(word, target).map(({ from, to }) => word.slice(from, to));

describe('typoMarks', () => {
  it('marks a wrong or extra letter itself', () => {
    expect(marked('Kanzlerr', 'Kanzler')).toEqual(['r']);
    expect(marked('hause', 'house')).toEqual(['a']);
  });

  it('marks the neighbours of a missing letter, one at either end', () => {
    expect(marked('Fahrad', 'Fahrrad')).toEqual(['ra']);
    expect(marked('ello', 'hello')).toEqual(['e']);
    expect(marked('hell', 'hello')).toEqual(['l']);
  });

  it('marks a swap as the pair, and separate typos separately', () => {
    expect(marked('Häsuer', 'Häuser')).toEqual(['su']);
    expect(marked('wnat', 'want')).toEqual(['na']);
    expect(marked('teh', 'the')).toEqual(['eh']);
    expect(marked('recieve', 'receive')).toEqual(['ie']);
    expect(marked('acomodate', 'accommodate')).toEqual(['como']);
  });

  it('marks nothing for the same word', () => {
    expect(typoMarks('same', 'same')).toEqual([]);
  });
});

describe('isNearMiss', () => {
  it('accepts one edit or one swap and nothing more', () => {
    expect(isNearMiss('Kanzlerr', 'Kanzler')).toBe(true);
    expect(isNearMiss('Fahrad', 'Fahrrad')).toBe(true);
    expect(isNearMiss('hause', 'house')).toBe(true);
    expect(isNearMiss('teh', 'the')).toBe(true);
    expect(isNearMiss('speling', 'spieling')).toBe(true);
    expect(isNearMiss('acomodate', 'accommodate')).toBe(false);
    expect(isNearMiss('helo', 'helot')).toBe(true);
    expect(isNearMiss('same', 'same')).toBe(false);
  });
});
