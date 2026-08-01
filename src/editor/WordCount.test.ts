import { describe, expect, it } from 'vitest'
import { countWords, trackWordCount } from './WordCount'

describe('countWords', () => {
  it('returns 0 for empty text', () => {
    expect(countWords('')).toBe(0)
  })

  it('returns 0 for whitespace-only text', () => {
    expect(countWords('   \n\t  ')).toBe(0)
  })

  it('counts plain space-separated words', () => {
    expect(countWords('one two three')).toBe(3)
  })

  it('treats runs of mixed whitespace (spaces, tabs, newlines) as a single separator', () => {
    expect(countWords('one   two\t\tthree\n\nfour')).toBe(4)
  })

  it('ignores leading/trailing whitespace', () => {
    expect(countWords('  one two  ')).toBe(2)
  })
})

describe('trackWordCount', () => {
  // Ground truth is always countWords on the resulting full text -- every
  // assertion here is "the tracked result must equal a full recount," never
  // a hand-transcribed expectation, per this codebase's own established
  // discipline for incremental logic (see PreviewBlockSplit.test.ts,
  // TextPolicy.test.ts).
  function expectMatchesFullRecount(newText: string, tracked: number) {
    expect(tracked).toBe(countWords(newText))
  }

  it('returns the same count unchanged when the text is identical', () => {
    expect(trackWordCount('one two three', 3, 'one two three')).toBe(3)
  })

  it('increments by one when a whole new word is typed at the end', () => {
    const tracked = trackWordCount('one two', 2, 'one two three')
    expectMatchesFullRecount('one two three', tracked)
  })

  it('does not change count when typing inside an existing word', () => {
    const tracked = trackWordCount('one two three', 3, 'one twwo three')
    expectMatchesFullRecount('one twwo three', tracked)
  })

  it('decrements when deleting a whole word plus its separating space', () => {
    const tracked = trackWordCount('one two three', 3, 'one three')
    expectMatchesFullRecount('one three', tracked)
  })

  it('handles typing the very first character into an empty document', () => {
    const tracked = trackWordCount('', 0, 'a')
    expectMatchesFullRecount('a', tracked)
  })

  it('handles deleting the last character, back to an empty document', () => {
    const tracked = trackWordCount('a', 1, '')
    expectMatchesFullRecount('', tracked)
  })

  it('merges two words into one by deleting the space between them', () => {
    const tracked = trackWordCount('one two', 2, 'onetwo')
    expectMatchesFullRecount('onetwo', tracked)
  })

  it('splits one word into two by inserting a space in the middle', () => {
    const tracked = trackWordCount('onetwo', 1, 'one two')
    expectMatchesFullRecount('one two', tracked)
  })

  it('handles inserting a newline (a whitespace character) splitting a word', () => {
    const tracked = trackWordCount('onetwo', 1, 'one\ntwo')
    expectMatchesFullRecount('one\ntwo', tracked)
  })

  it('handles a multi-character paste inserting several new words', () => {
    const tracked = trackWordCount('start end', 2, 'start middle words here end')
    expectMatchesFullRecount('start middle words here end', tracked)
  })

  it('handles deleting a whole word from the middle, collapsing double spaces down to one', () => {
    const tracked = trackWordCount('one two three', 3, 'one  three')
    expectMatchesFullRecount('one  three', tracked)
  })

  it('handles an edit inside a long run of non-whitespace characters (e.g. a URL) without scanning the whole document', () => {
    const before = `prefix ${'a'.repeat(5000)} suffix`
    const beforeCount = countWords(before)
    const after = `prefix ${'a'.repeat(2500)}X${'a'.repeat(2500)} suffix`
    const tracked = trackWordCount(before, beforeCount, after)
    expectMatchesFullRecount(after, tracked)
  })

  function makeRng(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  function buildFuzzText(rng: () => number): string {
    const kinds = [
      () => `word${Math.floor(rng() * 1000)}`,
      () => ' ',
      () => '  ',
      () => '\t',
      () => '\n',
      () => '\n\n',
      () => '',
    ]
    const count = 10 + Math.floor(rng() * 20)
    let text = ''
    for (let i = 0; i < count; i += 1) {
      text += kinds[Math.floor(rng() * kinds.length)]()
    }
    return text
  }

  function applyFuzzEdit(text: string, rng: () => number): string {
    const idx = Math.floor(rng() * (text.length + 1))
    const choice = rng()

    if (choice < 0.3) {
      // Insert a single character (word or whitespace) at a random position.
      const ch = rng() < 0.5 ? 'x' : [' ', '\t', '\n'][Math.floor(rng() * 3)]
      return text.slice(0, idx) + ch + text.slice(idx)
    }
    if (choice < 0.5 && text.length > 0) {
      // Delete a single character at a random position.
      const delIdx = Math.floor(rng() * text.length)
      return text.slice(0, delIdx) + text.slice(delIdx + 1)
    }
    if (choice < 0.7) {
      // Insert a whole new word.
      const word = `new${Math.floor(rng() * 1000)}`
      return text.slice(0, idx) + word + text.slice(idx)
    }
    if (choice < 0.85 && text.length > 3) {
      // Delete a small range.
      const start = Math.floor(rng() * text.length)
      const end = Math.min(text.length, start + 1 + Math.floor(rng() * 5))
      return text.slice(0, start) + text.slice(end)
    }
    // Replace a small range with a fresh chunk (paste-like edit).
    const start = Math.floor(rng() * (text.length + 1))
    const end = Math.min(text.length, start + Math.floor(rng() * 8))
    return text.slice(0, start) + buildFuzzText(rng).slice(0, 6) + text.slice(end)
  }

  function runFuzzSequence(seed: number, steps: number) {
    const rng = makeRng(seed)
    let text = buildFuzzText(rng)
    let wordCount = countWords(text)
    expect(wordCount).toBe(countWords(text))

    for (let step = 0; step < steps; step += 1) {
      const nextText = applyFuzzEdit(text, rng)
      const tracked = trackWordCount(text, wordCount, nextText)
      const groundTruth = countWords(nextText)

      expect(
        tracked,
        `seed ${seed}: mismatch after fuzz step ${step}\n  before: ${JSON.stringify(text)}\n  after:  ${JSON.stringify(nextText)}`,
      ).toBe(groundTruth)

      text = nextText
      wordCount = tracked
    }
  }

  it.each([20260801, 1, 424242])('matches a full recount after every step of a long randomized edit sequence (seed %i)', (seed) => {
    runFuzzSequence(seed, 500)
  })
})
