/**
 * The visualizer's song list: every song in the music pool once, in pick
 * order (`shared/musicPool.ts`) from the playing song on, so the pool's ring
 * is cut at the playing song and laid out top to bottom, in the rectangle
 * `songListArea` gives, one entry on every other row. An entry is an accent
 * box, an empty box, the title cut to fit, an empty box, an accent box; the
 * song that is playing sits on the strip's own letterbox colour, the rest on
 * the middle's (so no box is drawn behind them at all).
 *
 * The list is FINITE, so its length shows how big the pool is: it tops out
 * at the playing song and bottoms out at the last entry, and the wheel
 * scrolls it a whole entry at a time with the edit view's own dynamics
 * (`editor/rowWheel.ts`: notch, step and spin coast) between those two ends.
 * A press on an entry plays it (`NowPlaying.playFromPool`), and while the
 * pointer stays over the list nothing moves: the pressed entry only takes
 * the letterbox plate, the list still cut at the song that was playing.
 * Leaving the list scrolls it to the playing song, on the reader's
 * smooth-scroll curve (`buildScrollPlanFromCurrentParams`) but still a whole
 * entry at a time, so text never leaves the grid; during that one transition
 * each entry leaving the top is appended at the bottom, and once the playing
 * song is at the top the list is re-cut there and finite again.
 *
 * NO PER-FRAME RENDERING: the cells are built once per layout and written
 * imperatively, and only when the entry a slot shows actually changes; the
 * two layers are `contain: strict`, so a write repaints the list and nothing
 * else. React renders this component again only when the layout does.
 */

import { useEffect, useRef } from 'react'
import { createRowWheel } from '../editor/rowWheel'
import { buildScrollPlanFromCurrentParams, sampleScrollPlan } from '@thockdown/interaction/ScrollCurvePlan'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'
import { songListTitleText, type MusicSongEntry } from '../shared/audioPlayer'
import { dropWideGlyphs } from './cellGlyphs'
import { commitPoolFilterDraft, readShownPoolFilter, subscribePoolFilterDraft } from './poolFilterDraft'
import { middleStripOf, setMiddleHoles } from './middleHoles'
import { songListEntry, type VisualizerLayout } from './visualizerLayout'

export type SongListArea = { column: number; row: number; columns: number; rows: number; slots: number }

type SlotCells = {
  /** Behind the playing song's entry only. */
  plate: HTMLDivElement
  open: HTMLDivElement
  close: HTMLDivElement
  letters: HTMLDivElement[]
  /** What the slot shows now, so a write that changes nothing is skipped: `${id}:${isCurrent}`, or '' when empty. */
  shown: string
}

