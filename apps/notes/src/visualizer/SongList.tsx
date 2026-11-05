/**
 * The visualizer's song list: every song in the music pool, in pick order
 * (`shared/musicPool.ts`), drawn as an endless ring in the rectangle
 * `songListArea` gives, one entry on every other row. An entry is an accent
 * box, an empty box, the title cut to fit, an empty box, an accent box; the
 * song that is playing sits on the strip's own letterbox colour, the rest on
 * the middle's (so no box is drawn behind them at all).
 *
 * At rest the playing song is in the middle slot. Over the list the wheel
 * turns it a whole entry at a time with the edit view's own dynamics
 * (`editor/rowWheel.ts`: notch, step and spin coast); leaving it travels back
 * to the playing song the short way round, on the reader's smooth-scroll
 * curve (`buildScrollPlanFromCurrentParams`) but still a whole entry at a
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
import { songTitleText, type MusicSongEntry } from '../shared/audioPlayer'
import { ringDistance, songListEntry, songListIndex, type VisualizerLayout } from './visualizerLayout'

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

export function SongList({ layout, area }: { layout: VisualizerLayout; area: SongListArea }) {
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
    const centerSlot = Math.floor((area.slots - 1) / 2)
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

    let songs: MusicSongEntry[] = []
    let center = 0
    let hovered = false
    let travel: number | null = null

    const currentIndex = (): number => {
      const id = readNowPlaying().song?.id
      const index = id === undefined ? -1 : songs.findIndex((song) => song.id === id)
      return index < 0 ? 0 : index
    }

    const draw = () => {
      const currentId = readNowPlaying().song?.id
      for (let slot = 0; slot < slots.length; slot += 1) {
        const cells = slots[slot]
        const song = songs.length > 0 ? songs[songListIndex(center, slot, centerSlot, songs.length)] : null
        const isCurrent = song !== null && song.id === currentId
        const key = song ? `${song.id}:${isCurrent}` : ''
        if (key === cells.shown) continue
        cells.shown = key
        if (!song) {
          cells.plate.hidden = cells.open.hidden = cells.close.hidden = true
          for (const letter of cells.letters) letter.textContent = ''
          continue
        }
        const { text, closingColumn } = songListEntry(songTitleText(song), area.columns)
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
    }

    const setCenter = (next: number) => {
      const count = songs.length
      center = count > 0 ? ((next % count) + count) % count : 0
      draw()
    }

    const stopTravel = () => {
      if (travel !== null) cancelAnimationFrame(travel)
      travel = null
    }
    /** Back to the playing song, the short way round, a whole entry at a time on the reader's scroll curve. */
    const travelHome = () => {
      stopTravel()
      const count = songs.length
      if (count === 0) return
      const start = center
      const entries = ringDistance(start, currentIndex(), count)
      if (entries === 0) return
      const plan = buildScrollPlanFromCurrentParams(entries * pitchPx)
      const startMs = performance.now()
      const step = (nowMs: number) => {
        const elapsedSec = (nowMs - startMs) / 1000
        const done = elapsedSec >= plan.totalDurationSec
        const moved = done ? entries : Math.round(sampleScrollPlan(plan, elapsedSec) / pitchPx)
        if (start + moved !== center) setCenter(start + moved)
        travel = done ? null : requestAnimationFrame(step)
      }
      travel = requestAnimationFrame(step)
    }

    const wheel = createRowWheel({
      scrollRows: (rows) => {
        if (songs.length === 0 || rows === 0) return false
        stopTravel()
        setCenter(center + rows)
        return true
      },
      isBlocked: () => false,
    })

    // The pool's order is re-read whenever a write to it can have happened
    // (see NowPlaying.pool). While the reader is turning the list it keeps
    // the song they are looking at in the middle; otherwise it shows the
    // playing song there.
    let request = 0
    let lastSong = readNowPlaying().song
    let lastPool = readNowPlaying().pool
    const refresh = async () => {
      const ticket = ++request
      const pool = readNowPlaying().pool
      const next = pool ? await window.thockdownAudioPlayer?.getPool([...pool.slots]) ?? [] : []
      if (ticket !== request) return
      const heldId = hovered && songs.length > 0 ? songs[center]?.id : undefined
      songs = next
      for (const cells of slots) cells.shown = '\u0000'
      const held = heldId === undefined ? -1 : songs.findIndex((song) => song.id === heldId)
      if (held >= 0) {
        setCenter(held)
      } else {
        stopTravel()
        setCenter(currentIndex())
      }
    }
    void refresh()
    const unsubscribe = subscribeNowPlaying(() => {
      const { song, pool } = readNowPlaying()
      if (song === lastSong && pool === lastPool) return
      lastSong = song
      lastPool = pool
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
      const song = songs[songListIndex(center, row / 2, centerSlot, songs.length)]
      if (song) readNowPlaying().playFromPool(song.id)
    }
    hit.addEventListener('wheel', wheel.handleWheel, { passive: false })
    hit.addEventListener('pointerenter', onEnter)
    hit.addEventListener('pointerleave', onLeave)
    hit.addEventListener('pointerdown', onPress)

    return () => {
      request += 1
      unsubscribe()
      stopTravel()
      wheel.stop('unmount')
      hit.removeEventListener('wheel', wheel.handleWheel)
      hit.removeEventListener('pointerenter', onEnter)
      hit.removeEventListener('pointerleave', onLeave)
      hit.removeEventListener('pointerdown', onPress)
      boxesLayer.replaceChildren()
      lettersLayer.replaceChildren()
    }
  }, [area.columns, area.rows, area.slots, boxPx])

  const frame = { left, top, width, height }
  return (
    <>
      <div ref={boxesRef} className="visualizer-song-list is-boxes" style={frame} />
      <div ref={lettersRef} className="visualizer-song-list is-letters" style={frame} />
      <div ref={hitRef} className="visualizer-song-list-hit" style={frame} />
    </>
  )
}
