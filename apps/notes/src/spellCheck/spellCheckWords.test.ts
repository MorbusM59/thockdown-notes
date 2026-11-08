import { describe, expect, it } from 'vitest';
import { inFenceAfter, isFenceLine, wordsOnLine } from './spellCheckWords';

const words = (text: string) => wordsOnLine(text).map((entry) => entry.word);

describe('wordsOnLine', () => {
  it('finds words with their offsets, apostrophes inside a word included', () => {
    expect(wordsOnLine("I don't know")).toEqual([
      { from: 2, to: 7, word: "don't" },
      { from: 8, to: 12, word: 'know' },
    ]);
    expect(words("l'été arrive")).toEqual(["l'été", 'arrive']);
    expect(words('Häuser niño')).toEqual(['Häuser', 'niño']);
  });

  it('splits hyphenated words', () => {
    expect(words('well-known')).toEqual(['well', 'known']);
  });

  it('leaves out what is not prose', () => {
    expect(words('use `fooo bar` here')).toEqual(['use', 'here']);
    expect(words('see [the doc](https://exmple.com/pathh) now')).toEqual(['see', 'the', 'doc', 'now']);
    expect(words('go to https://exmple.org/x or www.exmple.org')).toEqual(['go', 'to', 'or']);
    expect(words('mail joe@exmple.com today')).toEqual(['mail', 'today']);
    expect(words('a #tagg and $noteid and @reff')).toEqual(['and', 'and']);
    expect(words('snake_case and v2 and 3rd')).toEqual(['and', 'and']);
    expect(words('<span class="x">text</span>')).toEqual(['text']);
    expect(words('[ref]: https://exmple.com')).toEqual([]);
  });

  it('skips single letters', () => {
    expect(words('a b cd')).toEqual(['cd']);
  });
});

describe('isFenceLine', () => {
  it('recognises backtick and tilde fences up to three spaces in', () => {
    expect(isFenceLine('```')).toBe(true);
    expect(isFenceLine('   ~~~ts')).toBe(true);
    expect(isFenceLine('    ```')).toBe(false);
    expect(isFenceLine('``')).toBe(false);
  });
});

describe('inFenceAfter', () => {
  it('follows the fences crossed', () => {
    expect(inFenceAfter(false, ['prose', '```', 'code'])).toBe(true);
    expect(inFenceAfter(false, ['```', 'code', '```', 'prose'])).toBe(false);
    expect(inFenceAfter(true, ['code', '~~~'])).toBe(false);
  });
});
