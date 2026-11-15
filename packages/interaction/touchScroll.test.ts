import { describe, expect, it } from 'vitest';
import { touchOwner, VERTICAL_RATIO } from './touchScroll';

describe('who owns a touch leaving the tap radius', () => {
  it('a press a hold has taken stays with its control, in any direction', () => {
    for (const [dx, dy] of [[0, 20], [20, 0], [10, 10]]) {
      expect(touchOwner(dx, dy, true, false)).toBe('control');
      expect(touchOwner(dx, dy, true, true)).toBe('control');
    }
  });
  it('a slider keeps a move that is not vertical, and loses a vertical one to the page', () => {
    expect(touchOwner(20, 0, false, true)).toBe('control');
    expect(touchOwner(10, -VERTICAL_RATIO * 10, false, true)).toBe('control');
    expect(touchOwner(10, -VERTICAL_RATIO * 10 - 1, false, true)).toBe('scroll');
  });
  it('anything else is a swipe, whatever its direction', () => {
    expect(touchOwner(0, 20, false, false)).toBe('scroll');
    expect(touchOwner(20, 0, false, false)).toBe('scroll');
  });
});
