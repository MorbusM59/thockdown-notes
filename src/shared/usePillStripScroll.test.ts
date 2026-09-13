import { describe, expect, it } from 'vitest'

import { readScrollEdges } from './usePillStripScroll'

/**
 * The fades are the only thing that says a pill strip continues past the bar,
 * so what has to hold is the PROPERTY at every scroll position, not the
 * arithmetic at one: a fade is shown exactly where content is hidden.
 *
 * The five bars that use this (tab, tag, suggested-tag, chapter, and a mode's
 * narration) all read it through the same function, which is the point -- a
 * strip that merely looks like a chapter bar's would have to be kept looking
 * like one.
 */
describe('readScrollEdges', () => {
  const strip = (scrollLeft: number) => readScrollEdges({ scrollLeft, scrollWidth: 900, clientWidth: 400 })

  it('fades neither end when nothing overflows', () => {
    expect(readScrollEdges({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toEqual({ left: false, right: false })
  })

  it('fades only the trailing end at the start of an overflowing strip', () => {
    expect(strip(0)).toEqual({ left: false, right: true })
  })

  it('fades both ends in the middle', () => {
    expect(strip(250)).toEqual({ left: true, right: true })
  })

  it('fades only the leading end at the far end', () => {
    expect(strip(500)).toEqual({ left: true, right: false })
  })

  it('holds the property at every position of a real travel', () => {
    // The invariant, iterated rather than sampled: a fade is up exactly when
    // there is content past that edge.
    for (let scrollLeft = 0; scrollLeft <= 500; scrollLeft += 1) {
      const edges = strip(scrollLeft)
      expect(edges.left).toBe(scrollLeft > 1)
      expect(edges.right).toBe(scrollLeft < 499)
    }
  })

  it('tolerates a sub-pixel overflow rather than fading a bar with nothing hidden', () => {
    // A row whose content is a hair wider than its box through rounding is
    // not a strip with more to see; a permanent fade there reads as broken.
    expect(readScrollEdges({ scrollLeft: 0, scrollWidth: 400.6, clientWidth: 400 })).toEqual({ left: false, right: false })
  })
})
