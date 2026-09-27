import { Children, type ReactNode } from 'react'

/**
 * How a group of sliders in the options panel is broken into rows, stated once
 * for every section. One slider takes the whole width. A count divisible by
 * three goes in rows of three, and any other even count in rows of two. A count
 * that is neither (five, seven) has no layout this rule can choose: those rows
 * group sliders by what they have in common, which only the caller knows, so
 * the caller must pass them and this throws rather than guess.
 */
export function sliderRowSizes(count: number, rows?: readonly number[]): number[] {
  if (rows) {
    const total = rows.reduce((sum, size) => sum + size, 0)
    if (total !== count) throw new Error(`Slider rows ${rows.join('+')} do not add up to ${count} sliders`)
    return [...rows]
  }
  if (count <= 1) return count === 1 ? [1] : []
  if (count % 3 === 0) return Array.from({ length: count / 3 }, () => 3)
  if (count % 2 === 0) return Array.from({ length: count / 2 }, () => 2)
  throw new Error(`${count} sliders need explicit rows grouped by what they have in common`)
}

/** Splits `items` into consecutive rows of the given sizes. */
export function chunkIntoRows<T>(items: readonly T[], sizes: readonly number[]): T[][] {
  const result: T[][] = []
  let start = 0
  for (const size of sizes) {
    result.push(items.slice(start, start + size))
    start += size
  }
  return result
}

/**
 * Lays its children (sliders) out in rows by `sliderRowSizes`; every slider in
 * a row takes an equal share of the row's width (`.options-slider-row`).
 */
export function OptionsSliderRows({ children, rows }: { children: ReactNode; rows?: readonly number[] }) {
  const items = Children.toArray(children)
  return (
    <>
      {chunkIntoRows(items, sliderRowSizes(items.length, rows)).map((row, index) => (
        <div className="options-slider-row" key={index}>{row}</div>
      ))}
    </>
  )
}
