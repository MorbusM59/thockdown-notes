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
 */

import { useEffect, useRef } from 'react'
import { pulseCurve } from '@thockdown/look/visualizer'
import { createSolidDrawScratch, drawSolidScene, emptyStateSolid, type SolidPlacement, type SolidScene } from './EmptyStateScene'
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
}

type Faller = { scene: SolidScene; atMs: number; from: SolidPose }
type Swap = { arriving: SolidScene; atMs: number; fallers: Faller[] }

const reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null

export function SolidCanvas({ seed, animateTo, active, className, subscribeThump }: SolidCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
  }, [seed, animateTo, active])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const scratch = createSolidDrawScratch()
    let dpr = window.devicePixelRatio || 1
    let frame: number | null = null
    let lastDrawMs = -Infinity
    let thump: (SolidThump & { atMs: number }) | null = null

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
      drawSolidScene(context, scratch, placements, dpr)
      lastDrawMs = nowMs
    }
    const placements: SolidPlacement[] = []
    const tick = (nowMs: number) => {
      frame = null
      if (thump || swapRef.current || nowMs - lastDrawMs >= MIN_FRAME_MS) draw(nowMs)
      if (active) frame = requestAnimationFrame(tick)
    }
    const resize = () => {
      dpr = window.devicePixelRatio || 1
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
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
  }, [active, subscribeThump])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
