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
import { GAP_PX, PADDING_PX, arrangeSections, linearSize, type Arrangement } from './shortcutReferenceLayout'

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
// IT NEVER SCROLLS, so the text is sized to the window, and that is solved
// from measurements rather than tried on screen. Only the TEXT is scaled --
// glyphs, key caps, line boxes and the description width, which all follow
// the UI text size -- while spacing, borders and corners keep the sizes the
// rest of the app has. That is what lets the panels go through double size
// mode exactly like the legend beside them and everything else: the mode
// halves the window the layout sees and supplies its own UI text size, and
// the page zoom doubles the result. A CSS `zoom` on the panels did the
// fitting once, and scaled their borders and corners along with the text, so
// they no longer matched anything around them.
//
// Every length in a panel is therefore fixed or proportional to the text
// scale `k`, so each panel's width and height is a straight line in `k`
// (shortcutReferenceLayout.ts's `LinearSize`). Two hidden copies, at k = 1
// and k = 2, give each line exactly; the lines then answer, without drawing
// anything, how large the text can be for each way of splitting the panels
// into contiguous columns, and the split that allows the largest wins. The
// description width wraps at the same words at every `k` (it is scaled with
// the text), which is what keeps the lines straight.
//
// The description width is a second free choice: narrow descriptions make
// panels tall and thin, wide ones short and wide, and which fits a window
// best depends on its shape. So the copies are drawn once per candidate
// width (LABEL_WIDTHS_PX), each candidate is solved the same way, and the
// largest text wins -- a finite choice evaluated in one pass.
//
// The hidden copies are watched by a ResizeObserver along with the window, so
// a change of UI font (or the font finishing loading) re-measures by the same
// path as a resize.

/** Candidate description widths, at text scale 1. */

const LABEL_WIDTHS_PX = [150, 190, 240, 300]
/** The two text scales each candidate is measured at; two points fix a line. */
const MEASURE_SCALES = [1, 2] as const
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
  /** The key column's width at the solved scale. */
  keysWidthPx: number
}

interface ShortcutReferenceProps {
  /**
   * The theme's surface colours (`loadoutTheme.ts`'s `shellVariables`) and
   * the sidebar's texture. The overlay sits outside `.app-shell`, which is
   * where the theme sets them, so without these its panels would draw input
   * fields and buttons in the stylesheet's defaults, and stand on the blurred
   * window rather than on the surface the options sidebar they copy stands on.
   */
  surfaceVariables: Record<string, string>
}

export function ShortcutReference({ surfaceVariables }: ShortcutReferenceProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const measuresRef = useRef<HTMLDivElement | null>(null)
  const [solution, setSolution] = useState<Solution | null>(null)

  useLayoutEffect(() => {
    const stage = stageRef.current
    const measures = measuresRef.current
    if (!stage || !measures) return
    const solve = () => {
      const copies = Array.from(measures.children) as HTMLElement[]
      const copyAt = (labelIndex: number, scaleIndex: number) => copies[labelIndex * MEASURE_SCALES.length + scaleIndex]
      // The key column first. A key cell keeps its own width in the hidden
      // copies (it does not depend on the description width), so each row's
      // width is a line in the scale, read from the first candidate's two
      // copies; the column is the widest row at whatever scale is drawn.
      const keyWidths = (copy: HTMLElement) =>
        Array.from(copy.querySelectorAll('.shortcut-ref-keys'), (keys) => keys.getBoundingClientRect().width)
      const atOne = keyWidths(copyAt(0, 0))
      const atTwo = keyWidths(copyAt(0, 1))
      const keysWidthAt = (scale: number) => Math.max(0, ...atOne.map((one, row) =>
        (2 * one - atTwo[row]) + (atTwo[row] - one) * scale))
      copies.forEach((copy, index) => {
        copy.style.setProperty('--shortcut-ref-keys-width', `${keysWidthAt(MEASURE_SCALES[index % MEASURE_SCALES.length])}px`)
      })
      const sizesOf = (copy: HTMLElement) => Array.from(copy.children, (child) => {
        const rect = child.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
      let best: Solution | null = null
      LABEL_WIDTHS_PX.forEach((labelWidthPx, labelIndex) => {
        const one = sizesOf(copyAt(labelIndex, 0))
        const two = sizesOf(copyAt(labelIndex, 1))
        // The panels have the stage: whatever the legend column leaves.
        const arrangement = arrangeSections(one.map((size, index) => linearSize(size, two[index])), stage.clientWidth, stage.clientHeight)
        if (!best || arrangement.scale > best.scale) {
          best = { ...arrangement, labelWidthPx, keysWidthPx: keysWidthAt(arrangement.scale) }
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
      className="shortcut-reference"
      role="dialog"
      aria-label="Keyboard shortcuts"
      style={{ ...surfaceVariables, '--shortcut-ref-gap': `${GAP_PX}px`, '--shortcut-ref-padding': `${PADDING_PX}px` } as CSSProperties}
    >
      <div ref={measuresRef} className="shortcut-ref-measures" aria-hidden="true">
        {LABEL_WIDTHS_PX.flatMap((width) => MEASURE_SCALES.map((scale) => (
          <div
            key={`${width}-${scale}`}
            className="shortcut-ref-measure"
            style={{ '--shortcut-ref-label-width': `${width}px`, '--shortcut-ref-text-scale': scale } as CSSProperties}
          >
            {PANELS.map((panel) => <PanelView key={panel.id} panel={panel} />)}
          </div>
        )))}
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
            '--shortcut-ref-text-scale': solution.scale,
            '--shortcut-ref-label-width': `${solution.labelWidthPx}px`,
            '--shortcut-ref-keys-width': `${solution.keysWidthPx}px`,
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
