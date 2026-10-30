/**
 * The visualizer's smooth wave: soft bands of the caret's colour, at half its
 * alpha, travelling left to right across the box grid's LINES (the 1px lines
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
 * moves. The inner one carries one repeating band
 * pattern, one period wider than the scene, and is moved by a CSS animation
 * of `transform` alone, one period per cycle, so the loop is seamless and
 * the compositor runs it without the main thread.
 *
 * Self-contained: it reads only the box size, the grid's origin and the
 * cutout, which the scene already has, so it can be switched off or moved
 * into a package without touching anything else.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

/** A wave's length, in boxes, from one band's peak to the next. */
const PERIOD_BOXES = 12
/** Seconds a band takes to travel one period. */
const PERIOD_SEC = 3

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

  const periodPx = PERIOD_BOXES * boxPx
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
            '--grid-wave-period': `${periodPx}px`,
            '--grid-wave-duration': `${PERIOD_SEC}s`,
          } as CSSProperties}
        >
          <div className="visualizer-grid-wave-lines" style={lineMask}>
            <div className="visualizer-grid-wave-bands" />
          </div>
        </div>,
        host,
      ) : null}
    </>
  )
}
