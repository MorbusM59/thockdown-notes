import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  SHORTCUT_GROUPS,
  displayChords,
  pressPrefix,
  shortcutsInGroup,
  type ShortcutDeclaration,
} from '../shared/keyboardShortcuts'
import { BASE_FONT_PX, GAP_EM, PADDING_EM, arrangeSections, type Arrangement } from './shortcutReferenceLayout'

// The keyboard shortcut reference: every declaration in
// shared/keyboardShortcuts.ts, grouped, over the active slot while Escape is
// held past the quick-actions menu (App.tsx's escape hold).
//
// IT NEVER SCROLLS, so the text is sized to the slot. That is solved rather
// than searched for. Every row is `white-space: nowrap` and every length in
// the panel is in `em`, so the whole layout is LINEAR in the font size: a
// section measured once at BASE_FONT_PX is exactly `scale` times that size at
// `scale * BASE_FONT_PX`. The sections are measured in a hidden copy, and for
// each column count the arrangement is computed on paper -- sections kept in
// reading order, split into contiguous columns so the tallest column is as
// short as it can be -- and the count whose arrangement can be drawn largest
// wins. A wide slot gets several columns side by side, a tall narrow one gets
// them stacked, and both get the largest text that fits.
//
// The hidden copy is watched by a ResizeObserver along with the slot, so a
// change of UI font (or the font finishing loading) re-measures by the same
// path as a resize; nothing has to know which happened.

const GROUPS = SHORTCUT_GROUPS
  .map((group) => ({ ...group, entries: shortcutsInGroup(group.id) }))
  .filter((group) => group.entries.length > 0)

function Keys({ declaration }: { declaration: ShortcutDeclaration }) {
  const parts: ReactNode[] = []
  const prefix = pressPrefix(declaration)
  if (prefix) parts.push(<span key="press" className="shortcut-ref-word">{prefix}</span>)
  displayChords(declaration).forEach(({ modifiers, keys }, groupIndex) => {
    if (groupIndex > 0) parts.push(<span key={`or-${groupIndex}`} className="shortcut-ref-word">or</span>)
    modifiers.forEach((modifier) => {
      parts.push(<kbd key={`${groupIndex}-${modifier}`}>{modifier}</kbd>)
    })
    keys.forEach((name, keyIndex) => {
      if (keyIndex > 0) parts.push(<span key={`${groupIndex}-sep-${keyIndex}`} className="shortcut-ref-word">/</span>)
      parts.push(<kbd key={`${groupIndex}-key-${keyIndex}`}>{name}</kbd>)
    })
  })
  return <span className="shortcut-ref-keys">{parts}</span>
}

function Section({ index }: { index: number }) {
  const group = GROUPS[index]
  return (
    <section className="shortcut-ref-section">
      <h3>{group.title}</h3>
      <div className="shortcut-ref-rows">
        {group.entries.map((entry) => (
          <div key={entry.label} className="shortcut-ref-row">
            <Keys declaration={entry} />
            <span className="shortcut-ref-label">{entry.label}</span>
          </div>
        ))}
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
      const sizes = Array.from(measure.children, (child) => {
        const rect = child.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
      setArrangement(arrangeSections(sizes, host.clientWidth, host.clientHeight))
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
        {GROUPS.map((group, index) => <Section key={group.id} index={index} />)}
      </div>
      {arrangement ? (
        <div className="shortcut-ref-layout" style={{ fontSize: arrangement.fontPx }}>
          {arrangement.columns.map((column) => (
            <div key={column.join('-')} className="shortcut-ref-column">
              {column.map((index) => <Section key={GROUPS[index].id} index={index} />)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
