/**
 * The visualizer's volume bar (`levelBarsArea`) on the middle section's
 * last row, just above the bottom strip. It is the progress track's language --
 * a row of accent boxes with one empty box at the level -- whose two end
 * boxes are always lit, so the level runs over the boxes between them
 * (`levelGapColumn`). A press sets the level at the box pressed
 * (`NowPlaying.setLevel`, which also unmutes or un-bypasses, as the music
 * bar's own controls do). Re-rendered only when a level changes.
 */

import { Fragment, useSyncExternalStore } from 'react'
import { readNowPlaying, subscribeNowPlaying, type SoundLevels } from '../sound/nowPlaying'
import { levelAtColumn, levelGapColumn, type LevelBar, type LevelBarsArea, type VisualizerLayout } from './visualizerLayout'

const BARS: ReadonlyArray<keyof SoundLevels & keyof LevelBarsArea> = ['volume']

/**
 * What frames an edge-to-edge bar: the glyphs on its two end boxes, drawn
 * over its lit boxes in the inverted accent, and the screen's cut-off part
 * boxes beyond them (the grid's margin either side), lit in the accent so the
 * bar reaches the screen's edges.
 */
export function BarEndGlyphs({ layout, bar, glyphs }: { layout: VisualizerLayout; bar: LevelBar; glyphs: readonly [string, string] }) {
  const { boxPx, originXPx, originYPx } = layout
  const top = originYPx + bar.row * boxPx
  return (
    <>
      {originXPx > 0 && <div className="visualizer-lit" style={{ left: 0, top, width: originXPx, height: boxPx }} />}
      {originXPx > 0 && <div className="visualizer-lit" style={{ left: originXPx + (bar.column + bar.columns) * boxPx, right: 0, top, height: boxPx }} />}
      {[0, bar.columns - 1].map((column, index) => (
        <div
          key={column}
          className="visualizer-letter is-bar-end"
          style={{ left: originXPx + (bar.column + column) * boxPx, top: originYPx + bar.row * boxPx, width: boxPx, height: boxPx, lineHeight: `${boxPx}px` }}
        >
          {glyphs[index]}
        </div>
      ))}
    </>
  )
}

export function LevelBars({ layout, area }: { layout: VisualizerLayout; area: LevelBarsArea }) {
  const levels = useSyncExternalStore(subscribeNowPlaying, () => readNowPlaying().levels)
  const { boxPx, originXPx, originYPx } = layout
  const place = (bar: LevelBar, from: number, columns: number) => ({
    left: originXPx + (bar.column + from) * boxPx,
    top: originYPx + bar.row * boxPx,
    width: columns * boxPx,
    height: boxPx,
  })
  return (
    <>
      <BarEndGlyphs layout={layout} bar={area.volume} glyphs={['\u2013', '+']} />
      {BARS.map((key) => {
        const bar = area[key]
        const gap = levelGapColumn(bar.columns, levels[key])
        // Volume stays when the panels are hidden.
        const boxClass = 'visualizer-lit'
        return (
          <Fragment key={key}>
            <div className={boxClass} style={place(bar, 0, gap)} />
            <div className={boxClass} style={place(bar, gap + 1, bar.columns - gap - 1)} />
            <div
              className="visualizer-bucket-hit is-always"
              style={place(bar, 0, bar.columns)}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                const column = Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / boxPx)
                readNowPlaying().setLevel(key, levelAtColumn(bar.columns, column))
              }}
            />
          </Fragment>
        )
      })}
    </>
  )
}
