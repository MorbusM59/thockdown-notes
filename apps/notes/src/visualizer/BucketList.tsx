/**
 * The visualizer's set list: every music set in regular order, in the
 * rectangle `bucketListArea` gives, one entry on every other row from the
 * top, right-aligned and framed like the song list. It scrolls only when the
 * full list does not fit, marks clipped ends with an ellipsis, and returns to
 * the top after the pointer has been away for the shared grace period.
 *
 * Active sets sit on the letterbox colour, cut out of the middle strip
 * (`middleHoles.ts`). A press selects a set alone; Shift-press adds it to the
 * selection (`NowPlaying.selectSlot`). An empty set takes no press.
 */

import { useEffect, useRef } from 'react'
import { createRowWheel } from '../editor/rowWheel'
import { buildScrollPlanFromCurrentParams, sampleScrollPlan } from '@thockdown/interaction/ScrollCurvePlan'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'
import { dropWideGlyphs } from './cellGlyphs'
import { middleStripOf, setMiddleHoles } from './middleHoles'
import { clampListOffset, LIST_RETURN_GRACE_MS, maximumListOffset, visibleListWindow } from './listWindow'
import { songListEntry, type VisualizerLayout } from './visualizerLayout'
import type { SongListArea } from './SongList'

type SlotCells = {
  plate: HTMLDivElement
  open: HTMLDivElement
  close: HTMLDivElement
  letters: HTMLDivElement[]
  shown: string
}

