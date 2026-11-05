// A slowly tumbling monochrome Platonic solid, cut out of the empty-state
// card's faint needle-stripe texture (and out of the visualizer's cutout
// face): the stripes fill the circle and the solid reads as a clean cutout
// tracing through it, edges as crisp transparent seams and faces as softer
// partial cutouts at their own alpha. Drawn into a canvas by SolidCanvas.tsx.
// It was an animated SVG used as a CSS mask, which Chromium re-rasterizes on
// the main thread every frame and which made every frame repaint the whole
// page; a canvas redraw needs no page paint. Seeded off a stable string so a
// given slot keeps the same solid, axis and speed across renders.

function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStringToSeed(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0
  }
  return hash
}

const VIEWBOX = 200

type Vec3 = [number, number, number]
type Vec2 = [number, number]

interface SolidDef {
  vertices: Vec3[]
  // Each face is a cyclic list of vertex indices, already wound so it draws
  // as a simple (non-self-intersecting) polygon.
  faces: number[][]
}

// ---------------------------------------------------------------------------
// Platonic solid definitions. Vertices are normalized to a unit circumradius
// (see normalizeVertices) so every solid reads at the same visual size
// regardless of which one gets picked. Edges are never hand-listed -- they're
// derived from the face windings (see edgesFromFaces) so they can't drift out
// of sync with the faces.
// ---------------------------------------------------------------------------

const TETRAHEDRON: SolidDef = {
  vertices: [
    [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1],
  ],
  faces: [
    [0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2],
  ],
}

const CUBE: SolidDef = {
  vertices: [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ],
  faces: [
    [0, 1, 2, 3], [4, 5, 6, 7],
    [0, 1, 5, 4], [3, 2, 6, 7],
    [0, 3, 7, 4], [1, 2, 6, 5],
  ],
}

const OCTAHEDRON: SolidDef = {
  vertices: [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ],
  faces: [
    [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
    [1, 2, 5], [1, 5, 3], [1, 3, 4], [1, 4, 2],
  ],
}

const PHI = (1 + Math.sqrt(5)) / 2

const ICOSAHEDRON: SolidDef = {
  vertices: [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ],
  faces: [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ],
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return [v[0] / len, v[1] / len, v[2] / len]
}

/** Any two vectors perpendicular to `normal` (and to each other), used to sort points rotationally around it. */
function orthonormalBasis(normal: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const tangent = normalize3(cross3(normal, helper))
  const bitangent = cross3(normal, tangent)
  return [tangent, bitangent]
}

/**
 * The dodecahedron is the icosahedron's dual: one dodecahedron vertex per
 * icosahedron face (its centroid, pushed out to the sphere), and one
 * dodecahedron face per icosahedron vertex (the 5 neighboring centroids,
 * sorted rotationally so they form a simple pentagon instead of a hand-typed
 * -- and easy to get subtly wrong -- coordinate/face table).
 */
function buildDodecahedron(): SolidDef {
  const icoVertices = normalizeVertices(ICOSAHEDRON.vertices)
  const vertices = ICOSAHEDRON.faces.map((face) => {
    let x = 0
    let y = 0
    let z = 0
    for (const idx of face) {
      x += icoVertices[idx][0]
      y += icoVertices[idx][1]
      z += icoVertices[idx][2]
    }
    return normalize3([x / face.length, y / face.length, z / face.length])
  })

  const faces = icoVertices.map((vertex, vertexIndex) => {
    const touchingFaces = ICOSAHEDRON.faces
      .map((face, faceIndex) => (face.includes(vertexIndex) ? faceIndex : -1))
      .filter((faceIndex) => faceIndex !== -1)

    const [refA, refB] = orthonormalBasis(vertex)
    return touchingFaces
      .map((faceIndex) => ({ faceIndex, angle: Math.atan2(dot3(vertices[faceIndex], refB), dot3(vertices[faceIndex], refA)) }))
      .sort((a, b) => a.angle - b.angle)
      .map((entry) => entry.faceIndex)
  })

  return { vertices, faces }
}

function normalizeVertices(vertices: Vec3[]): Vec3[] {
  const radius = Math.hypot(...vertices[0])
  return vertices.map(([x, y, z]) => [x / radius, y / radius, z / radius])
}

function edgesFromFaces(faces: number[][]): Array<[number, number]> {
  const seen = new Set<string>()
  const edges: Array<[number, number]> = []
  for (const face of faces) {
    for (let i = 0; i < face.length; i += 1) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      if (!seen.has(key)) {
        seen.add(key)
        edges.push(a < b ? [a, b] : [b, a])
      }
    }
  }
  return edges
}

