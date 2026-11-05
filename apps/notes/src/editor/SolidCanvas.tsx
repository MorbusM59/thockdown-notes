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
 */

import { useEffect, useRef } from 'react'
import { pulseCurve } from '@thockdown/look/visualizer'
import { createSolidDrawScratch, drawSolidScene, emptyStateSolid } from './EmptyStateScene'

const MIN_FRAME_MS = 33

export type SolidThump = {
  /** How much the solid grows at the hit, as a share of its size (0.1 is 10%). */
  growth: number
  fallSec: number
  /** The fall's curve shape (`pulseCurve`). */
  shape: number
}

export type SolidCanvasProps = {
  seed: string
  active: boolean
  className?: string
  subscribeThump?: (listener: (thump: SolidThump) => void) => () => void
}

export function SolidCanvas({ seed, active, className, subscribeThump }: SolidCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const scene = emptyStateSolid(seed)
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
      drawSolidScene(context, scratch, scene, nowMs / 1000, dpr, scale)
      lastDrawMs = nowMs
    }
    const tick = (nowMs: number) => {
      frame = null
      if (thump || nowMs - lastDrawMs >= MIN_FRAME_MS) draw(nowMs)
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
    const unsubscribe = subscribeThump?.((next) => {
      thump = { ...next, atMs: performance.now() }
      if (frame === null && active) frame = requestAnimationFrame(tick)
    })
    return () => {
      observer.disconnect()
      unsubscribe?.()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [seed, active, subscribeThump])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
