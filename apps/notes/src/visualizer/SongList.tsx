/**
 * The visualizer's song list: a ring in pick order (`shared/musicPool.ts`),
 * initially cut at the playing song and laid out top to bottom, in the
 * rectangle `songListArea` gives, one entry on every other row. It wraps
 * endlessly when the pool is larger than the visible list. For a smaller
 * pool, its songs stay contiguous at the top and the unused slots stay empty
 * at the bottom; scrolling recycles each song from the top to the end without
 * ever showing the same song twice.
 * An entry is an accent box, an empty box, the title cut to fit, an empty box,
 * an accent box; the song that is playing sits on the strip's own letterbox
 * colour, the rest on the middle's (so no box is drawn behind them at all).
 *
 * The wheel scrolls it a whole entry at a time with the edit view's own
 * dynamics (`scroll/rowWheel.ts`: notch, step and spin coast). A press on an
 * entry plays it (`NowPlaying.playFromPool`), and while the pointer stays over
 * the list nothing moves: the pressed entry only takes the letterbox plate.
 * Two seconds after the pointer leaves, the list scrolls to the playing song
 * on the reader's smooth-scroll curve (`buildScrollPlanFromCurrentParams`)
 * but still a whole entry at a time, so text never leaves the grid; the
 * playing song is then re-cut at the top.
 *
 * NO PER-FRAME RENDERING: the cells are built once per layout and written
 * imperatively, and only when the entry a slot shows actually changes; the
 * two layers are `contain: strict`, so a write repaints the list and nothing
 * else. React renders this component again only when the layout does.
 */

import { useEffect, useRef } from 'react'
import { createRowWheel } from '../scroll/rowWheel'
import { buildScrollPlanFromCurrentParams, sampleScrollPlan } from '@thockdown/interaction/ScrollCurvePlan'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'
import { songListTitleText, type MusicSongEntry } from '../shared/audioPlayer'
import { dropWideGlyphs } from './cellGlyphs'
import { claimPlayback, commitPoolFilterDraft, readShownPoolFilter, subscribePoolFilterDraft } from './poolFilterDraft'
import { middleStripOf, setMiddleHoles } from './middleHoles'
import { LIST_RETURN_GRACE_MS } from './listWindow'
import { listRing, shortestListDistance, wrapListIndex } from './songListRing'
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
      // The plate fills only the boxes between the two accent boxes, which sit on
      // the middle section itself rather than on the plate.
      const plate = box('visualizer-song-plate', boxesLayer, 1, row)
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
    let ring = listRing(songs)
    /** The entry in the top slot. */
    let offset = 0
    let hovered = false
    let travel: number | null = null
    let returnHomeTimeout: number | null = null

    const fromPlaying = (pool: MusicSongEntry[]): MusicSongEntry[] => {
      const id = readNowPlaying().song?.id
      const index = id === undefined ? -1 : pool.findIndex((song) => song.id === id)
      return index <= 0 ? pool : [...pool.slice(index), ...pool.slice(0, index)]
    }

    const draw = () => {
      const currentId = readNowPlaying().song?.id
      for (let slot = 0; slot < slots.length; slot += 1) {
        const cells = slots[slot]
        const song = slot < ring.length ? ring[wrapListIndex(offset + slot, ring.length)] : null
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
        cells.plate.style.width = `${Math.max(0, closingColumn - 1) * boxPx}px`
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
        holes.push({ x: left + boxPx, y: top - middle.offsetTop + slot * 2 * boxPx, width: parseFloat(slots[slot].plate.style.width), height: boxPx })
      }
      setMiddleHoles(middle, 'song-list', holes)
    }

    /** Scroll so entry `next` is in the top slot, wrapping around the ring. */
    const setOffset = (next: number): boolean => {
      if (ring.length === 0) return false
      const wrapped = wrapListIndex(next, ring.length)
      if (wrapped === offset) return false
      offset = wrapped
      draw()
      return true
    }

    const stopTravel = () => {
      if (travel !== null) cancelAnimationFrame(travel)
      travel = null
    }
    /** Re-cut the ring at the playing song, which is now in the top slot. */
    const recut = () => {
      songs = fromPlaying(songs)
      ring = listRing(songs)
      offset = 0
      for (const cells of slots) cells.shown = '\u0000'
      draw()
    }
    /** Scroll to the playing song, a whole entry at a time on the reader's scroll curve. */
    const travelHome = () => {
      stopTravel()
      const playingId = readNowPlaying().song?.id
      const target = ring.findIndex((song) => song?.id === playingId)
      const entries = shortestListDistance(offset, target < 0 ? 0 : target, ring.length)
      if (entries === 0) { recut(); return }
      const start = offset
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
    // (see NowPlaying.pool), or the filter's fields change. While the reader is turning
    // the list it keeps the song at the top; otherwise it shows the playing song at the top.
    let request = 0
    let lastSong = readNowPlaying().song
    let lastPool = readNowPlaying().pool
    let lastFilter = readShownPoolFilter()
    const refresh = async () => {
      const ticket = ++request
      const pool = readNowPlaying().pool
      const next = pool ? await window.thockdownAudioPlayer?.getPool({ slots: [...pool.slots], filter: readShownPoolFilter() }) ?? [] : []
      if (ticket !== request) return
      const preservePosition = hovered || travel !== null || returnHomeTimeout !== null
      const topSong = ring[wrapListIndex(offset, ring.length)]
      const anchor = topSong ?? songs[0] ?? null
      const at = preservePosition && anchor ? next.findIndex((song) => song.id === anchor.id) : -1
      if (at < 0) {
        stopTravel()
        songs = fromPlaying(next)
        ring = listRing(songs)
        offset = 0
      } else {
        songs = [...next.slice(at), ...next.slice(0, at)]
        ring = listRing(songs)
        offset = topSong ? 0 : wrapListIndex(offset, ring.length)
        if (!hovered && returnHomeTimeout === null) travelHome()
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
      if (returnHomeTimeout !== null) window.clearTimeout(returnHomeTimeout)
      returnHomeTimeout = null
      stopTravel()
    }
    const onLeave = () => {
      hovered = false
      wheel.stop('left the list')
      if (returnHomeTimeout !== null) window.clearTimeout(returnHomeTimeout)
      returnHomeTimeout = window.setTimeout(() => {
        returnHomeTimeout = null
        travelHome()
      }, LIST_RETURN_GRACE_MS)
    }
    const onPress = (event: PointerEvent) => {
      if (event.button !== 0 || songs.length === 0) return
      const rect = hit.getBoundingClientRect()
      const row = Math.floor((event.clientY - rect.top) / boxPx)
      if (row % 2 !== 0) return
      const slot = row / 2
      if (slot >= ring.length) return
      const song = ring[wrapListIndex(offset + slot, ring.length)]
      if (!song) return
      // A song chosen from the list as filtered is played from that pool.
      commitPoolFilterDraft()
      claimPlayback()
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
      if (returnHomeTimeout !== null) window.clearTimeout(returnHomeTimeout)
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
