// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginScrollTrackHold, SCROLL_TRACK_SNAP_HOLD_MS } from './scrollTrackHold'

describe('beginScrollTrackHold', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const spies = () => ({ onSnap: vi.fn(), onTravel: vi.fn() })

  it('travels when the button is released promptly', () => {
    const handlers = spies()
    beginScrollTrackHold(handlers)
    vi.advanceTimersByTime(SCROLL_TRACK_SNAP_HOLD_MS - 50)
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(handlers.onTravel).toHaveBeenCalledTimes(1)
    expect(handlers.onSnap).not.toHaveBeenCalled()
  })

  it('snaps while the button is still down, not on release', () => {
    // Firing on the timer rather than on release is what makes the gesture
    // discoverable: you hold, it jumps, and you have learned it.
    const handlers = spies()
    beginScrollTrackHold(handlers)
    vi.advanceTimersByTime(SCROLL_TRACK_SNAP_HOLD_MS)

    expect(handlers.onSnap).toHaveBeenCalledTimes(1)
    expect(handlers.onTravel).not.toHaveBeenCalled()
  })

  it('never does both, however late the release comes', () => {
    const handlers = spies()
    beginScrollTrackHold(handlers)
    vi.advanceTimersByTime(SCROLL_TRACK_SNAP_HOLD_MS + 500)
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(handlers.onSnap).toHaveBeenCalledTimes(1)
    expect(handlers.onTravel).not.toHaveBeenCalled()
  })

  it('does nothing at all once abandoned', () => {
    // The caller unmounting mid-gesture, for instance.
    const handlers = spies()
    const abandon = beginScrollTrackHold(handlers)
    abandon()
    vi.advanceTimersByTime(SCROLL_TRACK_SNAP_HOLD_MS + 500)
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(handlers.onSnap).not.toHaveBeenCalled()
    expect(handlers.onTravel).not.toHaveBeenCalled()
  })

  it('abandons rather than snapping when the window loses focus mid-hold', () => {
    // No mouseup is ever delivered in that case, so an armed gesture would
    // otherwise fire a snap the reader never asked for.
    const handlers = spies()
    beginScrollTrackHold(handlers)
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(SCROLL_TRACK_SNAP_HOLD_MS + 500)

    expect(handlers.onSnap).not.toHaveBeenCalled()
    expect(handlers.onTravel).not.toHaveBeenCalled()
  })

  it('leaves no listeners behind, whichever way it ended', () => {
    const added: string[] = []
    const removed: string[] = []
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type) => { added.push(String(type)) })
    const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((type) => { removed.push(String(type)) })

    beginScrollTrackHold(spies())
    vi.advanceTimersByTime(SCROLL_TRACK_SNAP_HOLD_MS)

    expect(added.sort()).toEqual(removed.sort())
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
