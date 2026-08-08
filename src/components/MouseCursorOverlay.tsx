import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { parseCssColorToRgba, type RgbaColor } from '../shared/colorMath'
import type { CustomCursorSettings } from '../shared/cursorSettings'
import {
  axisToRadiusMultiplier,
  axisToSpinMultiplier,
  buildCursorCurvePlan,
  buildCursorReleaseRampDownPlan,
  buildCursorStepPlan,
  resolveCursorClickWeights,
  resolveCursorRampCrossingTimeSec,
  sampleCursorReleaseRampDownPlanVelocity,
  sampleCursorStepPlanVelocity,
  type CursorClickStepPlan,
  type CursorReleaseRampDownPlan,
} from '../editor/CursorClickCurve'
import type { CurvePlan } from '../editor/ScrollCurvePlan'

export interface MouseCursorOverlayProps {
  stageRef: MutableRefObject<HTMLDivElement | null>
  settings: CustomCursorSettings
  /** Not the same as settings.trailFadeMs (a per-trail-particle decay time) -- this is how long the *whole overlay* takes to fade out after the pointer leaves the stage entirely. Not exposed in the options UI. */
  fadeMs?: number
}

const FALLBACK_RGBA: RgbaColor = { r: 0, g: 0, b: 0, a: 1 }

function resolveRgba(color: string): RgbaColor {
  return parseCssColorToRgba(color) ?? FALLBACK_RGBA
}

/**
 * Rendered by SectionEditorArea as a plain JSX child of `.editor-stage`
 * (a sibling of the edit/preview panes, painting over both via that
 * element's own `.editor-stage > *` z-index rule) -- not a `document.body`
 * portal. The previous version detached its canvas to `document.body` with
 * manual `position: fixed` + window scroll/resize tracking to fake what
 * `.editor-stage`'s own `position: relative`/`overflow: hidden` already
 * gives it for free, and hid the native cursor by calling
 * `stageEl.classList.add('hide-native-cursor')` directly on a DOM node
 * whose `className` is a React-owned template string in SectionEditorArea
 * -- every re-render of that component (i.e. every keystroke) reset
 * `className` back to its own computed value, silently dropping the class
 * again. The class is now baked into that template string instead (see
 * SectionEditorArea.tsx), so this component never touches another
 * component's DOM node.
 *
 * Visual model: `dotCount` dots orbit the cursor position at `spinHz`
 * revolutions/sec, evenly spaced (nth complex roots of unity), each one
 * dragging a fading trail behind it via a conic gradient (transparent tail
 * -> opaque head), plus a stationary center dot pinned to the tracked
 * pointer position. The trail's angular length isn't stored directly --
 * it's derived each time from `trailFadeMs` (how long a trail particle
 * takes to fully decay after the head passes it) and the current `spinHz`,
 * so e.g. a 1000ms fade at 1Hz sweeps exactly one full revolution (the head
 * chases a tail that only just finished fading where the head now sits).
 * The orbit radius itself breathes between 100% and `pulseMagnitude` via an
 * ease-in-out (raised-cosine) oscillation at `pulseHz`. The rAF loop only
 * runs while the pointer is actually over the stage or fading out
 * afterwards (`fadeMs`), not continuously for the component's whole
 * lifetime.
 *
 * Click response: mousedown (left = tighten, right = widen) inside the
 * stage drives a shared "intent" axis (clickAxisRef) that is NOT a
 * position -- like a scroll animation's current speed rather than its
 * resulting scrollTop, it always returns to exactly 0 once the gesture
 * settles. A tap samples the raw bell-curve height (ramp/skew/duration,
 * same math as smooth scrolling -- see CursorClickCurve.ts) at elapsed time
 * directly: rises from 0, peaks at `clickStep`, falls back to 0, all within
 * `clickDurationSec`, regardless of how long the button was actually held
 * (a quick tap still plays out in full, like a single un-repeated
 * PageDown). If still held once that rise would cross `clickMaxSpeed`,
 * control hands off to a continuous phase that pins the axis at exactly
 * `clickMaxSpeed` for as long as the button stays down (mirrors
 * PageUp/PageDown hold in usePreviewScrollbar.ts); releasing during that
 * phase decays smoothly back to exactly 0 via a release-ramp plan sampled
 * the same way, instead of snapping. `radiusPx`/`spinHz` below are each
 * scaled by their own multiplier derived from the axis (radius and spin
 * have inverted polarity: tightening speeds spin up while shrinking radius)
 * and the `clickBalance` weight, entirely at draw time -- the underlying
 * settings values themselves are never mutated by clicking.
 */
