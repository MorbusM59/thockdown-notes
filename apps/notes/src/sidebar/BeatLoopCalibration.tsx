import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { encodeTooltip } from '@thockdown/interaction/tooltipContent'
import { pulseCurve } from '@thockdown/look/visualizer'
import { useGracedWheel } from '@thockdown/interaction/useGracedWheel'
import { useBoxBevelImages } from '../shared/boxBevelStore'
import { BEAT_DELAY_MAX_MS, BEAT_DELAY_MIN_MS } from '../shared/beatSettings'
import { useHoldToAdjust, type HoldToAdjustKeyboardController } from '../shared/useHoldToAdjust'
import { BEAT_LOOPS, lastHit, startBeatLoop, type LoopRun } from '../sound/beatLoopCalibration'

/** The step Up and Down take, in ms; Left and Right take 1 and speed up while held. */
const COARSE_STEP_MS = 10
/**
 * Seconds a held arrow takes to cross the whole delay range: about 100 ms of
 * delay a second at full speed, so a hold covers ground and a release still
 * lands near where the eye said stop. The hold's default (a volume's hundred
 * steps) would cross these seven hundred seven times as fast.
 */
const HOLD_TRAVEL_SEC = (BEAT_DELAY_MAX_MS - BEAT_DELAY_MIN_MS) / 100

/** Boxes to the strip's height: half a row, a whole row and half a row. */
const ROWS = 2
/** The delay's boxes, centred on the middle row: room for -200. */
const VALUE_BOXES = 4

/** A fall as the visualizer's settings carry it (`VisualizerChannel`): its length and the shape of `pulseCurve`. */
export interface LoopFall {
  fallSec: number
  shape: number
}

/**
 * The two effects, as the visualizer draws them: the kick on the EDGE, the
 * snare on the box OUTLINES (the pane) with the hats at a third of their
 * strength there too. Each falls as the visualizer's own setting for it falls.
 */
const EFFECTS = [
  { variable: '--loop-edge', channels: [{ channel: 'thump', weight: 1 }], fall: 'edge' },
  { variable: '--loop-outline', channels: [{ channel: 'pierce', weight: 1 }, { channel: 'tick', weight: 1 / 3 }], fall: 'pane' },
] as const

/**
 * Options > Beat Detection's delay calibration (`sound/beatLoopCalibration.ts`):
 * one strip, six cells wide and one high. Pressing it plays a drum loop whose
 * hits are known, over a row of the visualizer's boxes, and shows them as
 * the visualizer would: the kick on the edge, the snare on the box outlines
 * and the hats there at a third, each falling as the visualizer's setting for
 * it does, drawn as late as the beat pulse would draw them. While it runs, Left and Right move
 * the device's delay by 1 ms (held, faster, on the app's hold curve), Up and
 * Down by 10 (the wheel over it as over a slider: a notch 1, with Shift 10),
 * until the effects land on the hits; Right draws later.
 * Pressing it again, Escape, or leaving Options stops it.
 */
