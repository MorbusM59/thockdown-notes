import { useEffect, useRef } from 'react'
import { parseCssColorToRgba, type RgbaColor } from '../shared/colorMath'
import type { CustomCursorSettings } from '../shared/cursorSettings'
import {
  axisToRadiusMultiplier,
  axisToSpinMultiplier,
  cursorClickReleaseTailDurationSec,
  resolveCursorClickDurationSec,
  resolveCursorClickWeights,
  sampleCursorPressAxis,
  sampleCursorReleaseAxis,
} from '../editor/CursorClickCurve'

export interface MouseCursorOverlayProps {
  settings: CustomCursorSettings
  /** Not the same as settings.trailFadeMs (a per-trail-particle decay time) -- this is how long the *whole overlay* takes to fade out after the pointer leaves the window entirely. Not exposed in the options UI. */
  fadeMs?: number
  /**
   * The app's dark-mode invert amount (0-1, see App.tsx's filterInvert),
   * applied to the cursor's own dot/center/trail colors. Since this overlay
   * is mounted as a sibling of .app-saturate-wrapper rather than nested
   * inside it (see the doc comment below), it never picks up that
   * wrapper's `filter: invert(...)` the rest of the app gets -- without
   * this, the cursor would keep its light-mode colors on an inverted/dark
   * background. Defaults to 0 (no invert) for any caller that doesn't pass it.
   */
  filterInvert?: number
}

const FALLBACK_RGBA: RgbaColor = { r: 0, g: 0, b: 0, a: 1 }

function resolveRgba(color: string): RgbaColor {
  return parseCssColorToRgba(color) ?? FALLBACK_RGBA
}

// Same per-channel formula as CSS's `filter: invert(amount)`: 0 = unchanged,
// 1 = fully inverted, continuous in between.
function applyInvert(color: RgbaColor, amount: number): RgbaColor {
  if (amount <= 0) return color
  const clampedAmount = Math.min(1, amount)
  const invertChannel = (channel: number) => Math.round(channel + (255 - 2 * channel) * clampedAmount)
  return { r: invertChannel(color.r), g: invertChannel(color.g), b: invertChannel(color.b), a: color.a }
}

/**
 * Mounted once, as the last child of `.app-root` (see App.tsx) -- deliberately
 * a sibling of `.app-saturate-wrapper`, not nested inside it, because that
 * wrapper conditionally applies a CSS `filter` (see appOuterStyle) whenever
 * any filter slider is active, and `filter` on an ancestor turns this
 * canvas's `position: fixed` into "fixed relative to that ancestor" instead
 * of the true viewport (same containing-block rule as `transform`). `.app-root`
 * itself sets neither, so mounting there keeps `position: fixed; inset: 0`
 * always meaning the real window viewport, with a z-index high enough to
 * paint over literally everything else in the app (see mouse-cursor-overlay-
 * canvas's own CSS) -- covering the whole app surface, not just the editor,
 * is the whole point: this used to be scoped to `.editor-stage` and require
 * `stageRef`-based DOM listeners/geometry, but a canvas that tracks the
 * pointer has no reason to be scoped to any one part of the app; the pointer
 * moves everywhere. Native cursor hiding (`.hide-native-cursor`, CSS) is
 * likewise now applied to `.app-root` itself instead of just the editor
 * stage -- see App.tsx and editor.css.
 *
 * Tracking is window/document-level (capture phase, so a component calling
 * stopPropagation on a click/move -- dropdowns, modals -- can't cause the
 * cursor to silently stop updating), not scoped to any element: a
 * `pointer-events: auto` full-viewport element sitting on top of the whole
 * app would swallow every click before it ever reaches the real UI
 * underneath, which is why this canvas stays `pointer-events: none` and
 * pointer state comes from `window`/`document` listeners instead.
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
 * The orbit radius itself breathes between 100% and `100% + pulseMagnitude`
 * (0 = no pulsing, 1 = up to 200%) via an ease-in-out (raised-cosine)
 * oscillation at `pulseHz`. `spinHz` can be negative (reversed spin); every
 * angle/trail calculation always uses its absolute value (spin is computed
 * as if it were always positive), and reversal is applied once at the very
 * end by mirroring the entire finished frame left-right about the cursor's
 * own center -- see the `reverseSpin` block in draw(). The rAF loop only
 * runs while the pointer is actually within the window or fading out
 * afterwards (`fadeMs`), not continuously for the component's whole
 * lifetime.
 *
 * Click response: mousedown (left = tighten, right = widen) anywhere in the
 * app drives a shared "intent" axis (clickAxisRef) that is NOT a
 * position -- like a scroll animation's current speed rather than its
 * resulting scrollTop, it always returns to exactly 0 once the gesture
 * settles. Every press is handled identically regardless of how long the
 * button is actually down for -- a plain click is too fast to reliably
 * register as anything but "held" -- so there's no separate short-tap
 * pulse: a press always ATTACKs toward `clickMaxSpeed` along the bell
 * curve's rising half (ramp/skew/duration -- see CursorClickCurve.ts),
 * SUSTAINs there for as long as it's held, then on release DECAYs back to
 * exactly 0 along the bell's falling half. `clickMinHoldMs` floors how long
 * the press is treated as held internally even if the physical click was
 * shorter, so a quick real click still produces a felt pulse instead of a
 * flicker. `radiusPx`/`spinHz` below are each scaled by their own
 * multiplier derived from the axis (radius and spin have inverted
 * polarity: tightening speeds spin up while shrinking radius) and the
 * `clickBalance` weight, entirely at draw time -- the underlying settings
 * values themselves are never mutated by clicking.
 */
