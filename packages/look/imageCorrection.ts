/**
 * The colour correction an IMAGE needs so it reads correctly through the
 * scene filter (loadoutTheme.ts's `themeFrame`), which filters the whole app
 * at once, images included.
 *
 * Which effects are undone: INVERT and HUE-ROTATE. Those two make a photo
 * WRONG (a negative, a blue face); sepia, brightness, contrast and saturate
 * only make it fit the room, so an image keeps them and stays immersed.
 *
 * Why not simply `hue-rotate(-h) invert(1)` on the image: the scene applies
 * its effects in a fixed order, invert FIRST and hue-rotate after sepia, and
 * colour matrices do not commute, so undoing two effects out of the middle of
 * the chain is not the same as reversing them. Every effect in the chain is an
 * affine map on (r, g, b) -- the matrices below are the ones the Filter
 * Effects spec defines the CSS shorthands as -- so the scene is one affine map
 * S, the look the image should have is another, T (the same chain without
 * invert and hue-rotate), and the correction is the single affine map C with
 * S(C(x)) = T(x), i.e. C = S⁻¹ ∘ T. It is handed to the renderer as an SVG
 * feColorMatrix, the one filter primitive that can carry an arbitrary matrix.
 *
 * What it cannot do: restore what the scene threw away. Where the scene is
 * not invertible (saturate at zero flattens colour to grey; invert near 0.5
 * flattens everything to grey) S⁻¹ is replaced by a regularised
 * pseudo-inverse, which restores what survives -- a greyscale theme shows a
 * greyscale positive rather than a negative. And the browser clamps each
 * pixel to 0..1 after the correction and again after every filter function
 * of the scene, which this single-map model does not see, so a colour pushed
 * out of range on the way comes back duller than it went in; strongly
 * saturated colours under a large hue rotation lose the most.
 */

/** The id of the SVG filter that carries the correction (ThemeLayers.tsx's `ImageCorrectionFilter`). */
export const IMAGE_CORRECTION_FILTER_ID = 'thockdown-image-correction'

/** An affine colour map: out = M · (r, g, b) + v. */
interface Affine {
  m: number[][]
  v: number[]
}

/** One effect of the scene filter, in the order the scene applies them. */
export type SceneEffect =
  | { kind: 'invert'; amount: number }
  | { kind: 'sepia'; amount: number }
  | { kind: 'hue-rotate'; deg: number }
  | { kind: 'brightness'; amount: number }
  | { kind: 'contrast'; amount: number }
  | { kind: 'saturate'; amount: number }

const IDENTITY: Affine = { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], v: [0, 0, 0] }

function diag(a: number, offset: number): Affine {
  return { m: [[a, 0, 0], [0, a, 0], [0, 0, a]], v: [offset, offset, offset] }
}

function affineOf(effect: SceneEffect): Affine {
  switch (effect.kind) {
    case 'invert':
      return diag(1 - 2 * effect.amount, effect.amount)
    case 'brightness':
      return diag(effect.amount, 0)
    case 'contrast':
      return diag(effect.amount, 0.5 - 0.5 * effect.amount)
    case 'sepia': {
      const a = 1 - Math.min(1, Math.max(0, effect.amount))
      return {
        m: [
          [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a],
          [0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a],
          [0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a],
        ],
        v: [0, 0, 0],
      }
    }
    case 'saturate': {
      const s = effect.amount
      return {
        m: [
          [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
          [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
          [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
        ],
        v: [0, 0, 0],
      }
    }
    case 'hue-rotate': {
      const t = (effect.deg * Math.PI) / 180
      const c = Math.cos(t)
      const s = Math.sin(t)
      return {
        m: [
          [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
          [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283],
          [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
        ],
        v: [0, 0, 0],
      }
    }
  }
}

function mul3(a: number[][], b: number[][]): number[][] {
  return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]))
}

function apply3(m: number[][], x: number[]): number[] {
  return m.map((row) => row[0] * x[0] + row[1] * x[1] + row[2] * x[2])
}

/** `outer ∘ inner`: inner first. */
function compose(outer: Affine, inner: Affine): Affine {
  const v = apply3(outer.m, inner.v)
  return { m: mul3(outer.m, inner.m), v: v.map((x, i) => x + outer.v[i]) }
}

function transpose(m: number[][]): number[][] {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i]))
}

function invert3(m: number[][], minDet: number): number[][] | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < minDet) return null
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ]
}

/**
 * (MᵀM + λI)⁻¹ Mᵀ, a damped pseudo-inverse: close to M⁻¹ along the
 * directions M preserves, close to zero along the ones it crushed.
 */
function regularisedInverse(m: number[][]): number[][] {
  const mt = transpose(m)
  const gram = mul3(mt, m)
  // Two hundredths of the mean eigenvalue of MᵀM: directions the scene keeps
  // are inverted almost exactly, directions it crushed are left alone.
  const lambda = 0.02 * ((gram[0][0] + gram[1][1] + gram[2][2]) / 3)
  const damped = gram.map((row, i) => row.map((x, j) => (i === j ? x + lambda : x)))
  const inv = invert3(damped, 1e-12) ?? [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  return mul3(inv, mt)
}

/** The largest gain an exact inverse may have before it is treated as ill-conditioned. */
const MAX_EXACT_GAIN = 6

function maxAbs(m: number[][]): number {
  return Math.max(...m.flat().map(Math.abs))
}

function chain(effects: readonly SceneEffect[]): Affine {
  return effects.reduce<Affine>((acc, effect) => compose(affineOf(effect), acc), IDENTITY)
}

/**
 * The correction for `scene`, as the 20 values of an SVG feColorMatrix
 * (row-major 4×5, alpha passed through), or null when the scene contains no
 * invert or hue-rotate and the image needs nothing.
 */
export function imageCorrectionMatrix(scene: readonly SceneEffect[]): string | null {
  const isUndone = (effect: SceneEffect) =>
    (effect.kind === 'invert' && effect.amount !== 0) ||
    (effect.kind === 'hue-rotate' && effect.deg % 360 !== 0)
  if (!scene.some(isUndone)) return null

  const s = chain(scene)
  const t = chain(scene.filter((effect) => !isUndone(effect)))
  // C(x) = S⁻¹(T(x) − s.v) = S⁻¹·T.m · x + S⁻¹·(t.v − s.v)
  // An exact inverse whose gain is large belongs to a scene that has
  // flattened colour (sepia at full strength, saturate near zero, invert near
  // 0.5): it would push nearly every pixel out of range, and the browser's
  // clamp then draws the whole image as one flat colour -- measured, on the
  // full-sepia "dusk" preset. The damped inverse restores what survives.
  const exact = invert3(s.m, 1e-9)
  const sInv = exact && maxAbs(exact) <= MAX_EXACT_GAIN ? exact : regularisedInverse(s.m)
  const m = mul3(sInv, t.m)
  const v = apply3(sInv, t.v.map((x, i) => x - s.v[i]))
  const round = (x: number) => Number(x.toFixed(6))
  return [
    ...m[0].map(round), 0, round(v[0]),
    ...m[1].map(round), 0, round(v[1]),
    ...m[2].map(round), 0, round(v[2]),
    0, 0, 0, 1, 0,
  ].join(' ')
}

/** `rgb` (0..1, unclamped) through `effects` in order: the map the browser applies, before it clamps. */
export function mapThroughScene(effects: readonly SceneEffect[], rgb: readonly number[]): number[] {
  const a = chain(effects)
  return apply3(a.m, [...rgb]).map((x, i) => x + a.v[i])
}
