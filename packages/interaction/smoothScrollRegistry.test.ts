import { describe, expect, it, vi } from 'vitest'
import { cancelSmoothScroll, onSmoothScrollArrival, registerSmoothScroll, unregisterSmoothScroll } from './smoothScrollRegistry'

const travel = (scroller: HTMLElement) => registerSmoothScroll(scroller, { rafId: 0, targetScrollTopPx: 100, releaseScrollBehavior: () => {} })

describe('onSmoothScrollArrival', () => {
  it('runs at once when nothing is travelling', () => {
    const arrive = vi.fn()
    onSmoothScrollArrival({} as HTMLElement, arrive)
    expect(arrive).toHaveBeenCalledTimes(1)
  })

  it('runs once, when the travel in flight lands', () => {
    const scroller = {} as HTMLElement
    const arrive = vi.fn()
    travel(scroller)
    onSmoothScrollArrival(scroller, arrive)
    travel(scroller) // the engine re-registers every frame
    expect(arrive).not.toHaveBeenCalled()
    unregisterSmoothScroll(scroller)
    unregisterSmoothScroll(scroller)
    expect(arrive).toHaveBeenCalledTimes(1)
  })

  it('is dropped when the travel is cancelled, and not run by a later one', () => {
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const scroller = {} as HTMLElement
    const arrive = vi.fn()
    travel(scroller)
    onSmoothScrollArrival(scroller, arrive)
    cancelSmoothScroll(scroller)
    travel(scroller)
    unregisterSmoothScroll(scroller)
    expect(arrive).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
