import { describe, expect, it } from 'vitest'
import { ParagraphOffsetIndex } from './ParagraphOffsetIndex'

describe('ParagraphOffsetIndex basics', () => {
  it('starts empty', () => {
    const index = new ParagraphOffsetIndex()
    expect(index.size()).toBe(0)
    expect(index.totalLength()).toBe(0)
    expect(index.toOrderedKeys()).toEqual([])
    index.debugValidateInvariants()
  })

  it('indexes a single paragraph', () => {
    const index = new ParagraphOffsetIndex()
    index.insertAfter(null, 'a', 5)
    expect(index.size()).toBe(1)
    expect(index.totalLength()).toBe(5)
    expect(index.prefixOffset('a')).toBe(0)
    index.debugValidateInvariants()
  })

  it('insertAfter appends in order and computes prefix offsets with LF separators', () => {
    const index = new ParagraphOffsetIndex()
    index.insertAfter(null, 'a', 5) // "alpha"
    index.insertAfter('a', 'b', 5) // "bravo"
    index.insertAfter('b', 'c', 7) // "charlie"
    expect(index.toOrderedKeys()).toEqual(['a', 'b', 'c'])
    expect(index.prefixOffset('a')).toBe(0)
    expect(index.prefixOffset('b')).toBe(6) // "alpha\n"
    expect(index.prefixOffset('c')).toBe(12) // "alpha\nbravo\n"
    expect(index.totalLength()).toBe(19) // "alpha\nbravo\ncharlie".length
    index.debugValidateInvariants()
  })

  it('insertBefore places a paragraph immediately before the reference', () => {
    const index = new ParagraphOffsetIndex()
    index.insertAfter(null, 'a', 5)
    index.insertAfter('a', 'c', 7)
    index.insertBefore('c', 'b', 5)
    expect(index.toOrderedKeys()).toEqual(['a', 'b', 'c'])
    index.debugValidateInvariants()
  })

  it('insertBefore(null, ...) appends at the end', () => {
    const index = new ParagraphOffsetIndex()
    index.insertAfter(null, 'a', 1)
    index.insertBefore(null, 'b', 1)
    expect(index.toOrderedKeys()).toEqual(['a', 'b'])
    index.debugValidateInvariants()
  })

  it('remove splices a paragraph out and shifts subsequent offsets', () => {
    const index = new ParagraphOffsetIndex()
    index.insertAfter(null, 'a', 5)
    index.insertAfter('a', 'b', 5)
    index.insertAfter('b', 'c', 7)
    index.remove('b')
    expect(index.toOrderedKeys()).toEqual(['a', 'c'])
    expect(index.prefixOffset('c')).toBe(6) // "alpha\n"
    expect(index.has('b')).toBe(false)
    index.debugValidateInvariants()
  })

  it('lengthOf returns each paragraph\'s own length', () => {
    const index = new ParagraphOffsetIndex()
    index.insertAfter(null, 'a', 5)
    index.insertAfter('a', 'b', 7)
    expect(index.lengthOf('a')).toBe(5)
    expect(index.lengthOf('b')).toBe(7)
    index.updateLength('a', 10)
    expect(index.lengthOf('a')).toBe(10)
  })

  it('updateLength adjusts this paragraph and every subsequent prefix offset', () => {
    const index = new ParagraphOffsetIndex()
    index.insertAfter(null, 'a', 5)
    index.insertAfter('a', 'b', 5)
    index.insertAfter('b', 'c', 7)
    index.updateLength('a', 10)
    expect(index.prefixOffset('a')).toBe(0)
    expect(index.prefixOffset('b')).toBe(11)
    expect(index.prefixOffset('c')).toBe(17)
    index.debugValidateInvariants()
  })

  it('removing every node returns the index to empty', () => {
    const index = new ParagraphOffsetIndex()
    index.insertAfter(null, 'a', 1)
    index.insertAfter('a', 'b', 1)
    index.insertAfter('b', 'c', 1)
    index.remove('a')
    index.remove('b')
    index.remove('c')
    expect(index.size()).toBe(0)
    expect(index.totalLength()).toBe(0)
    index.debugValidateInvariants()
  })

  it('throws on duplicate key insertion, unknown-key operations, and unknown reference keys', () => {
    const index = new ParagraphOffsetIndex()
    index.insertAfter(null, 'a', 1)
    expect(() => index.insertAfter(null, 'a', 1)).toThrow()
    expect(() => index.insertAfter('missing', 'b', 1)).toThrow()
    expect(() => index.insertBefore('missing', 'b', 1)).toThrow()
    expect(() => index.remove('missing')).toThrow()
    expect(() => index.updateLength('missing', 1)).toThrow()
    expect(() => index.prefixOffset('missing')).toThrow()
  })
})

