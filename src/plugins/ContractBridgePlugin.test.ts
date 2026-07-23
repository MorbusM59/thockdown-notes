import { describe, expect, it } from 'vitest';
import { resolveWordRange, resolvePairAwareRange, resolveScopeRange, isSameRange } from './ContractBridgePlugin';
import type { SelectionScope } from './ContractBridgePlugin';

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

  it('does not treat single quotes as a pair, since it collides with contractions', () => {
    const text = "'bar'";
    const range = resolveWordRange(text, 2);

    expect(range).toEqual({ start: 0, end: 5 });
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

  it('treats an opening parenthesis as a hard guard when selecting a sentence inside parentheses', () => {
    const text = 'first sentence (second sentence. third sentence.)';
    const result = resolveScopeRange('sentence', text, 23, null);

    expect(result.range).toEqual({ start: 16, end: 32 });
  });

  it('allows a single word inside parentheses to expand beyond the word when selecting a sentence', () => {
    const text = '(word)';
    const result = resolveScopeRange('sentence', text, 2, { anchor: 1, focus: 5, start: 1, end: 5, isCollapsed: false });

    expect(result.range).toEqual({ start: 0, end: 6 });
    expect(result.isPairAwareAdjustment).toBe(true);
  });

  it('expands a single parenthesized word from word to pair scope', () => {
    const text = '(word)';
    const selection = { anchor: 1, focus: 5, start: 1, end: 5, isCollapsed: false };
    const result = resolveScopeRange('word', text, 2, selection);

    expect(result.range).toEqual({ start: 0, end: 6 });
    expect(result.isPairAwareAdjustment).toBe(true);
  });

  it('marks a sentence scope as pair-aware adjustment when sentence expansion is clamped to the bracket interior', () => {
    const text = 'Test sentence (here is an inclusion) that can stop.';
    const selection = { anchor: 23, focus: 25, start: 23, end: 25, isCollapsed: false };
    const result = resolveScopeRange('sentence', text, 24, selection);

    expect(result.range).toEqual({ start: 15, end: 35 });
    expect(result.isPairAwareAdjustment).toBe(true);
  });

  it('marks a word scope as pair-aware adjustment when the current selection equals the inner secondary range and rewraps to include the pair', () => {
    const text = '[foo]';
    const selection = { anchor: 1, focus: 4, start: 1, end: 4, isCollapsed: false };
    const result = resolveScopeRange('word', text, 2, selection);

    expect(result.range).toEqual({ start: 0, end: 5 });
    expect(result.isPairAwareAdjustment).toBe(true);
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

  it('selects the inner word for the first click inside adjacent bracket groups', () => {
    const text = '(worda)(wordb)';
    const range = resolveWordRange(text, 2);

    expect(range).toEqual({ start: 1, end: 6 });
  });

  it('expands from the inner word to include the bracket pair for adjacent groups', () => {
    const text = '(worda)(wordb)';
    const selection = { anchor: 1, focus: 6, start: 1, end: 6, isCollapsed: false };
    const range = resolveWordRange(text, 2, selection);

    expect(range).toEqual({ start: 0, end: 7 });
  });
});

describe('line scope respects sentence boundaries (bug regression)', () => {
  it('does not let a bracket-clamped "line" scope jump past the sentence-ending character', () => {
    // The selection here is the fully bracket-wrapped content reached after
    // walking out through nested parentheses, but it does not yet contain a
    // sentence-ending character. "Line" scope must therefore stay capped at
    // the sentence boundary rather than expanding into the next sentence.
    const text = 'adfad (adfadfadf  (adfadf center adfadfmo) adfadg) adfadf. adfadf adfadf.';
    const selection = { anchor: 6, focus: 52, start: 6, end: 52, isCollapsed: false };
    const offset = text.indexOf('center') + 1;

    const result = resolveScopeRange('line', text, offset, selection);

    expect(text.slice(result.range.start, result.range.end)).toBe(
      'adfad (adfadfadf  (adfadf center adfadfmo) adfadg) adfadf.',
    );
  });

  it('allows the full (unclamped) line once the selection already contains a sentence-ending character', () => {
    const text = 'First sentence here. Second sentence follows.';
    const selection = { anchor: 0, focus: 19, start: 0, end: 19, isCollapsed: false }; // "First sentence here" (no period)
    const offset = 2;

    const result = resolveScopeRange('line', text, offset, selection);

    // Selection doesn't contain a period yet -> should stay at the sentence boundary.
    expect(text.slice(result.range.start, result.range.end)).toBe('First sentence here.');
  });

  it('does not clamp line scope once the current selection already spans a sentence-ending character', () => {
    const text = 'First sentence here. Second sentence follows.';
    const selection = { anchor: 0, focus: 21, start: 0, end: 21, isCollapsed: false }; // includes the period
    const offset = 2;

    const result = resolveScopeRange('line', text, offset, selection);

    expect(text.slice(result.range.start, result.range.end)).toBe(text);
  });

  it('reproduces the full click sequence: word -> sentence -> nested brackets -> sentence -> block', () => {
    type Sel = { anchor: number; focus: number; start: number; end: number; isCollapsed: boolean };
    const toSel = (start: number, end: number): Sel => ({ anchor: start, focus: end, start, end, isCollapsed: start === end });
    const resolveNextScope = (current: SelectionScope): SelectionScope => {
      if (current === 'word') return 'sentence';
      if (current === 'sentence') return 'line';
      return 'block';
    };

    const text = 'adfad (adfadfadf  (adfadf center adfadfmo) adfadg) adfadf. adfadf adfadf.';
    const offset = text.indexOf('center') + 1;

    interface CycleState {
      scope: SelectionScope;
      start: number;
      end: number;
      retrySameScope: boolean;
    }

    let cycle: CycleState | null = null;
    let currentSelection: Sel = toSel(offset, offset);
    const ranges: string[] = [];

    for (let i = 0; i < 7; i += 1) {
      const priorCycle: CycleState | null = cycle;
      const clickedInside = !currentSelection.isCollapsed
        && offset >= currentSelection.start && offset < currentSelection.end;
      const canAdvance = priorCycle !== null && clickedInside
        && priorCycle.start === currentSelection.start && priorCycle.end === currentSelection.end;

      let resolvedScope: SelectionScope = 'word';
      if (canAdvance) {
        const cyclePriorToAdvance = priorCycle as CycleState;
        resolvedScope = cyclePriorToAdvance.retrySameScope
          ? cyclePriorToAdvance.scope
          : resolveNextScope(cyclePriorToAdvance.scope);
      }

      let result = resolveScopeRange(resolvedScope, text, offset, currentSelection);
      if (canAdvance) {
        while (
          isSameRange(result.range, { start: currentSelection.start, end: currentSelection.end }) &&
          resolvedScope !== 'block'
        ) {
          if (result.isPairAwareAdjustment) break;
          resolvedScope = resolveNextScope(resolvedScope);
          result = resolveScopeRange(resolvedScope, text, offset, currentSelection);
        }
      }

      currentSelection = toSel(result.range.start, result.range.end);
      cycle = {
        scope: resolvedScope,
        start: result.range.start,
        end: result.range.end,
        retrySameScope: result.isPairAwareAdjustment,
      };
      ranges.push(text.slice(result.range.start, result.range.end));
    }

    expect(ranges).toEqual([
      'center',
      'adfadf center adfadfmo',
      '(adfadf center adfadfmo)',
      'adfadfadf  (adfadf center adfadfmo) adfadg',
      '(adfadfadf  (adfadf center adfadfmo) adfadg)',
      'adfad (adfadfadf  (adfadf center adfadfmo) adfadg) adfadf.',
      'adfad (adfadfadf  (adfadf center adfadfmo) adfadg) adfadf. adfadf adfadf.',
    ]);
  });
});
