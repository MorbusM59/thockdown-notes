/**
 * The visualizer's sound level bars (`levelBarsArea`): volume across the
 * bottom strip's first row, reverb and room under the cutout. Each is the progress track's language --
 * a row of accent boxes with one empty box at the level -- whose two end
 * boxes are always lit, so the level runs over the boxes between them
 * (`levelGapColumn`). A press sets the level at the box pressed
 * (`NowPlaying.setLevel`, which also unmutes or un-bypasses, as the music
 * bar's own controls do). Re-rendered only when a level changes.
 */

import { Fragment, useSyncExternalStore } from 'react'
import { readNowPlaying, subscribeNowPlaying, type SoundLevels } from '../sound/nowPlaying'
import { levelAtColumn, levelGapColumn, type LevelBar, type LevelBarsArea, type VisualizerLayout } from './visualizerLayout'

const BARS: ReadonlyArray<keyof SoundLevels> = ['volume', 'reverb', 'room']

/**
 * The middle bars' names, one letter per box like the song list's:
 * "reverb" and "size" two rows above their bars, flush with the bar's outer
 * end. The volume bar, alone on the bottom strip's first row, needs no name.
 * A name that would leave the middle section is not drawn.
 */
function labelsOf(area: LevelBarsArea, firstRow: number): Array<{ text: string; column: number; row: number }> {
  const { reverb, room } = area
  if (reverb.row - 2 < firstRow) return []
  return [
    { text: 'reverb', column: reverb.column, row: reverb.row - 2 },
    { text: 'size', column: room.column + room.columns - 4, row: room.row - 2 },
  ]
}

/** The glyphs on a bar's two end boxes, drawn over its lit boxes in the inverted accent. */
export function BarEndGlyphs({ layout, bar, glyphs }: { layout: VisualizerLayout; bar: LevelBar; glyphs: readonly [string, string] }) {
  const { boxPx, originXPx, originYPx } = layout
  return (
    <>
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
      {labelsOf(area, layout.stripRows + 1).flatMap((label) => Array.from(label.text).map((char, index) => (
        <div
          key={`${label.text}${index}`}
          className="visualizer-letter is-panel"
          style={{ left: originXPx + (label.column + index) * boxPx, top: originYPx + label.row * boxPx, width: boxPx, height: boxPx, lineHeight: `${boxPx}px` }}
        >
          {char}
        </div>
      )))}
      <BarEndGlyphs layout={layout} bar={area.volume} glyphs={['\u2013', '+']} />
      {BARS.map((key) => {
        const bar = area[key]
        const gap = levelGapColumn(bar.columns, levels[key])
        // Volume lives in the bottom strip and stays when the panels are hidden;
        // reverb and room are panel content and fade with them.
        const boxClass = key === 'volume' ? 'visualizer-lit' : 'visualizer-lit visualizer-bucket-box'
        return (
          <Fragment key={key}>
            <div className={boxClass} style={place(bar, 0, gap)} />
            <div className={boxClass} style={place(bar, gap + 1, bar.columns - gap - 1)} />
            <div
              className={key === 'volume' ? 'visualizer-bucket-hit is-always' : 'visualizer-bucket-hit'}
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
