import { describe, expect, it } from 'vitest';
import {
  applyPreserveCase,
  buildDocumentFindHits,
  buildPreviewVisibleDocumentFindHits,
  resolveDocumentFindDirective,
} from './FindReplaceEngine';

describe('buildDocumentFindHits', () => {
  it('returns no hits for an empty query without throwing on a large document', () => {
    const text = 'alpha beta gamma\n'.repeat(10000);
    expect(buildDocumentFindHits(text, '', { caseSensitive: false, wholeWord: false })).toEqual([]);
  });

  it('finds every case-insensitive match by default', () => {
    const hits = buildDocumentFindHits('Alpha alpha ALPHA', 'alpha', { caseSensitive: false, wholeWord: false });
    expect(hits.map((hit) => hit.index)).toEqual([0, 6, 12]);
  });

  it('respects case sensitivity when requested', () => {
    const hits = buildDocumentFindHits('Alpha alpha ALPHA', 'alpha', { caseSensitive: true, wholeWord: false });
    expect(hits.map((hit) => hit.index)).toEqual([6]);
  });

  it('normalizes CRLF line endings in the searched text before matching', () => {
    const hits = buildDocumentFindHits('line one\r\nline two', 'one\nline', { caseSensitive: false, wholeWord: false });
    expect(hits).toHaveLength(1);
  });

  it('takes the query raw: leading and trailing spaces are part of what is searched for', () => {
    const hits = buildDocumentFindHits('cat  dog cat dog', '  dog', { caseSensitive: false, wholeWord: false });
    expect(hits.map((hit) => hit.index)).toEqual([3]);
    expect(hits[0].matchLength).toBe(5);
  });

  it('finds runs of spaces with a whitespace-only query', () => {
    const hits = buildDocumentFindHits('a  b   c', '  ', { caseSensitive: false, wholeWord: false });
    expect(hits.map((hit) => hit.index)).toEqual([1, 4]);
  });
});

describe('whole word', () => {
  const wholeWord = { caseSensitive: false, wholeWord: true };

  it('skips a match that continues a word on either side', () => {
    const hits = buildDocumentFindHits('cat concatenate cats Cat_ cat.', 'cat', wholeWord);
    expect(hits.map((hit) => hit.index)).toEqual([0, 26]);
  });

  it('counts letters of every script and digits as word characters', () => {
    const hits = buildDocumentFindHits('über überall 2über über', 'über', wholeWord);
    expect(hits.map((hit) => hit.index)).toEqual([0, 19]);
  });

  it('checks a boundary only where the needle itself starts or ends in a word character', () => {
    expect(buildDocumentFindHits('a.b x.y', '.', wholeWord).map((hit) => hit.index)).toEqual([1, 5]);
    expect(buildDocumentFindHits('foo-bar foo-', 'foo-', wholeWord).map((hit) => hit.index)).toEqual([0, 8]);
  });

  it('applies in render view too', () => {
    const hits = buildPreviewVisibleDocumentFindHits('**cat** catalog', 'cat', wholeWord);
    expect(hits).toHaveLength(1);
  });
});

describe('buildPreviewVisibleDocumentFindHits', () => {
  it('takes the query raw in render view too', () => {
    const hits = buildPreviewVisibleDocumentFindHits('cat dog catdog', ' dog', { caseSensitive: false, wholeWord: false });
    expect(hits.map((hit) => hit.index)).toEqual([3]);
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

  it('keeps both terms raw, spaces included', () => {
    const directive = resolveDocumentFindDirective('  needle ', ' x ', true);
    expect(directive).toEqual({ findText: '  needle ', replaceText: ' x ', isReplaceMode: true });
  });
});

describe('applyPreserveCase', () => {
  it('upper-cases the replacement for an all-upper match', () => {
    expect(applyPreserveCase('FOO', 'bar')).toBe('BAR');
  });

  it('lower-cases the replacement for an all-lower match', () => {
    expect(applyPreserveCase('foo', 'BAR')).toBe('bar');
  });

  it('capitalizes the replacement for a Capitalized match', () => {
    expect(applyPreserveCase('Foo', 'bar')).toBe('Bar');
  });

  it('leaves the replacement literal for a mixed-case match', () => {
    expect(applyPreserveCase('FoO', 'bar')).toBe('bar');
  });

  it('reads Capitalized from the first letter when the match opens with spaces', () => {
    expect(applyPreserveCase('  Foo', '  bar')).toBe('  Bar');
  });

  it('capitalizes the first letter of a replacement that opens with punctuation', () => {
    expect(applyPreserveCase('Foo', '(bar')).toBe('(Bar');
  });
});
