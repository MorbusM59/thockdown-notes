/**
 * How the grid closes around the visualizer's centre cutout when the cutout's
 * face has rounded corners.
 *
 * The cutout is a square of whole boxes. Along a straight side the grid's own
 * pattern already borders it: the box-outline band (`--color-grid-outline`)
 * and, over it, the 1px grid line (`--color-grid-bg`). With the face rounded,
 * the boxes run on into the corners and are closed off by the same two lines
 * bent round the face: an OUTLINE RING two pixels wide (the band's two
 * visible pixels) and, on top of its inner pixel, a GRID RING one pixel wide.
 * Every grid layer leaves out the rounded square the outline ring encloses,
 * and each layer that draws a line kind draws its ring: the outline layer and
 * the beat pane's copy of it (`useBeatGridMirror.ts`) the outline ring, the
 * grid-line layer and the grid wave the grid ring.
 *
 * At roundness 0 the rings ARE the pattern's straight lines, so nothing here
 * applies: the hole is the face's own square, exactly as it always was.
 */

import type { CSSProperties } from 'react'

export interface CutoutRect {
  left: number
  top: number
  size: number
}

/** One ring: a square at `left`/`top` of side `size`, drawn by `mask` (an image of exactly that size). */
export interface CutoutRing {
  left: number
  top: number
  size: number
  mask: string
}

export interface CutoutClosure {
  /** The face's corner radius, px. */
  faceRadiusPx: number
  /** Mask for a grid layer: everything except the hole (the face's square at 0, the outline ring's outer shape above it). */
  hole: CSSProperties
  /** The rings, or null at roundness 0. */
  outlineRing: CutoutRing | null
  gridRing: CutoutRing | null
}

const OUTLINE_RING_PX = 2
const GRID_RING_PX = 1

function roundedSquarePath(offset: number, side: number, radius: number): string {
  const a = offset
  const b = offset + side
  const r = Math.max(0, Math.min(radius, side / 2))
  if (r === 0) return `M${a},${a}H${b}V${b}H${a}Z`
  return `M${a + r},${a}H${b - r}A${r},${r} 0 0 1 ${b},${a + r}V${b - r}A${r},${r} 0 0 1 ${b - r},${b}H${a + r}A${r},${r} 0 0 1 ${a},${b - r}V${a + r}A${r},${r} 0 0 1 ${a + r},${a}Z`
}

function svgUrl(side: number, path: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${side}' height='${side}' viewBox='0 0 ${side} ${side}'><path fill-rule='evenodd' d='${path}'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** A rounded square of side `side`, filled. */
export function roundedSquareMask(side: number, radius: number): string {
  return svgUrl(side, roundedSquarePath(0, side, radius))
}

/** A ring `width` wide inside a rounded square of side `side`, its inner edge concentric. */
export function roundedRingMask(side: number, radius: number, width: number): string {
  return svgUrl(side, roundedSquarePath(0, side, radius) + roundedSquarePath(width, side - 2 * width, radius - width))
}

function ring(face: CutoutRect, faceRadius: number, width: number): CutoutRing {
  const size = face.size + 2 * width
  return { left: face.left - width, top: face.top - width, size, mask: roundedRingMask(size, faceRadius + width, width) }
}

export function cutoutClosure(face: CutoutRect, round: number): CutoutClosure {
  const faceRadiusPx = Math.max(0, Math.min(1, round)) * face.size / 2
  if (faceRadiusPx === 0) {
    return {
      faceRadiusPx: 0,
      hole: {
        maskImage: 'linear-gradient(#000, #000), linear-gradient(#000, #000)',
        maskSize: `100% 100%, ${face.size}px ${face.size}px`,
        maskPosition: `0 0, ${face.left}px ${face.top}px`,
        maskRepeat: 'no-repeat',
        maskComposite: 'exclude',
      },
      outlineRing: null,
      gridRing: null,
    }
  }
  const outer = face.size + 2 * OUTLINE_RING_PX
  return {
    faceRadiusPx,
    hole: {
      maskImage: `linear-gradient(#000, #000), ${roundedSquareMask(outer, faceRadiusPx + OUTLINE_RING_PX)}`,
      maskSize: `100% 100%, ${outer}px ${outer}px`,
      maskPosition: `0 0, ${face.left - OUTLINE_RING_PX}px ${face.top - OUTLINE_RING_PX}px`,
      maskRepeat: 'no-repeat',
      maskComposite: 'exclude',
    },
    outlineRing: ring(face, faceRadiusPx, OUTLINE_RING_PX),
    gridRing: ring(face, faceRadiusPx, GRID_RING_PX),
  }
}
