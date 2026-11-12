/**
 * The wheel's continuous (sub-pixel) scroll dynamics, shared by every surface
 * that is not row-quantized: the reader, the sidebar, an image shown in a slot.
 * The twin of `rowWheel.ts`, which does the same for surfaces that scroll in
 * whole rows; both read the same rules:
 *
 * - `wheelNotch.ts` decides what counts as a notch, so the same wheel makes a
 *   nudge on every surface at the same moment, and a trackpad's sub-notch
 *   stream makes one on none.
 * - `wheelStep.ts` says what a notch is worth, in line heights here, so the
 *   same setting moves the same amount of reading at any text size.
 * - `wheelSpin.ts` decides when nudges become a spin that coasts on.
 *
 * Two things differ from the rows driver, both because nothing here snaps to a
 * grid. A single notch is delivered on a curve (`wheelNotchTravel.ts`) and
 * spliced onto the motion it interrupts, instead of written as a jump. A coast
 * is one continuous curve planned when the spin is detected
 * (`wheelSpinProfile.ts`), instead of a train of simulated notches.
 *
 * The surface owns every notch: `handleWheel` must be attached as a
 * non-passive listener, because a notch cannot be worth what the reader asked
 * for while the browser is still scrolling by whatever delta the device sent.
 * Per instance: two surfaces are two scrollers, and a spin in one says
 * nothing about the other.
 */

import { borrowAutoScrollBehavior } from '@thockdown/interaction/scrollBehaviorLock'
import { cancelSmoothScroll, isSmoothScrollActive } from '@thockdown/interaction/smoothScrollRegistry'
import { clamp } from '@thockdown/interaction/clamp'
import { createWheelNotchState, resolveWheelEventUnits } from './wheelNotch'
import { getWheelStepLines } from './wheelStep'
import { appendWheelTrace, isWheelTraceOn } from './wheelTrace'
import {
  cancelWheelSpin,
  createWheelSpinState,
  getWheelSpinCutoffMs,
  getWheelSpinDampenDivisor,
  getWheelSpinEffectiveThresholdMs,
  refreshWheelSpinCoast,
  registerWheelSpinNudge,
  type WheelSpinDirection,
} from './wheelSpin'
import {
  remainingWheelNotchTravelPx,
  retargetWheelNotchTravel,
  resolveWheelNotchTravelMs,
  takeWheelNotchTravelStep,
  type WheelNotchTravel,
} from './wheelNotchTravel'
import {
  addWheelSpinProfileCarry,
  buildWheelSpinProfile,
  sampleWheelSpinProfile,
  wheelSpinProfileSpeedPxPerMs,
  wheelSpinProfileUndeliveredCarryPx,
  type WheelSpinProfile,
} from './wheelSpinProfile'

export interface ContinuousWheelOptions {
  scroller: HTMLElement
  /** True while the surface may not scroll; a wheel then scrolls nothing and ends any coast. */
  isBlocked: () => boolean
  /** Called after every write that moved the scroller (the rail's thumb follows it). */
  onScrolled: () => void
  /**
   * Whether the scroller's edge in `direction` is the document's edge. A
   * windowed scroller (the reader's block window) reaches the end of its
   * mounted content many times on the way through a large note; only the
   * document's own edge ends a coast. Absent: the scroller's edge is the end.
   */
  isAtDocumentEdge?: (direction: -1 | 1) => boolean
  /** Prefix for this surface's lines in the wheel trace. */
  traceLabel: string
}

export interface ContinuousWheel {
  /** A wheel event over the surface. Attach non-passive: it prevents the default. */
  handleWheel: (event: WheelEvent) => void
  /** End any notch glide or coast, naming why in the wheel trace. */
  stop: (reason: string) => void
}