const SOLIDS: SolidDef[] = [TETRAHEDRON, CUBE, OCTAHEDRON, ICOSAHEDRON, buildDodecahedron()]

// ---------------------------------------------------------------------------
// Rotation + projection
// ---------------------------------------------------------------------------

/** A uniformly random unit vector, so the tumble axis isn't biased toward the poles. */
function randomUnitAxis(rand: () => number): Vec3 {
  const u = rand() * 2 - 1
  const theta = rand() * Math.PI * 2
  const r = Math.sqrt(Math.max(0, 1 - u * u))
  return [r * Math.cos(theta), r * Math.sin(theta), u]
}

/** Rodrigues' rotation formula: rotates `p` around an arbitrary unit `axis` by `angleRad`. */
function rotateAroundAxis(p: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const k = axis
  const kCrossP = cross3(k, p)
  const kDotP = dot3(k, p)
  return [
    p[0] * cos + kCrossP[0] * sin + k[0] * kDotP * (1 - cos),
    p[1] * cos + kCrossP[1] * sin + k[1] * kDotP * (1 - cos),
    p[2] * cos + kCrossP[2] * sin + k[2] * kDotP * (1 - cos),
  ]
}

/** Simple perspective divide -- points nearer the viewer (more negative z) project larger. */
function project(p: Vec3, scale: number, focal: number, cx: number, cy: number): Vec2 {
  const [x, y, z] = p
  const perspective = focal / (focal + z)
  return [cx + x * scale * perspective, cy + y * scale * perspective]
}

/** The solid's look: alpha quantized to this many discrete steps (a posterized, LCD-like step). */
const QUANTIZE_STEPS = 10
const QUANTIZE_FILTER_ID = 'thockdown-solid-quantize'

/**
 * The quantize as an SVG filter the canvas draws through (`context.filter`),
 * so it runs where the canvas is rasterized: a per-pixel pass in script read
 * the drawing back from the GPU every frame and was the largest script cost
 * in the visualizer at 4x throttle. Added to the document once.
 */
function quantizeFilter(): string {
  if (!document.getElementById(QUANTIZE_FILTER_ID)) {
    const table = Array.from({ length: QUANTIZE_STEPS }, (_, i) => (i / (QUANTIZE_STEPS - 1)).toFixed(4)).join(' ')
    const holder = document.createElement('div')
    holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0" aria-hidden="true"><filter id="${QUANTIZE_FILTER_ID}" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="discrete" tableValues="${table}" /></feComponentTransfer></filter></svg>`
    const svg = holder.firstElementChild
    if (svg) document.body.appendChild(svg)
  }
  return `url(#${QUANTIZE_FILTER_ID})`
}

/**
 * One seeded solid: everything that decides how it looks and turns, fixed per
 * seed. `drawSolidScene` renders it at any moment.
 */
export interface SolidScene {
  vertices: Vec3[]
  faces: number[][]
  edges: Array<[number, number]>
  axis: Vec3
  /** Turn direction, +1 or -1. */
  dir: number
  startPhase: number
  /** Seconds per full turn. */
  durationSec: number
  /** Circumradius and focal length in viewBox units. */
  halfSize: number
  focal: number
  /** Edge width in viewBox units. */
  strokeWidth: number
  /** Each face's own alpha, 0.1 to 0.5. */
  faceAlphas: number[]
}

