/**
 * The visualizer's bucket list: the music bar's playlist buckets
 * (`PLAYLIST_BUTTON_SLOTS`, by name), in the rectangle `bucketListArea`
 * gives, mirroring the song list: one entry on every other row from the top,
 * right-aligned, framed the way a song is (accent, gap, name, gap, accent).
 * An active bucket sits on the letterbox colour, cut out of the middle strip
 * (`middleHoles.ts`); the rest on the middle's. A press takes a bucket in or
 * out of the pool (`NowPlaying.toggleSlot`), and the song list follows the
 * pool it publishes. An empty bucket is shown and takes no press: filling
 * one is the music bar's (it opens a file dialog).
 *
 * Five entries, re-rendered only when the pool changes.
 */

import { Fragment, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'
import { PLAYLIST_BUTTON_SLOTS, PLAYLIST_SLOT_THEMES } from '../shared/audioPlayer'
import { dropWideGlyphs } from './cellGlyphs'
import { middleStripOf, setMiddleHoles } from './middleHoles'
import { songListEntry, type VisualizerLayout } from './visualizerLayout'
import type { SongListArea } from './SongList'

export function BucketList({ layout, area, glyphFont }: { layout: VisualizerLayout; area: SongListArea; glyphFont: string }) {
  const pool = useSyncExternalStore(subscribeNowPlaying, () => readNowPlaying().pool)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const { boxPx, originXPx, originYPx } = layout
  const right = originXPx + (area.column + area.columns) * boxPx
  const top = originYPx + area.row * boxPx

  const entries = PLAYLIST_BUTTON_SLOTS.slice(0, area.slots).map((slot, index) => {
    const { text, closingColumn } = songListEntry(dropWideGlyphs(PLAYLIST_SLOT_THEMES[slot], glyphFont), area.columns)
    const width = closingColumn + 1
    return {
      slot,
      text,
      left: right - width * boxPx,
      top: top + index * 2 * boxPx,
      width,
      active: pool?.slots.includes(slot) ?? false,
      empty: (pool?.counts[slot] ?? 0) === 0,
    }
  })

  const holeKey = entries.filter((entry) => entry.active).map((entry) => `${entry.left},${entry.top},${entry.width}`).join(';')
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const middle = anchor ? middleStripOf(anchor) : null
    if (!middle) return
    const holes = holeKey === '' ? [] : holeKey.split(';').map((part) => {
      const [x, y, width] = part.split(',').map(Number)
      return { x, y: y - middle.offsetTop, width: width * boxPx, height: boxPx }
    })
    setMiddleHoles(middle, 'bucket-list', holes)
    return () => setMiddleHoles(middle, 'bucket-list', [])
  }, [holeKey, boxPx])

  const cell = (left: number, entryTop: number, width = 1) => ({ left, top: entryTop, width: width * boxPx, height: boxPx })
  return (
    <>
      <div ref={anchorRef} hidden />
      {entries.map((entry) => (
        <Fragment key={`b${entry.slot}`}>
          {entry.active && <div className="visualizer-song-plate visualizer-bucket-box" style={cell(entry.left, entry.top, entry.width)} />}
          <div className="visualizer-lit visualizer-bucket-box" style={cell(entry.left, entry.top)} />
          <div className="visualizer-lit visualizer-bucket-box" style={cell(entry.left + (entry.width - 1) * boxPx, entry.top)} />
        </Fragment>
      ))}
      {entries.map((entry) => Array.from(entry.text).map((char, index) => (char === ' ' ? null : (
        <div key={`l${entry.slot}-${index}`} className="visualizer-letter is-panel" style={{ ...cell(entry.left + (index + 2) * boxPx, entry.top), lineHeight: `${boxPx}px` }}>
          {char}
        </div>
      ))))}
      {entries.map((entry) => (
        <div
          key={`h${entry.slot}`}
          className="visualizer-bucket-hit"
          style={cell(entry.left, entry.top, entry.width)}
          onPointerDown={(event) => {
            if (event.button === 0 && !entry.empty) readNowPlaying().toggleSlot(entry.slot)
          }}
        />
      ))}
    </>
  )
}
