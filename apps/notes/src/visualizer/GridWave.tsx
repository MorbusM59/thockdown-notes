/**
 * The visualizer's smooth wave: soft bands of the layout's wave colour
 * (Options > Visualizer, `--visualizer-wave-color`), travelling left to
 * right across the box grid's LINES (the 1px lines
 * between the boxes, `.thockdown-grid-lines`), brightening them as they pass.
 *
 * It is painted ABOVE the glaze, so the bands keep their colour instead of
 * being blended by the glaze stacks: the wave is portalled to the end of
 * `.app-saturate-wrapper` (the fixed, window-sized layer that holds the glaze)
 * at a z-index just above `.glaze-overlay-stack`. Being outside the scene, it
 * places itself over the scene by measuring an anchor the scene lays out
 * (its full box), and re-measures when that box resizes or the window does.
 * The scene's centre cutout is a hole in the mask, so the image stays clean.
 *
 * A frame repaints nothing. The outer element is masked to everything but
 * the cutout; the one inside it is masked to the grid lines by the same
 * gradients that draw them, at the same tile size and position. Neither
 * moves. Inside the lines sits a square as wide as the scene's diagonal,
 * centred on it, turned with the music's beat by one transform written per
 * frame (`gridWaveTurn.ts`: three nested pivots reduced to the single
 * rotation and shift that draw the same stripes); and inside that, one
 * repeating band pattern, one wave length wider than the square, moved by a
 * CSS animation of `transform` one wave length per cycle, so the loop is
 * seamless. Nothing repaints.
 *
 * The colour, wave length and travel time are the layout's, published as
 * CSS variables by `useBeatFeedback`, and the rotation step and wave length
 * through `gridWaveTurn.ts`'s settings store.
 *
 * Self-contained: it reads only the box size, the grid's origin and the
 * cutout, which the scene already has, so it can be switched off or moved
 * into a package without touching anything else.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { subscribeMusicTempo } from '../sound/musicBeat'
import { WAVE_ANGLES_AT_REST, advanceWaveAngles, readWaveTurnSettings, subscribeWaveTurnSettings, waveTurnTransform } from './gridWaveTurn'

/** A step between two frames' beat positions longer than this is a seek or a new track, not time passing. */
/** A frame further than this from the last is a seek or a stall, not playback. */
const MAX_FRAME_SEC = 0.25
/** How quickly the turning rate follows a change of tempo. */
const TEMPO_EASE_SEC = 2

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

interface SceneBox { left: number; top: number; width: number; height: number }

export function GridWave({ boxPx, originXPx, originYPx, cutout }: {
  boxPx: number
  originXPx: number
  originYPx: number
  /** The centre cutout in scene pixels, left out of the wave; null for none. */
  cutout: { left: number; top: number; size: number } | null
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [sceneBox, setSceneBox] = useState<SceneBox | null>(null)
  const [host, setHost] = useState<Element | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    setHost(anchor.closest('.app-saturate-wrapper'))
    const measure = () => {
      const rect = anchor.getBoundingClientRect()
      setSceneBox(previous => previous && previous.left === rect.left && previous.top === rect.top
        && previous.width === rect.width && previous.height === rect.height
        ? previous
        : { left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(anchor)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const turnRef = useRef<HTMLDivElement>(null)
  const { waveTurn, waveBoxes } = useSyncExternalStore(subscribeWaveTurnSettings, readWaveTurnSettings)
  const widthPx = sceneBox?.width ?? 0
  // The rotation turns at the music's TEMPO (`subscribeMusicTempo`), one
  // transform written per frame on the beat loop's own frame: each frame
  // advances by the time heard over the beat period, so the angle never takes
  // the beat clock's phase jumps when it re-seats after a seek or a change of
  // section. The rate itself follows the period exponentially (time constant
  // `TEMPO_EASE_SEC`), so a new tempo, or a grid found at double or half the
  // last one, is eased into rather than stepped. A frame further than
  // `MAX_FRAME_SEC` from the last (a seek, a stall) moves nothing. Entering
  // the visualizer starts upright; no beat holds the angle reached. Step 0
  // does not listen at all and rests upright.
  useEffect(() => {
    const turn = turnRef.current
    if (!turn) return
    turn.style.transform = ''
    if (waveTurn === 0 || widthPx === 0) return
    const periodPx = waveBoxes * boxPx
    let angles = WAVE_ANGLES_AT_REST
    let lastTime = NaN
    let beatsPerSec = NaN
    return subscribeMusicTempo((timeSec, periodSec) => {
      const dt = timeSec - lastTime
      lastTime = timeSec
      if (!(periodSec > 0)) return
      const target = 1 / periodSec
      if (!(dt > 0 && dt < MAX_FRAME_SEC)) {
        if (Number.isNaN(beatsPerSec)) beatsPerSec = target
        return
      }
      beatsPerSec += (target - beatsPerSec) * (1 - Math.exp(-dt / TEMPO_EASE_SEC))
      if (reducedMotion.matches) return
      angles = advanceWaveAngles(angles, waveTurn, dt * beatsPerSec)
      turn.style.transform = waveTurnTransform(angles, widthPx, periodPx)
    })
  }, [waveTurn, waveBoxes, boxPx, widthPx, host])

  // The rotating layer is a square as wide as the scene's diagonal, centred
  // on the scene, so the bands cover every corner at every angle.
  const turnSide = sceneBox ? Math.ceil(Math.hypot(sceneBox.width, sceneBox.height)) : 0
  const lines = `repeating-linear-gradient(to right, #000 0, #000 1px, transparent 1px, transparent ${boxPx}px), `
    + `repeating-linear-gradient(to bottom, #000 0, #000 1px, transparent 1px, transparent ${boxPx}px)`
  const lineMask: CSSProperties = {
    maskImage: lines,
    maskSize: `${boxPx}px ${boxPx}px`,
    maskPosition: `${originXPx}px ${originYPx}px`,
  }
  // A mask composites each layer onto the ones BELOW it, so "two line sets
  // minus a rectangle" cannot be one element's mask (the union of the lines
  // would have to be formed before the rectangle is taken out). The cutout is
  // therefore the outer element's mask and the lines the inner one's.
  const holeMask: CSSProperties = cutout && cutout.size > 0 ? {
    maskImage: 'linear-gradient(#000, #000), linear-gradient(#000, #000)',
    maskSize: `${cutout.size}px ${cutout.size}px, 100% 100%`,
    maskPosition: `${cutout.left}px ${cutout.top}px, 0 0`,
    maskRepeat: 'no-repeat',
    maskComposite: 'exclude',
  } : {}

  return (
    <>
      <div ref={anchorRef} className="visualizer-grid-wave-anchor" aria-hidden="true" />
      {host && sceneBox ? createPortal(
        <div
          className="visualizer-grid-wave"
          aria-hidden="true"
          style={{
            ...sceneBox,
            ...holeMask,
            '--grid-wave-box': `${boxPx}px`,
          } as CSSProperties}
        >
          <div className="visualizer-grid-wave-lines" style={lineMask}>
            <div
              ref={turnRef}
              className="visualizer-grid-wave-turn"
              style={{
                width: turnSide,
                height: turnSide,
                left: (sceneBox.width - turnSide) / 2,
                top: (sceneBox.height - turnSide) / 2,
              }}
            >
              <div className="visualizer-grid-wave-bands" />
            </div>
          </div>
        </div>,
        host,
      ) : null}
    </>
  )
}