/**
 * Picks one of the 5 Platonic solids and tumbles it around a fully random
 * 3D axis. Faces are filled at their own random 10-50% opacity -- since
 * they're all the same hue, overlapping translucent faces combine via
 * ordinary alpha compositing regardless of draw order (compositing two
 * same-colour layers is commutative), so no depth sorting is needed. Edges
 * stay fully opaque so they read as crisp seams between facets. The draw
 * quantizes the COMPOSITED alpha to QUANTIZE_STEPS shades, so it clips the
 * stacked-face alpha too, not just each face in isolation. The random draws
 * are taken in the order the earlier SVG generator took them, so a seed
 * still picks the solid it always did.
 */
function buildSolidScene(rand: () => number): SolidScene {
  const solid = SOLIDS[Math.floor(rand() * SOLIDS.length)]
  const vertices = normalizeVertices(solid.vertices)
  const axis = randomUnitAxis(rand)
  const dir = rand() < 0.5 ? 1 : -1
  const startPhase = rand() * Math.PI * 2
  const durationSec = 14 + rand() * 8
  const halfSize = VIEWBOX * (0.34 + rand() * 0.09)
  const focal = halfSize * (2.6 + rand())
  const strokeWidth = 1.6 + rand() * 0.6
  const faceAlphas = solid.faces.map(() => 0.1 + rand() * 0.4)
  return { vertices, faces: solid.faces, edges: edgesFromFaces(solid.faces), axis, dir, startPhase, durationSec, halfSize, focal, strokeWidth, faceAlphas }
}

const sceneCache = new Map<string, SolidScene>()

/** The solid seeded off `seed` (a section id, optionally with a reroll nonce -- see SectionEditorArea.tsx), cached per seed. */
export function emptyStateSolid(seed: string): SolidScene {
  let scene = sceneCache.get(seed)
  if (!scene) {
    scene = buildSolidScene(mulberry32(hashStringToSeed(seed)))
    sceneCache.set(seed, scene)
  }
  return scene
}

/** The 45deg needle stripes the solid is cut out of: 2px of 15% black in every 4px, as the CSS texture it replaces. */
const STRIPE_PERIOD_PX = 4
const STRIPE_INK = 'rgba(0, 0, 0, 0.15)'

/** Reusable buffers for `drawSolidScene`, so a frame allocates nothing. */
export interface SolidDrawScratch {
  alpha: HTMLCanvasElement
  alphaContext: CanvasRenderingContext2D
  stripes: CanvasPattern | null
  stripesDpr: number
}

export function createSolidDrawScratch(): SolidDrawScratch {
  const alpha = document.createElement('canvas')
  const alphaContext = alpha.getContext('2d') as CanvasRenderingContext2D
  return { alpha, alphaContext, stripes: null, stripesDpr: 0 }
}

function stripePattern(context: CanvasRenderingContext2D, scratch: SolidDrawScratch, dpr: number): CanvasPattern | null {
  if (scratch.stripes && scratch.stripesDpr === dpr) return scratch.stripes
  // One tile of the diagonal pattern: a 45deg band repeats every PERIOD px both across and down.
  const tilePx = Math.max(1, Math.round(STRIPE_PERIOD_PX * Math.SQRT2 * dpr))
  const tile = document.createElement('canvas')
  tile.width = tilePx
  tile.height = tilePx
  const t = tile.getContext('2d')
  if (!t) return null
  t.fillStyle = STRIPE_INK
  const band = (2 * Math.SQRT2 * dpr)
  for (let offset = -tilePx; offset <= tilePx; offset += tilePx) {
    t.beginPath()
    // A 45deg gradient runs toward the top right, so its stripes run from top left to bottom right.
    t.moveTo(offset, 0)
    t.lineTo(offset + band, 0)
    t.lineTo(offset + band + tilePx, tilePx)
    t.lineTo(offset + tilePx, tilePx)
    t.closePath()
    t.fill()
  }
  scratch.stripes = context.createPattern(tile, 'repeat')
  scratch.stripesDpr = dpr
  return scratch.stripes
}

