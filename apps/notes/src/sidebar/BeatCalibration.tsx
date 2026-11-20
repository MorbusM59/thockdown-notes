import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { encodeTooltip } from '@thockdown/interaction/tooltipContent'
import { CALIBRATION_MIN_TAPS, startLatencyCalibration } from '../sound/latencyCalibration'
import type { CalibrationProgress, CalibrationRun } from '../sound/latencyCalibration'

/**
 * Options > Beat Detection's tap-along calibration (`sound/latencyCalibration.ts`):
 * a start/stop button and a pad. A press on the pad, or Space while a run is
 * on, is a tap, taken on the PRESS from the event's own timestamp; the first
 * press on an idle pad also starts the run. A finished run stores its result
 * through `onResult`, which moves the delay slider below it. While the click
 * track plays the pad FLASHES on every click, timed exactly as the beat pulse
 * is with the delay the slider holds at that moment, so whether the delay is
 * right can be checked by eye and ear without tapping.
 */
export function BeatCalibration({ delayMs, onResult }: { delayMs: number; onResult: (delayMs: number) => void }) {
  const [progress, setProgress] = useState<CalibrationProgress | null>(null)
  const runRef = useRef<CalibrationRun | null>(null)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const delayRef = useRef(delayMs)
  delayRef.current = delayMs
  const padRef = useRef<HTMLButtonElement>(null)
  const running = progress?.phase === 'running'

  const start = () => {
    runRef.current?.cancel()
    runRef.current = startLatencyCalibration((next) => {
      setProgress(next)
      if (next.phase === 'done') onResultRef.current(next.delayMs)
      if (next.phase !== 'running') runRef.current = null
    }, {
      delaySec: () => delayRef.current / 1000,
      flash: () => padRef.current?.animate([{ filter: 'brightness(2)' }, { filter: 'none' }], { duration: 150, easing: 'ease-out' }),
    })
  }
  const stop = () => {
    runRef.current?.cancel()
    runRef.current = null
    setProgress(null)
  }

  useEffect(() => () => runRef.current?.cancel(), [])

  // Space taps while a run is on, and only then.
  useEffect(() => {
    if (!running) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) runRef.current?.tap(event.timeStamp)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [running])

  const onPadDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    if (runRef.current) runRef.current.tap(event.timeStamp)
    else start()
  }

  const shown = progress?.phase === 'done' ? progress.delayMs : progress?.phase === 'running' ? progress.delayMs : null
  const fill = progress?.phase === 'running' ? Math.min(1, progress.taps / CALIBRATION_MIN_TAPS) : 0

  return (
    <div className="options-loadout-grid beat-calibration" role="group" aria-label="Tap along to time the pulse">
      <button
        type="button"
        className={`options-loadout-btn beat-calibration-toggle${running ? ' active' : ''}`}
        onClick={() => (running ? stop() : start())}
        data-tooltip={running ? 'Stop' : 'Time the pulse to your ears'}
        aria-label={running ? 'Stop timing' : 'Time the pulse to your ears'}
      >
        <i className={`fa-solid ${running ? 'fa-stop' : 'fa-play'}`} aria-hidden="true"></i>
      </button>
      <button
        type="button"
        ref={padRef}
        className={`options-loadout-btn beat-calibration-pad${running ? ' active' : ''}`}
        style={{ ['--calibration-fill' as string]: String(fill) }}
        onPointerDown={onPadDown}
        data-live-tooltip={encodeTooltip({
          intention: running ? 'Tap on every click' : 'Tap along to a click track',
          value: shown === null ? undefined : `${shown} ms`,
        })}
        aria-label={running ? 'Tap on every click' : 'Tap along to a click track'}
      >
        {progress?.phase === 'failed'
          ? <i className="fa-solid fa-xmark" aria-hidden="true"></i>
          : shown !== null
            ? <span className="beat-calibration-value">{progress?.phase === 'done' && <i className="fa-solid fa-check" aria-hidden="true"></i>}{shown}</span>
            : <i className="fa-solid fa-hand-pointer" aria-hidden="true"></i>}
      </button>
    </div>
  )
}
