// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  scrollToNonQuantizedSmooth,
  cancelNonQuantizedSmoothScroll,
  isNonQuantizedSmoothScrollActive,
} from './NonQuantizedSmoothScroll'

/**
 * jsdom has no layout, so a scroller has to be faked: scrollHeight/
 * clientHeight are non-configurable zeros otherwise, which would make every
 * scroll a no-op clamp to 0.
 */
function createScroller(scrollHeight: number, clientHeight: number): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true })
  element.scrollTop = 0
  return element
}

describe('isNonQuantizedSmoothScrollActive', () => {
  let frames: FrameRequestCallback[] = []

  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const runFrame = (timeMs: number) => {
    const pending = frames
    frames = []
    pending.forEach((callback) => callback(timeMs))
  }

  it('reports a travel in flight, and stops once it lands', () => {
    const scroller = createScroller(10000, 600)
    expect(isNonQuantizedSmoothScrollActive(scroller)).toBe(false)

    scrollToNonQuantizedSmooth(scroller, 5000)
    expect(isNonQuantizedSmoothScrollActive(scroller)).toBe(true)

    runFrame(0)
    expect(isNonQuantizedSmoothScrollActive(scroller)).toBe(true)

    // Well past any plan's total duration -- the final frame lands and clears.
    runFrame(60_000)
    expect(isNonQuantizedSmoothScrollActive(scroller)).toBe(false)
    expect(scroller.scrollTop).toBe(5000)
  })

  it('stops reporting once cancelled', () => {
    const scroller = createScroller(10000, 600)
    scrollToNonQuantizedSmooth(scroller, 5000)
    expect(isNonQuantizedSmoothScrollActive(scroller)).toBe(true)

    cancelNonQuantizedSmoothScroll(scroller)
    expect(isNonQuantizedSmoothScrollActive(scroller)).toBe(false)
  })

  it('overwrites a scroll written from elsewhere mid-flight -- the reason callers must wait for it', () => {
    const scroller = createScroller(10000, 600)
    scrollToNonQuantizedSmooth(scroller, 5000)
    runFrame(0)
    runFrame(50)

    // Something else (an anchor/find landing correction) scrolls the pane.
    scroller.scrollTop = 1234
    runFrame(60_000)

    // The animation's own target won, silently discarding that write.
    expect(scroller.scrollTop).toBe(5000)
  })

  it('is per-element', () => {
    const first = createScroller(10000, 600)
    const second = createScroller(10000, 600)
    scrollToNonQuantizedSmooth(first, 5000)
    expect(isNonQuantizedSmoothScrollActive(first)).toBe(true)
    expect(isNonQuantizedSmoothScrollActive(second)).toBe(false)
  })
})
