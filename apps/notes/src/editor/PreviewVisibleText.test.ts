import { describe, it, expect } from 'vitest'
import { splitPreviewBlockRangesProgressively } from './PreviewBlockSplit'
import {
  appendProjectionNodes,
  createPreviewVisibleTextAccumulator,
  finishPreviewVisibleTextProjection,
  projectionNeedsWholeDocumentParse,
} from './PreviewVisibleText'
import { buildPreviewVisibleTextProjection, mapVisibleOffsetToSourceOffset } from './PreviewVisibleText'
import { buildDocumentFindHits, buildPreviewVisibleDocumentFindHits } from './FindReplaceEngine'
import { createPreviewSearchHighlightRehypePlugin, type RehypeAstNode } from './PreviewMarkdown'

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
    const tree: RehypeAstNode = { type: 'root', children: [{ type: 'text', value: text }] }

    createPreviewSearchHighlightRehypePlugin('a', false)()(tree)

    expect(tree.children).toHaveLength(1)
    expect(tree.children?.[0]).toEqual({ type: 'text', value: text })
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

describe('a projection assembled from the block split\'s own windows', () => {
  /**
   * The whole point of deriving the projection from the split's pass is that
   * it produces the SAME projection. A window boundary that dropped a block
   * separator, or shifted a source offset by the wrong amount, would give
   * find hits that land on the wrong text -- silently, since nothing else
   * reads these coordinates.
   *
   * Driven at tiny chunk sizes so even small corpora cross many boundaries,
   * exactly as the range-tiling test does.
   */
  function expectChunkedMatchesWhole(markdown: string, label: string) {
    // The one documented exception. A document with reference definitions is
    // NOT assembled from windows -- the worker parses it whole -- so the
    // property to hold here is that the detector says so, not that the
    // chunked assembly happens to agree (it does not, and cannot).
    if (projectionNeedsWholeDocumentParse(markdown)) {
      throw new Error(`${label}: use expectNeedsWholeDocumentParse for a document with definitions`)
    }
    const whole = buildPreviewVisibleTextProjection(markdown)
    for (const firstChunkLines of [1, 3, 7, 64]) {
      const accumulator = createPreviewVisibleTextAccumulator()
      for (const chunk of splitPreviewBlockRangesProgressively(markdown, firstChunkLines)) {
        appendProjectionNodes(accumulator, chunk.nodes, chunk.sourceOffset)
      }
      const chunked = finishPreviewVisibleTextProjection(accumulator)
      expect(chunked.visibleText, `${label} text @ ${firstChunkLines}`).toBe(whole.visibleText)
      expect(chunked.segments, `${label} segments @ ${firstChunkLines}`).toEqual(whole.segments)
    }
  }

  it('matches on ordinary prose and headings', () => {
    expectChunkedMatchesWhole('', 'empty')
    expectChunkedMatchesWhole('just one paragraph', 'single block')
    expectChunkedMatchesWhole('# Title\n\nBody text.\n\n## Next\n\nMore body.\n\n', 'headings')
  })

  it('matches where the source offsets are what a shift could get wrong', () => {
    // Every block after the first has a non-zero document offset, and the
    // later ones are large -- an off-by-one shift shows as a diff here rather
    // than as a hit landing one character out in the real app.
    let markdown = ''
    for (let i = 0; i < 30; i += 1) markdown += `## Heading ${i}\n\nParagraph ${i} with several words in it.\n\n`
    expectChunkedMatchesWhole(markdown, 'many offset blocks')
  })

  it('matches across the constructs that make chunk boundaries hard', () => {
    const body = Array.from({ length: 40 }, (_, i) => `line ${i} inside`).join('\n')
    expectChunkedMatchesWhole(`Intro.\n\n\`\`\`js\n${body}\n\`\`\`\n\nAfter.\n`, 'long fence')
    expectChunkedMatchesWhole(`Intro.\n\n\`\`\`js\n${body}\n`, 'unclosed fence')
    expectChunkedMatchesWhole('A paragraph\n===\n\nAnother\n---\n\nEnd.\n', 'setext')
    expectChunkedMatchesWhole('> quoted\n> continued\nlazy tail\n\nOut.\n', 'lazy blockquote')
    expectChunkedMatchesWhole('- a\n- b\n\nText **bold** and `code` and [link](#x).\n\n', 'inline runs')
    // Definitions are the exception, asserted as such below.
  })

  it('refuses to assemble a document whose references resolve document-wide', () => {
    // `[ref]` is the word "ref" when the definition exists and the literal
    // text "[ref]" when it does not, so a window parsed before reaching the
    // definition projects text the reader never sees. Caught by this suite,
    // not by reasoning: the projection was believed to have no document-wide
    // dependency at all.
    const withDefinition = 'See [ref] and [^fn].\n\nBody.\n\n[ref]: https://example.com\n\n[^fn]: A note.\n'
    expect(projectionNeedsWholeDocumentParse(withDefinition)).toBe(true)
    expect(buildPreviewVisibleTextProjection(withDefinition).visibleText).toContain('See ref and')

    expect(projectionNeedsWholeDocumentParse('Plain text with [an inline link](#x).\n')).toBe(false)
    expect(projectionNeedsWholeDocumentParse('# Heading\n\nBody.\n')).toBe(false)
    // Conservative on purpose: a definition-shaped line inside a fence is not
    // a definition, and costing a whole parse for it is the safe direction.
    expect(projectionNeedsWholeDocumentParse('```\n[ref]: not really\n```\n')).toBe(true)
  })

  it('matches on a randomized mixed corpus', () => {
    let seed = 20260913
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const out: string[] = []
    for (let i = 0; i < 60; i += 1) {
      const roll = rng()
      if (roll < 0.3) out.push(`Paragraph ${i} with filler words.`)
      else if (roll < 0.45) out.push(`## Heading ${i}`)
      else if (roll < 0.6) out.push('- item a\n- item b')
      else if (roll < 0.72) out.push(`\`\`\`js\nconst x = ${i}\n\`\`\``)
      else if (roll < 0.8) out.push(`> quoted ${i}\n> more`)
      else if (roll < 0.88) out.push(`Setext ${i}\n===`)
      // No reference definitions in this corpus: they are the documented
      // exception and have their own case.
      else out.push(`| a | b |\n| - | - |\n| ${i} | ${i + 1} |`)
    }
    expectChunkedMatchesWhole(`${out.join('\n\n')}\n`, 'mixed corpus')
  })
})
