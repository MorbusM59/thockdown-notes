// Generates a slowly tumbling monochrome Platonic solid as an SVG, used
// purely as a CSS mask shape -- the visible "ink" is always whatever
// background sits behind it (the empty-state card's diagonal stripe
// texture), this file only decides where that texture is allowed to show
// through. The rotation itself is baked in at generation time as a SMIL
// <animate> per edge/face, cycling through pre-computed true-3D-projected
// frames -- there is no JS render loop driving it, it's a self-contained
// animated image resource exactly like an animated GIF used as a
// background-image. Seeded off a stable string (the section id, optionally
// combined with a reroll nonce -- see SectionEditorArea.tsx) so a given
// empty slot keeps the same solid/axis/speed across renders instead of
// reshuffling on every repaint.

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

const FRAME_COUNT = 36

// 10 discrete alpha steps between fully transparent and fully opaque -- see
// buildRotatingSolid's <filter>.
const QUANTIZE_STEPS = 10
const QUANTIZE_TABLE_VALUES = Array.from({ length: QUANTIZE_STEPS }, (_, i) => (i / (QUANTIZE_STEPS - 1)).toFixed(4)).join(' ')

/**
 * Picks one of the 5 Platonic solids and tumbles it around a fully random
 * 3D axis. Faces are filled at their own random 10-50% opacity -- since
 * they're all the same hue (black), overlapping translucent faces combine
 * via ordinary alpha compositing regardless of draw order (compositing two
 * same-color layers is commutative), so no per-frame depth sorting is
 * needed even though the visible stacking is correct as the solid turns.
 * Edges stay fully opaque so they read as crisp seams between facets.
 * Everything is wrapped in an <feComponentTransfer> filter that quantizes
 * the final alpha to 10 discrete shades (a posterized, LCD-like step
 * instead of smooth blending) -- applied to the *composited* result, so it
 * clips the stacked-face alpha too, not just each face in isolation.
 */
function buildRotatingSolid(rand: () => number): string {
  const solid = SOLIDS[Math.floor(rand() * SOLIDS.length)]
  const vertices = normalizeVertices(solid.vertices)
  const edges = edgesFromFaces(solid.faces)

  const axis = randomUnitAxis(rand)
  const dir = rand() < 0.5 ? 1 : -1
  const startPhase = rand() * Math.PI * 2
  const durationSec = 14 + rand() * 8
  const halfSize = VIEWBOX * (0.34 + rand() * 0.09)
  const focal = halfSize * (2.6 + rand())
  const cx = VIEWBOX / 2
  const cy = VIEWBOX / 2
  const strokeWidth = (1.6 + rand() * 0.6).toFixed(2)
  const faceOpacities = solid.faces.map(() => (0.1 + rand() * 0.4).toFixed(2))

  const faceFrames: string[][] = solid.faces.map(() => [])
  const edgeFrames: string[][] = edges.map(() => [])

  for (let frame = 0; frame <= FRAME_COUNT; frame += 1) {
    // frame === FRAME_COUNT repeats angle 0's projection exactly, so the
    // SMIL loop has no visible seam when it wraps back to the first value.
    const angle = startPhase + (dir * Math.PI * 2 * frame) / FRAME_COUNT
    const projected = vertices.map((vertex) => project(rotateAroundAxis(vertex, axis, angle), halfSize, focal, cx, cy))

    solid.faces.forEach((face, faceIndex) => {
      const points = face.map((vertexIndex) => projected[vertexIndex].map((n) => n.toFixed(1)).join(',')).join(' ')
      faceFrames[faceIndex].push(points)
    })
    edges.forEach(([a, b], edgeIndex) => {
      const [x1, y1] = projected[a]
      const [x2, y2] = projected[b]
      edgeFrames[edgeIndex].push(`M ${x1.toFixed(1)},${y1.toFixed(1)} L ${x2.toFixed(1)},${y2.toFixed(1)}`)
    })
  }

  const facesMarkup = faceFrames
    .map((values, faceIndex) => `<polygon fill="black" fill-opacity="${faceOpacities[faceIndex]}" points="${values[0]}"><animate attributeName="points" dur="${durationSec.toFixed(2)}s" repeatCount="indefinite" calcMode="linear" values="${values.join(';')}" /></polygon>`)
    .join('')
  const edgesMarkup = edgeFrames
    .map((values) => `<path fill="none" stroke="black" stroke-width="${strokeWidth}" stroke-linecap="round" d="${values[0]}"><animate attributeName="d" dur="${durationSec.toFixed(2)}s" repeatCount="indefinite" calcMode="linear" values="${values.join(';')}" /></path>`)
    .join('')

  return `<defs><filter id="quantize" x="-20%" y="-20%" width="140%" height="140%"><feComponentTransfer><feFuncA type="discrete" tableValues="${QUANTIZE_TABLE_VALUES}" /></feComponentTransfer></filter></defs><g filter="url(#quantize)">${facesMarkup}${edgesMarkup}</g>`
}

function generateSceneSvg(seed: string): string {
  const rand = mulberry32(hashStringToSeed(seed))
  const solid = buildRotatingSolid(rand)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">${solid}</svg>`
}

const maskUrlCache = new Map<string, string>()

/** CSS `mask-image`-ready `url(...)` for a scene seeded off `seed` -- cached so repeated lookups for the same seed (e.g. re-renders) don't regenerate or re-encode the SVG. */
export function getEmptyStateSceneMaskUrl(seed: string): string {
  const cached = maskUrlCache.get(seed)
  if (cached) return cached

  const svg = generateSceneSvg(seed)
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')
  const url = `url("data:image/svg+xml,${encoded}")`
  maskUrlCache.set(seed, url)
  return url
}
