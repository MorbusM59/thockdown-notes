/**
 * PageUp/PageDown for one scroller, the same for every surface that pages:
 * the editor (rows), the reader, the sidebar, an image shown in a slot.
 *
 * A press travels one page on the engine's curve. Held, the key hands over
 * from that travel to a steady scroll at the moment the travel reaches the
 * steady speed (`resolveRampCrossingTimeSecFromCurrentParams`), and a release
 * eases the steady scroll out on the shared release ramp. A right-hold on a
 * scrollbar track is the same press and release (`press`/`release` are called
 * directly, never through a synthesized key event, which would reach every
 * other scroller listening on the window).
 *
 * What differs per surface is passed in, and nothing else:
 * - `pageStepPx`: how far one page is (the editor's caged middle rows, 90% of
 *   the reader's height).
 * - `snap`: the editor's row grid. Every write is snapped to it and a target
 *   is clamped inside the scroller; without it writes are sub-pixel and a
 *   target may lie outside the mounted content (the reader's block window
 *   travels there).
 * - `travelTo`: the one-shot page travel, on the surface's own engine.
 * - `isAtDocumentEdge`: where a windowed scroller's edge is not the document's.
 *
 * Who owns the keyboard is the caller's question: this module only scrolls.
 */

import { borrowAutoScrollBehavior } from '@thockdown/interaction/scrollBehaviorLock'
import { cancelSmoothScroll } from '@thockdown/interaction/smoothScrollRegistry'
import { clamp } from '@thockdown/interaction/clamp'
import {
  buildReleaseRampDownPlanFromCurrentParams,
  CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  resolveApexSpeedPxPerSecFromCurrentParams,
  resolveRampCrossingTimeSecFromCurrentParams,
  sampleReleaseRampDownPlan,
} from '@thockdown/interaction/NonQuantizedSmoothScroll'

export type PageKey = 'PageUp' | 'PageDown'

export interface PageKeysOptions {
  scroller: HTMLElement
  /** True while the surface may not scroll; a press then ends any held scroll. */
  isBlocked: () => boolean
  /** One page, in pixels. */
  pageStepPx: () => number
  /** The surface's grid, for a row-quantized scroller. */
  snap?: (scrollTop: number) => number
  /** Travel to `targetScrollTop` on the surface's engine. */
  travelTo: (targetScrollTop: number) => void
  /** Called after every write the held scroll makes. */
  onScrolled?: () => void
  /** Whether the scroller's edge in `direction` is the document's edge. Absent: it is. */
  isAtDocumentEdge?: (direction: -1 | 1) => boolean
}

export interface PageKeys {
  /** A press (or an auto-repeat) of a page key. False when the scroller cannot page now. */
  press: (key: PageKey, repeat: boolean) => boolean
  /** A release of a page key. */
  release: (key: PageKey) => void
  /** Forget every held key and end any held scroll or release ramp at once (a blur, an unmount). */
  reset: () => void
}

