import { describe, it, expect } from 'vitest'
import { buildPreviewVisibleTextProjection, mapVisibleOffsetToSourceOffset } from './PreviewVisibleText'
import { buildDocumentFindHits, buildPreviewVisibleDocumentFindHits } from './FindReplaceEngine'
import { createPreviewSearchHighlightRehypePlugin } from './PreviewMarkdown'

describe('buildPreviewVisibleTextProjection', () => {
  it('drops a link target while keeping its label', () => {
    const source = 'See the [anchor](#anchor) below.'
    const { visibleText } = buildPreviewVisibleTextProjection(source)
    expect(visibleText.trim()).toBe('See the anchor below.')
  })

  it('maps a visible offset back onto the matching source offset', () => {
    const source = 'See the [anchor](#anchor) below.'
    const projection = buildPreviewVisibleTextProjection(source)
    const visibleIndex = projection.visibleText.indexOf('anchor')
    const sourceIndex = mapVisibleOffsetToSourceOffset(projection, visibleIndex)
    expect(source.slice(sourceIndex, sourceIndex + 6)).toBe('anchor')
    // The label, not the target -- the target starts two characters later.
    expect(sourceIndex).toBe(source.indexOf('[anchor]') + 1)
  })

  it('keeps emphasis/heading/code content and drops their syntax', () => {
    const source = '# Heading\n\nSome **bold** and `code` text.\n'
    const { visibleText } = buildPreviewVisibleTextProjection(source)
    expect(visibleText).toContain('Heading')
    expect(visibleText).toContain('bold')
    expect(visibleText).toContain('code')
    expect(visibleText).not.toContain('**')
    expect(visibleText).not.toContain('#')
    expect(visibleText).not.toContain('`')
  })

  it('separates blocks so a query cannot match across two of them', () => {
    const source = 'alpha\n\nbeta\n'
    const { visibleText } = buildPreviewVisibleTextProjection(source)
    expect(visibleText.includes('alpha beta')).toBe(false)
    expect(visibleText.split('\n').filter(Boolean)).toEqual(['alpha', 'beta'])
  })

  it('omits image URLs, which render as an attribute rather than as text', () => {
    const source = 'Look: ![alt](https://example.com/anchor.png)\n'
    const { visibleText } = buildPreviewVisibleTextProjection(source)
    expect(visibleText).not.toContain('anchor')
  })
})

describe('createPreviewSearchHighlightRehypePlugin', () => {
  it('caps expensive DOM splitting when a single text node has too many matches', () => {
    const text = 'a'.repeat(300)
    const tree = { type: 'root', children: [{ type: 'text', value: text }] }

    createPreviewSearchHighlightRehypePlugin('a', false)()(tree as any)

    expect(tree.children).toHaveLength(1)
    expect(tree.children[0]).toEqual({ type: 'text', value: text })
  })
})

describe('buildPreviewVisibleDocumentFindHits', () => {
  it('reports one hit where the source has two, for a self-referential anchor link', () => {
    const source = 'See the [anchor](#anchor) below.\n'
    expect(buildDocumentFindHits(source, 'anchor', false)).toHaveLength(2)

    const previewHits = buildPreviewVisibleDocumentFindHits(source, 'anchor', false)
    expect(previewHits).toHaveLength(1)
    expect(source.slice(previewHits[0].index, previewHits[0].index + previewHits[0].matchLength)).toBe('anchor')
  })

  it('keeps ordering and source addressability across several blocks', () => {
    const source = [
      '# The anchor chapter',
      '',
      'First [anchor](#anchor) paragraph.',
      '',
      'Second anchor paragraph.',
      '',
    ].join('\n')

    const previewHits = buildPreviewVisibleDocumentFindHits(source, 'anchor', false)
    // Heading, link label, plain word -- not the link target, not twice.
    expect(previewHits).toHaveLength(3)
    previewHits.forEach((hit) => {
      expect(source.slice(hit.index, hit.index + hit.matchLength)).toBe('anchor')
    })
    const indices = previewHits.map((hit) => hit.index)
    expect([...indices].sort((left, right) => left - right)).toEqual(indices)
    const visibleIndices = previewHits.map((hit) => hit.visibleIndex ?? -1)
    expect([...visibleIndices].sort((left, right) => left - right)).toEqual(visibleIndices)
  })

  it('builds snippets out of rendered text, without markdown syntax', () => {
    const source = 'The **quick** [anchor](#anchor) jumped.\n'
    const [hit] = buildPreviewVisibleDocumentFindHits(source, 'anchor', false)
    expect(`${hit.snippetBefore}${hit.snippetMatch}${hit.snippetAfter}`.trim()).toBe('The quick anchor jumped.')
  })

  it('respects case sensitivity', () => {
    const source = 'Anchor and [anchor](#anchor).\n'
    expect(buildPreviewVisibleDocumentFindHits(source, 'anchor', true)).toHaveLength(1)
    expect(buildPreviewVisibleDocumentFindHits(source, 'anchor', false)).toHaveLength(2)
  })

  it('returns nothing for an empty query without parsing the document', () => {
    expect(buildPreviewVisibleDocumentFindHits('# anything', '   ', false)).toEqual([])
  })
})
