import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  SHORTCUT_GROUPS,
  displayChords,
  pressPrefix,
  shortcutsInGroup,
  type ChordDisplay,
  type ShortcutDeclaration,
} from '../shared/keyboardShortcuts'
import { mouseGesturesInGroup, type MouseGesture } from '../shared/mouseGestures'
import { BASE_FONT_PX, GAP_EM, PADDING_EM, arrangeSections, type Arrangement } from './shortcutReferenceLayout'

// The keyboard shortcut reference: every declaration in
// shared/keyboardShortcuts.ts, grouped into panels over the whole window, for
// as long as F1 is held (shared/useHelpKey.ts).
//
// It borrows the quick-actions ring's look on purpose, because it is the same
// family of thing -- a layer over the app that is up while a key is held. The
// window behind it is blurred the way the ring's slot is, and every panel
// wears its group's icon in a square chip drawn like one of the ring's cells.
//
// IT NEVER SCROLLS, so the text is sized to the window. That is solved rather
// than searched for. Every row is `white-space: nowrap` and every length in
// the layout is in `em`, so the whole layout is LINEAR in the font size: a
// panel measured once at BASE_FONT_PX is exactly `scale` times that size at
// `scale * BASE_FONT_PX`. The panels are measured in a hidden copy, and for
// each column count the arrangement is computed on paper -- panels kept in
// reading order, split into contiguous columns so the tallest column is as
// short as it can be -- and the count whose arrangement can be drawn largest
// wins (shortcutReferenceLayout.ts). A wide window gets several columns, a
// tall narrow one gets them stacked, and both get the largest text that fits.
// Panels are as tall as their rows and sit at the top of their column; what
// room the fit leaves over stays below them rather than inside them.
//
// EVERY PANEL'S KEY COLUMN IS ONE WIDTH, the widest key cell anywhere, so the
// descriptions line up across the window. A row holds one combination
// (at most two modifiers and a key, by how the declarations are written);
// a declaration's other combinations go on rows of their own beneath it,
// marked as alternatives, rather than widening every panel to fit a chain.
// The width is measured in the hidden copy, where each key cell keeps its
// own size (`justify-self: end`), and set in em on the overlay, so both
// copies agree and it scales with the text like everything else.
//
// The hidden copy is watched by a ResizeObserver along with the window, so a
// change of UI font (or the font finishing loading) re-measures by the same
// path as a resize; nothing has to know which happened.

const GROUPS = SHORTCUT_GROUPS
  .map((group) => ({ ...group, entries: shortcutsInGroup(group.id), gestures: mouseGesturesInGroup(group.id) }))
  .filter((group) => group.entries.length + group.gestures.length > 0)

const MOUSE_VERB: Record<MouseGesture['action'], string> = { click: 'Click', hold: 'Hold', drag: 'Drag', wheel: 'Roll' }
const MOUSE_BUTTON: Record<NonNullable<MouseGesture['button']>, string> = { left: 'Left', right: 'Right' }

/** One combination: `Hold`, the modifiers, and its keys as alternatives (`← / →`). */
function Combination({ prefix, chord }: { prefix: string | null; chord: ChordDisplay }) {
  const parts: ReactNode[] = []
  if (prefix) parts.push(<span key="press" className="shortcut-ref-word">{prefix}</span>)
  chord.modifiers.forEach((modifier) => parts.push(<kbd key={`mod-${modifier}`}>{modifier}</kbd>))
  chord.keys.forEach((name, index) => {
    if (index > 0) parts.push(<span key={`sep-${index}`} className="shortcut-ref-word">/</span>)
    parts.push(<kbd key={`key-${index}`}>{name}</kbd>)
  })
  return <span className="shortcut-ref-keys">{parts}</span>
}

function ShortcutRows({ declaration }: { declaration: ShortcutDeclaration }) {
  const prefix = pressPrefix(declaration)
  return (
    <>
      {displayChords(declaration).map((chord, index) => (
        <div key={index} className="shortcut-ref-row">
          <Combination prefix={prefix} chord={chord} />
          {index === 0
            ? <span className="shortcut-ref-label">{declaration.label}</span>
            : <span className="shortcut-ref-label shortcut-ref-alternative">alternative shortcut</span>}
        </div>
      ))}
    </>
  )
}

function GestureRow({ gesture }: { gesture: MouseGesture }) {
  return (
    <div className="shortcut-ref-row">
      <span className="shortcut-ref-keys">
        <span className="shortcut-ref-word">{MOUSE_VERB[gesture.action]}</span>
        <kbd className="shortcut-ref-mouse">
          <i className="fa-solid fa-computer-mouse" aria-hidden="true" />
          {gesture.button ? MOUSE_BUTTON[gesture.button] : 'Wheel'}
        </kbd>
      </span>
      <span className="shortcut-ref-label">{gesture.label}</span>
    </div>
  )
}

function Header() {
  return (
    <header className="shortcut-ref-header">
      <span className="shortcut-ref-title">Keyboard shortcuts</span>
      <span className="shortcut-ref-word">Release</span>
      <kbd>F1</kbd>
      <span className="shortcut-ref-word">to close</span>
    </header>
  )
}

function Section({ index }: { index: number }) {
  const group = GROUPS[index]
  return (
    <section className="shortcut-ref-section">
      <h3>
        <span className="shortcut-ref-badge" aria-hidden="true"><i className={group.icon} /></span>
        {group.title}
      </h3>
      <div className="shortcut-ref-rows">
        {group.entries.map((entry) => <ShortcutRows key={entry.label} declaration={entry} />)}
        {group.gestures.length > 0 && group.entries.length > 0 ? <div className="shortcut-ref-divider" /> : null}
        {group.gestures.map((gesture) => <GestureRow key={`${gesture.action}-${gesture.label}`} gesture={gesture} />)}
      </div>
    </section>
  )
}

export function ShortcutReference() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [arrangement, setArrangement] = useState<Arrangement | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    const measure = measureRef.current
    if (!host || !measure) return
    const solve = () => {
      // The key column first: every key cell keeps its own width in the
      // hidden copy, so the widest is read before the panels are measured
      // at the width it gives them.
      const widest = Math.max(...Array.from(measure.querySelectorAll('.shortcut-ref-keys'), (keys) =>
        keys.getBoundingClientRect().width))
      host.style.setProperty('--shortcut-ref-keys-width', `${widest / BASE_FONT_PX}em`)
      const [header, ...sections] = Array.from(measure.children, (child) => {
        const rect = child.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
      setArrangement(arrangeSections(sections, header, host.clientWidth, host.clientHeight))
    }
    solve()
    const observer = new ResizeObserver(solve)
    observer.observe(host)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={hostRef}
      className="shortcut-reference"
      role="dialog"
      aria-label="Keyboard shortcuts"
      style={{ '--shortcut-ref-gap': `${GAP_EM}em`, '--shortcut-ref-padding': `${PADDING_EM}em` } as CSSProperties}
    >
      <div ref={measureRef} className="shortcut-ref-measure" aria-hidden="true" style={{ fontSize: BASE_FONT_PX }}>
        <Header />
        {GROUPS.map((group, index) => <Section key={group.id} index={index} />)}
      </div>
      {arrangement ? (
        <div className="shortcut-ref-layout" style={{ fontSize: arrangement.fontPx }}>
          <Header />
          <div className="shortcut-ref-columns">
            {arrangement.columns.map((column) => (
              <div key={column.join('-')} className="shortcut-ref-column">
                {column.map((index) => <Section key={GROUPS[index].id} index={index} />)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