export function BucketList({ layout, area, glyphFont }: { layout: VisualizerLayout; area: SongListArea; glyphFont: string }) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const hitRef = useRef<HTMLDivElement | null>(null)
  const { boxPx, originXPx, originYPx } = layout
  const left = originXPx + area.column * boxPx
  const top = originYPx + area.row * boxPx
  const width = area.columns * boxPx
  const height = area.rows * boxPx
  const right = originXPx + (area.column + area.columns) * boxPx
  useEffect(() => {
    const anchor = anchorRef.current
    const hit = hitRef.current
    const scene = anchor?.closest('.visualizer-scene')
    const middle = anchor ? middleStripOf(anchor) : null
    if (!anchor || !hit || !scene) return

    const cell = (element: HTMLDivElement, x: number, y: number, columns = 1) => {
      element.style.left = `${x}px`
      element.style.top = `${y}px`
      element.style.width = `${columns * boxPx}px`
      element.style.height = `${boxPx}px`
    }
    const makeCell = (className: string, x: number, y: number, columns = 1) => {
      const element = document.createElement('div')
      element.className = className
      cell(element, x, y, columns)
      scene.appendChild(element)
      return element
    }
    const nameColumns = area.columns - 4
    const slots: SlotCells[] = []
    for (let slot = 0; slot < area.slots; slot += 1) {
      const row = top + slot * 2 * boxPx
      const plate = makeCell('visualizer-song-plate visualizer-bucket-box', left, row)
      const open = makeCell('visualizer-lit visualizer-bucket-box', left, row)
      const close = makeCell('visualizer-lit visualizer-bucket-box', left, row)
      const letters = Array.from({ length: nameColumns }, (_, index) => {
        const letter = makeCell('visualizer-letter is-panel', left + (index + 2) * boxPx, row)
        letter.style.lineHeight = `${boxPx}px`
        return letter
      })
      plate.hidden = open.hidden = close.hidden = true
      slots.push({ plate, open, close, letters, shown: '\u0000' })
    }

    const initialNowPlaying = readNowPlaying()
    let orderedSets = initialNowPlaying.musicSets.filter(
      (set) => (initialNowPlaying.pool?.counts[set.slot] ?? 0) > 0,
    )
    let offset = 0
    let visibleEntries = visibleListWindow(orderedSets, offset, slots.length)
    let hovered = false
    let travel: number | null = null
    let returnHomeTimeout: number | null = null
    const pitchPx = 2 * boxPx

    const draw = () => {
      const { pool } = readNowPlaying()
      visibleEntries = visibleListWindow(orderedSets, offset, slots.length)
      for (let slot = 0; slot < slots.length; slot += 1) {
        const cells = slots[slot]
        const entry = visibleEntries[slot]
        if (!entry) {
          cells.shown = ''
          cells.plate.hidden = cells.open.hidden = cells.close.hidden = true
          for (const letter of cells.letters) letter.textContent = ''
          continue
        }

        const set = entry.kind === 'item' ? entry.value : null
        const active = set !== null && (pool?.slots.includes(set.slot) ?? false)
        const name = set?.name ?? '...'
        const key = entry.kind === 'ellipsis' ? 'ellipsis' : `${set?.slot}:${name}:${active}`
        if (key === cells.shown) continue
        cells.shown = key
        const { text, closingColumn } = songListEntry(dropWideGlyphs(name, glyphFont), area.columns)
        const chars = Array.from(text)
        const entryWidth = closingColumn + 1
        const entryLeft = right - entryWidth * boxPx
        const row = top + slot * pitchPx
        cells.plate.hidden = !active
        cells.open.hidden = false
        cells.close.hidden = false
        cell(cells.plate, entryLeft + boxPx, row, Math.max(0, closingColumn - 1))
        cell(cells.open, entryLeft, row)
        cell(cells.close, entryLeft + closingColumn * boxPx, row)
        for (let index = 0; index < cells.letters.length; index += 1) {
          cell(cells.letters[index], entryLeft + (index + 2) * boxPx, row)
          const char = chars[index] ?? ''
          cells.letters[index].textContent = char === ' ' ? '' : char
        }
      }

      if (!middle) return
      const holes = []
      for (let slot = 0; slot < slots.length; slot += 1) {
        const plate = slots[slot].plate
        if (plate.hidden) continue
        holes.push({
          x: parseFloat(plate.style.left) + boxPx,
          y: parseFloat(plate.style.top) - middle.offsetTop,
          width: parseFloat(plate.style.width),
          height: boxPx,
        })
      }
      setMiddleHoles(middle, 'bucket-list', holes)
    }

    const setOffset = (next: number): boolean => {
      const clamped = clampListOffset(next, orderedSets.length, slots.length)
      if (clamped === offset) return false
      offset = clamped
      draw()
      return true
    }
    const stopTravel = () => {
      if (travel !== null) cancelAnimationFrame(travel)
      travel = null
    }
    const travelHome = () => {
      stopTravel()
      if (offset === 0) {
        draw()
        return
      }
      const start = offset
      const entries = -start
      const plan = buildScrollPlanFromCurrentParams(entries * pitchPx)
      const startMs = performance.now()
      const step = (nowMs: number) => {
        const elapsedSec = (nowMs - startMs) / 1000
        const done = elapsedSec >= plan.totalDurationSec
        const moved = done ? entries : Math.sign(entries) * Math.round(Math.abs(sampleScrollPlan(plan, elapsedSec)) / pitchPx)
        setOffset(start + moved)
        if (done) {
          offset = 0
          draw()
        }
        travel = done ? null : requestAnimationFrame(step)
      }
      travel = requestAnimationFrame(step)
    }
    const clearReturnHomeTimeout = () => {
      if (returnHomeTimeout !== null) window.clearTimeout(returnHomeTimeout)
      returnHomeTimeout = null
    }

    const wheel = createRowWheel({
      scrollRows: (rows) => {
        if (rows === 0) return false
        stopTravel()
        return setOffset(offset + rows)
      },
      isBlocked: () => maximumListOffset(orderedSets.length, slots.length) === 0,
    })
    const onEnter = () => {
      hovered = true
      clearReturnHomeTimeout()
      stopTravel()
    }
    const onLeave = () => {
      hovered = false
      wheel.stop('left the list')
      clearReturnHomeTimeout()
      returnHomeTimeout = window.setTimeout(() => {
        returnHomeTimeout = null
        travelHome()
      }, LIST_RETURN_GRACE_MS)
    }
    const onPress = (event: PointerEvent) => {
      if (event.button !== 0) return
      const row = Math.floor((event.clientY - hit.getBoundingClientRect().top) / boxPx)
      if (row % 2 !== 0) return
      const slot = row / 2
      const entry = visibleEntries[slot]
      if (!entry || entry.kind !== 'item') return
      const set = entry.value
      if ((readNowPlaying().pool?.counts[set.slot] ?? 0) > 0) {
        readNowPlaying().selectSlot(set.slot, event.shiftKey)
      }
    }

    let lastPool = readNowPlaying().pool
    let lastSets = readNowPlaying().musicSets
    const refresh = () => {
      const current = readNowPlaying()
      const next = current.musicSets.filter((set) => (current.pool?.counts[set.slot] ?? 0) > 0)
      const preservePosition = hovered || travel !== null || returnHomeTimeout !== null
      const topEntry = visibleEntries.find((entry) => entry.kind === 'item')
      const topSet = topEntry?.kind === 'item' ? topEntry.value : null
      const at = preservePosition && topSet ? next.findIndex((set) => set.slot === topSet.slot) : -1
      const wasTraveling = travel !== null
      if (wasTraveling) stopTravel()
      orderedSets = next
      if (at < 0) {
        offset = preservePosition
          ? clampListOffset(offset, orderedSets.length, slots.length)
          : 0
      } else {
        offset = clampListOffset(Math.max(0, at - 1), orderedSets.length, slots.length)
      }
      for (const cells of slots) cells.shown = '\u0000'
      draw()
      if (wasTraveling && !hovered && returnHomeTimeout === null) travelHome()
    }

    draw()
    const unsubscribe = subscribeNowPlaying(() => {
      const current = readNowPlaying()
      if (current.pool === lastPool && current.musicSets === lastSets) return
      lastPool = current.pool
      lastSets = current.musicSets
      refresh()
    })
    hit.addEventListener('wheel', wheel.handleWheel, { passive: false })
    hit.addEventListener('pointerenter', onEnter)
    hit.addEventListener('pointerleave', onLeave)
    hit.addEventListener('pointerdown', onPress)

    return () => {
      unsubscribe()
      stopTravel()
      clearReturnHomeTimeout()
      wheel.stop('unmount')
      hit.removeEventListener('wheel', wheel.handleWheel)
      hit.removeEventListener('pointerenter', onEnter)
      hit.removeEventListener('pointerleave', onLeave)
      hit.removeEventListener('pointerdown', onPress)
      if (middle) setMiddleHoles(middle, 'bucket-list', [])
      for (const cells of slots) {
        cells.plate.remove()
        cells.open.remove()
        cells.close.remove()
        for (const letter of cells.letters) letter.remove()
      }
    }
  }, [area.columns, area.rows, area.slots, boxPx, glyphFont, height, left, right, top, width])

  return (
    <>
      <div ref={anchorRef} hidden />
      <div ref={hitRef} className="visualizer-bucket-hit" style={{ left, top, width, height }} />
    </>
  )
}
