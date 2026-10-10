import { Fragment, type CSSProperties } from 'react'
import {
  SHORTCUT_PANELS,
  displayChords,
  pressPrefix,
  shortcutsInSection,
  type ChordDisplay,
  type ShortcutDeclaration,
} from '../shared/keyboardShortcuts'
import { mouseGesturesInSection, type MouseGesture } from '../shared/mouseGestures'
import { HOLD_CAP, capForKey, capsForGesture, legendOf, type KeyCap, type LegendEntry } from './keyCaps'

// The keyboard shortcut reference: every declaration in
// shared/keyboardShortcuts.ts and every gesture in shared/mouseGestures.ts,
// over the whole window, for as long as F1 is held (shared/useHelpKey.ts).
//
// It is ONE FLAT RUN OF ITEMS -- a panel's heading, a sub-section's label,
// and one item per shortcut or gesture -- in the order SHORTCUT_PANELS
// declares, poured into equal-width columns: top to bottom, then on into the
// next column (CSS multi-column layout, so the browser does the flowing).
// Nothing is scaled: every item is drawn at the options sidebar's own sizes,
// and a heading is kept with the item under it. The key legend is its own
// column down the left, as wide as its content.
//
// EVERY KEY IS ONE SQUARE CAP (keyCaps.ts), an icon or a short text, so a
// combination's width is its number of keys, and the key column is as wide
// as the longest combination anywhere (KEY_SLOTS) so the descriptions line
// up across the window.

interface Row {
  caps: KeyCap[][]
  label: string
  alternative: boolean
}

function shortcutRows(declaration: ShortcutDeclaration): Row[] {
  const hold = pressPrefix(declaration) ? [HOLD_CAP] : []
  return displayChords(declaration).map((chord: ChordDisplay, index) => {
    // A combination's alternative keys (`← / →`) are groups of one cap; the
    // press manner and the modifiers lead the first of them.
    // Alternatives drawn by the same cap (every arrow key) are drawn once.
    const caps = [...new Set(chord.keys.map(capForKey))].map((cap) => [cap])
    caps[0] = [...hold, ...chord.modifiers.map(capForKey), ...caps[0]]
    return {
      caps,
      label: index === 0 ? declaration.label : 'alternative shortcut',
      alternative: index > 0,
    }
  })
}

function gestureRow(gesture: MouseGesture): Row {
  return { caps: [capsForGesture(gesture)], label: gesture.label, alternative: false }
}

type Item =
  | { kind: 'panel'; title: string; icon: string }
  | { kind: 'section'; title: string }
  | { kind: 'row'; row: Row }

const PANELS = SHORTCUT_PANELS.filter((panel) => panel.inReference !== false)

const ITEMS: Item[] = PANELS.flatMap((panel) => {
  const sections = panel.sections
    .map((section) => ({
      title: section.title,
      rows: [...shortcutsInSection(section.id).flatMap(shortcutRows), ...mouseGesturesInSection(section.id).map(gestureRow)],
    }))
    .filter((section) => section.rows.length > 0)
  if (sections.length === 0) return []
  return [
    { kind: 'panel' as const, title: panel.title, icon: panel.icon },
    ...sections.flatMap((section) => [
      ...(section.title ? [{ kind: 'section' as const, title: section.title }] : []),
      ...section.rows.map((row) => ({ kind: 'row' as const, row })),
    ]),
  ]
})

const ROWS = ITEMS.flatMap((item) => (item.kind === 'row' ? [item.row] : []))

/** The longest combination, in caps plus `/` separators. */
const KEY_SLOTS = Math.max(...ROWS.map((row) => row.caps.flat().length + row.caps.length - 1))

const LEGEND: LegendEntry[] = legendOf(ROWS.flatMap((row) => row.caps.flat()))

function Cap({ cap }: { cap: KeyCap }) {
  return (
    <kbd className="shortcut-ref-cap">
      {cap.icon ? <i className={cap.icon} aria-hidden="true" /> : <span>{cap.text}</span>}
    </kbd>
  )
}

function RowView({ row }: { row: Row }) {
  return (
    <div className="shortcut-ref-row">
      <span className="shortcut-ref-keys">
        {row.caps.map((group, groupIndex) => (
          <Fragment key={groupIndex}>
            {groupIndex > 0 ? <span className="shortcut-ref-or">/</span> : null}
            {group.map((cap, capIndex) => <Cap key={capIndex} cap={cap} />)}
          </Fragment>
        ))}
      </span>
      <span className={`shortcut-ref-label${row.alternative ? ' shortcut-ref-alternative' : ''}`}>{row.label}</span>
    </div>
  )
}

function ItemView({ item }: { item: Item }) {
  if (item.kind === 'panel') {
    return (
      <h3 className="sidebar-options-section-heading shortcut-ref-heading">
        <span className={item.icon} aria-hidden="true" />
        {item.title}
      </h3>
    )
  }
  if (item.kind === 'section') return <div className="options-subsection-label shortcut-ref-heading">{item.title}</div>
  return <RowView row={item.row} />
}

interface ShortcutReferenceProps {
  /**
   * The theme's surface colours (`loadoutTheme.ts`'s `shellVariables`) and
   * the sidebar's texture. The overlay sits outside `.app-shell`, which is
   * where the theme sets them, so without these its items would stand on the
   * stylesheet's defaults rather than on the options sidebar's surface.
   */
  surfaceVariables: Record<string, string>
}

export function ShortcutReference({ surfaceVariables }: ShortcutReferenceProps) {
  return (
    <div
      className="shortcut-reference"
      role="dialog"
      aria-label="Keyboard shortcuts"
      style={{ ...surfaceVariables, '--shortcut-ref-key-slots': KEY_SLOTS } as CSSProperties}
    >
      <aside className="shortcut-ref-legend" aria-label="Key legend">
        {LEGEND.map((entry) => (
          <div key={entry.legend} className="shortcut-ref-legend-entry">
            <span className="shortcut-ref-legend-caps">{entry.caps.map((cap, index) => <Cap key={index} cap={cap} />)}</span>
            <span className="shortcut-ref-legend-name">{entry.legend}</span>
          </div>
        ))}
      </aside>
      <div className="shortcut-ref-items">
        {ITEMS.map((item, index) => <ItemView key={index} item={item} />)}
      </div>
    </div>
  )
}
