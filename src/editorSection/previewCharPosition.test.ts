import { describe, expect, it } from 'vitest'
import {
  buildBlockCharOffsets,
  findBlockAtChar,
  findBlockAtPixel,
  resolvePreviewCharScrollOffset,
  resolvePreviewCharViewport,
} from './previewCharPosition'
import type { PreviewBlockMeasurement } from './previewCharPosition'

const blocks = (lengths: number[]) => lengths.map((length) => ({ text: 'x'.repeat(length) }))

/** Blocks of `size` pixels each, laid out end to end from 0. */
const evenMeasurements = (count: number, size: number): PreviewBlockMeasurement[] =>
  Array.from({ length: count }, (_, index) => ({ index, start: index * size, size }))

describe('buildBlockCharOffsets', () => {
  it('prefix-sums the blocks and ends with the document total', () => {
    const offsets = buildBlockCharOffsets(blocks([10, 20, 30]))
    // Each block counts for its text plus one, so the offsets stay strictly
    // increasing even where a block is empty.
    expect([...offsets]).toEqual([0, 11, 32, 63])
  })

  it('keeps empty blocks distinguishable from their neighbours', () => {
    const offsets = buildBlockCharOffsets(blocks([0, 0, 0]))
    expect([...offsets]).toEqual([0, 1, 2, 3])
  })

  it('handles an empty document', () => {
    expect([...buildBlockCharOffsets([])]).toEqual([0])
  })
})

describe('findBlockAtChar', () => {
  const offsets = buildBlockCharOffsets(blocks([10, 20, 30]))

  it('finds the block a character offset falls inside', () => {
    expect(findBlockAtChar(offsets, 0)).toBe(0)
    expect(findBlockAtChar(offsets, 10)).toBe(0)
    expect(findBlockAtChar(offsets, 11)).toBe(1)
    expect(findBlockAtChar(offsets, 31)).toBe(1)
    expect(findBlockAtChar(offsets, 32)).toBe(2)
  })

  it('clamps outside the document rather than reporting nonsense', () => {
    expect(findBlockAtChar(offsets, -50)).toBe(0)
    expect(findBlockAtChar(offsets, 99999)).toBe(2)
    expect(findBlockAtChar(buildBlockCharOffsets([]), 5)).toBe(0)
  })
})

describe('findBlockAtPixel', () => {
  const measurements = evenMeasurements(5, 100)

  it('finds the block a pixel position falls inside', () => {
    expect(findBlockAtPixel(measurements, 0)).toBe(0)
    expect(findBlockAtPixel(measurements, 99)).toBe(0)
    expect(findBlockAtPixel(measurements, 100)).toBe(1)
    expect(findBlockAtPixel(measurements, 449)).toBe(4)
  })

  it('clamps above and below, and reports nothing for an empty list', () => {
    expect(findBlockAtPixel(measurements, -20)).toBe(0)
    expect(findBlockAtPixel(measurements, 100000)).toBe(4)
    expect(findBlockAtPixel([], 10)).toBe(-1)
  })
})

describe('resolvePreviewCharViewport', () => {
  const lengths = [99, 99, 99, 99, 99]
  const offsets = buildBlockCharOffsets(lengths.map((length) => ({ text: 'x'.repeat(length) })))
  const measurements = evenMeasurements(5, 100)

  it('reads position at the top of the document as zero', () => {
    const viewport = resolvePreviewCharViewport({ offsets, measurements, scrollTop: 0, clientHeight: 200 })!
    expect(viewport.startChar).toBe(0)
    expect(viewport.totalChars).toBe(500)
    expect(viewport.visibleChars).toBe(200)
  })

  it('interpolates INSIDE a block, so the thumb moves while scrolling through one', () => {
    // Half way down block 2 (pixels 200..300) is half way through its
    // characters. Without interpolation this would report the same position
    // for every scroll offset inside the block.
    const viewport = resolvePreviewCharViewport({ offsets, measurements, scrollTop: 250, clientHeight: 200 })!
    expect(viewport.startChar).toBe(250)
  })

  it('reports the end of the document at the end of the scroll range', () => {
    const viewport = resolvePreviewCharViewport({ offsets, measurements, scrollTop: 300, clientHeight: 200 })!
    expect(viewport.startChar + viewport.visibleChars).toBe(500)
  })

  it('never reports a span outside the document', () => {
    const viewport = resolvePreviewCharViewport({ offsets, measurements, scrollTop: 480, clientHeight: 400 })!
    expect(viewport.startChar).toBeLessThanOrEqual(viewport.totalChars)
    expect(viewport.startChar + viewport.visibleChars).toBeLessThanOrEqual(viewport.totalChars)
  })

  it('says nothing at all when there is nothing to say', () => {
    expect(resolvePreviewCharViewport({ offsets: null, measurements, scrollTop: 0, clientHeight: 100 })).toBeNull()
    expect(resolvePreviewCharViewport({ offsets, measurements: [], scrollTop: 0, clientHeight: 100 })).toBeNull()
    expect(resolvePreviewCharViewport({
      offsets: buildBlockCharOffsets([]),
      measurements,
      scrollTop: 0,
      clientHeight: 100,
    })).toBeNull()
  })
})

describe('resolvePreviewCharScrollOffset', () => {
  const offsets = buildBlockCharOffsets(blocks([99, 99, 99, 99, 99]))
  const measurements = evenMeasurements(5, 100)

  it('is the exact inverse of the viewport reading', () => {
    // A drag that reads position one way and writes it another drops the
    // thumb somewhere the reader did not put it.
    for (const scrollTop of [0, 37, 150, 250, 399]) {
      const viewport = resolvePreviewCharViewport({ offsets, measurements, scrollTop, clientHeight: 200 })!
      const back = resolvePreviewCharScrollOffset({ offsets, measurements, charOffset: viewport.startChar })!
      expect(Math.abs(back - scrollTop)).toBeLessThan(1)
    }
  })

  it('lands at the start of the document and at the last block', () => {
    expect(resolvePreviewCharScrollOffset({ offsets, measurements, charOffset: 0 })).toBe(0)
    expect(resolvePreviewCharScrollOffset({ offsets, measurements, charOffset: 100000 })).toBe(500)
  })

  it('tolerates measurements that are not index-aligned', () => {
    const shuffled = [...measurements].reverse()
    expect(resolvePreviewCharScrollOffset({ offsets, measurements: shuffled, charOffset: 210 })).toBe(210)
  })

  it('says nothing when it has nothing to work from', () => {
    expect(resolvePreviewCharScrollOffset({ offsets: null, measurements, charOffset: 5 })).toBeNull()
    expect(resolvePreviewCharScrollOffset({ offsets, measurements: [], charOffset: 5 })).toBeNull()
  })
})
