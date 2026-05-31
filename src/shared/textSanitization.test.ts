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
