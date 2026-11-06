/**
 * Arrows drawn in accent boxes around the cutout. One empty box separates
 * each arrow from the cutout. The arrows left and right of it step the
 * layout presets back and forward. The arrow above it switches light and
 * dark: it points up in dark mode and down in light mode.
 */

import { Fragment, useSyncExternalStore } from 'react'
import { readThemeControls, subscribeThemeControls } from './themeControls'
import type { VisualizerLayout } from './visualizerLayout'

/**
 * Each arrow's lit boxes as [column, row], the left one pointing left: four
 * boxes long beside a cutout an even number of boxes wide, three (one middle
 * box fewer) beside an odd one, so the arrow is centred on it either way.
 */
function shapes(length: 3 | 4) {
  const left: Array<[number, number]> = length === 4 ? [[1, 0], [0, 1], [0, 2], [1, 3]] : [[1, 0], [0, 1], [1, 2]]
  const right = left.map(([c, r]): [number, number] => [1 - c, r])
  const up = left.map(([c, r]): [number, number] => [r, c])
  const down = up.map(([c, r]): [number, number] => [c, 1 - r])
  return { left, right, up, down }
}
const SHAPES = { 3: shapes(3), 4: shapes(4) }

export function ThemeArrows({ layout }: { layout: VisualizerLayout }) {
  const controls = useSyncExternalStore(subscribeThemeControls, readThemeControls)
  const { boxPx, originXPx, originYPx, cutout } = layout
  if (cutout.size <= 0) return null
  const length = cutout.size % 2 === 1 ? 3 : 4
  const { left, right, up, down } = SHAPES[length]
  const middleRow = cutout.row + (cutout.size - length) / 2
  const middleColumn = cutout.column + (cutout.size - length) / 2
  const arrows = [
    { key: 'left', boxes: left, column: cutout.column - 3, row: middleRow, width: 2, height: length, label: 'Previous layout', press: () => controls.stepLayout(-1) },
    { key: 'right', boxes: right, column: cutout.column + cutout.size + 1, row: middleRow, width: 2, height: length, label: 'Next layout', press: () => controls.stepLayout(1) },
    { key: 'mode', boxes: controls.isDark ? up : down, column: middleColumn, row: cutout.row - 3, width: length, height: 2, label: controls.isDark ? 'Switch to light mode' : 'Switch to dark mode', press: () => controls.toggleUiMode() },
  ]
  return (
    <>
      {arrows.map((arrow) => (
        <Fragment key={arrow.key}>
          {arrow.boxes.map(([column, row]) => (
            <div
              key={`${column},${row}`}
              className="visualizer-lit visualizer-bucket-box"
              style={{ left: originXPx + (arrow.column + column) * boxPx, top: originYPx + (arrow.row + row) * boxPx, width: boxPx, height: boxPx }}
            />
          ))}
        </Fragment>
      ))}
      {arrows.map((arrow) => (
        <div
          key={`hit-${arrow.key}`}
          className="visualizer-bucket-hit"
          data-tooltip={arrow.label}
          style={{ left: originXPx + arrow.column * boxPx, top: originYPx + arrow.row * boxPx, width: arrow.width * boxPx, height: arrow.height * boxPx }}
          onPointerDown={(event) => {
            if (event.button === 0) arrow.press()
          }}
        />
      ))}
    </>
  )
}
