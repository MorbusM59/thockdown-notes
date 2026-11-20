import { SOLID_VIEWBOX, type SolidScene } from '../editor/EmptyStateScene'

/**
 * The solid the swish calibration turns (`SwishCalibration.tsx`): a flat
 * cylinder, height 1 and radius 6, its mantle 96 faces, turning once a second
 * about its own vertical axis, seen from INSIDE: the camera stands
 * `CAMERA_DISTANCE` from the axis, `CAMERA_HEIGHT` above the floor, looking
 * straight at the far wall, which fills the frame's height. Drawn by the
 * empty scene's own `drawSolidScene` (`SolidScene.eyeDistance` clips what is
 * behind the camera), so it is the empty scene's look: the stripes with the
 * solid cut out, alpha quantized.
 *
 * Every mantle face is 30% opaque, the top and bottom 15%, and ONE mantle
 * face 60%: the marker. At `timeSec` 0.5 (and every whole second after) the
 * marker is straight ahead on the far wall, moving left to right, as the
 * swish peaks and pans; `swishCylinder.test.ts` holds that.
 */

/** From the axis, away from the wall looked at: 0 is the centre, towards CYLINDER_RADIUS is against the wall behind. */
export const CAMERA_DISTANCE = 0
/** Above the floor: 0 is the floor, CYLINDER_HEIGHT the ceiling, 0.5 the middle of the wall. */
export const CAMERA_HEIGHT = 0.5

export const CYLINDER_RADIUS = 6
export const CYLINDER_HEIGHT = 1
export const MANTLE_FACES = 96
const ASPECT = 6
/** The share of the frame's height the far wall fills. */
const FILL = 0.94
const MANTLE_ALPHA = 0.3
const CAP_ALPHA = 0.15
const MARKER_ALPHA = 0.6

function buildCylinder(): SolidScene {
  const vertices: Array<[number, number, number]> = []
  // Face 0 (the marker) is centred on the far wall (+z) before any turn. y runs down the screen, from the camera's height.
  for (const height of [CYLINDER_HEIGHT, 0]) {
    for (let i = 0; i < MANTLE_FACES; i++) {
      const angle = ((i - 0.5) * 2 * Math.PI) / MANTLE_FACES
      vertices.push([CYLINDER_RADIUS * Math.sin(angle), CAMERA_HEIGHT - height, CYLINDER_RADIUS * Math.cos(angle)])
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
  // The far wall's farther edge from the camera's height reaches the frame's edge.
  const reach = Math.max(CAMERA_HEIGHT, CYLINDER_HEIGHT - CAMERA_HEIGHT)
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
    // A turn by +angle about +y moves the far wall rightwards on screen.
    dir: 1,
    // At timeSec 0.5 the turn is at a whole revolution: the marker straight ahead.
    startPhase: Math.PI,
    durationSec: 1,
    halfSize: ((FILL * SOLID_VIEWBOX) / 2) * (CAMERA_DISTANCE + CYLINDER_RADIUS) / reach,
    focal: 1,
    eyeDistance: CAMERA_DISTANCE,
    // Viewbox units: the frame is ~30 px high, so this is about a pixel.
    strokeWidth: 8,
    faceAlphas,
    aspect: ASPECT,
  }
}

export const SWISH_CYLINDER: SolidScene = buildCylinder()
