import { describe, expect, it } from 'vitest';
import { touchOwner, VERTICAL_RATIO } from './touchScroll';

describe('who owns a touch leaving the tap radius', () => {
  it('a press a hold has taken stays with its control, in any direction', () => {
    for (const [dx, dy] of [[0, 20], [20, 0], [10, 10]]) {
      expect(touchOwner(dx, dy, true, 'none')).toBe('control');
      expect(touchOwner(dx, dy, true, 'slider')).toBe('control');
    }
  });
  it('a slider keeps a move that is not vertical, and loses a vertical one to the page', () => {
    expect(touchOwner(20, 0, false, 'slider')).toBe('control');
    expect(touchOwner(10, -VERTICAL_RATIO * 10, false, 'slider')).toBe('control');
    expect(touchOwner(10, -VERTICAL_RATIO * 10 - 1, false, 'slider')).toBe('scroll');
  });
  it('a handle keeps the finger in every direction', () => {
    for (const [dx, dy] of [[0, 20], [20, 0], [10, 10], [0, -20]]) {
      expect(touchOwner(dx, dy, false, 'handle')).toBe('control');
    }
  });
  it('anything else is a swipe, whatever its direction', () => {
    expect(touchOwner(0, 20, false, 'none')).toBe('scroll');
    expect(touchOwner(20, 0, false, 'none')).toBe('scroll');
  });
});