export function BeatLoopCalibration({ delayMs, onChange, falls, fontFamily, fontPerBox }: {
  delayMs: number
  onChange: (delayMs: number) => void
  /** The visualizer's own falls for its edge and pane. */
  falls: Readonly<Record<'edge' | 'pane', LoopFall>>
  /** The visualizer's font, the delay's letters are written in. */
  fontFamily: string
  /** The visualizer's font size over its box size, so the letters sit in their boxes as there. */
  fontPerBox: number
}) {
  // The loop playing, by its place in BEAT_LOOPS; null while stopped.
  const [playing, setPlaying] = useState<number | null>(null)
  const running = playing !== null
  const [failed, setFailed] = useState(false)
  const stripRef = useRef<HTMLButtonElement>(null)
  const fallsRef = useRef(falls)
  fallsRef.current = falls
  // The strip's size: the box is a quarter of its height, in whole pixels.
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const observer = new ResizeObserver(() => setSize({ width: strip.clientWidth, height: strip.clientHeight }))
    observer.observe(strip)
    return () => observer.disconnect()
  }, [])
  const boxPx = Math.max(0, Math.round(size.height / ROWS))
  // Grid lines through the strip's horizontal centre, and the whole row centred
  // vertically: the rows read half, whole, half.
  const centreX = Math.round(size.width / 2)
  const valueTop = Math.round((size.height - boxPx) / 2)
  const originX = boxPx > 0 ? centreX % boxPx : 0
  const originY = boxPx > 0 ? valueTop % boxPx : 0
  const valueText = String(delayMs).padStart(VALUE_BOXES, ' ')
  // The wheel over the strip moves the delay as it moves a slider: a notch a millisecond, ten with Shift, up raising it.
  useGracedWheel(stripRef, useCallback((event: WheelEvent) => {
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (delta === 0) return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey ? COARSE_STEP_MS : 1
    const next = Math.max(BEAT_DELAY_MIN_MS, Math.min(BEAT_DELAY_MAX_MS, delayRef.current + (delta > 0 ? -step : step)))
    if (next === delayRef.current) return
    delayRef.current = next
    onChangeRef.current(next)
  }, []))
  const bevel = useBoxBevelImages(Math.max(1, boxPx), Math.max(1, boxPx))
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
    if (playing === null || !strip) return
    const loop = BEAT_LOOPS[playing]
    const run: LoopRun = startBeatLoop(loop, () => {
      setFailed(true)
      setPlaying(null)
    })
    const written = EFFECTS.map(() => '')
    let frame = requestAnimationFrame(function tick(frameTimeMs) {
      const barSec = run.heardBarSec(frameTimeMs, delayRef.current / 1000)
      EFFECTS.forEach(({ variable, channels, fall }, index) => {
        let response = 0
        if (!Number.isNaN(barSec)) {
          const { fallSec, shape } = fallsRef.current[fall]
          for (const { channel, weight } of channels) {
            const { strength, agoSec } = lastHit(loop, channel, barSec)
            response = Math.max(response, weight * strength * pulseCurve(fallSec > 0 ? agoSec / fallSec : Infinity, shape))
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
  }, [playing])

  // The keys, only while running, ahead of everything else (the window's capture phase).
  useEffect(() => {
    if (!running) return
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key
      if (key === 'Escape') setPlaying(null)
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

  const intention = running ? 'Next loop' : 'Line the beat up with the drums'
  return (
    <div className="options-loadout-grid beat-loop-calibration" role="group" aria-label="Line the visuals up with the sound">
      <button
        ref={stripRef}
        type="button"
        className={`options-loadout-btn beat-loop-calibration-strip${running ? ' active' : ''}${failed ? ' failed' : ''}`}
        onClick={() => {
          setFailed(false)
          setPlaying((index) => (index === null ? 0 : (index + 1) % BEAT_LOOPS.length))
        }}
        data-live-tooltip={encodeTooltip({ intention, value: `${delayMs} ms` })}
        aria-label={intention}
      >
        {boxPx > 1 && (
          <span
            className="beat-loop-calibration-grid"
            aria-hidden="true"
            style={{
              '--loop-grid-x': `${originX}px`,
              '--loop-grid-y': `${originY}px`,
              '--editor-cell-width': `${boxPx}px`,
              '--editor-line-height': `${boxPx}px`,
              '--grid-outline-tile': bevel.tile,
              '--box-shading': bevel.shading,
            } as CSSProperties}
          >
            <span className="thockdown-grid-outline-lines beat-loop-calibration-layer is-outline" />
            <span className="thockdown-grid-lines beat-loop-calibration-layer" />
            <span className="thockdown-grid-outline-lines beat-loop-calibration-layer is-outline is-outline-hit" />
            {Array.from(valueText).map((char, index) => (
              <span
                key={index}
                className="beat-loop-calibration-letter"
                style={{ left: centreX + (index - VALUE_BOXES / 2) * boxPx, top: valueTop, width: boxPx, height: boxPx, lineHeight: `${boxPx}px`, fontFamily, fontSize: `${boxPx * fontPerBox}px` }}
              >
                {char}
              </span>
            ))}
            <span className="beat-loop-calibration-edge" />
          </span>
        )}
      </button>
    </div>
  )
}
