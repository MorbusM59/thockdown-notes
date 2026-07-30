import { describe, expect, it } from 'vitest';
import { buildDocumentFindHits, resolveDocumentFindDirective } from './FindReplaceEngine';

describe('buildDocumentFindHits', () => {
  it('returns no hits for an empty query without throwing on a large document', () => {
    const text = 'alpha beta gamma\n'.repeat(10000);
    expect(buildDocumentFindHits(text, '', false)).toEqual([]);
    expect(buildDocumentFindHits(text, '   ', false)).toEqual([]);
  });

  it('finds every case-insensitive match by default', () => {
    const hits = buildDocumentFindHits('Alpha alpha ALPHA', 'alpha', false);
    expect(hits.map((hit) => hit.index)).toEqual([0, 6, 12]);
  });

  it('respects case sensitivity when requested', () => {
    const hits = buildDocumentFindHits('Alpha alpha ALPHA', 'alpha', true);
    expect(hits.map((hit) => hit.index)).toEqual([6]);
  });

  it('normalizes CRLF line endings in the searched text before matching', () => {
    const hits = buildDocumentFindHits('line one\r\nline two', 'one\nline', false);
    expect(hits).toHaveLength(1);
  });
});

describe('resolveDocumentFindDirective', () => {
  it('leaves replaceText empty outside of replace mode', () => {
    const directive = resolveDocumentFindDirective('needle', 'replacement', false);
    expect(directive).toEqual({ findText: 'needle', replaceText: '', isReplaceMode: false });
  });

  it('carries the replacement text through in replace mode', () => {
    const directive = resolveDocumentFindDirective('needle', 'replacement', true);
    expect(directive).toEqual({ findText: 'needle', replaceText: 'replacement', isReplaceMode: true });
  });
});
