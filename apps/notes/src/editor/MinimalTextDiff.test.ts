import { describe, expect, it } from 'vitest'
import { computeMinimalTextReplacement } from './MinimalTextDiff'

function applyReplacement(currentText: string, change: { from: number; to: number; insert: string }): string {
  return currentText.slice(0, change.from) + change.insert + currentText.slice(change.to)
}

// A naive reference: replace the whole string, always correct by
// construction, used only to confirm computeMinimalTextReplacement's output
// round-trips to nextText -- never to check minimality (that's checked
// directly against known common prefix/suffix lengths below).
function naiveReplace(currentText: string, nextText: string): string {
  void currentText
  return nextText
}

describe('computeMinimalTextReplacement', () => {
  it('produces a change that round-trips to nextText for basic cases', () => {
    const cases: [string, string][] = [
      ['AAAAA BBBBB CCCCC', 'XXXAAAAA BBBBB CCCCC'],
      ['AAAAA BBBBB CCCCC', 'AAAAA BBBBB CCCCCXXX'],
      ['AAAAA BBBBB CCCCC', 'AAAAA ZZZZZ CCCCC'],
      ['', ''],
      ['', 'new content'],
      ['old content', ''],
      ['same', 'same'],
      ['a', 'b'],
      ['abc', 'xyz'],
    ]
    for (const [current, next] of cases) {
      const change = computeMinimalTextReplacement(current, next)
      expect(applyReplacement(current, change)).toBe(naiveReplace(current, next))
    }
  })

  it('returns a no-op (from === to, empty insert) for identical strings', () => {
    const change = computeMinimalTextReplacement('identical text', 'identical text')
    expect(change.from).toBe(change.to)
    expect(change.insert).toBe('')
  })

  it('finds the maximal common prefix and suffix -- does not touch unrelated leading/trailing content', () => {
    const current = 'PREFIX-middle-SUFFIX'
    const next = 'PREFIX-changed-SUFFIX'
    const change = computeMinimalTextReplacement(current, next)
    expect(change.from).toBe('PREFIX-'.length)
    expect(current.length - change.to).toBe('-SUFFIX'.length)
    expect(change.insert).toBe('changed')
  })

  it('handles nextText being a strict prefix of currentText (trailing deletion)', () => {
    const current = 'AAAA BBBB CCCC DDDD'
    const next = 'AAAA BBBB'
    const change = computeMinimalTextReplacement(current, next)
    expect(change.insert).toBe('')
    expect(applyReplacement(current, change)).toBe(next)
  })

  it('handles nextText being a strict extension of currentText (trailing insertion)', () => {
    const current = 'AAAA BBBB'
    const next = 'AAAA BBBB CCCC DDDD'
    const change = computeMinimalTextReplacement(current, next)
    expect(change.from).toBe(change.to)
    expect(change.from).toBe(current.length)
    expect(change.insert).toBe(' CCCC DDDD')
  })

  it('handles a leading insertion (the exact shape the hydration mismatch produces for appended typing)', () => {
    const current = 'rest of the document unchanged here'
    const next = 'XYZ' + current
    const change = computeMinimalTextReplacement(current, next)
    expect(change.from).toBe(0)
    expect(change.to).toBe(0)
    expect(change.insert).toBe('XYZ')
  })

  // Fuzz: random string pairs (including shared substrings, since purely
  // random strings rarely share a prefix/suffix at all) verified only for
  // the one property that actually matters here -- the computed change
  // round-trips to nextText exactly. Minimality for structured cases is
  // covered by the targeted tests above; the fuzz pass exists to catch any
  // off-by-one in the prefix/suffix walk across a wide range of lengths.
  it('round-trips correctly across many random string pairs (fuzz)', () => {
    let seed = 20260731
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const alphabet = 'ab '
    const randomString = (len: number) => {
      let s = ''
      for (let i = 0; i < len; i += 1) s += alphabet[Math.floor(rand() * alphabet.length)]
      return s
    }

    for (let step = 0; step < 500; step += 1) {
      const baseLen = Math.floor(rand() * 30)
      const base = randomString(baseLen)
      // Bias toward edits derived from `base` (shared prefix/suffix is the
      // realistic case this function exists for) rather than fully
      // independent random strings.
      const editStart = Math.floor(rand() * (base.length + 1))
      const editEnd = editStart + Math.floor(rand() * (base.length - editStart + 1))
      const inserted = randomString(Math.floor(rand() * 10))
      const next = base.slice(0, editStart) + inserted + base.slice(editEnd)

      const change = computeMinimalTextReplacement(base, next)
      expect(applyReplacement(base, change)).toBe(next)
      // Bounds sanity: from <= to, both within [0, base.length].
      expect(change.from).toBeGreaterThanOrEqual(0)
      expect(change.to).toBeGreaterThanOrEqual(change.from)
      expect(change.to).toBeLessThanOrEqual(base.length)
    }
  })
})
