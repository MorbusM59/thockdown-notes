/**
 * The visualizer's song filter: one field in the rectangle `poolFilterArea`
 * gives, bottom right, sharing the song list's lowest line. It is framed by
 * accent boxes and drawn one character per box like everything in the scene,
 * on the middle's colour, or on the letterbox colour (cut out of the middle
 * strip, `middleHoles.ts`) while it has the keyboard. An empty field shows
 * its prompt at half opacity.
 *
 * Typing is a real `<input>` over the field, its own text and caret
 * transparent, so selection, clipboard and IME are the browser's; the boxes
 * draw its value and caret. The song list follows every keystroke
 * (`poolFilterDraft.ts`); playback takes the filter when the reader leaves
 * the field: Enter, Tab, Escape (which empties the field first), a press
 * anywhere outside the field, or leaving the visualizer. Typed text that
 * reaches the scene with no field holding the keyboard goes to this field
 * (App.tsx, through
 * `registerPoolFilterFields`).
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { EMPTY_POOL_FILTER, type MusicPoolFilter } from '../shared/audioPlayer'
import { dropWideGlyphs } from './cellGlyphs'
import { middleStripOf, setMiddleHoles } from './middleHoles'
import { commitPoolFilterDraft, readShownPoolFilter, registerPoolFilterFields, setPoolFilterDraft, subscribePoolFilterDraft } from './poolFilterDraft'
import { subscribeNowPlaying } from '../sound/nowPlaying'
import { fieldWindow, type PoolFilterArea, type VisualizerLayout } from './visualizerLayout'

type FieldKey = keyof MusicPoolFilter
const FIELD: FieldKey = 'query'

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
  const field = { column: 1, row: 0, columns: area.columns - 2, placeholder: 'Filter songs...' }
  const accents: Array<[number, number]> = [[0, 0], [area.columns - 1, 0]]
  const cell = (column: number, row: number, width = 1) => ({ left: left + column * boxPx, top: top + row * boxPx, width: width * boxPx, height: boxPx })

  // The focused field's plate, cut out of the middle strip.
  const holeKey = focused ? `${field.column},${field.row},${field.columns}` : ''
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

  useEffect(() => registerPoolFilterFields({
    focused: () => inputs.current[FIELD] === document.activeElement ? FIELD : null,
    focus: (key) => {
      const input = inputs.current[key]
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
      setCaret(Array.from(input.value).length)
    },
    type: (key, text, fresh) => {
      const base = fresh ? EMPTY_POOL_FILTER : readShownPoolFilter()
      const next = base.query + text
      setPoolFilterDraft({ query: next })
      // Focused before React writes the new value, which puts the caret at
      // the end of it.
      inputs.current[key]?.focus()
      setCaret(Array.from(next).length)
    },
  }), [])

  const readCaret = (input: HTMLInputElement) => {
    // A code point index, as the boxes count.
    setCaret(Array.from(input.value.slice(0, input.selectionStart ?? input.value.length)).length)
  }
  const value = filter.query
  const isFocused = focused === FIELD
  const shown = value === ''
    ? { chars: Array.from(field.placeholder).slice(0, field.columns), caretColumn: 0 }
    : fieldWindow(dropWideGlyphs(value, glyphFont), isFocused ? caret : 0, field.columns)

  return (
    <>
      <div ref={anchorRef} hidden />
      {focused && <div className="visualizer-song-plate visualizer-bucket-box" style={cell(field.column, field.row, field.columns)} />}
      {accents.map(([column, row]) => <div key={`a${column}-${row}`} className="visualizer-lit visualizer-bucket-box" style={cell(column, row)} />)}
      {shown.chars.map((char, index) => (char === ' ' ? null : (
        <div
          key={`l${index}`}
          className={value === '' ? 'visualizer-letter is-panel is-placeholder' : 'visualizer-letter is-panel'}
          style={{ ...cell(field.column + index, field.row), lineHeight: `${boxPx}px` }}
        >
          {char}
        </div>
      )))}
      {isFocused && <div className="visualizer-filter-caret" style={cell(field.column + Math.min(shown.caretColumn, field.columns - 1), field.row)} />}
      <input
        ref={(element) => { inputs.current[FIELD] = element }}
        className="visualizer-filter-input"
        style={cell(field.column, field.row, field.columns)}
        value={value}
        aria-label={field.placeholder}
        spellCheck={false}
        autoComplete="off"
        onFocus={(event) => { setFocused(FIELD); readCaret(event.currentTarget) }}
        onBlur={() => { setFocused((current) => (current === FIELD ? null : current)); commitPoolFilterDraft() }}
        onChange={(event) => {
          setPoolFilterDraft({ query: event.currentTarget.value })
          readCaret(event.currentTarget)
        }}
        onSelect={(event) => readCaret(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            // Leaves the field emptied; the blur commits it.
            event.preventDefault()
            setPoolFilterDraft(EMPTY_POOL_FILTER)
            event.currentTarget.blur()
          }
        }}
      />
    </>
  )
}
