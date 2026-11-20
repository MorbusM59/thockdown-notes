import { useEffect, useRef, useState } from 'react'
import { encodeTooltip } from '@thockdown/interaction/tooltipContent'
import { emptyStateSolid, solidSeed } from '../editor/EmptyStateScene'
import { BEAT_DELAY_MAX_MS, BEAT_DELAY_MIN_MS } from '../shared/beatSettings'
import { useHoldToAdjust, type HoldToAdjustKeyboardController } from '../shared/useHoldToAdjust'
import { startSwish, SWISH_APEX_SEC, SWISH_PERIOD_SEC, type SwishRun } from '../sound/swishCalibration'

/** The step Up and Down take, in ms; Left and Right take 1 and speed up while held. */
const COARSE_STEP_MS = 10
/** The solid that orbits: the octahedron (`solidSeed`'s index 2), whose points read clearly at this size. */
const BODY = emptyStateSolid(solidSeed('swish-calibration', 2))
/** Turns of the body about its own axis per orbit, so it reads as a solid rather than a sprite. */
const SPIN_PER_ORBIT = 1
/**
 * Seconds a held arrow takes to cross the whole delay range: about 100 ms of
 * delay a second at full speed, so a hold covers ground and a release still
 * lands near where the eye said stop. The hold's default (a volume's hundred
 * steps) would cross these seven hundred seven times as fast.
 */
const HOLD_TRAVEL_SEC = (BEAT_DELAY_MAX_MS - BEAT_DELAY_MIN_MS) / 100
/** The orbit seen from slightly above: how far the far side rises, as a share of the strip's height. */
const ORBIT_RISE = 0.1

/**
 * Options > Beat Detection's delay calibration (`sound/swishCalibration.ts`):
 * one strip, six cells wide and one high. Pressing it starts the swish and a
 * solid orbiting in front of the reader, passing closest (largest, brightest,
 * fastest, crossing the centre mark left to right as the swish pans) once a
 * second, drawn as late as the beat pulse would draw a hit heard at the
 * swish's peak. While it runs, Left and Right move the device's delay by
 * 1 ms (held, faster, on the app's hold curve), Up and Down by 10, until the
 * pass and the peak coincide; Right draws later. Pressing it again, Escape,
 * or leaving Options stops it. At rest the body waits at the front.
 */
export function SwishCalibration({ delayMs, onChange }: { delayMs: number; onChange: (delayMs: number) => void }) {
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const delayRef = useRef(delayMs)
  delayRef.current = delayMs
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const keyboardRef = useRef<HoldToAdjustKeyboardController | null>(null)

  useHoldToAdjust({
    getValue: () => delayRef.current,
    onChange: (next) => {
      // Read on the next frame before React has re-rendered with it.
      delayRef.current = next
      onChangeRef.current(next)
    },
    min: BEAT_DELAY_MIN_MS,
    max: BEAT_DELAY_MAX_MS,
    fullTravelSec: HOLD_TRAVEL_SEC,
  }, keyboardRef)

  // The frame loop: drawn every frame while running, once at the apex at rest and on resize.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let run: SwishRun | null = null
    let frame: number | null = null
    let ink = ''
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const width = Math.round(canvas.clientWidth * dpr)
      const height = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ink = getComputedStyle(canvas).color
    }
    const paint = (phase: number) => {
      const context = canvas.getContext('2d')
      if (context) drawOrbit(context, phase, ink)
    }
    const tick = (frameTimeMs: number) => {
      const phase = run ? run.heardPhase(frameTimeMs, delayRef.current / 1000) : NaN
      paint(Number.isNaN(phase) ? SWISH_APEX_SEC / SWISH_PERIOD_SEC : phase)
      frame = requestAnimationFrame(tick)
    }
    fit()
    const observer = new ResizeObserver(() => {
      fit()
      if (!running) paint(SWISH_APEX_SEC / SWISH_PERIOD_SEC)
    })
    observer.observe(canvas)
    if (running) {
      run = startSwish(() => {
        setFailed(true)
        setRunning(false)
      })
      frame = requestAnimationFrame(tick)
    } else {
      paint(SWISH_APEX_SEC / SWISH_PERIOD_SEC)
    }
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
      run?.stop()
    }
  }, [running])

  // The keys, only while running, ahead of everything else (the window's capture phase).
  useEffect(() => {
    if (!running) return
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key
      if (key === 'Escape') setRunning(false)
      else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        if (!event.repeat) keyboardRef.current?.start(key === 'ArrowLeft' ? 0 : 2)
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        const next = Math.max(BEAT_DELAY_MIN_MS, Math.min(BEAT_DELAY_MAX_MS, delayRef.current + (key === 'ArrowUp' ? COARSE_STEP_MS : -COARSE_STEP_MS)))
        delayRef.current = next
        onChangeRef.current(next)
      } else return
      event.preventDefault()
      event.stopPropagation()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      keyboardRef.current?.end()
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    const keyboard = keyboardRef
    return () => {
      keyboard.current?.cancel()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [running])

  const intention = running ? 'Stop' : 'Match the pass to the swish'
  return (
    <div className="options-loadout-grid swish-calibration" role="group" aria-label="Match the visuals to the sound">
      <button
        type="button"
        className={`options-loadout-btn swish-calibration-strip${running ? ' active' : ''}${failed ? ' failed' : ''}`}
        onClick={() => {
          setFailed(false)
          setRunning((on) => !on)
        }}
        data-live-tooltip={encodeTooltip({ intention, value: `${delayMs} ms` })}
        aria-label={intention}
      >
        <canvas ref={canvasRef} className="swish-calibration-canvas" aria-hidden="true" />
        {running && <span className="swish-calibration-value">{delayMs}</span>}
      </button>
    </div>
  )
}

