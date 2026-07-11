import { describe, expect, it } from 'vitest';
import { resolveWordRange, resolvePairAwareRange } from './ContractBridgePlugin';

describe('resolveWordRange pair-aware expansion', () => {
  it('selects text inside brackets when the regular word expansion includes the pair', () => {
    const text = '[foo]';
    const range = resolveWordRange(text, 2);

    expect(range).toEqual({ start: 1, end: 4 });
  });

  it('selects text inside double quotes when the regular expansion includes the pair', () => {
    const text = '"hello"';
    const range = resolveWordRange(text, 3);

    expect(range).toEqual({ start: 1, end: 6 });
  });

  it('expands to include the delimiter pair when current selection already equals the inner secondary expansion', () => {
    const text = '[foo]';
    const range = resolveWordRange(text, 2, { anchor: 1, focus: 4, start: 1, end: 4, isCollapsed: false });

    expect(range).toEqual({ start: 0, end: 5 });
  });

  it('preserves the regular expansion when brackets are not balanced', () => {
    const text = '[foo';
    const range = resolveWordRange(text, 2);

    expect(range).toEqual({ start: 0, end: 4 });
  });

  it('selects text inside single quotes when the regular expansion includes the pair', () => {
    const text = "'bar'";
    const range = resolveWordRange(text, 2);

    expect(range).toEqual({ start: 1, end: 4 });
  });

  it('selects the word an inside parentheses without jumping directly to sentence', () => {
    const text = 'Test sentence (here is an inclusion) that can stop.';
    const range = resolveWordRange(text, 24);

    expect(range).toEqual({ start: 23, end: 25 });
  });

  it('selects the full parenthetical contents when expanding sentence selection inside parentheses', () => {
    const text = 'Test sentence (here is an inclusion) that can stop.';
    const selection = { anchor: 23, focus: 25, start: 23, end: 25, isCollapsed: false };
    const regularSentence = resolvePairAwareRange(text, { start: 0, end: text.length }, selection);

    expect(regularSentence).toEqual({ start: 15, end: 35 });
  });

  it('excludes a single leading bounding character whose match lies outside the word range', () => {
    // "[" has no matching "]" within the word-level range, but one exists later
    // in the text, so it should be treated as a stray character, not kept.
    const text = 'value [count total items] processed';
    const range = resolveWordRange(text, 8); // click inside "count"

    expect(range).toEqual({ start: 7, end: 12 });
  });

  it('excludes a single trailing bounding character whose match lies outside the word range', () => {
    // "]" at the end of "count]" has no opening "[" within the word-level range,
    // but its match precedes it earlier in the text.
    const text = '[first count] rest';
    const range = resolveWordRange(text, 9); // click inside "count"

    expect(range).toEqual({ start: 7, end: 12 });
  });

  it('keeps a lone bounding character when no matching partner exists anywhere in the text', () => {
    const text = '[foo';
    const range = resolveWordRange(text, 2);

    expect(range).toEqual({ start: 0, end: 4 });
  });
});
