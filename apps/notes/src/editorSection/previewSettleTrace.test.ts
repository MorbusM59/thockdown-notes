import { describe, expect, it } from 'vitest'
import { sampleDiffers, type SettleGeometrySample } from './previewSettleTrace'

/**
 * The settle watcher's change detector.
 *
 * Worth testing on its own because decisions get made from what it says: a
 * trace reading "the reveal was followed by movement" is what sends someone
 * looking for a mover, and it reported exactly that on a capture where all
 * three geometry numbers were flat at zero delta. The only thing that had
 * changed was the latched block leaving the mounted range -- the reader
 * having scrolled past it, which is not the pane moving under them.
 *
 * An instrument that cries wolf costs more than no instrument, because the
 * hunt it starts looks justified.
 */
const sample = (over: Partial<SettleGeometrySample> = {}): SettleGeometrySample => ({
  scrollTop: 500,
  scrollHeight: 2500,
  sizerHeightPx: 2464,
  latchedBlockScreenTop: 120,
  ...over,
})

describe('sampleDiffers', () => {
  it('sees nothing in two identical samples', () => {
    expect(sampleDiffers(sample(), sample())).toBe(false)
  })

  it('sees each geometry component move on its own', () => {
    expect(sampleDiffers(sample({ scrollTop: 501 }), sample())).toBe(true)
    expect(sampleDiffers(sample({ scrollHeight: 2499 }), sample())).toBe(true)
    expect(sampleDiffers(sample({ sizerHeightPx: 2463 }), sample())).toBe(true)
  })

  it('sees the latched block move while it stays mounted', () => {
    expect(sampleDiffers(sample({ latchedBlockScreenTop: 118 }), sample())).toBe(true)
  })

  it('does NOT call the latched block unmounting a movement', () => {
    // The case that produced the false report: geometry flat, block gone.
    expect(sampleDiffers(sample({ latchedBlockScreenTop: null }), sample())).toBe(false)
    // ...and symmetrically, a block that mounts between two samples.
    expect(sampleDiffers(sample(), sample({ latchedBlockScreenTop: null }))).toBe(false)
  })

  it('still reports real movement in the frame the block unmounts', () => {
    // Losing the block must not become a way to hide a genuine shift.
    expect(sampleDiffers(
      sample({ latchedBlockScreenTop: null, scrollHeight: 2400 }),
      sample(),
    )).toBe(true)
  })
})
