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
import { CutoutGlyphBox } from './CutoutGlyphBox'
import { levelAtColumn, levelGapColumn, type LevelBar, type LevelBarsArea, type VisualizerLayout } from './visualizerLayout'

const BARS: ReadonlyArray<keyof SoundLevels & keyof LevelBarsArea> = ['volume']

/**
 * What frames an edge-to-edge bar: its two end boxes, accent boxes with their
 * glyph cut out (`CutoutGlyphBox`), and the screen's cut-off part
 * boxes beyond them (the grid's margin either side), lit in the accent so the
 * bar reaches the screen's edges. An end box takes its own press (`onPress`,
 * what the bar's own hit layer does at that column) so it can look pressed.
 */
export function BarEndGlyphs({ layout, bar, glyphs, font, onPress }: { layout: VisualizerLayout; bar: LevelBar; glyphs: readonly [string, string]; font: string; onPress: (end: 0 | 1) => void }) {
  const { boxPx, originXPx, originYPx } = layout
  const top = originYPx + bar.row * boxPx
  return (
    <>
      {originXPx > 0 && <div className="visualizer-lit" style={{ left: 0, top, width: originXPx, height: boxPx }} />}
      {originXPx > 0 && <div className="visualizer-lit" style={{ left: originXPx + (bar.column + bar.columns) * boxPx, right: 0, top, height: boxPx }} />}
      {[0, bar.columns - 1].map((column, index) => (
        <CutoutGlyphBox
          key={column}
          className="is-bar-end"
          // A pixel in: the grid line on a box's first row and column stays drawn.
          left={originXPx + (bar.column + column) * boxPx + 1}
          top={top + 1}
          sizePx={boxPx - 1}
          text={glyphs[index]}
          font={font}
          onPointerDown={(event) => {
            if (event.button === 0) onPress(index as 0 | 1)
          }}
        />
      ))}
    </>
  )
}

export function LevelBars({ layout, area, font }: { layout: VisualizerLayout; area: LevelBarsArea; font: string }) {
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
      <BarEndGlyphs
        layout={layout}
        bar={area.volume}
        glyphs={['\u2013', '+']}
        font={font}
        onPress={(end) => readNowPlaying().setLevel('volume', levelAtColumn(area.volume.columns, end === 0 ? 0 : area.volume.columns - 1))}
      />
      {BARS.map((key) => {
        const bar = area[key]
        const gap = levelGapColumn(bar.columns, levels[key])
        // Volume stays when the panels are hidden.
        const boxClass = 'visualizer-lit'
        return (
          <Fragment key={key}>
            {/* The lit runs either side of the gap, the end boxes left to BarEndGlyphs. */}
            <div className={boxClass} style={place(bar, 1, gap - 1)} />
            <div className={boxClass} style={place(bar, gap + 1, bar.columns - gap - 2)} />
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
