import { describe, expect, it } from 'vitest';
import { sanitizeDocumentText, sanitizeTextFragment } from './textSanitization';
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
