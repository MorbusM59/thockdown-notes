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
import { subscribeMusicBeats } from '../sound/musicBeat'
import { WAVE_ANGLES_AT_REST, advanceWaveAngles, readWaveTurnSettings, subscribeWaveTurnSettings, waveTurnTransform } from './gridWaveTurn'

/** A step between two frames' beat positions longer than this is a seek or a new track, not time passing. */
const MAX_BEAT_STEP = 1

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
  // The rotation follows the music's steady beat (`subscribeMusicBeats`),
  // one transform written per frame on the beat loop's own frame. Entering
  // the visualizer starts upright; no beat (paused, no tempo found yet)
  // holds the angle reached, and the next beat carries on from it. Step 0
  // does not listen at all and rests upright.
  useEffect(() => {
    const turn = turnRef.current
    if (!turn) return
    turn.style.transform = ''
    if (waveTurn === 0 || widthPx === 0) return
    const periodPx = waveBoxes * boxPx
    let angles = WAVE_ANGLES_AT_REST
    let last = NaN
    return subscribeMusicBeats((beats) => {
      const step = beats - last
      last = beats
      if (!(step > 0 && step < MAX_BEAT_STEP) || reducedMotion.matches) return
      angles = advanceWaveAngles(angles, waveTurn, step)
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
