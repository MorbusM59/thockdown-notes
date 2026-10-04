import { Children, type ReactNode } from 'react'
import { chunkIntoRows, sliderRowSizes } from './sliderRows'

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
