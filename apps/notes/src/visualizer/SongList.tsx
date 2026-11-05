/**
 * The visualizer's song list: every song in the music pool once, in pick
 * order (`shared/musicPool.ts`) from the playing song on, so the pool's ring
 * is cut at the playing song and laid out top to bottom, in the rectangle
 * `songListArea` gives, one entry on every other row. An entry is an accent
 * box, an empty box, the title cut to fit, an empty box, an accent box; the
 * song that is playing sits on the strip's own letterbox colour, the rest on
 * the middle's (so no box is drawn behind them at all).
 *
 * At rest the playing song is in the top slot. Over the list the wheel
 * scrolls it a whole entry at a time with the edit view's own dynamics
 * (`editor/rowWheel.ts`: notch, step and spin coast), as far as the last
 * entry in the top slot; leaving it travels back to the top, on the reader's
 * smooth-scroll curve (`buildScrollPlanFromCurrentParams`) but still a whole entry at a
 * time, so text never leaves the grid. A press on an entry plays it
 * (`NowPlaying.playFromPool`).
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
    /**
     * The entry in the top slot. Negative while the reader is over the list
     * after the playing song changed under them (a press, or a song ending):
     * the list is re-cut at the new playing song, but that song stays in the
     * slot where the reader saw it, so the slots above it show nothing until
     * the list travels home on leaving.
     */
    let offset = 0
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
        const song = songs[offset + slot] ?? null
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
      // Scrolling never moves further into the empty slots above the head.
      const clamped = Math.max(Math.min(0, offset), Math.min(songs.length - 1, next))
      if (clamped === offset) return false
      offset = clamped
      draw()
      return true
    }

    const stopTravel = () => {
      if (travel !== null) cancelAnimationFrame(travel)
      travel = null
    }
    /** Back to the top, a whole entry at a time on the reader's scroll curve. */
    const travelHome = () => {
      stopTravel()
      const start = offset
      const entries = -start
      if (entries === 0) return
      const plan = buildScrollPlanFromCurrentParams(entries * pitchPx)
      const startMs = performance.now()
      const step = (nowMs: number) => {
        const elapsedSec = (nowMs - startMs) / 1000
        const done = elapsedSec >= plan.totalDurationSec
        const moved = done ? entries : Math.round(sampleScrollPlan(plan, elapsedSec) / pitchPx)
        setOffset(start + moved)
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
      // While the reader is over the list, keep what they are looking at
      // where it is: the playing song in its slot if it is on screen (a song
      // they just pressed, or the next one taking over), else the top entry.
      const playingId = readNowPlaying().song?.id
      const playingSlot = songs.findIndex((song) => song.id === playingId) - offset
      const anchor = !hovered ? null
        : playingSlot >= 0 && playingSlot < slots.length ? { id: playingId, slot: playingSlot }
        : { id: songs[offset]?.id, slot: 0 }
      songs = fromPlaying(next)
      for (const cells of slots) cells.shown = '\u0000'
      const held = anchor ? songs.findIndex((song) => song.id === anchor.id) : -1
      if (held < 0) stopTravel()
      offset = held < 0 ? 0 : held - anchor!.slot
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
