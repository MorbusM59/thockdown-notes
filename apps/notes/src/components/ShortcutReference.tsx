import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import {
  SHORTCUT_GROUPS,
  displayChords,
  pressPrefix,
  shortcutsInGroup,
  type ChordDisplay,
  type ShortcutDeclaration,
} from '../shared/keyboardShortcuts'
import { mouseGesturesInGroup, type MouseGesture } from '../shared/mouseGestures'
import { HOLD_CAP, capForKey, capsForGesture, legendOf, type KeyCap } from './keyCaps'
import { GAP_PX, PADDING_PX, arrangeSections, type Arrangement } from './shortcutReferenceLayout'

// The keyboard shortcut reference: every declaration in
// shared/keyboardShortcuts.ts and every gesture in shared/mouseGestures.ts,
// grouped into panels over the whole window, for as long as F1 is held
// (shared/useHelpKey.ts).
//
// A PANEL IS AN OPTIONS SECTION, unfolded. It is built from the options
// sidebar's own classes -- the section's card, its heading, its body's flow
// rule and its sub-section labels (packages/interaction/interaction.css) --
// so it looks like the sidebar because it is drawn by the same rules, not by
// a copy of them. Only the fold arrow is taken off: nothing here folds.
//
// EVERY KEY IS ONE SQUARE CAP (keyCaps.ts), an icon or a short text, so a
// combination's width is its number of keys. The legend for the caps that do
// not name themselves is not a panel: it is its own column down the left of
// the window, as wide as its content, and the panels are arranged in what
// is left. Every panel's key column is one
// width, the widest key cell anywhere, so the descriptions line up across
// the window; descriptions wrap at a fixed width rather than widening a row.
//
// IT NEVER SCROLLS, so the whole layout is zoomed to the window, and that is
// solved rather than searched for. The panels are measured once, unzoomed, in
// a hidden copy; CSS `zoom` scales layout exactly, so the arrangement drawn
// at zoom `s` is `s` times what was measured. For each column count the
// arrangement is computed on paper -- panels kept in reading order, split into
// contiguous columns so the tallest column is as short as it can be -- and
// the count that can be drawn largest wins (shortcutReferenceLayout.ts).
//
// The description width is a second free choice: narrow descriptions make
// panels tall and thin, wide ones short and wide, and which fits a window
// best depends on its shape. So the hidden copy is drawn once per candidate
// width (LABEL_WIDTHS_PX), each candidate is solved the same way, and the
// largest zoom wins -- a finite choice evaluated in one pass, not a search.
//
// The hidden copies are watched by a ResizeObserver along with the window, so
// a change of UI font (or the font finishing loading) re-measures by the same
// path as a resize.

/** Candidate description widths, unzoomed. */
const LABEL_WIDTHS_PX = [150, 190, 240, 300]

interface Row {
  caps: KeyCap[][]
  label: string
  alternative: boolean
}

interface Panel {
  id: string
  title: string
  icon: string
  shortcuts: Row[]
  gestures: Row[]
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

const PANELS: Panel[] = SHORTCUT_GROUPS
  .map((group) => ({
    id: group.id,
    title: group.title,
    icon: group.icon,
    shortcuts: shortcutsInGroup(group.id).flatMap(shortcutRows),
    gestures: mouseGesturesInGroup(group.id).map(gestureRow),
  }))
  .filter((panel) => panel.shortcuts.length + panel.gestures.length > 0)

const LEGEND_ROWS: Row[] = legendOf(PANELS.flatMap((panel) => [...panel.shortcuts, ...panel.gestures])
    .flatMap((row) => row.caps.flat()))
  .map((entry) => ({ caps: [entry.caps], label: entry.legend, alternative: false }))

function Cap({ cap }: { cap: KeyCap }) {
  return (
    <kbd className="shortcut-ref-cap">
      {cap.icon ? <i className={cap.icon} aria-hidden="true" /> : <span>{cap.text}</span>}
    </kbd>
  )
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <div className="shortcut-ref-rows">
      {rows.map((row, rowIndex) => (
        <Fragment key={rowIndex}>
          <span className="shortcut-ref-keys">
            {row.caps.map((group, groupIndex) => (
              <Fragment key={groupIndex}>
                {groupIndex > 0 ? <span className="shortcut-ref-or">/</span> : null}
                {group.map((cap, capIndex) => <Cap key={capIndex} cap={cap} />)}
              </Fragment>
            ))}
          </span>
          <span className={`shortcut-ref-label${row.alternative ? ' shortcut-ref-alternative' : ''}`}>{row.label}</span>
        </Fragment>
      ))}
    </div>
  )
}

