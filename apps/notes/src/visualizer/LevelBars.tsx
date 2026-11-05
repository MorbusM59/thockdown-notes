/**
 * The visualizer's sound level bars (`levelBarsArea`): volume under the
 * cutout, reverb and room above it. Each is the progress track's language --
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
      {BARS.map((key) => {
        const bar = area[key]
        const gap = levelGapColumn(bar.columns, levels[key])
        return (
          <Fragment key={key}>
            <div className="visualizer-lit visualizer-bucket-box" style={place(bar, 0, gap)} />
            <div className="visualizer-lit visualizer-bucket-box" style={place(bar, gap + 1, bar.columns - gap - 1)} />
            <div
              className="visualizer-bucket-hit"
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
