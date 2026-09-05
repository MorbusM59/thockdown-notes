import { describe, expect, it } from 'vitest'
import {
  CONTINUOUS_DOCUMENT_MAX_CHARS,
  isContinuousDocument,
  resolveChunkedCharTarget,
  resolveChunkedThumbRatio,
  resolveViewportCharCapacity,
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
  const totalChars = 400_000
  const lastScreenChars = 1_600
  const at = (startChar: number) => resolveChunkedScrollRatio({ startChar, totalChars, lastScreenChars })!

  it('is exactly 0 and exactly 1 at the two ends', () => {
    // The point of measuring the last screen rather than estimating it: the
    // furthest a reader can go is the START of that screen, so dividing by the
    // span they can actually move through makes both ends land, not approach.
    expect(at(0)).toBe(0)
    expect(at(totalChars - lastScreenChars)).toBe(1)
  })

  it('is the position over the span the reader can move through', () => {
    const span = totalChars - lastScreenChars
    expect(at(span / 2)).toBeCloseTo(0.5, 12)
    expect(at(span / 4)).toBeCloseTo(0.25, 12)
  })

  it('is monotone as the reader advances', () => {
    let previous = -1
    for (let startChar = 0; startChar <= totalChars - lastScreenChars; startChar += 5_000) {
      const ratio = at(startChar)
      expect(ratio).toBeGreaterThan(previous)
      previous = ratio
    }
  })

  it('round-trips exactly through the char target it is the inverse of', () => {
    // Excluding 1, which is answered directly rather than through the span --
    // see 'answers the very end directly' below.
    for (const ratio of [0, 0.1, 0.37, 0.5, 0.9]) {
      const startChar = resolveChunkedCharTarget({ ratio, totalChars, lastScreenChars })
      expect(at(startChar)).toBeCloseTo(ratio, 12)
    }
  })

  it('lands a drag just short of the end on the start of the last screenful', () => {
    const target = resolveChunkedCharTarget({ ratio: 0.999, totalChars, lastScreenChars })
    expect(target).toBeCloseTo((totalChars - lastScreenChars) * 0.999, 6)
  })

  it('answers the very end directly, not through the measurement', () => {
    // lastScreenChars is measured and carries a small error; at the extreme the
    // reader's intent is unambiguous and should not be filtered through it.
    expect(resolveChunkedCharTarget({ ratio: 1, totalChars, lastScreenChars })).toBe(totalChars)
  })

  it('reads zero when one screen holds the whole document', () => {
    expect(resolveChunkedScrollRatio({ startChar: 0, totalChars: 1000, lastScreenChars: 1000 })).toBe(0)
    expect(resolveChunkedCharTarget({ ratio: 0.5, totalChars: 1000, lastScreenChars: 1000 })).toBe(0)
  })

  it('does not run past its own ends', () => {
    expect(at(-50)).toBe(0)
    expect(at(totalChars * 2)).toBe(1)
    expect(resolveChunkedCharTarget({ ratio: 2, totalChars, lastScreenChars })).toBe(totalChars)
    expect(resolveChunkedCharTarget({ ratio: -1, totalChars, lastScreenChars })).toBe(0)
  })

  it('says nothing rather than zero for an empty document', () => {
    expect(resolveChunkedScrollRatio({ startChar: 0, totalChars: 0, lastScreenChars: 0 })).toBeNull()
  })
})

describe('resolveViewportCharCapacity', () => {
  const base = { contentWidthPx: 935, viewportHeightPx: 655, charWidthPx: 7.3, lineHeightPx: 25.6 }

  it('is columns x rows, halved', () => {
    // 935/7.3 = 128 columns, 655/25.6 = 25 rows, half of 3200.
    expect(resolveViewportCharCapacity(base)).toBe(1600)
  })

  it('counts only whole cells', () => {
    // A column that does not fit is not a column: 934/7.3 is still 127.9.
    expect(resolveViewportCharCapacity({ ...base, contentWidthPx: 930 }))
      .toBe(Math.floor(930 / 7.3) * 25 * 0.5)
  })

  it('grows with the pane and shrinks with the type', () => {
    expect(resolveViewportCharCapacity({ ...base, viewportHeightPx: 1310 })!)
      .toBeGreaterThan(resolveViewportCharCapacity(base)!)
    expect(resolveViewportCharCapacity({ ...base, charWidthPx: 14.6 })!)
      .toBeLessThan(resolveViewportCharCapacity(base)!)
  })

  it('says nothing rather than zero when it has not been given enough', () => {
    expect(resolveViewportCharCapacity({ ...base, charWidthPx: 0 })).toBeNull()
    expect(resolveViewportCharCapacity({ ...base, lineHeightPx: 0 })).toBeNull()
    expect(resolveViewportCharCapacity({ ...base, contentWidthPx: 0 })).toBeNull()
    expect(resolveViewportCharCapacity({ ...base, viewportHeightPx: 0 })).toBeNull()
  })

  it('says nothing when not even one cell fits', () => {
    expect(resolveViewportCharCapacity({ ...base, contentWidthPx: 3 })).toBeNull()
  })
})

describe('resolveChunkedThumbRatio', () => {
  it('is the share of the document one screen holds', () => {
    expect(resolveChunkedThumbRatio({ charsPerScreen: 1600, totalChars: 500_000 }))
      .toBeCloseTo(1600 / 500_000, 10)
  })

  it('shrinks with the document and grows with the screenful', () => {
    const base = { charsPerScreen: 1600, totalChars: 500_000 }
    expect(resolveChunkedThumbRatio({ ...base, totalChars: 1_000_000 })!)
      .toBeCloseTo(resolveChunkedThumbRatio(base)! / 2, 10)
    expect(resolveChunkedThumbRatio({ ...base, charsPerScreen: 3200 })!)
      .toBeCloseTo(resolveChunkedThumbRatio(base)! * 2, 10)
  })

  it('never exceeds the whole track', () => {
    expect(resolveChunkedThumbRatio({ charsPerScreen: 1600, totalChars: 10 })).toBe(1)
  })

  it('says nothing rather than zero when it has not been given enough', () => {
    expect(resolveChunkedThumbRatio({ charsPerScreen: 0, totalChars: 500_000 })).toBeNull()
    expect(resolveChunkedThumbRatio({ charsPerScreen: 1600, totalChars: 0 })).toBeNull()
  })
})
