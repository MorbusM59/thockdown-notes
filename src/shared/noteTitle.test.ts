import { describe, expect, it } from 'vitest'
import { deriveNoteTitleFromText, deriveNoteTitleIncremental, type NoteTitleCache } from './noteTitle'

describe('deriveNoteTitleIncremental', () => {
  // Ground truth is always deriveNoteTitleFromText's own full O(document
  // length) scan -- every assertion here is "the incremental result must
  // equal a full scan," never a hand-transcribed expectation, per this
  // codebase's own established discipline for incremental/caching logic.
  function expectMatchesFullScan(text: string, result: { title: string }) {
    expect(result.title).toBe(deriveNoteTitleFromText(text))
  }

  it('matches a full scan with no previous cache (first call)', () => {
    const text = '# My Title\nsome body text'
    const result = deriveNoteTitleIncremental(text, null)
    expectMatchesFullScan(text, result)
    expect(result.title).toBe('My Title')
  })

  it('falls back to first content line when there is no heading', () => {
    const text = 'just a plain first line\nmore text'
    const result = deriveNoteTitleIncremental(text, null)
    expectMatchesFullScan(text, result)
    expect(result.title).toBe('just a plain first line')
  })

  it('an edit far below an existing heading does not change the title (and reuses the cache)', () => {
    const before = ['# Title', '', 'paragraph one', 'paragraph two'].join('\n')
    const beforeResult = deriveNoteTitleIncremental(before, null)

    const after = ['# Title', '', 'paragraph one', 'paragraph TWO'].join('\n')
    const afterResult = deriveNoteTitleIncremental(after, beforeResult.cache)

    expectMatchesFullScan(after, afterResult)
    expect(afterResult.title).toBe('Title')
    // The cached heading-match index is reused verbatim, not rescanned.
    expect(afterResult.cache.headingMatch.index).toBe(beforeResult.cache.headingMatch.index)
  })

  it('picks up a heading inserted later in a document that previously had none', () => {
    const before = ['plain line one', 'plain line two', 'plain line three'].join('\n')
    const beforeResult = deriveNoteTitleIncremental(before, null)
    expect(beforeResult.title).toBe('plain line one')

    const after = ['plain line one', '# New Heading', 'plain line three'].join('\n')
    const afterResult = deriveNoteTitleIncremental(after, beforeResult.cache)

    expectMatchesFullScan(after, afterResult)
    expect(afterResult.title).toBe('New Heading')
  })

  it('handles editing away the title-determining heading (the no-cached-suffix-info hazard)', () => {
    const before = ['intro', '# The Title', 'body', 'more body', '# a later heading too'].join('\n')
    const beforeResult = deriveNoteTitleIncremental(before, null)
    expect(beforeResult.title).toBe('The Title')

    const after = ['intro', 'not a heading anymore', 'body', 'more body', '# a later heading too'].join('\n')
    const afterResult = deriveNoteTitleIncremental(after, beforeResult.cache)

    expectMatchesFullScan(after, afterResult)
    expect(afterResult.title).toBe('a later heading too')
  })

  it('handles editing away the only heading, falling back to first content line', () => {
    const before = ['# Only Heading', 'body text'].join('\n')
    const beforeResult = deriveNoteTitleIncremental(before, null)
    expect(beforeResult.title).toBe('Only Heading')

    const after = ['not a heading', 'body text'].join('\n')
    const afterResult = deriveNoteTitleIncremental(after, beforeResult.cache)

    expectMatchesFullScan(after, afterResult)
    expect(afterResult.title).toBe('not a heading')
  })

  it('handles going from a heading-present document straight to an edit of the (never-cached) content line', () => {
    // First call finds a heading, so contentMatch is deliberately left
    // uncached (see noteTitle.ts doc comment) -- this exercises the "next
    // call that actually needs content matching starts from null" path.
    const first = ['# Heading', 'first content line', 'second content line'].join('\n')
    const firstResult = deriveNoteTitleIncremental(first, null)
    expect(firstResult.cache.contentMatch).toBeNull()

    const second = ['not a heading', 'first content line', 'second content line'].join('\n')
    const secondResult = deriveNoteTitleIncremental(second, firstResult.cache)
    expectMatchesFullScan(second, secondResult)
    expect(secondResult.title).toBe('not a heading')
  })

  it('returns an empty-ish title for an all-blank document', () => {
    const text = '\n\n\n'
    const result = deriveNoteTitleIncremental(text, null)
    expectMatchesFullScan(text, result)
  })

  function makeRng(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  function buildFuzzDocument(rng: () => number): string {
    const kinds = [
      () => `# Heading ${Math.floor(rng() * 1000)}`,
      () => `plain content line ${Math.floor(rng() * 1000)}`,
      () => '',
      () => '#',
      () => `#not a real heading ${Math.floor(rng() * 1000)}`,
    ]
    const lineCount = 3 + Math.floor(rng() * 15)
    const lines: string[] = []
    for (let i = 0; i < lineCount; i += 1) {
      lines.push(kinds[Math.floor(rng() * kinds.length)]())
    }
    return lines.join('\n')
  }

  function applyFuzzEdit(text: string, rng: () => number): string {
    const lines = text.split('\n')
    const idx = Math.floor(rng() * Math.max(1, lines.length))
    const choice = rng()

    if (lines.length === 0 || choice < 0.25) {
      const kinds = [`# New Heading ${Math.floor(rng() * 1000)}`, `new content ${Math.floor(rng() * 1000)}`, '']
      lines.splice(idx, 0, kinds[Math.floor(rng() * kinds.length)])
    } else if (choice < 0.45) {
      lines.splice(idx, 1)
    } else if (choice < 0.7) {
      lines[idx] = `${lines[idx]}x`
    } else if (choice < 0.85 && lines[idx].startsWith('# ')) {
      // Specifically edit away a heading -- the hazard case.
      lines[idx] = lines[idx].slice(2)
    } else {
      lines[idx] = `# ${lines[idx]}`
    }

    return lines.join('\n')
  }

  function runFuzzSequence(seed: number, steps: number) {
    const rng = makeRng(seed)
    let text = buildFuzzDocument(rng)
    let cache: NoteTitleCache | null = null

    for (let step = 0; step < steps; step += 1) {
      text = applyFuzzEdit(text, rng)
      const result = deriveNoteTitleIncremental(text, cache)
      cache = result.cache

      const groundTruth = deriveNoteTitleFromText(text)
      expect(
        result.title,
        `seed ${seed}: mismatch after fuzz step ${step} on text:\n${JSON.stringify(text)}`,
      ).toBe(groundTruth)
    }
  }

  it.each([20260730, 1, 424242])('matches a full scan after every step of a long randomized edit sequence (seed %i)', (seed) => {
    runFuzzSequence(seed, 300)
  })
})
