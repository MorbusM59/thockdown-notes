import { useEffect, useRef, useState } from 'react'
import { encodeTooltip } from '@thockdown/interaction/tooltipContent'
import { createSolidDrawScratch, drawSolidScene } from '../editor/EmptyStateScene'
import { BEAT_DELAY_MAX_MS, BEAT_DELAY_MIN_MS } from '../shared/beatSettings'
import { useHoldToAdjust, type HoldToAdjustKeyboardController } from '../shared/useHoldToAdjust'
import { startSwish, SWISH_APEX_SEC, SWISH_PERIOD_SEC, type SwishRun } from '../sound/swishCalibration'
import { SWISH_CYLINDER } from './swishCylinder'

/** The step Up and Down take, in ms; Left and Right take 1 and speed up while held. */
const COARSE_STEP_MS = 10
/**
 * Seconds a held arrow takes to cross the whole delay range: about 100 ms of
 * delay a second at full speed, so a hold covers ground and a release still
 * lands near where the eye said stop. The hold's default (a volume's hundred
 * steps) would cross these seven hundred seven times as fast.
 */
const HOLD_TRAVEL_SEC = (BEAT_DELAY_MAX_MS - BEAT_DELAY_MIN_MS) / 100

/**
 * Options > Beat Detection's delay calibration (`sound/swishCalibration.ts`):
 * one strip, six cells wide and one high. Pressing it starts the swish and
 * a flat cylinder turning once a second (`swishCylinder.ts`, drawn the way
 * the empty scene draws its solid), whose one dark face passes the front,
 * left to right, as the swish peaks and pans, drawn as late as the beat
 * pulse would draw a hit heard at that peak. While it runs, Left and Right move the device's delay by
 * 1 ms (held, faster, on the app's hold curve), Up and Down by 10, until the
 * pass and the peak coincide; Right draws later. Pressing it again, Escape,
 * or leaving Options stops it. At rest the dark face waits at the front.
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
    const scratch = createSolidDrawScratch()
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const width = Math.round(canvas.clientWidth * dpr)
      const height = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
    }
    const paint = (phase: number) => {
      const context = canvas.getContext('2d')
      if (context) drawSolidScene(context, scratch, [{ scene: SWISH_CYLINDER, timeSec: phase * SWISH_PERIOD_SEC, scale: 1, offsetY: 0 }], window.devicePixelRatio || 1)
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
