/**
 * The empty state's tumbling solid (`EmptyStateScene.ts`) drawn into a canvas,
 * the visualizer's cutout face included. A canvas's redraw is composited
 * without repainting the page around it, which the animated SVG mask it
 * replaces could not do.
 *
 * Runs only while `active`, at most every MIN_FRAME_MS: the solid turns once
 * in 14 to 22 seconds, so its edge moves under a pixel a frame and redrawing
 * at the display's full rate would buy nothing. A THUMP (`subscribeThump`,
 * the visualizer's centre pulse) grows the solid about its centre and lets
 * it fall back on the given curve, drawn at the full rate while it lasts.
 *
 * A change of `seed` to `animateTo` (the reader clicked to another solid) is
 * played as a swap (`solidSwapMotion.ts`): the old solid knocked back and
 * falling out of view, the new one swinging in from above with a bounce,
 * both cut out of the same canvas, so the swap repaints nothing around it
 * either. Any other change of seed (a restored choice) simply appears, as
 * does every change under the OS's reduced-motion setting.
 *
 * Drawn on the GPU where WebGL2 runs (`solidShader.ts`), else by the 2D
 * path (`drawSolidScene`); the choice is made once per mount. Either way the
 * canvas rounds its own corners (`cornerRadiusPx`) rather than being clipped
 * by a CSS border-radius, which the compositor draws through a mask layer.
 */

import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { pulseCurve } from '@thockdown/look/visualizer'
import { createSolidDrawScratch, drawSolidScene, emptyStateSolid, type SolidPlacement, type SolidScene } from './EmptyStateScene'
import { createSolidShader } from './solidShader'
import { canUseShaderSolid } from '../visualizer/glazeShaderSupport'
import { useWebGL2Canvas } from '../visualizer/useWebGL2Canvas'
import { arrivalPose, fallPose, hasFallenOut, type SolidPose } from './solidSwapMotion'

const MIN_FRAME_MS = 33

const REST: SolidPose = { offsetY: 0, scale: 1 }

/** The offset, in resting sides, at which a solid at rest size has just left the canvas below or above. */
function edgeOf(canvas: HTMLCanvasElement): number {
  const side = Math.min(canvas.width, canvas.height)
  return side > 0 ? (canvas.height / side + 1) / 2 : 1
}

export type SolidThump = {
  /** How much the solid grows at the hit, as a share of its size (0.1 is 10%). */
  growth: number
  fallSec: number
  /** The fall's curve shape (`pulseCurve`). */
  shape: number
}

export type SolidCanvasProps = {
  seed: string
  /** The seed the reader stepped to: a change of `seed` to it is animated. */
  animateTo?: string | null
  active: boolean
  className?: string
  subscribeThump?: (listener: (thump: SolidThump) => void) => () => void
  /**
   * The most device pixels per CSS pixel the canvas is drawn at. The whole
   * canvas is repainted every frame, which at a phone's ~2.6 density cost
   * more than the rest of the visualizer together; a phone passes 1.5 and
   * takes slightly softer stripes. Unbounded when absent.
   */
  maxPixelRatio?: number
  /** The canvas's corner radius, CSS px. */
  cornerRadiusPx?: number
}

type Faller = { scene: SolidScene; atMs: number; from: SolidPose }
type Swap = { arriving: SolidScene; atMs: number; fallers: Faller[] }

const reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null

export function SolidCanvas(props: SolidCanvasProps) {
  const [useShader] = useState(canUseShaderSolid)
  return useShader ? <SolidCanvasGL {...props} /> : <SolidCanvas2D {...props} />
}

/** What the draw loop reads from the component: the seed's scene, a swap in flight, and how to wake the loop. */
type Motion = {
  sceneRef: MutableRefObject<SolidScene>
  swapRef: MutableRefObject<Swap | null>
  wakeRef: MutableRefObject<() => void>
}

/** The seed's solid, and a change of it played as a swap (see the file's comment). */
function useSolidMotion(canvasRef: RefObject<HTMLCanvasElement | null>, seed: string, animateTo: string | null | undefined, active: boolean): Motion {
  // The seed is read by the draw loop rather than restarting it, so a swap
  // can hold the old solid and the new one at once.
  const sceneRef = useRef<SolidScene>(emptyStateSolid(seed))
  const swapRef = useRef<Swap | null>(null)
  const wakeRef = useRef<() => void>(() => {})

  useEffect(() => {
    const next = emptyStateSolid(seed)
    const previous = sceneRef.current
    if (next === previous) return
    sceneRef.current = next
    if (seed !== animateTo || !active || reducedMotion?.matches) {
      swapRef.current = null
      wakeRef.current()
      return
    }
    const nowMs = performance.now()
    const canvas = canvasRef.current
    const edge = canvas ? edgeOf(canvas) : 1
    const swap = swapRef.current
    // A click while a solid is still arriving knocks it away from wherever it has got to.
    const fromPose = swap ? arrivalPose((nowMs - swap.atMs) / 1000, edge) ?? REST : REST
    const fallers = swap ? swap.fallers : []
    fallers.push({ scene: previous, atMs: nowMs, from: fromPose })
    swapRef.current = { arriving: next, atMs: nowMs, fallers }
    wakeRef.current()
  }, [seed, animateTo, active, canvasRef])

  return { sceneRef, swapRef, wakeRef }
}

