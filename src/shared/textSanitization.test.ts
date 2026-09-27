import { describe, expect, it } from 'vitest';
import { sanitizeDocumentText, sanitizedFirstLine, sanitizeTextFragment } from './textSanitization';
import { normalizeInternalText } from '../editor/TextPolicy';

describe('tab normalization protocol', () => {
  it('normalizes tab characters to three spaces in sanitizeTextFragment', () => {
    expect(sanitizeTextFragment('\ta\tb')).toBe('   a   b');
  });

  it('normalizes tab characters to three spaces in sanitizeDocumentText', () => {
    expect(sanitizeDocumentText('<b>\talpha\t</b>')).toBe('   alpha   ');
  });

  it('normalizes tab characters to three spaces in normalizeInternalText', () => {
    expect(normalizeInternalText('x\ty\n\tz')).toBe('x   y\n   z');
  });
});

describe('sanitizeTextFragment already satisfies normalizeInternalText', () => {
  // NoteTextHydrationPlugin.tsx used to call normalizeInternalText(sanitizeTextFragment(text))
  // on every keystroke -- a provable no-op, since sanitizeTextFragment's own
  // normalizeLineSeparators + tab-replace already cover everything
  // normalizeInternalText checks for (BOM, \r/\r\n/U+2028/U+2029, tabs).
  // Removed the redundant wrapper there; this locks in the equivalence so a
  // future change to either function can't silently reintroduce a real
  // difference between the two without this test catching it.
  it.each([
    'plain text',
    '﻿leading bom',
    'crlf line\r\nendings\r\nhere',
    'lone\rcarriage\rreturns',
    'unicode line separators',
    'tabs\there\tand\tthere',
    'mixed\r\n\ttabs and separators\r',
    '',
  ])('normalizeInternalText(sanitizeTextFragment(x)) === sanitizeTextFragment(x) for %j', (input) => {
    const sanitized = sanitizeTextFragment(input);
    expect(normalizeInternalText(sanitized)).toBe(sanitized);
  });
});

describe('sanitizedFirstLine', () => {
  it('equals the first line of the sanitised document, for any text', () => {
    const alphabet = ['a', 'B', ' ', '#', '\n', '\r', '\r\n', ' ', ' ', '\t', '<', '>', '<b>', '​', '﻿', '😀', '️', '\u0007', '-']
    let seed = 11
    const next = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0x100000000 }
    for (let trial = 0; trial < 3000; trial += 1) {
      const length = Math.floor(next() * 24)
      let text = ''
      for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(next() * alphabet.length)]
      expect(sanitizedFirstLine(text)).toBe(sanitizeDocumentText(text).split('\n', 1)[0])
    }
  })
})