export function SongList({ layout, area, glyphFont }: { layout: VisualizerLayout; area: SongListArea; glyphFont: string }) {
  const boxesRef = useRef<HTMLDivElement | null>(null)
  const lettersRef = useRef<HTMLDivElement | null>(null)
  const hitRef = useRef<HTMLDivElement | null>(null)
  const { boxPx, originXPx, originYPx } = layout
  const left = originXPx + area.column * boxPx
  const top = originYPx + area.row * boxPx
  const width = area.columns * boxPx
  const height = area.rows * boxPx

  useEffect(() => {
    const boxesLayer = boxesRef.current
    const lettersLayer = lettersRef.current
    const hit = hitRef.current
    if (!boxesLayer || !lettersLayer || !hit) return
    const nameColumns = area.columns - 4
    const pitchPx = 2 * boxPx

    const box = (className: string, parent: HTMLElement, column: number, row: number, span = 1) => {
      const element = document.createElement('div')
      element.className = className
      element.style.left = `${column * boxPx}px`
      element.style.top = `${row * boxPx}px`
      element.style.width = `${span * boxPx}px`
      element.style.height = `${boxPx}px`
      parent.appendChild(element)
      return element
    }
    const slots: SlotCells[] = []
    for (let slot = 0; slot < area.slots; slot += 1) {
      const row = slot * 2
      const plate = box('visualizer-song-plate', boxesLayer, 0, row)
      const open = box('visualizer-lit', boxesLayer, 0, row)
      const close = box('visualizer-lit', boxesLayer, 0, row)
      const letters: HTMLDivElement[] = []
      for (let index = 0; index < nameColumns; index += 1) {
        const letter = box('visualizer-letter', lettersLayer, index + 2, row)
        letter.style.lineHeight = `${boxPx}px`
        letters.push(letter)
      }
      plate.hidden = true
      open.hidden = true
      close.hidden = true
      slots.push({ plate, open, close, letters, shown: '' })
    }

    /** The pool in pick order from the playing song on (or from its head, when the playing song is not in it). */
    let songs: MusicSongEntry[] = []
    /** The entry in the top slot. */
    let offset = 0
    /** True only while travelling home after the playing song changed: entries scrolled off the top are appended at the bottom. */
    let appending = false
    let hovered = false
    let travel: number | null = null

    const fromPlaying = (pool: MusicSongEntry[]): MusicSongEntry[] => {
      const id = readNowPlaying().song?.id
      const index = id === undefined ? -1 : pool.findIndex((song) => song.id === id)
      return index <= 0 ? pool : [...pool.slice(index), ...pool.slice(0, index)]
    }

    const draw = () => {
      const currentId = readNowPlaying().song?.id
      for (let slot = 0; slot < slots.length; slot += 1) {
        const cells = slots[slot]
        const index = offset + slot
        const song = index < songs.length ? songs[index]
          : appending && index - songs.length < offset ? songs[index - songs.length] : null
        const isCurrent = song !== null && song.id === currentId
        const key = song ? `${song.id}:${isCurrent}` : ''
        if (key === cells.shown) continue
        cells.shown = key
        if (!song) {
          cells.plate.hidden = cells.open.hidden = cells.close.hidden = true
          for (const letter of cells.letters) letter.textContent = ''
          continue
        }
        const { text, closingColumn } = songListEntry(dropWideGlyphs(songListTitleText(song), glyphFont), area.columns)
        const chars = Array.from(text)
        cells.open.hidden = false
        cells.close.hidden = false
        cells.close.style.left = `${closingColumn * boxPx}px`
        cells.plate.hidden = !isCurrent
        cells.plate.style.width = `${(closingColumn + 1) * boxPx}px`
        for (let index = 0; index < cells.letters.length; index += 1) {
          const char = chars[index] ?? ''
          cells.letters[index].textContent = char === ' ' ? '' : char
        }
      }
      cutPlateHole()
    }

    // The plate sits on the stage, cut out of the middle strip (middleHoles.ts).
    const middle = middleStripOf(boxesLayer)
    const cutPlateHole = () => {
      if (!middle) return
      // The slot showing the playing song (the top one, at rest).
      const holes = []
      for (let slot = 0; slot < slots.length; slot += 1) {
        if (slots[slot].plate.hidden) continue
        holes.push({ x: left, y: top - middle.offsetTop + slot * 2 * boxPx, width: parseFloat(slots[slot].plate.style.width), height: boxPx })
      }
      setMiddleHoles(middle, 'song-list', holes)
    }

    /** Scroll so entry `next` is in the top slot, clamped to the list; false when that moves nothing. */
    const setOffset = (next: number): boolean => {
      const clamped = Math.max(0, Math.min(songs.length - 1, next))
      if (clamped === offset) return false
      offset = clamped
      draw()
      return true
    }

    const stopTravel = () => {
      if (travel !== null) cancelAnimationFrame(travel)
      travel = null
    }
    /** Re-cut the list at the playing song, which is in the top slot: what was appended is the list's own tail now, so nothing on screen changes. */
    const recut = () => {
      songs = fromPlaying(songs)
      offset = 0
      appending = false
      for (const cells of slots) cells.shown = '\u0000'
      draw()
    }
    /** Scroll to the playing song, a whole entry at a time on the reader's scroll curve. */
    const travelHome = () => {
      stopTravel()
      const playingId = readNowPlaying().song?.id
      const target = Math.max(0, songs.findIndex((song) => song.id === playingId))
      appending = target > 0
      if (target === offset) { recut(); return }
      const start = offset
      const entries = target - start
      const plan = buildScrollPlanFromCurrentParams(entries * pitchPx)
      const startMs = performance.now()
      const step = (nowMs: number) => {
        const elapsedSec = (nowMs - startMs) / 1000
        const done = elapsedSec >= plan.totalDurationSec
        const moved = done ? entries : Math.sign(entries) * Math.round(Math.abs(sampleScrollPlan(plan, elapsedSec)) / pitchPx)
        setOffset(start + moved)
        if (done) recut()
        travel = done ? null : requestAnimationFrame(step)
      }
      travel = requestAnimationFrame(step)
    }

    const wheel = createRowWheel({
      scrollRows: (rows) => {
        if (rows === 0) return false
        stopTravel()
        return setOffset(offset + rows)
      },
      isBlocked: () => false,
    })

    // The pool's order is re-read whenever a write to it can have happened
    // (see NowPlaying.pool), or the filter's fields change. While the reader is turning the list it keeps
    // the song they are looking at at the top; otherwise it shows the
    // playing song at the top.
    let request = 0
    let lastSong = readNowPlaying().song
    let lastPool = readNowPlaying().pool
    let lastFilter = readShownPoolFilter()
    const refresh = async () => {
      const ticket = ++request
      const pool = readNowPlaying().pool
      const next = pool ? await window.thockdownAudioPlayer?.getPool({ slots: [...pool.slots], filter: readShownPoolFilter() }) ?? [] : []
      if (ticket !== request) return
      // While the reader is over the list (or it is travelling home), the
      // ring keeps its cut and position, so nothing on screen moves: a song
      // they just pressed, or the next one taking over, only takes the
      // plate. Otherwise the ring is cut at the playing song, at the top.
      const head = songs[0]?.id
      const at = hovered || travel !== null ? next.findIndex((song) => song.id === head) : -1
      if (at < 0) {
        stopTravel()
        songs = fromPlaying(next)
        offset = 0
        appending = false
      } else {
        songs = [...next.slice(at), ...next.slice(0, at)]
        offset = Math.min(offset, Math.max(0, songs.length - 1))
        if (!hovered) travelHome()
      }
      for (const cells of slots) cells.shown = '\u0000'
      draw()
    }
    void refresh()
    const unsubscribe = subscribeNowPlaying(() => {
      const { song, pool } = readNowPlaying()
      if (song === lastSong && pool === lastPool) return
      lastSong = song
      lastPool = pool
      void refresh()
    })
    // The filter's fields, as typed: the list follows them before playback does.
    const unsubscribeFilter = subscribePoolFilterDraft(() => {
      const filter = readShownPoolFilter()
      if (filter === lastFilter) return
      lastFilter = filter
      void refresh()
    })

    const onEnter = () => {
      hovered = true
      stopTravel()
      // Back over the list, it is finite again: the appended tail goes.
      if (appending) { appending = false; draw() }
    }
    const onLeave = () => {
      hovered = false
      wheel.stop('left the list')
      travelHome()
    }
    const onPress = (event: PointerEvent) => {
      if (event.button !== 0 || songs.length === 0) return
      const rect = hit.getBoundingClientRect()
      const row = Math.floor((event.clientY - rect.top) / boxPx)
      if (row % 2 !== 0) return
      const song = songs[offset + row / 2]
      if (!song) return
      // A song chosen from the list as filtered is played from that pool.
      commitPoolFilterDraft()
      readNowPlaying().playFromPool(song.id)
    }
    hit.addEventListener('wheel', wheel.handleWheel, { passive: false })
    hit.addEventListener('pointerenter', onEnter)
    hit.addEventListener('pointerleave', onLeave)
    hit.addEventListener('pointerdown', onPress)

    return () => {
      request += 1
      unsubscribe()
      unsubscribeFilter()
      stopTravel()
      wheel.stop('unmount')
      hit.removeEventListener('wheel', wheel.handleWheel)
      hit.removeEventListener('pointerenter', onEnter)
      hit.removeEventListener('pointerleave', onLeave)
      hit.removeEventListener('pointerdown', onPress)
      if (middle) setMiddleHoles(middle, 'song-list', [])
      boxesLayer.replaceChildren()
      lettersLayer.replaceChildren()
    }
  }, [area.columns, area.rows, area.slots, boxPx, glyphFont, left, top])

  const frame = { left, top, width, height }
  return (
    <>
      <div ref={boxesRef} className="visualizer-song-list is-boxes" style={frame} />
      <div ref={lettersRef} className="visualizer-song-list is-letters" style={frame} />
      <div ref={hitRef} className="visualizer-song-list-hit" style={frame} />
    </>
  )
}