export function MouseCursorOverlay({
  stageRef,
  settings,
  fadeMs = 550,
}: MouseCursorOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const posRef = useRef<{ x: number; y: number } | null>(null)
  const stageRectRef = useRef<DOMRect | null>(null)
  // Exact backing-buffer-to-CSS-box scale, not just `devicePixelRatio`: the
  // canvas's backing resolution is rounded to a whole pixel count, which can
  // shift the true scale by a fraction of a percent. Using that exact ratio
  // (rather than assuming it equals dpr) keeps the drawn cursor's center
  // pinned exactly under the real pointer position instead of drifting a
  // sub-pixel further off at wider parts of the stage.
  const scaleRef = useRef({ x: 1, y: 1 })
  const rafRef = useRef<number | null>(null)
  const activeSinceRef = useRef<number | null>(null)
  const leftAtRef = useRef<number | null>(null)

  // Click-response interaction state. Declared at component scope (not
  // inside the effect below) so the live axis value survives a settings
  // tweak mid-interaction -- only the in-flight animation refs are torn
  // down and rebuilt when the effect reruns.
  const clickAxisRef = useRef(0)
  const rotationPhaseRef = useRef(0)
  const lastFrameMsRef = useRef<number | null>(null)
  const clickHoldRef = useRef<{ button: 0 | 2; direction: -1 | 1 } | null>(null)
  const clickContinuousActiveRef = useRef(false)
  const clickTapPlanRef = useRef<{ curve: CurvePlan; plan: CursorClickStepPlan; startMs: number } | null>(null)
  const clickReleasePlanRef = useRef<{ plan: CursorReleaseRampDownPlan; startMs: number } | null>(null)
  const clickHandoffTimeoutRef = useRef<number | null>(null)

  const {
    dotColor, centerColor, trailColor, dotCount, radiusPx, spinHz, trailThicknessPx, trailFadeMs,
    dotSizePx, centerSizePx, pulseMagnitude, pulseHz,
    clickRamp, clickSkew, clickDurationSec, clickMaxSpeed, clickStep, clickBalance,
  } = settings

  useEffect(() => {
    const stageEl = stageRef.current
    const canvas = canvasRef.current
    if (!stageEl || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const dot = resolveRgba(dotColor)
    const center = resolveRgba(centerColor)
    const trail = resolveRgba(trailColor)
    // A 1000ms fade at 1Hz spin should sweep exactly one full revolution
    // (2*PI) -- the head chasing a tail whose oldest point just finished
    // decaying where the head currently is. Capped at one revolution: past
    // that the tail would start overlapping itself, which the conic
    // gradient (0 -> 1 stops over the sweep) can't represent as a longer fade.
    const trailRad = Math.min(Math.PI * 2, (trailFadeMs / 1000) * spinHz * Math.PI * 2)
    const effectiveDotCount = Math.max(1, Math.round(dotCount))
    const angleStep = (Math.PI * 2) / effectiveDotCount
    const clickWeights = resolveCursorClickWeights(clickBalance)

    function updateCanvasResolution() {
      const rect = stageEl!.getBoundingClientRect()
      stageRectRef.current = rect
      const backingWidth = Math.max(1, Math.round(rect.width * dpr))
      const backingHeight = Math.max(1, Math.round(rect.height * dpr))
      canvas!.width = backingWidth
      canvas!.height = backingHeight
      scaleRef.current = {
        x: rect.width > 0 ? backingWidth / rect.width : dpr,
        y: rect.height > 0 ? backingHeight / rect.height : dpr,
      }
    }

    updateCanvasResolution()

    function ensureLoopRunning() {
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(draw)
      }
    }

    function clearClickHandoffTimeout() {
      if (clickHandoffTimeoutRef.current !== null) {
        window.clearTimeout(clickHandoffTimeoutRef.current)
        clickHandoffTimeoutRef.current = null
      }
    }

    // Ends whatever hold is currently tracked (real mouseup, or a different
    // button pressed while one was already held): if it had handed off to
    // the continuous plateau, starts a release-ramp-down from clickMaxSpeed
    // back to 0; otherwise the tap (if any) is left to finish playing out
    // (rise then fall, back to 0) on its own -- a quick click always
    // completes its full pulse regardless of when the button comes back up.
    function finalizeActiveHold() {
      clearClickHandoffTimeout()
      const hold = clickHoldRef.current
      if (hold && clickContinuousActiveRef.current) {
        const plan = buildCursorReleaseRampDownPlan(clickRamp, clickSkew, clickDurationSec, hold.direction, clickMaxSpeed)
        if (plan) {
          clickReleasePlanRef.current = { plan, startMs: performance.now() }
        }
      }
      clickContinuousActiveRef.current = false
      clickHoldRef.current = null
    }

    function draw(now: number) {
      const pos = posRef.current
      const activeSince = activeSinceRef.current
      const leftAt = leftAtRef.current

      if (!pos || activeSince === null) {
        ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
        rafRef.current = null
        return
      }

      let fadeAlpha = 1
      if (leftAt !== null) {
        fadeAlpha = Math.max(0, 1 - (now - leftAt) / fadeMs)
        if (fadeAlpha <= 0) {
          ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
          rafRef.current = null
          return
        }
      }

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      // magical number offset so that we actually have pin point accuracy on the grid.
      const cx = pos.x * scaleRef.current.x + 5
      const cy = pos.y * scaleRef.current.y

      // Cap frame delta so a backgrounded-tab / dropped-frame gap doesn't
      // register as one giant jump in continuous-hold motion or spin phase.
      const lastFrameMs = lastFrameMsRef.current
      const dtSec = lastFrameMs === null ? 0 : Math.min(0.1, Math.max(0, (now - lastFrameMs) / 1000))
      lastFrameMsRef.current = now

      // --- click-response axis update -------------------------------
      // The axis is a deviation (bell height), not a position -- each
      // branch below computes it fresh from elapsed time within whichever
      // phase is active, never accumulated from a prior value. It settles
      // to exactly 0 the instant no phase is active.
      let axis = 0
      if (clickTapPlanRef.current) {
        const tap = clickTapPlanRef.current
        const elapsedSec = (now - tap.startMs) / 1000
        if (elapsedSec >= tap.plan.totalDurationSec) {
          clickTapPlanRef.current = null
        } else {
          axis = sampleCursorStepPlanVelocity(tap.curve, tap.plan, elapsedSec)
        }
      } else if (clickContinuousActiveRef.current && clickHoldRef.current) {
        axis = clickHoldRef.current.direction * clickMaxSpeed
      } else if (clickReleasePlanRef.current) {
        const release = clickReleasePlanRef.current
        const elapsedSec = (now - release.startMs) / 1000
        if (elapsedSec >= release.plan.tailDurationSec) {
          clickReleasePlanRef.current = null
        } else {
          axis = sampleCursorReleaseRampDownPlanVelocity(release.plan, elapsedSec)
        }
      }
      clickAxisRef.current = axis
      const effectiveRadiusPx = radiusPx * axisToRadiusMultiplier(axis, clickWeights.radiusWeight)
      const effectiveSpinHz = spinHz * axisToSpinMultiplier(axis, clickWeights.spinWeight)

      rotationPhaseRef.current += effectiveSpinHz * dtSec
      const rotation = (rotationPhaseRef.current % 1) * Math.PI * 2

      const elapsedSec = (now - activeSince) / 1000
      const pulsePhase = (elapsedSec * pulseHz) % 1
      const pulseEase = (1 - Math.cos(pulsePhase * Math.PI * 2)) / 2
      const pulseScale = 1 + (pulseMagnitude - 1) * pulseEase
      const orbitRadius = effectiveRadiusPx * dpr * pulseScale

      const dotHeadRadius = Math.max(0.5, dotSizePx * dpr * 0.5)
      const lineWidth = Math.max(1, trailThicknessPx * dpr)

      for (let i = 0; i < effectiveDotCount; i += 1) {
        const headAngle = rotation + i * angleStep
        const tailAngle = headAngle - trailRad

        const gradient = ctx!.createConicGradient(tailAngle, cx, cy)
        gradient.addColorStop(0, `rgba(${trail.r}, ${trail.g}, ${trail.b}, 0)`)
        gradient.addColorStop(1, `rgba(${trail.r}, ${trail.g}, ${trail.b}, ${trail.a * fadeAlpha})`)

        ctx!.save()
        ctx!.lineWidth = lineWidth
        // 'butt', not 'round': a round cap at the tail end bleeds slightly
        // past tailAngle, and because a conic gradient wraps a full circle
        // (angle just before the start reads as nearly the OTHER end of the
        // gradient, i.e. nearly opaque instead of the alpha-0 we want there),
        // that sliver renders as a solid half-circle blob at the fading tail.
        // The head's own round cap is harmless (it's already near-opaque
        // there, and covered by the separately-drawn head dot) but dropping
        // it too keeps both ends consistent.
        ctx!.lineCap = 'butt'
        ctx!.strokeStyle = gradient
        ctx!.beginPath()
        ctx!.arc(cx, cy, orbitRadius, tailAngle, headAngle)
        ctx!.stroke()
        ctx!.restore()

        if (dotSizePx > 0) {
          const headX = cx + Math.cos(headAngle) * orbitRadius
          const headY = cy + Math.sin(headAngle) * orbitRadius
          ctx!.save()
          ctx!.fillStyle = `rgba(${dot.r}, ${dot.g}, ${dot.b}, ${dot.a * fadeAlpha})`
          ctx!.beginPath()
          ctx!.arc(headX, headY, dotHeadRadius, 0, Math.PI * 2)
          ctx!.fill()
          ctx!.restore()
        }
      }

      if (centerSizePx > 0) {
        ctx!.save()
        ctx!.fillStyle = `rgba(${center.r}, ${center.g}, ${center.b}, ${center.a * fadeAlpha})`
        ctx!.beginPath()
        ctx!.arc(cx, cy, Math.max(0.5, centerSizePx * dpr * 0.5), 0, Math.PI * 2)
        ctx!.fill()
        ctx!.restore()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    function handlePointerMove(event: PointerEvent) {
      const rect = stageRectRef.current
      if (!rect) return
      posRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      ensureLoopRunning()
    }

    function handlePointerEnter() {
      activeSinceRef.current = performance.now()
      leftAtRef.current = null
      lastFrameMsRef.current = null
      ensureLoopRunning()
    }

    function handlePointerLeave() {
      leftAtRef.current = performance.now()
      ensureLoopRunning()
    }

    function handleStageMouseDown(event: MouseEvent) {
      if (event.button !== 0 && event.button !== 2) return
      const direction: -1 | 1 = event.button === 0 ? -1 : 1

      // Any prior gesture (a different button held, a tap still rising, or
      // a release still decaying) is retriggered from scratch -- a fresh
      // click always starts a brand-new pulse at 0.
      finalizeActiveHold()
      clickReleasePlanRef.current = null
      clickTapPlanRef.current = null

      clickHoldRef.current = { button: event.button as 0 | 2, direction }
      ensureLoopRunning()

      const signedDistance = direction * clickStep
      const curve = buildCursorCurvePlan(clickRamp, clickSkew, clickDurationSec)
      const plan = buildCursorStepPlan(curve, clickDurationSec, signedDistance, clickMaxSpeed)
      clickTapPlanRef.current = { curve, plan, startMs: performance.now() }

      const crossingTimeSec = resolveCursorRampCrossingTimeSec(clickRamp, clickSkew, clickDurationSec, signedDistance, clickMaxSpeed)
      if (crossingTimeSec !== null) {
        const delayMs = Math.max(0, Math.round(crossingTimeSec * 1000))
        clickHandoffTimeoutRef.current = window.setTimeout(() => {
          clickHandoffTimeoutRef.current = null
          if (!clickHoldRef.current || clickHoldRef.current.button !== event.button) return
          clickTapPlanRef.current = null
          clickContinuousActiveRef.current = true
        }, delayMs)
      }
    }

    function handleWindowMouseUp(event: globalThis.MouseEvent) {
      if (event.button !== 0 && event.button !== 2) return
      if (!clickHoldRef.current || clickHoldRef.current.button !== event.button) return
      finalizeActiveHold()
    }

    stageEl.addEventListener('pointermove', handlePointerMove, { passive: true })
    stageEl.addEventListener('pointerenter', handlePointerEnter)
    stageEl.addEventListener('pointerleave', handlePointerLeave)
    stageEl.addEventListener('mousedown', handleStageMouseDown)
    window.addEventListener('mouseup', handleWindowMouseUp)

    const resizeObserver = new ResizeObserver(updateCanvasResolution)
    resizeObserver.observe(stageEl)

    return () => {
      stageEl.removeEventListener('pointermove', handlePointerMove)
      stageEl.removeEventListener('pointerenter', handlePointerEnter)
      stageEl.removeEventListener('pointerleave', handlePointerLeave)
      stageEl.removeEventListener('mousedown', handleStageMouseDown)
      window.removeEventListener('mouseup', handleWindowMouseUp)
      resizeObserver.disconnect()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      activeSinceRef.current = null
      leftAtRef.current = null
      clearClickHandoffTimeout()
      clickHoldRef.current = null
      clickContinuousActiveRef.current = false
      clickTapPlanRef.current = null
      clickReleasePlanRef.current = null
    }
  }, [
    stageRef, radiusPx, trailThicknessPx, trailFadeMs, spinHz, fadeMs, dotCount, dotColor, centerColor, trailColor,
    dotSizePx, centerSizePx, pulseMagnitude, pulseHz,
    clickRamp, clickSkew, clickDurationSec, clickMaxSpeed, clickStep, clickBalance,
  ])

  return <canvas ref={canvasRef} className="mouse-cursor-overlay-canvas" aria-hidden="true" />
}

export default MouseCursorOverlay
