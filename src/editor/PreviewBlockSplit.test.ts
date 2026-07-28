import { describe, expect, it } from 'vitest'
import { splitMarkdownIntoPreviewBlocks } from './PreviewBlockSplit'

describe('splitMarkdownIntoPreviewBlocks', () => {
  it('returns a single block spanning the whole text for empty input', () => {
    const blocks = splitMarkdownIntoPreviewBlocks('')
    expect(blocks).toEqual([{ text: '', startLine: 0 }])
  })

  it('returns a single block spanning the whole text for a single paragraph', () => {
    const blocks = splitMarkdownIntoPreviewBlocks('just one paragraph')
    expect(blocks).toEqual([{ text: 'just one paragraph', startLine: 0 }])
  })

  it('splits multiple paragraphs at blank-line boundaries, each with the correct absolute start line', () => {
    const text = 'first paragraph\n\nsecond paragraph\n\nthird paragraph'
    const blocks = splitMarkdownIntoPreviewBlocks(text)

    expect(blocks.map((b) => b.text)).toEqual([
      'first paragraph',
      '\nsecond paragraph',
      '\nthird paragraph',
    ])
    expect(blocks.map((b) => b.startLine)).toEqual([0, 1, 3])
  })

  it('keeps a loose list (blank lines between items) as a single block', () => {
    const text = '- item one\n\n- item two\n\n- item three'
    const blocks = splitMarkdownIntoPreviewBlocks(text)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe(text)
  })

  it('keeps a multi-line code fence as a single block', () => {
    const text = 'intro\n\n```\nline one\nline two\n```\n\noutro'
    const blocks = splitMarkdownIntoPreviewBlocks(text)

    expect(blocks.map((b) => b.text)).toEqual([
      'intro',
      '\n```\nline one\nline two\n```',
      '\noutro',
    ])
  })

  it('leaves unrelated blocks value-identical when only one block changes', () => {
    const before = 'alpha\n\nbravo\n\ncharlie'
    const after = 'alpha\n\nbravo-edited\n\ncharlie'

    const blocksBefore = splitMarkdownIntoPreviewBlocks(before)
    const blocksAfter = splitMarkdownIntoPreviewBlocks(after)

    expect(blocksBefore[0].text).toBe(blocksAfter[0].text)
    expect(blocksBefore[0].startLine).toBe(blocksAfter[0].startLine)
    expect(blocksBefore[2].text).toBe(blocksAfter[2].text)
    expect(blocksAfter[1].text).toBe('\nbravo-edited')
  })

  it('propagates a link-reference definition to every other block, but not to its own', () => {
    const text = 'see [a link][ref]\n\n[ref]: https://example.com "Example"\n\nanother paragraph'
    const blocks = splitMarkdownIntoPreviewBlocks(text)

    expect(blocks).toHaveLength(3)
    expect(blocks[0].text).toContain('see [a link][ref]')
    expect(blocks[0].text).toContain('[ref]: https://example.com "Example"')
    expect(blocks[1].text.match(/\[ref\]:/g)).toHaveLength(1)
    expect(blocks[2].text).toContain('another paragraph')
    expect(blocks[2].text).toContain('[ref]: https://example.com "Example"')
  })

  it('propagates a footnote definition to every other block, but not to its own', () => {
    const text = 'a note[^1]\n\n[^1]: the footnote text\n\nunrelated paragraph'
    const blocks = splitMarkdownIntoPreviewBlocks(text)

    expect(blocks).toHaveLength(3)
    expect(blocks[0].text).toContain('a note[^1]')
    expect(blocks[0].text).toContain('[^1]: the footnote text')
    expect(blocks[1].text.match(/\[\^1\]:/g)).toHaveLength(1)
    expect(blocks[2].text).toContain('unrelated paragraph')
    expect(blocks[2].text).toContain('[^1]: the footnote text')
  })
})