describe('ParagraphOffsetIndex fuzz vs. naive array reference', () => {
  function makeRng(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  // Naive O(n)-per-op reference: an ordered array of {key, length}, exactly
  // mirroring what the *old* getOffsetWithinRoot-style linear walk computes.
  // Ground truth for the fuzz comparison -- if the treap and this reference
  // ever disagree, the treap is wrong.
  class NaiveReference {
    entries: Array<{ key: string; length: number }> = []

    insertAfter(afterKey: string | null, key: string, length: number) {
      const index = afterKey === null ? 0 : this.entries.findIndex((e) => e.key === afterKey) + 1
      this.entries.splice(index, 0, { key, length })
    }

    insertBefore(beforeKey: string | null, key: string, length: number) {
      const index = beforeKey === null ? this.entries.length : this.entries.findIndex((e) => e.key === beforeKey)
      this.entries.splice(index, 0, { key, length })
    }

    remove(key: string) {
      const index = this.entries.findIndex((e) => e.key === key)
      this.entries.splice(index, 1)
    }

    updateLength(key: string, length: number) {
      const entry = this.entries.find((e) => e.key === key)!
      entry.length = length
    }

    prefixOffset(key: string): number {
      let offset = 0
      for (const entry of this.entries) {
        if (entry.key === key) return offset
        offset += entry.length + 1
      }
      throw new Error(`key ${key} not found in reference`)
    }

    totalLength(): number {
      if (this.entries.length === 0) return 0
      return this.entries.reduce((sum, e) => sum + e.length, 0) + (this.entries.length - 1)
    }

    orderedKeys(): string[] {
      return this.entries.map((e) => e.key)
    }
  }

  function runFuzzSequence(seed: number, steps: number) {
    const rng = makeRng(seed)
    const index = new ParagraphOffsetIndex()
    const reference = new NaiveReference()
    let nextId = 0

    const assertMatches = (label: string) => {
      index.debugValidateInvariants()
      expect(index.toOrderedKeys(), `${label} (seed ${seed}): ordered keys diverged`).toEqual(reference.orderedKeys())
      expect(index.size(), `${label} (seed ${seed}): size diverged`).toBe(reference.entries.length)
      expect(index.totalLength(), `${label} (seed ${seed}): totalLength diverged`).toBe(reference.totalLength())
      for (const entry of reference.entries) {
        expect(index.prefixOffset(entry.key), `${label} (seed ${seed}): prefixOffset("${entry.key}") diverged`).toBe(reference.prefixOffset(entry.key))
      }
    }

    for (let step = 0; step < steps; step += 1) {
      const n = reference.entries.length
      const choice = rng()

      if (n === 0 || choice < 0.4) {
        // Insert a new paragraph at a random position via insertAfter or insertBefore.
        const key = `p${nextId}`
        nextId += 1
        const length = Math.floor(rng() * 40)
        const useAfter = rng() < 0.5
        if (n === 0) {
          index.insertAfter(null, key, length)
          reference.insertAfter(null, key, length)
        } else if (useAfter) {
          const refKey = reference.entries[Math.floor(rng() * n)].key
          index.insertAfter(refKey, key, length)
          reference.insertAfter(refKey, key, length)
        } else {
          const refKey = reference.entries[Math.floor(rng() * n)].key
          index.insertBefore(refKey, key, length)
          reference.insertBefore(refKey, key, length)
        }
      } else if (choice < 0.6 && n > 0) {
        // Insert at the very start or very end.
        const key = `p${nextId}`
        nextId += 1
        const length = Math.floor(rng() * 40)
        if (rng() < 0.5) {
          index.insertAfter(null, key, length)
          reference.insertAfter(null, key, length)
        } else {
          index.insertBefore(null, key, length)
          reference.insertBefore(null, key, length)
        }
      } else if (choice < 0.8 && n > 0) {
        // Remove a random paragraph.
        const key = reference.entries[Math.floor(rng() * n)].key
        index.remove(key)
        reference.remove(key)
      } else if (n > 0) {
        // Update a random paragraph's length.
        const key = reference.entries[Math.floor(rng() * n)].key
        const length = Math.floor(rng() * 40)
        index.updateLength(key, length)
        reference.updateLength(key, length)
      }

      assertMatches(`step ${step}`)
    }
  }

  it.each([1, 2026, 424242, 90210, 7])('matches a naive reference after every step of a long randomized operation sequence (seed %i)', (seed) => {
    runFuzzSequence(seed, 500)
  })

  it('handles a large document (10,000 paragraphs) without stack overflow or invariant drift', () => {
    const index = new ParagraphOffsetIndex()
    const reference = new NaiveReference()
    for (let i = 0; i < 10000; i += 1) {
      const key = `p${i}`
      const length = 20 + (i % 30)
      index.insertAfter(i === 0 ? null : `p${i - 1}`, key, length)
      reference.insertAfter(i === 0 ? null : `p${i - 1}`, key, length)
    }
    index.debugValidateInvariants()
    expect(index.totalLength()).toBe(reference.totalLength())
    // Spot-check offsets at the start, middle, and end -- this is exactly
    // the "page 1 must feel identical to page 1,000" property: an edit near
    // the start must not be asymptotically cheaper or more expensive to
    // query than one near the end.
    expect(index.prefixOffset('p0')).toBe(reference.prefixOffset('p0'))
    expect(index.prefixOffset('p5000')).toBe(reference.prefixOffset('p5000'))
    expect(index.prefixOffset('p9999')).toBe(reference.prefixOffset('p9999'))

    // Delete and re-edit near the start, middle, and end; confirm still correct.
    for (const key of ['p0', 'p5000', 'p9999']) {
      index.updateLength(key, 999)
      reference.updateLength(key, 999)
    }
    index.debugValidateInvariants()
    expect(index.prefixOffset('p1')).toBe(reference.prefixOffset('p1'))
    expect(index.prefixOffset('p5001')).toBe(reference.prefixOffset('p5001'))
  })
})