/** One solid as drawn: which, at what moment of its turn, how large and where. */
export interface SolidPlacement {
  scene: SolidScene
  timeSec: number
  /** Size about its centre, 1 being the resting size. */
  scale: number
  /** Vertical offset from the resting place, in resting sides (positive is down). */
  offsetY: number
}

/**
 * Draws the stripe texture over the whole canvas with each placed solid cut
 * out of it (faces as partial cutouts at their quantized alpha, edges as
 * clean seams). A solid at rest sits in a centred square as wide as the
 * canvas's shorter side (as `mask-size: contain` placed it); a placement
 * grows it by `scale` about its centre and moves it down by `offsetY` sides.
 * More than one placement is a change of solid in flight (SolidCanvas.tsx).
 */
export function drawSolidScene(
  context: CanvasRenderingContext2D,
  scratch: SolidDrawScratch,
  placements: readonly SolidPlacement[],
  dpr: number,
): void {
  const width = context.canvas.width
  const height = context.canvas.height
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalCompositeOperation = 'source-over'
  context.clearRect(0, 0, width, height)
  const stripes = stripePattern(context, scratch, dpr)
  if (stripes) {
    context.fillStyle = stripes
    context.fillRect(0, 0, width, height)
  }
  const restSide = Math.min(width, height)
  for (const placement of placements) cutOutSolid(context, scratch, placement, restSide, dpr)
}

function cutOutSolid(
  context: CanvasRenderingContext2D,
  scratch: SolidDrawScratch,
  { scene, timeSec, scale, offsetY }: SolidPlacement,
  restSide: number,
  dpr: number,
): void {
  const width = context.canvas.width
  const height = context.canvas.height
  const side = restSide * scale
  const top = (height - side) / 2 + offsetY * restSide
  // Wholly outside the canvas (a solid falling away or not yet arrived): nothing to cut.
  if (top >= height || top + side <= 0) return
  // The cutout is drawn at CSS-pixel resolution and scaled up: the quantize
  // pass reads and writes every pixel of it, so at a device pixel ratio of 2
  // full resolution would cost four times as much for edges already softened
  // by the quantize.
  const size = Math.ceil(side / Math.max(1, dpr))
  if (size <= 0) return
  const { alpha, alphaContext: a } = scratch
  if (alpha.width !== size || alpha.height !== size) {
    alpha.width = size
    alpha.height = size
  }
  a.setTransform(1, 0, 0, 1, 0, 0)
  a.clearRect(0, 0, size, size)
  const unit = size / VIEWBOX
  a.setTransform(unit, 0, 0, unit, 0, 0)
  const angle = scene.startPhase + (scene.dir * Math.PI * 2 * timeSec) / scene.durationSec
  const centre = VIEWBOX / 2
  const projected = scene.vertices.map((vertex) => project(rotateAroundAxis(vertex, scene.axis, angle), scene.halfSize, scene.focal, centre, centre))
  a.fillStyle = '#000'
  scene.faces.forEach((face, faceIndex) => {
    a.globalAlpha = scene.faceAlphas[faceIndex]
    a.beginPath()
    face.forEach((vertexIndex, i) => {
      const [x, y] = projected[vertexIndex]
      if (i === 0) a.moveTo(x, y)
      else a.lineTo(x, y)
    })
    a.closePath()
    a.fill()
  })
  a.globalAlpha = 1
  a.strokeStyle = '#000'
  a.lineWidth = scene.strokeWidth
  a.lineCap = 'round'
  a.beginPath()
  for (const [from, to] of scene.edges) {
    a.moveTo(projected[from][0], projected[from][1])
    a.lineTo(projected[to][0], projected[to][1])
  }
  a.stroke()

  // Cut out through the quantize: the COMPOSITED alpha of the faces and
  // edges, stepped to QUANTIZE_STEPS values from 0 to 1.
  context.filter = quantizeFilter()
  context.globalCompositeOperation = 'destination-out'
  context.drawImage(alpha, (width - side) / 2, top, side, side)
  context.globalCompositeOperation = 'source-over'
  context.filter = 'none'
}
