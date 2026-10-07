// How the shortcut reference's sections are arranged and sized to a slot --
// see ShortcutReference.tsx's header for why this is arithmetic rather than a
// search.

export const BASE_FONT_PX = 16
/** Gap between columns, and between sections in a column, in em. */
export const GAP_EM = 1.25
/** The panel's own inner margin, in em. */
export const PADDING_EM = 1.5
/** A large slot does not get poster-sized text. */
const MAX_FONT_PX = 26
/** What sub-pixel rounding can add back when the layout is drawn at the solved size. */
const ROUNDING_HEADROOM = 0.98

interface SectionSize {
  width: number
  height: number
}

export interface Arrangement {
  /** Section indices per column, in reading order. */
  columns: number[][]
  fontPx: number
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

export function arrangeSections(sizes: SectionSize[], availableWidth: number, availableHeight: number): Arrangement {
  const gap = GAP_EM * BASE_FONT_PX
  const padding = PADDING_EM * BASE_FONT_PX * 2
  let bestArrangement: Arrangement = { columns: [sizes.map((_, index) => index)], fontPx: 0 }
  for (let count = 1; count <= sizes.length; count += 1) {
    const columns = partition(sizes.map((size) => size.height), count, gap)
    const width = columns.reduce((sum, column) => sum + Math.max(...column.map((index) => sizes[index].width)), 0)
      + gap * (count - 1) + padding
    const height = Math.max(...columns.map((column) =>
      column.reduce((sum, index) => sum + sizes[index].height, 0) + gap * (column.length - 1))) + padding
    const scale = Math.min(availableWidth / width, availableHeight / height)
    const fontPx = Math.min(MAX_FONT_PX, BASE_FONT_PX * scale * ROUNDING_HEADROOM)
    if (fontPx > bestArrangement.fontPx) bestArrangement = { columns, fontPx }
  }
  return bestArrangement
}