export function createPageKeys({
  scroller,
  isBlocked,
  pageStepPx,
  snap,
  travelTo,
  onScrolled,
  isAtDocumentEdge,
}: PageKeysOptions): PageKeys {
  const held = new Set<PageKey>()
  let direction: -1 | 0 | 1 = 0
  let continuousRaf: number | null = null
  let lastTs: number | null = null
  let handoffTimeout: number | null = null
  let rampRaf: number | null = null
  let releaseScrollBehavior: (() => void) | null = null

  const place = (scrollTop: number) => (snap ? snap(scrollTop) : scrollTop)
  const steadySpeedPxPerSec = () => Math.max(
    1,
    resolveApexSpeedPxPerSecFromCurrentParams(pageStepPx()) * CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  )
  const write = (nextScrollTop: number) => {
    if (Math.abs(nextScrollTop - scroller.scrollTop) > 0.01) {
      scroller.scrollTop = nextScrollTop
      onScrolled?.()
    }
  }
  const atEdge = (scrollTop: number, towards: -1 | 1) => {
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const atScrollerEnd = towards < 0 ? scrollTop <= 0.01 : scrollTop >= maxScrollTop - 0.01
    return atScrollerEnd && (isAtDocumentEdge?.(towards) ?? true)
  }
  const returnScrollBehavior = () => {
    releaseScrollBehavior?.()
    releaseScrollBehavior = null
  }

  const clearHandoff = () => {
    if (handoffTimeout !== null) window.clearTimeout(handoffTimeout)
    handoffTimeout = null
  }

  const stop = () => {
    direction = 0
    lastTs = null
    if (continuousRaf !== null) cancelAnimationFrame(continuousRaf)
    continuousRaf = null
    if (rampRaf !== null) cancelAnimationFrame(rampRaf)
    rampRaf = null
    returnScrollBehavior()
  }

  const continuousFrame = (nowMs: number) => {
    continuousRaf = null
    if (direction === 0 || !scroller.isConnected) {
      lastTs = null
      return
    }
    const previousTs = lastTs
    lastTs = nowMs
    if (previousTs !== null) {
      const deltaSec = Math.max(0, (nowMs - previousTs) / 1000)
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const next = place(clamp(scroller.scrollTop + direction * steadySpeedPxPerSec() * deltaSec, 0, maxScrollTop))
      write(next)
      if (atEdge(next, direction)) {
        stop()
        return
      }
    }
    continuousRaf = requestAnimationFrame(continuousFrame)
  }

  const startContinuous = (towards: -1 | 1) => {
    cancelSmoothScroll(scroller)
    releaseScrollBehavior ??= borrowAutoScrollBehavior(scroller)
    const previous = direction
    direction = towards
    // Timing is reset only from idle or on a change of direction: resetting
    // on every auto-repeat would throttle the speed.
    if (continuousRaf === null || previous !== towards) lastTs = null
    continuousRaf ??= requestAnimationFrame(continuousFrame)
  }

  const startReleaseRamp = (towards: -1 | 1) => {
    const plan = buildReleaseRampDownPlanFromCurrentParams(towards, steadySpeedPxPerSec())
    if (!plan) {
      stop()
      return
    }
    if (continuousRaf !== null) cancelAnimationFrame(continuousRaf)
    continuousRaf = null
    direction = 0
    lastTs = null
    if (rampRaf !== null) cancelAnimationFrame(rampRaf)
    releaseScrollBehavior ??= borrowAutoScrollBehavior(scroller)

    // The ramp writes its displacement as a STEP from the scroller's current
    // position, never as an offset from where it started: a windowed
    // scroller re-anchors its content under the reader (the block window's
    // carry lowers scrollTop by what it unmounted), and an absolute target
    // from before that carry would throw the reader forward by the same
    // amount on every frame, re-triggering the move until the document end.
    let writtenDisplacement = 0
    let startMs: number | null = null
    const rampFrame = (nowMs: number) => {
      rampRaf = null
      if (!scroller.isConnected) return stop()
      startMs ??= nowMs
      const elapsedSec = Math.max(0, (nowMs - startMs) / 1000)
      const displacement = sampleReleaseRampDownPlan(plan, elapsedSec)
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const before = scroller.scrollTop
      const next = place(clamp(before + (displacement - writtenDisplacement), 0, maxScrollTop))
      // Counted as what actually moved, so a step the row grid rounds away
      // is carried into the next frame rather than lost.
      writtenDisplacement += next - before
      write(next)
      if (elapsedSec >= plan.tailDurationSec || atEdge(next, displacement >= 0 ? 1 : -1)) {
        returnScrollBehavior()
        return
      }
      rampRaf = requestAnimationFrame(rampFrame)
    }
    rampRaf = requestAnimationFrame(rampFrame)
  }

  const press = (key: PageKey, repeat: boolean): boolean => {
    if (isBlocked()) {
      held.delete(key)
      clearHandoff()
      stop()
      return true
    }
    if (!scroller.isConnected) return false
    const towards: -1 | 1 = key === 'PageDown' ? 1 : -1
    held.add(key)

    if (repeat) {
      if (handoffTimeout === null) startContinuous(towards)
      return true
    }

    clearHandoff()
    stop()
    const start = place(scroller.scrollTop)
    let target = start + towards * pageStepPx()
    if (snap) {
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      target = snap(clamp(target, 0, maxScrollTop))
    }
    travelTo(target)

    // Hand over to the steady scroll when the travel reaches its speed.
    const distancePx = target - start
    const crossingTimeSec = resolveRampCrossingTimeSecFromCurrentParams(
      distancePx,
      Math.max(1, resolveApexSpeedPxPerSecFromCurrentParams(distancePx) * CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER),
    )
    if (crossingTimeSec !== null) {
      handoffTimeout = window.setTimeout(() => {
        handoffTimeout = null
        if (held.has(key)) startContinuous(towards)
      }, Math.max(0, Math.round(crossingTimeSec * 1000)))
    }
    return true
  }

  const release = (key: PageKey) => {
    held.delete(key)
    clearHandoff()
    if (held.size > 0) return
    if (direction !== 0) startReleaseRamp(direction)
    else stop()
  }

  const reset = () => {
    held.clear()
    clearHandoff()
    stop()
  }

  return { press, release, reset }
}
