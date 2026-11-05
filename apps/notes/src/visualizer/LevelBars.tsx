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

/**
 * Each bar's name, one letter per box like the song list's: "volume" ("vol"
 * on an odd-width bar, so it can sit exactly in the middle) centred
 * over the volume bar on the row of the reverb and room bars (in the gap
 * between them), "reverb" and "room" two rows above their bars, flush with
 * the bar's outer end. A name that would leave the middle section is not drawn.
 */
function labelsOf(area: LevelBarsArea, firstRow: number): Array<{ text: string; column: number; row: number }> {
  const { volume, reverb, room } = area
  // Exactly centred: an even bar (the cutout's parity) takes "volume", an odd one "vol".
  const name = volume.columns % 2 === 0 ? 'volume' : 'vol'
  const labels = [{ text: name, column: volume.column + (volume.columns - name.length) / 2, row: reverb.row }]
  if (reverb.row - 2 >= firstRow) {
    labels.push({ text: 'reverb', column: reverb.column, row: reverb.row - 2 })
    labels.push({ text: 'room', column: room.column + room.columns - 4, row: room.row - 2 })
  }
  return labels
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
          className="visualizer-letter"
          style={{ left: originXPx + (label.column + index) * boxPx, top: originYPx + label.row * boxPx, width: boxPx, height: boxPx, lineHeight: `${boxPx}px` }}
        >
          {char}
        </div>
      )))}
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