/** A renderer the loop draws through: told the canvas's size, then each frame's placements. */
type Renderer = {
  resize: (width: number, height: number, dpr: number) => void
  draw: (placements: readonly SolidPlacement[]) => void
}

/**
 * Runs the draw loop on `canvas` until the returned cleanup: sizes the
 * canvas to its box at the capped pixel ratio, and draws while `active` at
 * most every MIN_FRAME_MS, every frame while a thump or a swap plays.
 */
function runSolidLoop(
  canvas: HTMLCanvasElement,
  renderer: Renderer,
  { sceneRef, swapRef, wakeRef }: Motion,
  active: boolean,
  maxPixelRatio: number,
  subscribeThump: SolidCanvasProps['subscribeThump'],
): () => void {
  let frame: number | null = null
  let lastDrawMs = -Infinity
  let thump: (SolidThump & { atMs: number }) | null = null
  const placements: SolidPlacement[] = []

  const draw = (nowMs: number) => {
    let scale = 1
    if (thump) {
      const elapsed = (nowMs - thump.atMs) / 1000
      if (elapsed >= thump.fallSec || thump.fallSec <= 0) thump = null
      else scale = 1 + thump.growth * pulseCurve(elapsed / thump.fallSec, thump.shape)
    }
    const timeSec = nowMs / 1000
    placements.length = 0
    const swap = swapRef.current
    if (swap) {
      const edge = edgeOf(canvas)
      swap.fallers = swap.fallers.filter((faller) => {
        const pose = fallPose((nowMs - faller.atMs) / 1000, faller.from)
        if (hasFallenOut(pose, edge)) return false
        placements.push({ scene: faller.scene, timeSec, scale: pose.scale * scale, offsetY: pose.offsetY })
        return true
      })
      const pose = arrivalPose((nowMs - swap.atMs) / 1000, edge) ?? REST
      placements.push({ scene: swap.arriving, timeSec, scale: pose.scale * scale, offsetY: pose.offsetY })
      if (pose === REST && swap.fallers.length === 0) swapRef.current = null
    } else {
      placements.push({ scene: sceneRef.current, timeSec, scale, offsetY: 0 })
    }
    renderer.draw(placements)
    lastDrawMs = nowMs
  }
  const tick = (nowMs: number) => {
    frame = null
    if (thump || swapRef.current || nowMs - lastDrawMs >= MIN_FRAME_MS) draw(nowMs)
    if (active) frame = requestAnimationFrame(tick)
  }
  const resize = () => {
    const dpr = Math.min(maxPixelRatio, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
    // Assigning a canvas's size clears it, even to the size it already has.
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    renderer.resize(width, height, dpr)
    draw(performance.now())
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  if (active) frame = requestAnimationFrame(tick)
  wakeRef.current = () => {
    if (frame === null && active) frame = requestAnimationFrame(tick)
    else if (!active) draw(performance.now())
  }
  const unsubscribe = subscribeThump?.((next) => {
    thump = { ...next, atMs: performance.now() }
    if (frame === null && active) frame = requestAnimationFrame(tick)
  })
  return () => {
    observer.disconnect()
    unsubscribe?.()
    if (frame !== null) cancelAnimationFrame(frame)
    wakeRef.current = () => {}
  }
}

function SolidCanvasGL({ seed, animateTo, active, className, subscribeThump, maxPixelRatio = Infinity, cornerRadiusPx = 0 }: SolidCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const motion = useSolidMotion(canvasRef, seed, animateTo, active)
  useWebGL2Canvas(canvasRef, (gl, canvas) => {
    const shader = createSolidShader(gl)
    const stop = runSolidLoop(canvas, {
      resize: shader.resize,
      draw: (placements) => shader.draw(placements, cornerRadiusPx),
    }, motion, active, maxPixelRatio, subscribeThump)
    return () => {
      stop()
      shader.dispose()
    }
  }, [active, subscribeThump, maxPixelRatio, cornerRadiusPx])
  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}

function SolidCanvas2D({ seed, animateTo, active, className, subscribeThump, maxPixelRatio = Infinity, cornerRadiusPx = 0 }: SolidCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const motion = useSolidMotion(canvasRef, seed, animateTo, active)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const scratch = createSolidDrawScratch()
    let dpr = 1
    return runSolidLoop(canvas, {
      resize: (_width, _height, nextDpr) => { dpr = nextDpr },
      draw: (placements) => drawSolidScene(context, scratch, placements, dpr, cornerRadiusPx),
    }, motion, active, maxPixelRatio, subscribeThump)
    // `motion` is refs, stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, subscribeThump, maxPixelRatio, cornerRadiusPx])
  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
