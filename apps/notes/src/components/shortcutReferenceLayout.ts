// How the shortcut reference's panels are arranged and how large their text
// is drawn -- see ShortcutReference.tsx's opening comment for the whole
// argument.

/** Gap between columns, and between panels in a column, in CSS px. */
export const GAP_PX = 10
/** The overlay's own inner margin, in CSS px. */
export const PADDING_PX = 16
/** What sub-pixel rounding can add back when the layout is drawn at the solved size. */
const ROUNDING_HEADROOM = 0.98
/** Bisection steps: the scale is exact to 2^-40 of its range, far below a pixel. */
const BISECTION_STEPS = 40

export interface SectionSize {
  width: number
  height: number
}

/**
 * A panel's size as a function of its text scale `k`: every length inside a
 * panel either follows the text (glyphs, caps, line boxes, the description
 * width) or stays fixed (spacing, borders), so each dimension is
 * `base + slope * k` -- exactly a straight line, read off two measurements.
 */
export interface LinearSize {
  width: { base: number; slope: number }
  height: { base: number; slope: number }
}

/** The line through a panel's sizes measured at text scales 1 and 2. */
export function linearSize(atOne: SectionSize, atTwo: SectionSize): LinearSize {
  return {
    width: { base: 2 * atOne.width - atTwo.width, slope: atTwo.width - atOne.width },
    height: { base: 2 * atOne.height - atTwo.height, slope: atTwo.height - atOne.height },
  }
}

export function sizeAt(size: LinearSize, scale: number): SectionSize {
  return {
    width: size.width.base + size.width.slope * scale,
    height: size.height.base + size.height.slope * scale,
  }
}

export interface Arrangement {
  /** Section indices per column, in reading order. */
  columns: number[][]
  /** The text scale the arrangement is drawn at. */
  scale: number
}

/** Splits `heights` (in order) into `count` contiguous runs, minimising the tallest run. */
function partition(heights: number[], count: number, gap: number): number[][] {
  const n = heights.length
  const runHeight = (from: number, to: number): number => {
    let sum = 0
    for (let i = from; i < to; i += 1) sum += heights[i]
    return sum + gap * Math.max(0, to - from - 1)
  }
  // best[k][i]: the tallest column when the first i sections fill k columns.
  const best: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(Infinity))
  const cut: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(0))
  best[0][0] = 0
  for (let k = 1; k <= count; k += 1) {
    for (let i = k; i <= n; i += 1) {
      for (let j = k - 1; j < i; j += 1) {
        const tallest = Math.max(best[k - 1][j], runHeight(j, i))
        if (tallest < best[k][i]) {
          best[k][i] = tallest
          cut[k][i] = j
        }
      }
    }
  }
  const columns: number[][] = []
  let end = n
  for (let k = count; k >= 1; k -= 1) {
    const start = cut[k][end]
    columns.unshift(Array.from({ length: end - start }, (_, offset) => start + offset))
    end = start
  }
  return columns
}

/** The space `columns` takes with every panel at `sizes`, padding included. */
export function arrangementSize(sizes: SectionSize[], columns: number[][]): SectionSize {
  const width = columns.reduce((sum, column) => sum + Math.max(...column.map((index) => sizes[index].width)), 0)
    + GAP_PX * (columns.length - 1) + PADDING_PX * 2
  const height = Math.max(...columns.map((column) =>
    column.reduce((sum, index) => sum + sizes[index].height, 0) + GAP_PX * (column.length - 1)))
    + PADDING_PX * 2
  return { width, height }
}

/**
 * The column count, and the text scale, at which the panels can be drawn
 * largest in `availableWidth` x `availableHeight`.
 *
 * For a given count, whether the panels fit at scale `k` is a pure function
 * of the measured lines: lay them out at `k` (contiguous columns, the tallest
 * as short as it can be) and compare. Every panel grows with `k`, so fitting
 * is monotone in it, and the largest scale that fits is found by bisection on
 * that function -- arithmetic on numbers already measured, nothing redrawn.
 */
export function arrangeSections(sizes: LinearSize[], availableWidth: number, availableHeight: number): Arrangement {
  let bestArrangement: Arrangement = { columns: [sizes.map((_, index) => index)], scale: 0 }
  const layoutAt = (scale: number, count: number) => {
    const scaled = sizes.map((size) => sizeAt(size, scale))
    const columns = partition(scaled.map((size) => size.height), count, GAP_PX)
    const { width, height } = arrangementSize(scaled, columns)
    return { columns, fits: width <= availableWidth * ROUNDING_HEADROOM && height <= availableHeight * ROUNDING_HEADROOM }
  }
  // No panel can be drawn larger than the scale at which it alone fills the space.
  let ceiling = Infinity
  for (const size of sizes) {
    if (size.width.slope > 0) ceiling = Math.min(ceiling, (availableWidth - PADDING_PX * 2 - size.width.base) / size.width.slope)
    if (size.height.slope > 0) ceiling = Math.min(ceiling, (availableHeight - PADDING_PX * 2 - size.height.base) / size.height.slope)
  }
  if (!(ceiling > 0)) return bestArrangement
  for (let count = 1; count <= sizes.length; count += 1) {
    if (!layoutAt(bestArrangement.scale, count).fits) continue
    let low = bestArrangement.scale
    let high = ceiling
    for (let step = 0; step < BISECTION_STEPS; step += 1) {
      const middle = (low + high) / 2
      if (layoutAt(middle, count).fits) low = middle
      else high = middle
    }
    if (low > bestArrangement.scale) bestArrangement = { columns: layoutAt(low, count).columns, scale: low }
  }
  return bestArrangement
}
