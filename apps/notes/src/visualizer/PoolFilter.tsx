/**
 * The visualizer's pool filter: three fields in the rectangle `poolFilterArea`
 * gives, bottom right, sharing the song list's lowest line. The top row is
 * artist and album side by side, the row two below it the title, every field
 * framed by accent boxes (accent, artist, accent, album, accent; accent,
 * title, accent). A field is drawn one character per box like everything in
 * the scene, on the middle's colour, or on the letterbox colour (cut out of
 * the middle strip, `middleHoles.ts`) while it has the keyboard. An empty
 * field shows what it takes, at half opacity.
 *
 * Typing is a real `<input>` laid over each field, its own text and caret
 * transparent, so selection, clipboard and IME are the browser's; the boxes
 * draw its value and caret. The song list follows every keystroke
 * (`poolFilterDraft.ts`); playback takes the filter when the reader LEAVES a
 * field: Enter, Tab (which steps to the next field by name), a press anywhere
 * outside the fields, or leaving the visualizer.
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MusicPoolFilter } from '../shared/audioPlayer'
import { dropWideGlyphs } from './cellGlyphs'
import { middleStripOf, setMiddleHoles } from './middleHoles'
import { commitPoolFilterDraft, readShownPoolFilter, setPoolFilterDraft, subscribePoolFilterDraft } from './poolFilterDraft'
import { subscribeNowPlaying } from '../sound/nowPlaying'
import { fieldWindow, type PoolFilterArea, type VisualizerLayout } from './visualizerLayout'

type FieldKey = keyof MusicPoolFilter
const FIELD_ORDER: readonly FieldKey[] = ['artist', 'album', 'title']

const subscribeShown = (listener: () => void) => {
  const a = subscribePoolFilterDraft(listener)
  const b = subscribeNowPlaying(listener)
  return () => { a(); b() }
}

export function PoolFilter({ layout, area, glyphFont }: { layout: VisualizerLayout; area: PoolFilterArea; glyphFont: string }) {
  const filter = useSyncExternalStore(subscribeShown, readShownPoolFilter)
  const [focused, setFocused] = useState<FieldKey | null>(null)
  const [caret, setCaret] = useState(0)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const inputs = useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({})
  const { boxPx, originXPx, originYPx } = layout
  const left = originXPx + area.column * boxPx
  const top = originYPx + area.row * boxPx
  const wide = 2 * area.fieldColumns + 1

  // Each field's first column (from the area's) and row (0 or 2), and width.
  const fields: Record<FieldKey, { column: number; row: number; columns: number; placeholder: string }> = {
    artist: { column: 1, row: 0, columns: area.fieldColumns, placeholder: 'artist' },
    album: { column: area.fieldColumns + 2, row: 0, columns: area.fieldColumns, placeholder: 'album' },
    title: { column: 1, row: 2, columns: wide, placeholder: 'title' },
  }
  const accents: Array<[number, number]> = [[0, 0], [area.fieldColumns + 1, 0], [area.columns - 1, 0], [0, 2], [area.columns - 1, 2]]
  const cell = (column: number, row: number, width = 1) => ({ left: left + column * boxPx, top: top + row * boxPx, width: width * boxPx, height: boxPx })

  // The focused field's plate, cut out of the middle strip.
  const holeKey = focused ? `${fields[focused].column},${fields[focused].row},${fields[focused].columns}` : ''
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const middle = anchor ? middleStripOf(anchor) : null
    if (!middle) return
    const holes = holeKey === '' ? [] : [(() => {
      const [column, row, columns] = holeKey.split(',').map(Number)
      return { x: left + column * boxPx, y: top + row * boxPx - middle.offsetTop, width: columns * boxPx, height: boxPx }
    })()]
    setMiddleHoles(middle, 'pool-filter', holes)
    return () => setMiddleHoles(middle, 'pool-filter', [])
  }, [holeKey, boxPx, left, top])

  // Leaving the fields in any way commits: a press outside them (which,
  // focus being kept on a press, would not by itself take the keyboard
  // away) gives the keyboard back, and leaving the visualizer commits too.
  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      const active = document.activeElement
      if (!(active instanceof HTMLInputElement) || !Object.values(inputs.current).includes(active)) return
      if (event.target instanceof Node && Object.values(inputs.current).some((input) => input?.contains(event.target as Node))) return
      active.blur()
    }
    window.addEventListener('pointerdown', onPress, true)
    return () => {
      window.removeEventListener('pointerdown', onPress, true)
      commitPoolFilterDraft()
    }
  }, [])

  const readCaret = (input: HTMLInputElement) => {
    // A code point index, as the boxes count.
    setCaret(Array.from(input.value.slice(0, input.selectionStart ?? input.value.length)).length)
  }

  return (
    <>
      <div ref={anchorRef} hidden />
      {focused && <div className="visualizer-song-plate visualizer-bucket-box" style={cell(fields[focused].column, fields[focused].row, fields[focused].columns)} />}
      {accents.map(([column, row]) => <div key={`a${column}-${row}`} className="visualizer-lit visualizer-bucket-box" style={cell(column, row)} />)}
      {FIELD_ORDER.map((key) => {
        const field = fields[key]
        const value = filter[key]
        const isFocused = focused === key
        const shown = value === ''
          ? { chars: Array.from(field.placeholder).slice(0, field.columns), caretColumn: 0 }
          : fieldWindow(dropWideGlyphs(value, glyphFont), isFocused ? caret : 0, field.columns)
        return (
          <Fragment key={key}>
            {shown.chars.map((char, index) => (char === ' ' ? null : (
              <div
                key={`l${key}-${index}`}
                className={value === '' ? 'visualizer-letter is-panel is-placeholder' : 'visualizer-letter is-panel'}
                style={{ ...cell(field.column + index, field.row), lineHeight: `${boxPx}px` }}
              >
                {char}
              </div>
            )))}
            {isFocused && <div className="visualizer-filter-caret" style={cell(field.column + Math.min(shown.caretColumn, field.columns - 1), field.row)} />}
            <input
              ref={(element) => { inputs.current[key] = element }}
              className="visualizer-filter-input"
              style={cell(field.column, field.row, field.columns)}
              value={value}
              aria-label={field.placeholder}
              spellCheck={false}
              autoComplete="off"
              onFocus={(event) => { setFocused(key); readCaret(event.currentTarget) }}
              onBlur={() => { setFocused((current) => (current === key ? null : current)); commitPoolFilterDraft() }}
              onChange={(event) => {
                setPoolFilterDraft({ ...readShownPoolFilter(), [key]: event.currentTarget.value })
                readCaret(event.currentTarget)
              }}
              onSelect={(event) => readCaret(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                } else if (event.key === 'Tab') {
                  event.preventDefault()
                  const step = event.shiftKey ? FIELD_ORDER.length - 1 : 1
                  const next = inputs.current[FIELD_ORDER[(FIELD_ORDER.indexOf(key) + step) % FIELD_ORDER.length]]
                  commitPoolFilterDraft()
                  next?.focus()
                  next?.select()
                }
              }}
            />
          </Fragment>
        )
      })}
    </>
  )
}
