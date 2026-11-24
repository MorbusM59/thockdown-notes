import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { encodeTooltip } from '@thockdown/interaction/tooltipContent'
import { pulseCurve } from '@thockdown/look/visualizer'
import { useGracedWheel } from '@thockdown/interaction/useGracedWheel'
import { useBoxBevelImages } from '@thockdown/visualizer/shared/boxBevelStore'
import { BEAT_DELAY_MAX_MS, BEAT_DELAY_MIN_MS } from '@thockdown/visualizer/shared/beatSettings'
import { useHoldToAdjust, type HoldToAdjustKeyboardController } from '@thockdown/interaction/useHoldToAdjust'
import { lastHit, type BeatLoop, type BeatLoopPlayer, type LoopRun } from './beatLoops'
import { DRAG_STEP_PX, HOLD_GRACE_PX, HOLD_GRACE_TOUCH_PX } from '@thockdown/interaction/holdTiming'
import './beat.css'

/** The step Up and Down take, in ms; Left and Right take 1 and speed up while held. */
const COARSE_STEP_MS = 10
/** The step a horizontal swipe over the strip takes, in ms, every DRAG_STEP_PX. */
const SWIPE_STEP_MS = 5
/**
 * Seconds a held arrow takes to cross the whole delay range: about 100 ms of
 * delay a second at full speed, so a hold covers ground and a release still
 * lands near where the eye said stop. The hold's default (a volume's hundred
 * steps) would cross these seven hundred seven times as fast.
 */
const HOLD_TRAVEL_SEC = (BEAT_DELAY_MAX_MS - BEAT_DELAY_MIN_MS) / 100

/** Boxes to the strip's height: half a row, a whole row and half a row. */
const ROWS = 2

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
 * Pressing it again or Escape stops it, and so does the strip leaving the screen by any route.
 * A horizontal SWIPE over it (a finger, or a mouse drag) moves the delay by
 * SWIPE_STEP_MS every DRAG_STEP_PX, right later; a swipe neither starts nor
 * stops the loop. A vertical one is left to the page (`data-touch-slider`).
 *
 * The loop is played by the app (`startLoop`), on the music's own path to the
 * speaker, so the delay set here is the music's.
 */
export function BeatLoopCalibration({ loops, delayMs, onChange, falls, fontFamily, fontPerBox, startLoop }: {
  /**
   * The loops the app ships, in the order a right press steps through them.
   * With one there is nothing to step through, and the strip declares no
   * right press: the phone, which has none, ships one.
   */
  loops: readonly BeatLoop[]
  /** Plays a loop where the music plays (beatLoops.ts's BeatLoopPlayer). */
  startLoop: BeatLoopPlayer
  delayMs: number
  onChange: (delayMs: number) => void
  /** The visualizer's own falls for its edge and pane. */
  falls: Readonly<Record<'edge' | 'pane', LoopFall>>
  /** The visualizer's font, the delay's letters are written in. */
  fontFamily: string
  /** The visualizer's font size over its box size, so the letters sit in their boxes as there. */
  fontPerBox: number
}) {
  // The loop playing, by its place in `loops`; null while stopped.
  const [playing, setPlaying] = useState<number | null>(null)
  const running = playing !== null
  // The loop a press starts: the one last played, so stopping and starting again keeps it.
  const lastLoopRef = useRef(0)
  if (playing !== null) lastLoopRef.current = playing
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
    // The loop plays only while the strip can be seen: a sound whose visuals
    // are not on screen calibrates nothing. Not on screen covers every way it
    // goes: its fold closed (a closed <details> renders no content), another
    // fold or Options section opened, the sidebar switched or hidden, the
    // strip scrolled out of view. So no close path has to remember to stop it.
    const visibility = new IntersectionObserver((entries) => {
      if (!entries[entries.length - 1].isIntersecting) setPlaying(null)
    })
    visibility.observe(strip)
    return () => {
      observer.disconnect()
      visibility.disconnect()
    }
  }, [])
  const boxPx = Math.max(0, Math.round(size.height / ROWS))
  // The grid is fixed by the strip alone, a line through its horizontal
  // centre, so it never moves under the pointer as the value changes; the
  // digits take as many boxes as they have, centred on that line, an odd
  // count half a box to the right. The whole row is centred vertically: the
  // rows read half, whole, half.
  const centreX = Math.round(size.width / 2)
  const valueText = String(delayMs)
  const valueLeft = centreX - Math.floor(valueText.length / 2) * boxPx
  const valueTop = Math.round((size.height - boxPx) / 2)
  const originX = boxPx > 0 ? centreX % boxPx : 0
  const originY = boxPx > 0 ? valueTop % boxPx : 0
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
  const startLoopRef = useRef(startLoop)
  const loopsRef = useRef(loops)
  loopsRef.current = loops
  startLoopRef.current = startLoop
  // The swipe: where it began and the delay then, and whether it has moved past the grace (then it is no press).
  const swipeRef = useRef<{ pointerId: number; x: number; base: number; grace: number; swiped: boolean } | null>(null)

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
    const loop = loopsRef.current[playing]
    const run: LoopRun = startLoopRef.current(loop, () => {
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

  const intention = running ? 'Stop' : 'Line the beat up with the drums'
  const steps = loops.length > 1
  return (
    <div className="options-loadout-grid beat-loop-calibration" role="group" aria-label="Line the visuals up with the sound">
      <button
        ref={stripRef}
        type="button"
        className={`options-loadout-btn beat-loop-calibration-strip${running ? ' active' : ''}${failed ? ' failed' : ''}`}
        data-touch-slider=""
        onPointerDown={(event) => {
          if (event.button !== 0) return
          swipeRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            base: delayRef.current,
            grace: event.pointerType === 'touch' ? HOLD_GRACE_TOUCH_PX : HOLD_GRACE_PX,
            swiped: false,
          }
        }}
        onPointerMove={(event) => {
          const swipe = swipeRef.current
          if (!swipe || swipe.pointerId !== event.pointerId) return
          const dx = event.clientX - swipe.x
          if (!swipe.swiped) {
            if (Math.abs(dx) < swipe.grace) return
            swipe.swiped = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          const next = Math.max(BEAT_DELAY_MIN_MS, Math.min(BEAT_DELAY_MAX_MS, swipe.base + Math.trunc(dx / DRAG_STEP_PX) * SWIPE_STEP_MS))
          if (next === delayRef.current) return
          delayRef.current = next
          onChangeRef.current(next)
        }}
        onPointerUp={(event) => {
          // A swipe's release is not a press: the click after it is dropped.
          if (swipeRef.current?.pointerId === event.pointerId && !swipeRef.current.swiped) swipeRef.current = null
        }}
        onPointerCancel={() => { swipeRef.current = null }}
        onClick={() => {
          if (swipeRef.current?.swiped) {
            swipeRef.current = null
            return
          }
          setFailed(false)
          setPlaying((index) => (index === null ? lastLoopRef.current : null))
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          if (!steps) return
          setFailed(false)
          setPlaying((index) => ((index ?? lastLoopRef.current) + (index === null ? 0 : 1)) % loops.length)
        }}
        data-secondary-press={steps ? 'action' : 'none'}
        data-live-tooltip={encodeTooltip({ intention, value: `${delayMs} ms`, gestures: steps ? [{ press: 'right', intention: 'Next loop' }] : [] })}
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
                style={{ left: valueLeft + index * boxPx, top: valueTop, width: boxPx, height: boxPx, lineHeight: `${boxPx}px`, fontFamily, fontSize: `${boxPx * fontPerBox}px` }}
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