/**
 * The strip at `phase` of a period (0..1, the apex at SWISH_APEX_SEC): a faint
 * orbit and centre mark, and the body on the orbit, in front and at the
 * centre at the apex, moving left to right there.
 */
function drawOrbit(context: CanvasRenderingContext2D, phase: number, ink: string): void {
  const { width, height } = context.canvas
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, width, height)
  if (width === 0 || height === 0) return
  const theta = 2 * Math.PI * (phase - SWISH_APEX_SEC / SWISH_PERIOD_SEC)
  const centreX = width / 2
  const centreY = height / 2
  // Clear of the delay figure at the right end, and as far from the left.
  const radiusX = width / 2 - height * 1.7
  const rise = height * ORBIT_RISE
  context.strokeStyle = ink
  context.fillStyle = ink
  context.lineWidth = Math.max(1, height / 40)

  // The orbit and the mark the body crosses at the apex.
  context.globalAlpha = 0.18
  context.beginPath()
  context.ellipse(centreX, centreY, radiusX, rise, 0, 0, 2 * Math.PI)
  context.stroke()
  context.globalAlpha = 0.3
  context.beginPath()
  context.moveTo(centreX, height * 0.1)
  context.lineTo(centreX, height * 0.9)
  context.stroke()

  // Nearness: 1 at the front, 0 at the back.
  const near = (Math.cos(theta) + 1) / 2
  const x = centreX + radiusX * Math.sin(theta)
  const y = centreY + rise * Math.cos(theta)
  const size = height * (0.16 + 0.26 * near * near)
  const spin = theta * SPIN_PER_ORBIT
  const tilt = 0.5
  const cs = Math.cos(spin), sn = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt)
  const points = BODY.vertices.map(([vx, vy, vz]) => {
    // Spin about the vertical axis, then tilt towards the reader.
    const rx = vx * cs + vz * sn
    const rz = -vx * sn + vz * cs
    const ry = vy * ct - rz * st
    const depth = vy * st + rz * ct
    const perspective = 3 / (3 - depth)
    return [x + rx * size * perspective, y + ry * size * perspective] as const
  })
  const strength = 0.25 + 0.75 * near ** 3
  BODY.faces.forEach((face, i) => {
    context.globalAlpha = BODY.faceAlphas[i] * strength
    context.beginPath()
    face.forEach((v, j) => (j === 0 ? context.moveTo(points[v][0], points[v][1]) : context.lineTo(points[v][0], points[v][1])))
    context.closePath()
    context.fill()
  })
  context.globalAlpha = strength
  context.beginPath()
  for (const [a, b] of BODY.edges) {
    context.moveTo(points[a][0], points[a][1])
    context.lineTo(points[b][0], points[b][1])
  }
  context.stroke()
  context.globalAlpha = 1
}
