import { describe, expect, it } from 'vitest';
import { buildTokenPresentation } from './MarkdownLineClassification';

describe('buildTokenPresentation', () => {
  it('classifies a blank line', () => {
    expect(buildTokenPresentation('')?.tokenType).toBe('blank');
  });

  it('classifies a heading with its level', () => {
    const result = buildTokenPresentation('## Section');
    expect(result?.tokenType).toBe('heading');
    expect(result?.data.headingLevel).toBe('2');
  });

  it('classifies an unordered list item', () => {
    const result = buildTokenPresentation('- an item');
    expect(result?.tokenType).toBe('unordered-list-item');
    expect(result?.data.listMarker).toBe('-');
  });

  it('classifies an ordered list item', () => {
    const result = buildTokenPresentation('1. an item');
    expect(result?.tokenType).toBe('ordered-list-item');
  });

  it('classifies a checked task item', () => {
    const result = buildTokenPresentation('- [x] done');
    expect(result?.tokenType).toBe('task-list-item');
    expect(result?.data.taskState).toBe('checked');
  });

  it('classifies a code fence', () => {
    expect(buildTokenPresentation('```')?.tokenType).toBe('code-fence');
  });

  it('classifies a thematic break', () => {
    expect(buildTokenPresentation('---')?.tokenType).toBe('thematic-break');
  });

  it('classifies a table divider and row', () => {
    expect(buildTokenPresentation('|---|---|')?.tokenType).toBe('table-divider');
    expect(buildTokenPresentation('| a | b |')?.tokenType).toBe('table-row');
  });

  it('classifies a blockquote', () => {
    expect(buildTokenPresentation('> quoted')?.tokenType).toBe('blockquote');
  });

  it('returns null for plain prose', () => {
    expect(buildTokenPresentation('just a normal sentence.')).toBeNull();
  });
});
