import { describe, expect, it } from 'vitest';
import { buildTokenPresentation } from './MarkdownLineClassification';

const NO_LINES_ABOVE = { previous: null, beforePrevious: null };

describe('buildTokenPresentation', () => {
  it('classifies a blank line', () => {
    expect(buildTokenPresentation('', NO_LINES_ABOVE)?.tokenType).toBe('blank');
  });

  it('classifies a heading with its level', () => {
    const result = buildTokenPresentation('## Section', NO_LINES_ABOVE);
    expect(result?.tokenType).toBe('heading');
    expect(result?.data.headingLevel).toBe('2');
  });

  it('classifies an unordered list item', () => {
    const result = buildTokenPresentation('- an item', NO_LINES_ABOVE);
    expect(result?.tokenType).toBe('unordered-list-item');
    expect(result?.data.listMarker).toBe('-');
  });

  it('classifies an ordered list item', () => {
    const result = buildTokenPresentation('1. an item', NO_LINES_ABOVE);
    expect(result?.tokenType).toBe('ordered-list-item');
  });

  it('classifies a checked task item', () => {
    const result = buildTokenPresentation('- [x] done', NO_LINES_ABOVE);
    expect(result?.tokenType).toBe('task-list-item');
    expect(result?.data.taskState).toBe('checked');
  });

  it('classifies a code fence', () => {
    expect(buildTokenPresentation('```', NO_LINES_ABOVE)?.tokenType).toBe('code-fence');
  });

  it('classifies a thematic break', () => {
    expect(buildTokenPresentation('---', NO_LINES_ABOVE)?.tokenType).toBe('thematic-break');
  });

  it('classifies a table divider only as a table\'s second line', () => {
    const header = '| a | b |';
    expect(buildTokenPresentation('|---|:-:|', { previous: header, beforePrevious: null })?.tokenType).toBe('table-divider');
    expect(buildTokenPresentation('|---|---|', { previous: header, beforePrevious: 'prose' })?.tokenType).toBe('table-divider');
    expect(buildTokenPresentation(header, NO_LINES_ABOVE)?.tokenType).toBe('table-row');
  });

  it('classifies a divider-shaped line anywhere else as an ordinary row', () => {
    // First line: no header above it.
    expect(buildTokenPresentation('|---|---|', NO_LINES_ABOVE)?.tokenType).toBe('table-row');
    // Below a body row: the line above is not the header.
    expect(buildTokenPresentation('|---|---|', { previous: '| c | d |', beforePrevious: '|---|---|' })?.tokenType).toBe('table-row');
    // Cell count differs from the header's: GFM does not render it as a table.
    expect(buildTokenPresentation('|---|', { previous: '| a | b |', beforePrevious: null })?.tokenType).toBe('table-row');
  });

  it('classifies a blockquote', () => {
    expect(buildTokenPresentation('> quoted', NO_LINES_ABOVE)?.tokenType).toBe('blockquote');
  });

  it('returns null for plain prose', () => {
    expect(buildTokenPresentation('just a normal sentence.', NO_LINES_ABOVE)).toBeNull();
  });
});