export function createContinuousWheel({
  scroller,
  isBlocked,
  onScrolled,
  isAtDocumentEdge,
  traceLabel,
}: ContinuousWheelOptions): ContinuousWheel {
  const spinState = createWheelSpinState()
  const notchState = createWheelNotchState()
  let profile: WheelSpinProfile | null = null
  let coastRaf: number | null = null
  let coastLastFrameMs: number | null = null
  // The coast's own clock, kept apart from wall time so a stalled frame can
  // advance it less than the wall did; and how much of the profile is paid.
  let coastClockMs = 0
  let coastPaidPx = 0
  let notchTravel: WheelNotchTravel | null = null
  let notchRaf: number | null = null
  // The sub-pixel remainder owed to the reader across every write, so a slow
  // coast does not round to a standstill and a fractional step is not lost.
  let carryPx = 0
  // The hold on `scroll-behavior: auto` while a glide or coast writes; a
  // scroller with CSS smooth behaviour would otherwise animate every write.
  let releaseScrollBehavior: (() => void) | null = null

  const trace = (line: string) => {
    if (isWheelTraceOn()) appendWheelTrace(`${traceLabel} ${line}`)
  }

  /**
   * Line height measured once, not per notch: a getComputedStyle inside a
   * wheel handler is a forced style pass. A surface whose line height can
   * change recreates its driver.
   */
  let lineHeightCache: number | null = null
  const lineHeightPx = (): number => {
    if (lineHeightCache !== null) return lineHeightCache
    const style = window.getComputedStyle(scroller)
    const parsed = Number.parseFloat(style.lineHeight)
    if (Number.isFinite(parsed) && parsed > 0) return (lineHeightCache = parsed)
    // `line-height: normal` reports as the keyword; 1.5 is the app's default.
    const fontPx = Number.parseFloat(style.fontSize)
    return (lineHeightCache = Number.isFinite(fontPx) && fontPx > 0 ? fontPx * 1.5 : 24)
  }

  const stop = (reason: string) => {
    const wasRunning = profile !== null || coastRaf !== null || notchTravel !== null || spinState.coast !== null
    if (coastRaf !== null) cancelAnimationFrame(coastRaf)
    coastRaf = null
    profile = null
    coastLastFrameMs = null
    coastClockMs = 0
    coastPaidPx = 0
    if (notchRaf !== null) cancelAnimationFrame(notchRaf)
    notchRaf = null
    notchTravel = null
    // The sub-pixel carry survives: it is under a pixel and belongs to the
    // reader rather than to any one gesture.
    cancelWheelSpin(spinState)
    releaseScrollBehavior?.()
    releaseScrollBehavior = null
    if (wasRunning) trace(`coast ENDED (${reason})`)
  }

  /** The one write both a notch and the coast go through. */
  const scrollByPx = (deltaPx: number, label: string | null): boolean => {
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const beforeTop = scroller.scrollTop
    const owedPx = carryPx + deltaPx
    const wholePx = Math.trunc(owedPx)
    carryPx = owedPx - wholePx
    const nextScrollTop = clamp(beforeTop + wholePx, 0, maxScrollTop)
    // The lock counts, so borrowing while a glide holds it cannot disturb it.
    const releaseForWrite = borrowAutoScrollBehavior(scroller)
    if (Math.abs(nextScrollTop - beforeTop) > 0.01) {
      scroller.scrollTop = nextScrollTop
      onScrolled()
    }
    releaseForWrite()
    if (label !== null) {
      trace(`${label} px=${deltaPx.toFixed(2)} lh=${lineHeightPx().toFixed(2)} step=${getWheelStepLines().toFixed(1)}`
        + ` top ${beforeTop.toFixed(2)}->${scroller.scrollTop.toFixed(2)}`)
    }
    return scroller.scrollTop !== beforeTop
  }

  // A glide's borrow of `scroll-behavior` is returned when it ends, unless a
  // coast now owns the same borrow.
  const endNotchTravel = () => {
    if (notchRaf !== null) cancelAnimationFrame(notchRaf)
    notchRaf = null
    notchTravel = null
    if (profile === null) {
      releaseScrollBehavior?.()
      releaseScrollBehavior = null
    }
  }

  const notchFrame = (nowMs: number) => {
    notchRaf = null
    if (!notchTravel) return
    // Blocked, or something with a destination of its own took the scroller.
    if (!scroller.isConnected || isBlocked() || isSmoothScrollActive(scroller)) {
      endNotchTravel()
      return
    }
    const step = takeWheelNotchTravelStep(notchTravel, nowMs)
    if (step.pixels !== 0) scrollByPx(step.pixels, null)
    if (step.finished) {
      endNotchTravel()
      trace('notch glide LANDED')
      return
    }
    notchRaf = requestAnimationFrame(notchFrame)
  }

  /** Deliver a notch on a curve, splicing onto a glide already running. */
  const travelByNotch = (signedPixels: number, label: string) => {
    cancelSmoothScroll(scroller)
    releaseScrollBehavior ??= borrowAutoScrollBehavior(scroller)
    notchTravel = retargetWheelNotchTravel(notchTravel, signedPixels, performance.now())
    const leg = notchTravel.leg
    trace(`${label} px=${signedPixels.toFixed(2)} leg=${leg.kind}`
      + ` owed=${(leg.kind === 'continuation' ? leg.plan.signedDistance : leg.signedDistance).toFixed(2)}`
      + ` over=${(leg.durationSec * 1000).toFixed(0)}ms`
      + (leg.kind === 'continuation' ? ` v0=${leg.plan.initialVelocity.toFixed(1)}` : ''))
    notchRaf ??= requestAnimationFrame(notchFrame)
  }

  const coastFrame = (nowMs: number) => {
    coastRaf = null
    if (!profile) return
    if (!scroller.isConnected) return stop('surface gone')
    if (isBlocked()) return stop('scroll blocked')
    if (getWheelSpinEffectiveThresholdMs() <= 0) return stop('bypassed')
    if (isSmoothScrollActive(scroller)) return stop('journey took over')

    // A frame after a long stall advances the coast's clock by at most
    // 100ms; inside that the profile is sampled at an absolute time.
    const advanceMs = coastLastFrameMs === null ? 0 : clamp(nowMs - coastLastFrameMs, 0, 100)
    coastLastFrameMs = nowMs
    coastClockMs += advanceMs
    const sample = sampleWheelSpinProfile(profile, coastClockMs)
    const owedPx = sample.travelledPx - coastPaidPx
    coastPaidPx = sample.travelledPx

    if (owedPx !== 0) {
      scrollByPx(profile.direction * owedPx, null)
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const atScrollerEnd = (profile.direction < 0 && scroller.scrollTop <= 0.01)
        || (profile.direction > 0 && scroller.scrollTop >= maxScrollTop - 0.01)
      if (atScrollerEnd && (isAtDocumentEdge?.(profile.direction) ?? true)) return stop('document end')
    }
    if (sample.finished) return stop('damped out')
    coastRaf = requestAnimationFrame(coastFrame)
  }

  const startCoast = (direction: WheelSpinDirection, pixelsPerNudge: number, averageGapMs: number, startCarryPx: number) => {
    if (coastRaf !== null) cancelAnimationFrame(coastRaf)
    coastRaf = null
    cancelSmoothScroll(scroller)
    releaseScrollBehavior ??= borrowAutoScrollBehavior(scroller)
    // The glide's remainder is already in `startCarryPx`; one writer only.
    if (notchRaf !== null) cancelAnimationFrame(notchRaf)
    notchRaf = null
    notchTravel = null
    // The whole coast is planned here; dampening and cut-off are read once.
    profile = buildWheelSpinProfile({
      direction,
      pixelsPerNudge,
      averageGapMs,
      dampenDivisor: getWheelSpinDampenDivisor(),
      cutoffMs: getWheelSpinCutoffMs(),
      carryPx: startCarryPx,
    })
    coastClockMs = 0
    coastPaidPx = 0
    // The first frame only establishes the clock.
    coastLastFrameMs = null
    coastRaf = requestAnimationFrame(coastFrame)
  }

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault()
    if (isBlocked()) {
      trace(`wheel dy=${event.deltaY} DECLINED blocked`)
      stop('scroll blocked')
      return
    }
    if (event.deltaY === 0) return

    const notches = resolveWheelEventUnits(event, notchState, performance.now())
    if (notches === 0) {
      trace(`wheel dy=${event.deltaY} mode=${event.deltaMode} DECLINED sub-notch`
        + ` notch=${notchState.notchPx} pending=${notchState.pendingPx.toFixed(2)}`)
      return
    }
    const pixels = Math.abs(notches) * getWheelStepLines() * lineHeightPx()
    const direction: WheelSpinDirection = event.deltaY > 0 ? 1 : -1
    const thresholdMs = getWheelSpinEffectiveThresholdMs()

    if (thresholdMs <= 0) {
      // The spin's off position: the step still applies, the coast does not.
      stop('bypassed')
      travelByNotch(direction * pixels, `wheel[spin off] dy=${event.deltaY} mode=${event.deltaMode}`)
      return
    }

    const action = registerWheelSpinNudge(spinState, { nowMs: performance.now(), direction, rows: pixels, thresholdMs })

    if (action.kind === 'ignore') {
      trace(`wheel dy=${event.deltaY} SWALLOWED spin-tail`)
      return
    }
    if (action.kind === 'stop') {
      // The notch that stops a coast scrolls nothing, so the reader can halt
      // on the line they meant to.
      stop('user nudge')
      return
    }

    // One more nudge on top of a running coast, added to its profile rather
    // than written directly: the coast owns the scroller.
    const extendCoast = (amount: number, label: string): boolean => {
      if (!profile) return false
      addWheelSpinProfileCarry(profile, direction * amount, coastClockMs, resolveWheelNotchTravelMs())
      trace(`${label} px=${(direction * amount).toFixed(2)}`)
      return true
    }

    if (action.kind === 'extend') {
      if (extendCoast(action.rows, `wheel EXTEND dy=${event.deltaY}`)) return
      travelByNotch(direction * action.rows, `wheel[no coast] dy=${event.deltaY}`)
      return
    }

    if (action.kind === 'respin') {
      // Adopted only when the hand now turns faster than the coast is going
      // at this instant, not than the rate it was planned at.
      const currentSpeed = profile ? wheelSpinProfileSpeedPxPerMs(profile, coastClockMs) : 0
      const respinSpeed = action.rows / Math.max(1, action.averageGapMs)
      if (profile && respinSpeed > currentSpeed) {
        trace(`wheel RESPIN gap=${action.averageGapMs.toFixed(1)}ms`
          + ` ${(currentSpeed * 1000).toFixed(0)}->${(respinSpeed * 1000).toFixed(0)}px/s`)
        refreshWheelSpinCoast(spinState, performance.now(), action.averageGapMs, action.rows)
        // The new coast inherits what the old one was still folding in.
        const undeliveredPx = wheelSpinProfileUndeliveredCarryPx(profile, coastClockMs)
        startCoast(direction, action.rows, action.averageGapMs, (direction * action.rows) + undeliveredPx)
        return
      }
      if (extendCoast(action.rows, `wheel RESPIN-declined dy=${event.deltaY}`)) return
      travelByNotch(direction * action.rows, `wheel[no coast] dy=${event.deltaY}`)
      return
    }

    const label = `wheel[b=${thresholdMs} c=${getWheelSpinDampenDivisor()}`
      + `${action.startsCoast ? ' SPIN' : ''}] dy=${event.deltaY} mode=${event.deltaMode}`
    if (!action.startsCoast) {
      travelByNotch(direction * action.rows, label)
      return
    }
    // The third notch of a spin: everything the glide has not paid yet, this
    // notch included, becomes the coast's carry, so the spin travels the
    // distance the hand actually turned.
    const startCarryPx = remainingWheelNotchTravelPx(notchTravel) + (direction * action.rows)
    trace(`${label} carry=${startCarryPx.toFixed(2)}`)
    startCoast(direction, action.rows, spinState.coast?.averageGapMs ?? thresholdMs, startCarryPx)
  }

  return { handleWheel, stop }
}
