import { useEffect, useRef, useState } from 'react'
import { encodeTooltip } from '@thockdown/interaction/tooltipContent'
import { pulseCurve } from '@thockdown/look/visualizer'
import { BEAT_DELAY_MAX_MS, BEAT_DELAY_MIN_MS } from '../shared/beatSettings'
import { useHoldToAdjust, type HoldToAdjustKeyboardController } from '../shared/useHoldToAdjust'
import { lastHit, startBeatLoop, type LoopChannel, type LoopRun } from '../sound/beatLoopCalibration'

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
 * The two effects, at a fixed and fairly strong setting: what each follows
 * (a share of each channel's hit, the largest taken), and its fall on the
 * grid beat's own curve (`pulseCurve`). The edge takes the kick and the
 * snare, the pane the snare and, faintly, the hats, so all three are seen.
 */
const EFFECTS: ReadonlyArray<{ variable: string; mix: Readonly<Record<LoopChannel, number>>; fallSec: number; shape: number }> = [
  { variable: '--loop-edge', mix: { thump: 1, pierce: 0.7, tick: 0 }, fallSec: 0.3, shape: 0 },
  { variable: '--loop-pane', mix: { thump: 0, pierce: 0.8, tick: 0.5 }, fallSec: 0.18, shape: 0 },
]

/**
 * Options > Beat Detection's delay calibration (`sound/beatLoopCalibration.ts`):
 * one strip, six cells wide and one high. Pressing it plays a drum loop whose
 * hits are known, and the strip shows the grid beat's two effects on them,
 * an edge glow (kick and snare) and a pane flash (snare and hats), drawn as
 * late as the beat pulse would draw them. While it runs, Left and Right move
 * the device's delay by 1 ms (held, faster, on the app's hold curve), Up and
 * Down by 10, until the effects land on the hits; Right draws later.
 * Pressing it again, Escape, or leaving Options stops it.
 */
export function BeatLoopCalibration({ delayMs, onChange }: { delayMs: number; onChange: (delayMs: number) => void }) {
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState(false)
  const stripRef = useRef<HTMLButtonElement>(null)
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

  // The frame loop, only while running: each effect's response written to the strip.
  useEffect(() => {
    const strip = stripRef.current
    if (!running || !strip) return
    const run: LoopRun = startBeatLoop(() => {
      setFailed(true)
      setRunning(false)
    })
    const written = EFFECTS.map(() => '')
    let frame = requestAnimationFrame(function tick(frameTimeMs) {
      const barSec = run.heardBarSec(frameTimeMs, delayRef.current / 1000)
      EFFECTS.forEach(({ variable, mix, fallSec, shape }, index) => {
        let response = 0
        if (!Number.isNaN(barSec)) {
          for (const channel of ['thump', 'pierce', 'tick'] as const) {
            if (mix[channel] === 0) continue
            const { strength, agoSec } = lastHit(channel, barSec)
            response = Math.max(response, mix[channel] * strength * pulseCurve(agoSec / fallSec, shape))
          }
        }
        // Quantized to the 1/255 a colour channel resolves, as the grid beat is; an unchanged value is not written.
        const value = (Math.round(response * 255) / 255).toFixed(4)
        if (value !== written[index]) strip.style.setProperty(variable, (written[index] = value))
      })
      frame = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(frame)
      run.stop()
      for (const { variable } of EFFECTS) strip.style.removeProperty(variable)
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

  const intention = running ? 'Stop' : 'Line the beat up with the drums'
  return (
    <div className="options-loadout-grid beat-loop-calibration" role="group" aria-label="Line the visuals up with the sound">
      <button
        ref={stripRef}
        type="button"
        className={`options-loadout-btn beat-loop-calibration-strip${running ? ' active' : ''}${failed ? ' failed' : ''}`}
        onClick={() => {
          setFailed(false)
          setRunning((on) => !on)
        }}
        data-live-tooltip={encodeTooltip({ intention, value: `${delayMs} ms` })}
        aria-label={intention}
      >
        <span className="beat-loop-calibration-pane" aria-hidden="true" />
        <span className="beat-loop-calibration-edge" aria-hidden="true" />
        {running
          ? <span className="beat-loop-calibration-value">{delayMs}</span>
          : <i className="fa-solid fa-drum" aria-hidden="true"></i>}
      </button>
    </div>
  )
}