function PanelView({ panel }: { panel: Panel }) {
  return (
    <section className="options-section sidebar-options-section shortcut-ref-section">
      <div className="sidebar-options-accordion">
        <h3 className="sidebar-options-section-heading">
          <span className={panel.icon} aria-hidden="true" />
          {panel.title}
        </h3>
        <div className="sidebar-options-accordion-body">
          {panel.shortcuts.length > 0 ? (
            <>
              <div className="options-subsection-label">Shortcuts</div>
              <Rows rows={panel.shortcuts} />
            </>
          ) : null}
          {panel.gestures.length > 0 ? (
            <>
              <div className="options-subsection-label">Mouse</div>
              <Rows rows={panel.gestures} />
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}

interface Solution extends Arrangement {
  labelWidthPx: number
  /** The window's size, unzoomed, so the zoomed layout fills it exactly. */
  widthPx: number
  heightPx: number
}

interface ShortcutReferenceProps {
  /**
   * The theme's surface colours (`loadoutTheme.ts`'s `shellVariables`). The
   * overlay sits outside `.app-shell`, which is where the theme sets them, so
   * without these its panels would draw input fields and buttons in the
   * stylesheet's defaults rather than in the colours the options sidebar it
   * copies is drawn in.
   */
  surfaceVariables: Record<string, string>
}

export function ShortcutReference({ surfaceVariables }: ShortcutReferenceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const measuresRef = useRef<HTMLDivElement | null>(null)
  const [solution, setSolution] = useState<Solution | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    const stage = stageRef.current
    const measures = measuresRef.current
    if (!host || !stage || !measures) return
    const solve = () => {
      // The key column first: every key cell keeps its own width in the
      // hidden copies, so the widest is read before the panels are measured
      // at the width it gives them.
      const widest = Math.max(0, ...Array.from(measures.querySelectorAll('.shortcut-ref-keys'), (keys) =>
        keys.getBoundingClientRect().width))
      host.style.setProperty('--shortcut-ref-keys-width', `${widest}px`)
      let best: Solution | null = null
      Array.from(measures.children).forEach((copy, index) => {
        const sections = Array.from(copy.children, (child) => {
          const rect = child.getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        })
        // The panels have the stage: whatever the legend column leaves.
        const widthPx = stage.clientWidth
        const arrangement = arrangeSections(sections, widthPx, stage.clientHeight)
        if (!best || arrangement.scale > best.scale) {
          best = { ...arrangement, labelWidthPx: LABEL_WIDTHS_PX[index], widthPx, heightPx: stage.clientHeight }
        }
      })
      setSolution(best)
    }
    solve()
    const observer = new ResizeObserver(solve)
    observer.observe(stage)
    Array.from(measures.children).forEach((copy) => observer.observe(copy))
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={hostRef}
      className="shortcut-reference"
      role="dialog"
      aria-label="Keyboard shortcuts"
      style={{ ...surfaceVariables, '--shortcut-ref-gap': `${GAP_PX}px`, '--shortcut-ref-padding': `${PADDING_PX}px` } as CSSProperties}
    >
      <div ref={measuresRef} className="shortcut-ref-measures" aria-hidden="true">
        {LABEL_WIDTHS_PX.map((width) => (
          <div key={width} className="shortcut-ref-measure" style={{ '--shortcut-ref-label-width': `${width}px` } as CSSProperties}>
            {PANELS.map((panel) => <PanelView key={panel.id} panel={panel} />)}
          </div>
        ))}
      </div>
      <aside className="shortcut-ref-legend" aria-label="Key legend">
        {LEGEND_ROWS.map((row) => (
          <div key={row.label} className="shortcut-ref-legend-entry">
            <span className="shortcut-ref-legend-caps">{row.caps[0].map((cap, index) => <Cap key={index} cap={cap} />)}</span>
            <span className="shortcut-ref-legend-name">{row.label}</span>
          </div>
        ))}
      </aside>
      <div ref={stageRef} className="shortcut-ref-stage">
      {solution ? (
        <div
          className="shortcut-ref-layout"
          style={{
            zoom: solution.scale,
            width: solution.widthPx / solution.scale,
            height: solution.heightPx / solution.scale,
            '--shortcut-ref-label-width': `${solution.labelWidthPx}px`,
          } as CSSProperties}
        >
          <div className="shortcut-ref-columns">
            {solution.columns.map((column) => (
              <div key={column.join('-')} className="shortcut-ref-column">
                {column.map((index) => <PanelView key={PANELS[index].id} panel={PANELS[index]} />)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      </div>
    </div>
  )
}
