import { describe, expect, it } from 'vitest'
import { summarizeFrameIntervals } from './previewFrameCostTrace'

/**
 * The summary is the whole output of this instrument, and the decision it
 * feeds -- whether the preview can stop virtualizing -- turns on the shape of
 * the distribution rather than its centre. So the thing worth testing is that
 * it reports the tail honestly: scrolling that is smooth except for a hitch
 * every twenty frames reads as broken, and any summary that averages that
 * away would say the opposite of what a reader feels.
 */
describe('summarizeFrameIntervals', () => {
  it('has nothing to say about no frames', () => {
    expect(summarizeFrameIntervals([])).toBeNull()
  })

  it('reports a healthy 60Hz run as healthy', () => {
    const smooth = Array.from({ length: 100 }, () => 16.7)
    expect(summarizeFrameIntervals(smooth)).toEqual({
      frames: 100,
      medianMs: 16.7,
      p95Ms: 16.7,
      maxMs: 16.7,
      dropped: 0,
    })
  })

  it('surfaces an occasional hitch that a mean would bury', () => {
    // 95 good frames and 5 terrible ones: the mean is ~24ms and looks
    // survivable, the max and the dropped count say what it actually is.
    const hitchy = [...Array.from({ length: 95 }, () => 16.7), 150, 150, 150, 150, 150]
    const summary = summarizeFrameIntervals(hitchy)
    expect(summary?.medianMs).toBe(16.7)
    expect(summary?.maxMs).toBe(150)
    expect(summary?.dropped).toBe(5)
  })

  it('counts every frame over the drop threshold, not just the worst', () => {
    const sluggish = Array.from({ length: 20 }, () => 40)
    expect(summarizeFrameIntervals(sluggish)?.dropped).toBe(20)
  })

  it('leaves frames just under the threshold uncounted', () => {
    const borderline = Array.from({ length: 20 }, () => 24.9)
    expect(summarizeFrameIntervals(borderline)?.dropped).toBe(0)
  })
})
