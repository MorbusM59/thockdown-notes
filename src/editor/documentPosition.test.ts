import { describe, expect, it } from 'vitest'
import {
  CONTINUOUS_DOCUMENT_MAX_CHARS,
  isContinuousDocument,
  resolveChunkedCharTarget,
  resolveChunkedScrollRatio,
  resolveContinuousRatios,
} from './documentPosition'

describe('isContinuousDocument', () => {
  it('splits at the threshold', () => {
    expect(isContinuousDocument(0)).toBe(true)
    expect(isContinuousDocument(CONTINUOUS_DOCUMENT_MAX_CHARS - 1)).toBe(true)
    expect(isContinuousDocument(CONTINUOUS_DOCUMENT_MAX_CHARS)).toBe(false)
  })
})

describe('resolveContinuousRatios', () => {
  it('reports the plain scrollbar identity', () => {
    const ratios = resolveContinuousRatios({ scrollTopPx: 250, clientHeightPx: 500, scrollHeightPx: 1000 })
    expect(ratios).toEqual({ scrollRatio: 0.5, thumbRatio: 0.5 })
  })

  it('reads zero for a document that fits on screen', () => {
    const ratios = resolveContinuousRatios({ scrollTopPx: 0, clientHeightPx: 900, scrollHeightPx: 900 })
    expect(ratios).toEqual({ scrollRatio: 0, thumbRatio: 1 })
  })

  it('says nothing rather than zero when it has no geometry', () => {
    expect(resolveContinuousRatios({ scrollTopPx: 0, clientHeightPx: 0, scrollHeightPx: 1000 })).toBeNull()
    expect(resolveContinuousRatios({ scrollTopPx: 0, clientHeightPx: 500, scrollHeightPx: 0 })).toBeNull()
  })
})

describe('resolveChunkedScrollRatio', () => {
  it('reaches exactly 1 when the document does', () => {
    const totalChars = 1_000_000
    const thumbRatio = 0.02
    // The last position a reader can reach is the document minus the
    // screenful that stays visible.
    const lastStartChar = totalChars * (1 - thumbRatio)
    expect(resolveChunkedScrollRatio({ startChar: lastStartChar, totalChars, thumbRatio })).toBe(1)
    expect(resolveChunkedScrollRatio({ startChar: 0, totalChars, thumbRatio })).toBe(0)
  })

  it('is monotone in position and independent of anything else', () => {
    const totalChars = 500_000
    const thumbRatio = 0.05
    let previous = -1
    for (let startChar = 0; startChar <= totalChars; startChar += 10_000) {
      const ratio = resolveChunkedScrollRatio({ startChar, totalChars, thumbRatio })!
      expect(ratio).toBeGreaterThanOrEqual(previous)
      previous = ratio
    }
  })

  it('round-trips through the char target it is the inverse of', () => {
    const totalChars = 1_200_000
    const thumbRatio = 0.013
    for (const ratio of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
      const startChar = resolveChunkedCharTarget({ ratio, totalChars, thumbRatio })
      expect(resolveChunkedScrollRatio({ startChar, totalChars, thumbRatio })).toBeCloseTo(ratio, 10)
    }
  })

  it('does not run past its own ends', () => {
    const totalChars = 1000
    const thumbRatio = 0.1
    expect(resolveChunkedScrollRatio({ startChar: -50, totalChars, thumbRatio })).toBe(0)
    expect(resolveChunkedScrollRatio({ startChar: totalChars * 2, totalChars, thumbRatio })).toBe(1)
    expect(resolveChunkedCharTarget({ ratio: 2, totalChars, thumbRatio })).toBe(900)
    expect(resolveChunkedCharTarget({ ratio: -1, totalChars, thumbRatio })).toBe(0)
  })

  it('says nothing rather than zero for an empty document', () => {
    expect(resolveChunkedScrollRatio({ startChar: 0, totalChars: 0, thumbRatio: 0.5 })).toBeNull()
  })

  it('reads zero when one screen already holds the whole document', () => {
    expect(resolveChunkedScrollRatio({ startChar: 0, totalChars: 1000, thumbRatio: 1 })).toBe(0)
  })
})
