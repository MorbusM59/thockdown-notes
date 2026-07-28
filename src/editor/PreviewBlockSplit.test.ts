import { describe, expect, it } from 'vitest'
import {
  splitMarkdownIntoPreviewBlocks,
  splitMarkdownIntoPreviewBlocksIncremental,
  type PreviewBlockSplitCache,
} from './PreviewBlockSplit'

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

describe('splitMarkdownIntoPreviewBlocksIncremental', () => {
  // Ground truth is always the whole-document parse -- every assertion here
  // is "the incremental result must equal what a full reparse would say",
  // never a hand-transcribed expected array. That's deliberate: this is
  // exactly the kind of function where a plausible-looking hand-written
  // expectation can quietly encode the same mistake as the implementation.
  function expectMatchesFullParse(text: string, cache: PreviewBlockSplitCache) {
    expect(cache.blocks).toEqual(splitMarkdownIntoPreviewBlocks(text))
  }

  it('matches a full parse with no previous cache (first call)', () => {
    const text = 'first paragraph\n\nsecond paragraph\n\nthird paragraph'
    const cache = splitMarkdownIntoPreviewBlocksIncremental(text, null)
    expectMatchesFullParse(text, cache)
  })

  it('returns the same cache object, unchanged, when the text is identical', () => {
    const text = 'alpha\n\nbravo\n\ncharlie'
    const first = splitMarkdownIntoPreviewBlocksIncremental(text, null)
    const second = splitMarkdownIntoPreviewBlocksIncremental(text, first)
    expect(second).toBe(first)
  })

  it('matches a full parse for a single-character edit inside one paragraph, in a document large enough to exercise the buffered reuse path', () => {
    const before = Array.from({ length: 12 }, (_, i) => `paragraph number ${i}`).join('\n\n')
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const after = before.replace('paragraph number 6', 'paragraph NUMBER 6')
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
    // The head/tail blocks untouched by the edit should be the exact same
    // string instances as the ground truth would produce -- confirms the
    // fast path actually engaged rather than silently falling back to a
    // full reparse every time.
    expect(afterCache.blocks[0].text).toBe(beforeCache.blocks[0].text)
    expect(afterCache.blocks[afterCache.blocks.length - 1].text).toBe(beforeCache.blocks[beforeCache.blocks.length - 1].text)
  })

  it('handles an edit that merges two blocks into a setext heading by deleting the blank line before a lone "---"', () => {
    // Enough leading/trailing paragraphs that head/tailKeepCount are both
    // positive -- this exercises the adjacency-buffer reparse window, not
    // just the "nothing safely reusable, fall back to full parse" path.
    const before = 'A\n\nB\n\nC\n\n---\n\nD\n\nE'
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const after = 'A\n\nB\n\nC\n---\n\nD\n\nE' // blank line between C and --- removed
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
    // Ground truth: "C\n---" is now one setext heading, so there are 4
    // top-level blocks (A, B, the heading, D+E's two paragraphs collapse to
    // 2), not the original 5.
    expect(afterCache.blocks.map((b) => b.text)).toEqual(
      splitMarkdownIntoPreviewBlocks(after).map((b) => b.text),
    )
  })

  it('handles an edit that splits a setext heading back into a paragraph and a thematic break by inserting a blank line', () => {
    const before = 'A\n\nB\n\nC\n---\n\nD\n\nE'
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const after = 'A\n\nB\n\nC\n\n---\n\nD\n\nE'
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
  })

  it('handles an edit where a new list marker starts interrupting what was a plain paragraph', () => {
    const before = 'Intro\n\nPlain paragraph\n\nOutro'
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const after = 'Intro\n\n- Plain paragraph\n\nOutro'
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
  })

  it('handles an edit inside a multi-line code fence without splitting it', () => {
    const before = 'intro\n\n```\nline one\nline two\n```\n\noutro'
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const after = 'intro\n\n```\nline one\nline TWO\n```\n\noutro'
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
  })

  it('handles an edit that adds a blank line inside a code fence (must not be mistaken for the fence ending)', () => {
    const before = 'intro\n\n```\nline one\nline two\n```\n\noutro'
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const after = 'intro\n\n```\nline one\n\nline two\n```\n\noutro'
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
  })

  it('handles editing a link-reference definition\'s URL, which changes every other block\'s materialized text', () => {
    const before = 'see [a link][ref]\n\n[ref]: https://example.com "Example"\n\nanother paragraph'
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const after = 'see [a link][ref]\n\n[ref]: https://example.org "Example"\n\nanother paragraph'
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
  })

  it('handles inserting a whole new paragraph in the middle of a long document (line-count shift propagates through the tail)', () => {
    const before = Array.from({ length: 10 }, (_, i) => `p${i}`).join('\n\n')
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const lines = before.split('\n\n')
    lines.splice(5, 0, 'inserted paragraph')
    const after = lines.join('\n\n')
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
    expect(afterCache.blocks).toHaveLength(11)
  })

  it('handles deleting an entire paragraph from a long document', () => {
    const before = Array.from({ length: 10 }, (_, i) => `p${i}`).join('\n\n')
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const lines = before.split('\n\n')
    lines.splice(5, 1)
    const after = lines.join('\n\n')
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
    expect(afterCache.blocks).toHaveLength(9)
  })

  it('handles an edit right at the very start of the document (no head buffer available)', () => {
    const before = 'Start\n\nMiddle\n\nEnd'
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const after = 'START\n\nMiddle\n\nEnd'
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
  })

  it('handles an edit right at the very end of the document (no tail buffer available)', () => {
    const before = 'Start\n\nMiddle\n\nEnd'
    const beforeCache = splitMarkdownIntoPreviewBlocksIncremental(before, null)

    const after = 'Start\n\nMiddle\n\nEND'
    const afterCache = splitMarkdownIntoPreviewBlocksIncremental(after, beforeCache)

    expectMatchesFullParse(after, afterCache)
  })

  it('handles a chain of many consecutive single-character edits, reusing the cache each time', () => {
    let text = Array.from({ length: 20 }, (_, i) => `paragraph ${i} has some words in it`).join('\n\n')
    let cache = splitMarkdownIntoPreviewBlocksIncremental(text, null)
    expectMatchesFullParse(text, cache)

    for (let i = 0; i < 30; i += 1) {
      const targetLine = 2 + (i % 18) * 2 // stays on a paragraph line, never a blank separator
      const lines = text.split('\n')
      lines[targetLine] = `${lines[targetLine]}x`
      text = lines.join('\n')
      cache = splitMarkdownIntoPreviewBlocksIncremental(text, cache)
      expectMatchesFullParse(text, cache)
    }
  })

  function makeRng(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  function buildFuzzCorpus(rng: () => number): string {
    const blocks: string[] = []
    const kinds = [
      () => `Paragraph ${Math.floor(rng() * 1000)} with a few words in it.`,
      () => `## Heading ${Math.floor(rng() * 1000)}`,
      () => '- item one\n- item two\n- item three',
      () => '- item one\n\n- item two\n\n- item three', // loose list
      () => '```\ncode line one\ncode line two\n```',
      () => '```\ncode line one\n\ncode line two\n```', // fence containing a blank line
      () => '> a blockquote line\n> and another',
      () => `[ref${Math.floor(rng() * 100)}]: https://example.com/${Math.floor(rng() * 100)}`,
      () => `see a note[^fn${Math.floor(rng() * 100)}]`,
      () => `[^fn${Math.floor(rng() * 100)}]: footnote body text`,
      () => '---',
      () => 'Some text\n---', // setext heading
      () => '| a | b |\n| - | - |\n| 1 | 2 |',
    ]
    const blockCount = 15 + Math.floor(rng() * 10)
    for (let i = 0; i < blockCount; i += 1) {
      blocks.push(kinds[Math.floor(rng() * kinds.length)]())
    }
    return blocks.join('\n\n')
  }

  function applyFuzzEdit(text: string, rng: () => number): string {
    const lines = text.split('\n')
    const idx = Math.floor(rng() * lines.length)
    const choice = rng()

    if (choice < 0.2) {
      // Edit a character within an existing (possibly blank) line.
      lines[idx] = `${lines[idx]}x`
    } else if (choice < 0.35) {
      // Delete this line entirely (may remove a blank-line separator,
      // possibly triggering a merge, or a fence delimiter, possibly
      // unclosing it).
      lines.splice(idx, 1)
    } else if (choice < 0.5) {
      // Insert a new blank line (may split a merged construct apart).
      lines.splice(idx, 0, '')
    } else if (choice < 0.65) {
      // Insert a line that could interrupt a paragraph or form a setext
      // heading with its predecessor.
      const marker = ['---', '===', '- new item', '1. new item', '# New heading'][Math.floor(rng() * 5)]
      lines.splice(idx, 0, marker)
    } else if (choice < 0.75) {
      // Insert a brand new paragraph.
      lines.splice(idx, 0, `Inserted paragraph ${Math.floor(rng() * 1000)}`)
    } else if (choice < 0.85) {
      // Directly perturb a fence delimiter line if this line is one --
      // the exact class of edit that makes an already-closed fence unclosed
      // (or vice versa), which can absorb/release arbitrarily much of the
      // rest of the document. No-op if this line isn't a fence marker.
      if (/^```/.test(lines[idx])) {
        lines[idx] = rng() < 0.5 ? `${lines[idx]}x` : lines[idx].slice(0, -1)
      } else {
        lines.splice(idx, 0, '```')
      }
    } else if (choice < 0.93) {
      // Insert a fresh fence-open marker with no matching close nearby --
      // forces a long-range absorption until the next real ``` in the doc.
      lines.splice(idx, 0, '```')
    } else {
      // Duplicate a line right after itself (common typing pattern; also
      // exercises "identical adjacent lines" in the prefix/suffix diff).
      lines.splice(idx, 0, lines[idx])
    }

    return lines.join('\n')
  }

  function runFuzzSequence(seed: number, steps: number) {
    const rng = makeRng(seed)
    let text = buildFuzzCorpus(rng)
    let cache = splitMarkdownIntoPreviewBlocksIncremental(text, null)
    expectMatchesFullParse(text, cache)

    for (let step = 0; step < steps; step += 1) {
      text = applyFuzzEdit(text, rng)
      cache = splitMarkdownIntoPreviewBlocksIncremental(text, cache)

      const groundTruth = splitMarkdownIntoPreviewBlocks(text)
      expect(cache.blocks, `seed ${seed}: mismatch after fuzz step ${step} on text:\n${JSON.stringify(text)}`).toEqual(groundTruth)
    }
  }

  // Deterministic seeded fuzz test, run across several independent seeds:
  // generates a document with a mix of constructs, then applies a long
  // random sequence of edits -- including several specifically chosen to be
  // adjacency-sensitive (removing/adding the blank line before a "---" or
  // "===", inserting a list marker right after a plain paragraph, and
  // directly perturbing code-fence delimiters, per the forward-unbounded
  // hazard documented on splitMarkdownIntoPreviewBlocksIncremental) --
  // checking after every single edit that the incrementally-cached result
  // exactly equals a fresh full parse.
  it.each([20260728, 1, 424242])('matches a full parse after every step of a long randomized edit sequence (seed %i)', (seed) => {
    runFuzzSequence(seed, 350)
  })
})