export function MouseCursorOverlay({
  settings,
  fadeMs = 550,
  filterInvert = 0,
}: MouseCursorOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const posRef = useRef<{ x: number; y: number } | null>(null)
  // Exact backing-buffer-to-CSS-box scale, not just `devicePixelRatio`: the
  // canvas's backing resolution is rounded to a whole pixel count, which can
  // shift the true scale by a fraction of a percent. Using that exact ratio
  // (rather than assuming it equals dpr) keeps the drawn cursor's center
  // pinned exactly under the real pointer position instead of drifting a
  // sub-pixel further off at wider parts of the window.
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
  const clickPressRef = useRef<{ button: 0 | 2; direction: -1 | 1; startMs: number } | null>(null)
  const clickReleaseRef = useRef<{ initialAxis: number; startMs: number } | null>(null)
  const clickPendingReleaseTimeoutRef = useRef<number | null>(null)

  const {
    dotColor, centerColor, trailColor, dotCount, radiusPx, spinHz, trailThicknessPx, trailFadeMs,
    dotSizePx, centerSizePx, haloColor, haloRadiusPx, haloFalloff, pulseMagnitude, pulseHz,
    clickRamp, clickSkew, clickSpeedX, clickMaxSpeed, clickMinHoldMs, clickBalance,
  } = settings

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const dot = applyInvert(resolveRgba(dotColor), filterInvert)
    const center = applyInvert(resolveRgba(centerColor), filterInvert)
    const trail = applyInvert(resolveRgba(trailColor), filterInvert)
    const halo = applyInvert(resolveRgba(haloColor), filterInvert)
    // A 1000ms fade at 1Hz spin should sweep exactly one full revolution
    // (2*PI) -- the head chasing a tail whose oldest point just finished
    // decaying where the head currently is. Capped at one revolution: past
    // that the tail would start overlapping itself, which the conic
    // gradient (0 -> 1 stops over the sweep) can't represent as a longer fade.
    // Everything below is computed as if spin were always positive (using
    // |spinHz|) -- reversed (negative) spin is handled entirely by mirroring
    // the finished frame at the end of draw(), not by threading a sign
    // through this math. (An earlier attempt flipped just arc()'s sweep
    // direction for negative spin, but a conic gradient's alpha ramp is
    // always painted clockwise from its start angle regardless of the
    // stroke path's direction, so that desynced the gradient from the
    // stroke and produced a solid, non-fading tail. Mirroring the whole
    // rendered image instead keeps the gradient and geometry consistent.)
    const trailRad = Math.min(Math.PI * 2, (trailFadeMs / 1000) * Math.abs(spinHz) * Math.PI * 2)
    const reverseSpin = spinHz < 0
    const effectiveDotCount = Math.max(1, Math.round(dotCount))
    const angleStep = (Math.PI * 2) / effectiveDotCount
    const clickWeights = resolveCursorClickWeights(clickBalance)
    const clickDurationSec = resolveCursorClickDurationSec(clickSpeedX)

    function updateCanvasResolution() {
      const width = window.innerWidth
      const height = window.innerHeight
      const backingWidth = Math.max(1, Math.round(width * dpr))
      const backingHeight = Math.max(1, Math.round(height * dpr))
      canvas!.width = backingWidth
      canvas!.height = backingHeight
      scaleRef.current = {
        x: width > 0 ? backingWidth / width : dpr,
        y: height > 0 ? backingHeight / height : dpr,
      }
    }

    updateCanvasResolution()

    function ensureLoopRunning() {
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(draw)
      }
    }

    function clearPendingRelease() {
      if (clickPendingReleaseTimeoutRef.current !== null) {
        window.clearTimeout(clickPendingReleaseTimeoutRef.current)
        clickPendingReleaseTimeoutRef.current = null
      }
    }

    // Ends the currently-tracked press (real mouseup once clickMinHoldMs is
    // satisfied, or a fresh click superseding an old one): samples wherever
    // the attack/sustain currently is and starts a release decay from
    // exactly that value back to 0.
    function beginRelease() {
      clearPendingRelease()
      const press = clickPressRef.current
      if (!press) return
      const elapsedSec = (performance.now() - press.startMs) / 1000
      const initialAxis = sampleCursorPressAxis(press.direction, elapsedSec, clickRamp, clickSkew, clickDurationSec, clickMaxSpeed)
      clickPressRef.current = null
      clickReleaseRef.current = { initialAxis, startMs: performance.now() }
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
      if (clickPressRef.current) {
        const press = clickPressRef.current
        const elapsedSec = (now - press.startMs) / 1000
        axis = sampleCursorPressAxis(press.direction, elapsedSec, clickRamp, clickSkew, clickDurationSec, clickMaxSpeed)
      } else if (clickReleaseRef.current) {
        const release = clickReleaseRef.current
        const elapsedSec = (now - release.startMs) / 1000
        const tailDurationSec = cursorClickReleaseTailDurationSec(clickSkew, clickDurationSec)
        if (elapsedSec >= tailDurationSec) {
          clickReleaseRef.current = null
        } else {
          axis = sampleCursorReleaseAxis(release.initialAxis, elapsedSec, clickRamp, clickSkew, clickDurationSec)
        }
      }
      clickAxisRef.current = axis
      const effectiveRadiusPx = radiusPx * axisToRadiusMultiplier(axis, clickWeights.radiusWeight)
      const effectiveSpinHz = Math.abs(spinHz) * axisToSpinMultiplier(axis, clickWeights.spinWeight)

      rotationPhaseRef.current += effectiveSpinHz * dtSec
      const rotation = (rotationPhaseRef.current % 1) * Math.PI * 2

      const elapsedSec = (now - activeSince) / 1000
      const pulsePhase = (elapsedSec * pulseHz) % 1
      const pulseEase = (1 - Math.cos(pulsePhase * Math.PI * 2)) / 2
      // pulseMagnitude is the ADDITIONAL fraction grown at the pulse peak
      // (0 = no pulsing, stays at the stable base radius; 1 = breathes up
      // to 200% of it) -- not a peak multiplier itself, so no "-1" here.
      const pulseScale = 1 + pulseMagnitude * pulseEase
      const orbitRadius = effectiveRadiusPx * dpr * pulseScale

      const dotHeadRadius = Math.max(0.5, dotSizePx * dpr * 0.5)
      const lineWidth = Math.max(1, trailThicknessPx * dpr)

      // Everything from here to the matching restore() below is drawn as if
      // spin were positive; for reversed spin the whole frame is mirrored
      // left-right about the cursor's own center (cx), which reverses the
      // apparent rotation direction while keeping the gradient and stroke
      // geometry (computed with unsigned trailRad/effectiveSpinHz above)
      // consistent with each other. cx already includes the "pinpoint
      // accuracy" +5 offset, so mirroring about it leaves the cursor's own
      // position fixed -- only the orbiting elements around it flip.
      if (reverseSpin) {
        ctx!.save()
        ctx!.translate(cx, 0)
        ctx!.scale(-1, 1)
        ctx!.translate(-cx, 0)
      }

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

      if (haloRadiusPx > 0) {
        const haloOuterRadius = haloRadiusPx * dpr
        const falloffStop = haloFalloff / 100
        const gradient = ctx!.createRadialGradient(cx, cy, 0, cx, cy, haloOuterRadius)
        gradient.addColorStop(0, `rgba(${halo.r}, ${halo.g}, ${halo.b}, ${halo.a * fadeAlpha})`)
        gradient.addColorStop(falloffStop, `rgba(${halo.r}, ${halo.g}, ${halo.b}, ${halo.a * falloffStop * fadeAlpha})`)
        gradient.addColorStop(1, `rgba(${halo.r}, ${halo.g}, ${halo.b}, 0)`)
        ctx!.save()
        ctx!.fillStyle = gradient
        ctx!.beginPath()
        ctx!.arc(cx, cy, haloOuterRadius, 0, Math.PI * 2)
        ctx!.fill()
        ctx!.restore()
      }

      if (centerSizePx > 0) {
        ctx!.save()
        ctx!.fillStyle = `rgba(${center.r}, ${center.g}, ${center.b}, ${center.a * fadeAlpha})`
        ctx!.beginPath()
        ctx!.arc(cx, cy, Math.max(0.5, centerSizePx * dpr * 0.5), 0, Math.PI * 2)
        ctx!.fill()
        ctx!.restore()
      }

      if (reverseSpin) {
        ctx!.restore()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    // Window/document-level, not scoped to any element -- see the component
    // doc comment. First move after a fresh mount, or after the pointer had
    // left the window, re-activates (resets phase/fade) same as the old
    // per-element pointerenter used to.
    function handlePointerMove(event: PointerEvent) {
      posRef.current = { x: event.clientX, y: event.clientY }
      if (activeSinceRef.current === null || leftAtRef.current !== null) {
        activeSinceRef.current = performance.now()
        lastFrameMsRef.current = null
        leftAtRef.current = null
      }
      ensureLoopRunning()
    }

    function handleDocumentMouseLeave() {
      leftAtRef.current = performance.now()
      ensureLoopRunning()
    }

    function handleWindowMouseDown(event: MouseEvent) {
      if (event.button !== 0 && event.button !== 2) return
      const direction: -1 | 1 = event.button === 0 ? -1 : 1

      // Any prior gesture (a different button pressed, or a release still
      // decaying) is retriggered from scratch -- a fresh click always
      // starts a brand-new pulse at 0.
      clearPendingRelease()
      clickReleaseRef.current = null
      clickPressRef.current = { button: event.button as 0 | 2, direction, startMs: performance.now() }
      ensureLoopRunning()
    }

    function handleWindowMouseUp(event: globalThis.MouseEvent) {
      if (event.button !== 0 && event.button !== 2) return
      const press = clickPressRef.current
      if (!press || press.button !== event.button) return

      const heldMs = performance.now() - press.startMs
      const remainingMs = clickMinHoldMs - heldMs
      if (remainingMs > 0) {
        // Physical click was shorter than the enforced floor -- keep the
        // press (attack/sustain) running until that floor is met, THEN
        // start the release decay.
        clearPendingRelease()
        clickPendingReleaseTimeoutRef.current = window.setTimeout(() => {
          clickPendingReleaseTimeoutRef.current = null
          beginRelease()
        }, remainingMs)
        return
      }
      beginRelease()
    }

    // capture: true throughout -- a component calling stopPropagation on a
    // click or move (dropdowns, modals) fires during the bubble phase, so
    // listening in the capture phase (which runs first, top-down) means
    // the cursor keeps tracking regardless of what happens further down.
    window.addEventListener('pointermove', handlePointerMove, { passive: true, capture: true })
    document.addEventListener('mouseleave', handleDocumentMouseLeave)
    window.addEventListener('mousedown', handleWindowMouseDown, { capture: true })
    window.addEventListener('mouseup', handleWindowMouseUp, { capture: true })
    window.addEventListener('resize', updateCanvasResolution)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove, { capture: true })
      document.removeEventListener('mouseleave', handleDocumentMouseLeave)
      window.removeEventListener('mousedown', handleWindowMouseDown, { capture: true })
      window.removeEventListener('mouseup', handleWindowMouseUp, { capture: true })
      window.removeEventListener('resize', updateCanvasResolution)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      activeSinceRef.current = null
      leftAtRef.current = null
      clearPendingRelease()
      clickPressRef.current = null
      clickReleaseRef.current = null
    }
  }, [
    radiusPx, trailThicknessPx, trailFadeMs, spinHz, fadeMs, dotCount, dotColor, centerColor, trailColor,
    dotSizePx, centerSizePx, haloColor, haloRadiusPx, haloFalloff, pulseMagnitude, pulseHz, filterInvert,
    clickRamp, clickSkew, clickSpeedX, clickMaxSpeed, clickMinHoldMs, clickBalance,
  ])

  return <canvas ref={canvasRef} className="mouse-cursor-overlay-canvas" aria-hidden="true" />
}

export default MouseCursorOverlay
