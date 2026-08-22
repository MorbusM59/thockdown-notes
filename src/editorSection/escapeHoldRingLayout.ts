// Pure geometry for arranging the escape-hold quick-actions buttons evenly
// around the perimeter of a rounded square, centered inside the shared
// .editor-empty-state circle (editor.css). No React/DOM dependency, so this
// is trivial to unit-test and to reason about independently of rendering.
//
// The ring line is a rounded rect (same corner radius as the panel itself,
// per SectionEditorArea's usage -- NOT a shrunk/offset radius, which would
// degenerate at these token sizes) inset from the panel edge by
// spacing-extra-large + half the button size, so a button's near edge sits
// spacing-extra-large away from the panel border with its center exactly on
// the line.
//
// Points are placed by ANGLE, not arc length: take `count` directions evenly
// spaced around a full circle (starting straight up, going clockwise -- so
// index 0 always lands at top-center), and project each one outward from the
// center onto the rounded square's actual boundary. Arc-length spacing (an
// earlier version of this file) put points straddling a corner visibly
// closer together than points on a straight run, even though the arc length
// between them was identical everywhere -- a corner's curve "shortcuts" the
// straight-line distance between two points on either side of it, so equal
// arc length there means shorter equal visual distance. Angular spacing
// doesn't have that problem, since it's driven by the same quantity (angle
// from center) the eye actually judges position by. This is also what makes
// a future "telephone dial" rotation cheap to add later: rotating is just
// adding an offset to each index's angle before projecting.

export interface RingPoint {
  x: number
  y: number
}

/**
 * Where a ray from the origin at angle `theta` (0 = pointing +x/right,
 * increasing clockwise on screen since y grows downward) crosses the
 * boundary of a rounded square of the given half-size and corner radius,
 * centered at the origin.
 *
 * Uses the shape's quadrant symmetry: reflects `theta`'s direction into the
 * canonical bottom-right quadrant (dx, dy both >= 0), resolves the
 * intersection there against whichever of that quadrant's two straight
 * edges or one corner arc the direction actually falls into, then reflects
 * the result back out via the original signs.
 */
function rayToRoundedSquareBoundary(theta: number, halfSize: number, cornerRadius: number): RingPoint {
  const r = Math.max(0, Math.min(cornerRadius, halfSize))
  const straightHalf = halfSize - r

  const dx = Math.cos(theta)
  const dy = Math.sin(theta)
  const signX = dx < 0 ? -1 : 1
  const signY = dy < 0 ? -1 : 1
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)

  if (adx === 0 && ady === 0) return { x: 0, y: 0 }

  // Straight-edge cases: the ray crosses x = halfSize (or y = halfSize)
  // within that edge's flat run, before reaching the corner. Written as
  // cross-multiplied comparisons (not ady/adx <= ratio) so adx or ady being
  // exactly 0 can't divide by zero here -- the actual division only happens
  // below, once the corresponding case is already known to apply.
  if (ady * halfSize <= straightHalf * adx) {
    return { x: signX * halfSize, y: signY * (halfSize * ady / adx) }
  }
  if (adx * halfSize <= straightHalf * ady) {
    return { x: signX * (halfSize * adx / ady), y: signY * halfSize }
  }

  // Corner-arc case: intersect the ray with the corner's own circle
  // (center (straightHalf, straightHalf) in the canonical quadrant, radius
  // r). The quadratic t^2 - 2*dot*t + (|center|^2 - r^2) = 0 (D is a unit
  // vector here) has two roots -- the near one is where the ray dips inside
  // the circle on its way past, which sits INSIDE the square's straight-edge
  // run, not on its actual outer boundary; the far root is the real corner
  // point, since the corner circle bulges outward past the straight edges.
  const centerX = straightHalf
  const centerY = straightHalf
  const dot = adx * centerX + ady * centerY
  const centerDistSq = centerX * centerX + centerY * centerY
  const discriminant = Math.max(0, dot * dot - (centerDistSq - r * r))
  const t = dot + Math.sqrt(discriminant)
  return { x: signX * adx * t, y: signY * ady * t }
}

/**
 * `count` points evenly spaced by ANGLE (not arc length -- see the module
 * comment) around a rounded square's perimeter, as offsets from its center.
 * Index 0 is always top-center; the rest proceed clockwise. `count <= 0`
 * returns an empty array.
 */
export function computeRoundedSquareRingPoints(
  count: number,
  params: { size: number; inset: number; cornerRadius: number },
): RingPoint[] {
  if (count <= 0) return []
  const halfSize = params.size / 2 - params.inset
  return Array.from({ length: count }, (_, index) => {
    const theta = -Math.PI / 2 + (index / count) * 2 * Math.PI
    return rayToRoundedSquareBoundary(theta, halfSize, params.cornerRadius)
  })
}

// PANEL_SIZE_PX and BUTTON_SIZE_PX mirror CSS tokens that are static and
// non-theme-dependent today (--circle-diameter in editor.css,
// --btn-square-larger-size in tokens.css) -- a plain numeric mirror is
// simpler and more testable than measuring the DOM at runtime. If either of
// those source tokens changes, these need updating to match.
//
// Corner radius and spacing are NOT mirrored the same way: --border-radius-regular
// and --spacing-regular are live, user-configurable values (options menu
// sliders, see App.tsx's borderRadiusRegularPx/spacingRegularPx state) that
// can change at any time, not just between builds -- a hardcoded mirror of
// those would silently drift from .editor-empty-state's actual on-screen
// shape the moment the user moved either slider. computeEscapeHoldRingPoints
// takes them as live parameters instead, so it's threaded through as
// ordinary reactive props (App.tsx -> EditorSection -> SectionEditorArea ->
// EscapeHoldPanel) the same way editorRuntimeMetrics/viewFontSize/etc.
// already are, rather than read once and gone stale.
const PANEL_SIZE_PX = 220
const BUTTON_SIZE_PX = 44

export interface EscapeHoldRingParams {
  /** Mirrors --border-radius-regular; the panel's own corner radius is calc(var(--border-radius-regular) * 6) in editor.css. */
  borderRadiusRegularPx: number
  /** Mirrors --spacing-regular; the ring's inset from the panel edge uses --spacing-extra-large, which is calc(var(--spacing-regular) * 4) in tokens.css. */
  spacingRegularPx: number
}

/** The escape-hold panel's own ring, at its actual on-screen dimensions. */
export function computeEscapeHoldRingPoints(count: number, params: EscapeHoldRingParams): RingPoint[] {
  const cornerRadius = params.borderRadiusRegularPx * 6
  const spacingExtraLarge = params.spacingRegularPx * 4
  const inset = spacingExtraLarge + BUTTON_SIZE_PX / 2
  return computeRoundedSquareRingPoints(count, {
    size: PANEL_SIZE_PX,
    inset,
    cornerRadius,
  })
}
