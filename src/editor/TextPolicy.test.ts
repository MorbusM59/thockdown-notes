import { describe, expect, it } from 'vitest'
import {
  canonicalizeParagraphSegments,
  canonicalizeParagraphSegmentsIncremental,
  normalizeInternalText,
  type CanonicalizeParagraphSegmentsCache,
} from './TextPolicy'

describe('normalizeInternalText', () => {
  it('normalizes CRLF and lone CR to LF', () => {
    expect(normalizeInternalText('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('normalizes unicode line/paragraph separators to LF', () => {
    expect(normalizeInternalText('a b c')).toBe('a\nb\nc')
  })

  it('expands tabs to three spaces', () => {
    expect(normalizeInternalText('a\tb')).toBe('a   b')
  })

  it('strips a leading BOM', () => {
    expect(normalizeInternalText('﻿hello')).toBe('hello')
  })
})

describe('canonicalizeParagraphSegmentsIncremental', () => {
  // Ground truth is always the plain, non-incremental
  // canonicalizeParagraphSegments -- every assertion here is "the
  // incremental result must equal a full recompute," never a hand-
  // transcribed expectation, per this codebase's own established
  // discipline for incremental/caching logic.
  function expectMatchesFullRecompute(segments: string[], cache: CanonicalizeParagraphSegmentsCache) {
    expect(cache.text).toBe(canonicalizeParagraphSegments(segments))
  }

  it('matches a full recompute with no previous cache (first call)', () => {
    const segments = ['first', 'second', 'third']
    const cache = canonicalizeParagraphSegmentsIncremental(segments, null)
    expectMatchesFullRecompute(segments, cache)
  })

  it('returns an empty cache for an empty segments array', () => {
    const cache = canonicalizeParagraphSegmentsIncremental([], null)
    expect(cache.text).toBe('')
    expect(cache.normalized).toEqual([])
  })

  it('reuses unchanged prefix/suffix segments verbatim (same string instances)', () => {
    const before = ['alpha', 'bravo', 'charlie']
    const beforeCache = canonicalizeParagraphSegmentsIncremental(before, null)

    const after = ['alpha', 'BRAVO', 'charlie']
    const afterCache = canonicalizeParagraphSegmentsIncremental(after, beforeCache)

    expectMatchesFullRecompute(after, afterCache)
    expect(afterCache.normalized[0]).toBe(beforeCache.normalized[0])
    expect(afterCache.normalized[2]).toBe(beforeCache.normalized[2])
    expect(afterCache.normalized[1]).toBe('BRAVO')
  })

  it('handles a segment insertion shifting the tail', () => {
    const before = ['a', 'b', 'c']
    const beforeCache = canonicalizeParagraphSegmentsIncremental(before, null)

    const after = ['a', 'NEW', 'b', 'c']
    const afterCache = canonicalizeParagraphSegmentsIncremental(after, beforeCache)

    expectMatchesFullRecompute(after, afterCache)
    expect(afterCache.normalized[3]).toBe(beforeCache.normalized[2])
  })

  it('handles a segment deletion shifting the tail', () => {
    const before = ['a', 'b', 'c', 'd']
    const beforeCache = canonicalizeParagraphSegmentsIncremental(before, null)

    const after = ['a', 'c', 'd']
    const afterCache = canonicalizeParagraphSegmentsIncremental(after, beforeCache)

    expectMatchesFullRecompute(after, afterCache)
    expect(afterCache.normalized[1]).toBe(beforeCache.normalized[2])
    expect(afterCache.normalized[2]).toBe(beforeCache.normalized[3])
  })

  it('normalizes a newly-added segment needing normalization (tabs, CRLF)', () => {
    const before = ['a', 'b']
    const beforeCache = canonicalizeParagraphSegmentsIncremental(before, null)

    const after = ['a', 'b', 'c\td\r\ne']
    const afterCache = canonicalizeParagraphSegmentsIncremental(after, beforeCache)

    expectMatchesFullRecompute(after, afterCache)
    expect(afterCache.normalized[2]).toBe('c   d\ne')
  })

  it('handles going all the way to zero segments and back', () => {
    const cache1 = canonicalizeParagraphSegmentsIncremental(['a', 'b'], null)
    const cache2 = canonicalizeParagraphSegmentsIncremental([], cache1)
    expect(cache2.text).toBe('')
    const cache3 = canonicalizeParagraphSegmentsIncremental(['x'], cache2)
    expectMatchesFullRecompute(['x'], cache3)
  })

  function makeRng(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  function buildFuzzSegments(rng: () => number): string[] {
    const kinds = [
      () => `plain segment ${Math.floor(rng() * 1000)}`,
      () => `segment\twith\ttabs ${Math.floor(rng() * 1000)}`,
      () => `segment\r\nwith\rmixed line endings`,
      () => '',
      () => '   leading and trailing spaces   ',
    ]
    const count = 5 + Math.floor(rng() * 15)
    const segments: string[] = []
    for (let i = 0; i < count; i += 1) {
      segments.push(kinds[Math.floor(rng() * kinds.length)]())
    }
    return segments
  }

  function applyFuzzEdit(segments: string[], rng: () => number): string[] {
    const next = segments.slice()
    const idx = Math.floor(rng() * Math.max(1, next.length))
    const choice = rng()

    if (next.length === 0 || choice < 0.35) {
      next.splice(idx, 0, `inserted ${Math.floor(rng() * 1000)}`)
    } else if (choice < 0.55) {
      next.splice(idx, 1)
    } else if (choice < 0.8) {
      next[idx] = `${next[idx]}x`
    } else {
      next[idx] = `${next[idx]}\t\r\n`
    }

    return next
  }

  function runFuzzSequence(seed: number, steps: number) {
    const rng = makeRng(seed)
    let segments = buildFuzzSegments(rng)
    let cache = canonicalizeParagraphSegmentsIncremental(segments, null)
    expectMatchesFullRecompute(segments, cache)

    for (let step = 0; step < steps; step += 1) {
      segments = applyFuzzEdit(segments, rng)
      cache = canonicalizeParagraphSegmentsIncremental(segments, cache)

      const groundTruth = canonicalizeParagraphSegments(segments)
      expect(
        cache.text,
        `seed ${seed}: mismatch after fuzz step ${step} on segments:\n${JSON.stringify(segments)}`,
      ).toBe(groundTruth)
    }
  }

  it.each([20260730, 1, 424242])('matches a full recompute after every step of a long randomized edit sequence (seed %i)', (seed) => {
    runFuzzSequence(seed, 200)
  })
})
