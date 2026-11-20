import { SOLID_VIEWBOX, type SolidScene } from '../editor/EmptyStateScene'

/**
 * The solid the swish calibration turns (`SwishCalibration.tsx`): a flat
 * cylinder, height 1 and radius 6, its mantle 96 faces, turning once a second
 * about its own vertical axis, seen straight on from mid-height at the
 * distance at which the whole of it just fills a frame six wide and one high.
 * Drawn by the empty scene's own `drawSolidScene`, so it is the empty scene's
 * look: the stripes with the solid cut out, alpha quantized.
 *
 * Every mantle face is 30% opaque, the top and bottom 15%, and ONE mantle
 * face 60%: the marker. At `timeSec` 0.5 (and every whole second after) the
 * marker is at the front, centred, moving left to right, as the swish peaks
 * and pans; `swishCylinder.test.ts` holds that.
 */

export const CYLINDER_RADIUS = 6
export const CYLINDER_HEIGHT = 1
export const MANTLE_FACES = 96
const ASPECT = 6
/** The frame's share the cylinder fills, so its outline is not clipped by the canvas edge. */
const FILL = 0.94
const MANTLE_ALPHA = 0.3
const CAP_ALPHA = 0.15
const MARKER_ALPHA = 0.6

/** Half the projected width over half the projected height at camera distance `d`, eye at mid-height. */
function projectedAspect(d: number): number {
  let halfWidth = 0
  for (let i = 0; i <= 2000; i++) {
    const z = -CYLINDER_RADIUS + (2 * CYLINDER_RADIUS * i) / 2000
    halfWidth = Math.max(halfWidth, (Math.sqrt(Math.max(0, CYLINDER_RADIUS ** 2 - z * z)) * d) / (d + z))
  }
  const halfHeight = ((CYLINDER_HEIGHT / 2) * d) / (d - CYLINDER_RADIUS)
  return halfWidth / halfHeight
}

/** The distance at which the cylinder's outline is exactly as wide as the frame for its height (the aspect falls as the camera nears). */
function fittingDistance(): number {
  let near = CYLINDER_RADIUS * 1.0001
  let far = CYLINDER_RADIUS * 1000
  for (let i = 0; i < 80; i++) {
    const mid = (near + far) / 2
    if (projectedAspect(mid) > ASPECT) far = mid
    else near = mid
  }
  return (near + far) / 2
}

function buildCylinder(): SolidScene {
  const distance = fittingDistance()
  const vertices: Array<[number, number, number]> = []
  // Face 0 (the marker) is centred on the front (towards the camera, -z) before any turn.
  for (const y of [-CYLINDER_HEIGHT / 2, CYLINDER_HEIGHT / 2]) {
    for (let i = 0; i < MANTLE_FACES; i++) {
      const angle = ((i - 0.5) * 2 * Math.PI) / MANTLE_FACES
      vertices.push([CYLINDER_RADIUS * Math.sin(angle), y, -CYLINDER_RADIUS * Math.cos(angle)])
    }
  }
  const faces: number[][] = []
  const faceAlphas: number[] = []
  for (let i = 0; i < MANTLE_FACES; i++) {
    const next = (i + 1) % MANTLE_FACES
    faces.push([i, next, MANTLE_FACES + next, MANTLE_FACES + i])
    faceAlphas.push(i === 0 ? MARKER_ALPHA : MANTLE_ALPHA)
  }
  for (const ring of [0, MANTLE_FACES]) {
    faces.push(Array.from({ length: MANTLE_FACES }, (_, i) => ring + i))
    faceAlphas.push(CAP_ALPHA)
  }
  const halfHeight = ((CYLINDER_HEIGHT / 2) * distance) / (distance - CYLINDER_RADIUS)
  return {
    vertices,
    faces,
    // The two rims and the marker's two sides. The faces alone barely show: they
    // cut 30% out of stripes of 15% ink. The empty scene's solids show through
    // their edges, but 96 mantle seams would hatch the whole strip.
    edges: [
      ...Array.from({ length: MANTLE_FACES }, (_, i): [number, number] => [i, (i + 1) % MANTLE_FACES]),
      ...Array.from({ length: MANTLE_FACES }, (_, i): [number, number] => [MANTLE_FACES + i, MANTLE_FACES + (i + 1) % MANTLE_FACES]),
      [0, MANTLE_FACES],
      [1, MANTLE_FACES + 1],
    ],
    axis: [0, 1, 0],
    // A turn by +angle about +y moves the front leftwards on screen, so the turn runs negative.
    dir: -1,
    // At timeSec 0.5 the turn is at a whole revolution: the marker in front.
    startPhase: Math.PI,
    durationSec: 1,
    halfSize: (FILL * SOLID_VIEWBOX) / 2 / halfHeight,
    focal: distance,
    // Viewbox units: the frame is ~30 px high, so this is about a pixel.
    strokeWidth: 8,
    faceAlphas,
    aspect: ASPECT,
  }
}

export const SWISH_CYLINDER: SolidScene = buildCylinder()
