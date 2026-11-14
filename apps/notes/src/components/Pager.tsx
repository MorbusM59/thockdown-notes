import { useEffect, useRef, useState } from 'react'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'

/** The largest number the readout writes out; anything larger reads "many". */
export const PAGER_MAX_FIGURE = 9999

/**
 * One axis a pager moves along: the hits of a search, or the pages of a list.
 * Positions are 0-based here and shown 1-based.
 */
export interface PagerAxis {
  /** Where on the axis we are, or null when nowhere (no hit marked yet). */
  current: number | null
  total: number
  /** More exist than are counted: the total reads "many". */
  isTotalOpen?: boolean
  /** Go to a position, already clamped to the axis. */
  onGo: (position: number) => void
  /**
   * One step back or forward, when the axis steps by a rule of its own (a
   * search's next hit is found from the caret, and wraps). Without it a
   * step is `onGo(current ± 1)`, stopping at either end.
   */
  onStep?: (direction: 1 | -1) => void
}

/**
 * THE PAGER: paging and hit navigation in one element, for a list of pages,
 * a set of hits, or both together (a search whose hit list is paged).
 *
 * In order: page back, previous hit, the readout, next hit, page forward --
 * each arrow only where its axis is given. A press steps; holding the press
 * goes to the first or last item, the same hold every other press-and-hold
 * here uses (`armHold`). With hits, the readout between the arrows shows
 * `n | N` and a right-click turns it into a field for a match number. The
 * page is not written in the pager: a paged list shows it on the thumb of
 * its scrollbar (CanonicalScrollRail's `thumbLabel`).
 *
 * It fills the width it is given: the page arrows sit at its two ends, a
 * `--spacing-regular` in, and the parts between share the rest evenly, so it
 * can be a whole dock row or a slim part of one.
 */
export function Pager({ hits, pages, className }: { hits?: PagerAxis; pages?: PagerAxis; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (draft === null) return
    inputRef.current?.focus()
    inputRef.current?.select()
    // Only on entering the field, not on every typed character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft === null])

  // The page is not written here: a paged list shows it on its scrollbar's
  // thumb. The readout is the hits', and only typed into when there are hits.
  const entryAxis = hits
  // Plain figures, no thousands separator; past four digits a number reads
  // "many", which keeps the readout one width however large the list.
  const figure = (value: number) => (value > PAGER_MAX_FIGURE ? 'many' : String(value))
  const show = (axis: PagerAxis) => (axis.current === null ? '-' : figure(axis.current + 1))
  const showTotal = (axis: PagerAxis) => (axis.isTotalOpen ? 'many' : figure(axis.total))
  const readout = hits ? `${show(hits)} | ${showTotal(hits)}` : null

  const commit = () => {
    if (draft === null || !entryAxis) return
    const typed = Number.parseInt(draft.trim(), 10)
    setDraft(null)
    if (Number.isFinite(typed) && entryAxis.total > 0) {
      entryAxis.onGo(Math.min(Math.max(typed, 1), entryAxis.total) - 1)
    }
  }

  return (
    <div className={`pager options-curve-cell options-curve-display${className ? ` ${className}` : ''}`}>
      {pages ? <PagerArrow axis={pages} direction={-1} kind="page" /> : null}
      {hits ? <PagerArrow axis={hits} direction={-1} kind="hit" /> : null}
      {readout === null ? null : draft === null ? (
        <span
          className="pager-readout"
          data-tooltip="Right-click to go to a match"
          data-secondary-press="action"
          onContextMenu={(event) => {
            event.preventDefault()
            if (entryAxis && entryAxis.total > 0) setDraft(entryAxis.current === null ? '' : String(entryAxis.current + 1))
          }}
        >
          {readout}
        </span>
      ) : (
        <input
          ref={inputRef}
          className="pager-readout pager-field"
          type="text"
          inputMode="numeric"
          spellCheck={false}
          aria-label="Go to match"
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            else if (event.key === 'Escape' || event.key === 'Tab') setDraft(null)
          }}
          onBlur={() => setDraft(null)}
        />
      )}
      {hits ? <PagerArrow axis={hits} direction={1} kind="hit" /> : null}
      {pages ? <PagerArrow axis={pages} direction={1} kind="page" /> : null}
    </div>
  )
}

function PagerArrow({ axis, direction, kind }: { axis: PagerAxis; direction: 1 | -1; kind: 'hit' | 'page' }) {
  const cancelHoldRef = useRef<(() => void) | null>(null)
  /** Set when the hold completes; the click its release dispatches then does nothing more. */
  const holdClaimedRef = useRef(false)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])

  // Hits wrap, so their arrows always lead somewhere while there are any;
  // pages stop at either end, and an arrow with nowhere to go is dimmed.
  const atEnd = axis.total === 0 || (kind === 'page' && axis.current !== null
    && (direction === -1 ? axis.current <= 0 : axis.current >= axis.total - 1))
  const edge = direction === -1 ? 0 : axis.total - 1
  const step = () => {
    if (axis.total === 0) return
    if (axis.onStep) {
      axis.onStep(direction)
      return
    }
    const from = axis.current ?? (direction === 1 ? -1 : axis.total)
    const next = from + direction
    if (next >= 0 && next < axis.total) axis.onGo(next)
  }
  const noun = kind === 'hit' ? 'match' : 'page'
  const label = direction === -1 ? `Previous ${noun}; hold for the first` : `Next ${noun}; hold for the last`
  const icon = kind === 'hit'
    ? (direction === -1 ? 'fa-caret-left' : 'fa-caret-right')
    : `fa-right-to-bracket${direction === -1 ? ' pager-mirrored' : ''}`

  return (
    <button
      type="button"
      className={`pager-arrow${atEnd ? ' is-at-end' : ''}`}
      aria-label={label}
      data-tooltip={label}
      onPointerDown={(event) => {
        if (event.button !== 0 || axis.total === 0) return
        holdClaimedRef.current = false
        cancelHold()
        cancelHoldRef.current = armHold(() => {
          cancelHoldRef.current = null
          holdClaimedRef.current = true
          axis.onGo(edge)
        }, HOLD_CONFIRM_MS)
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onMouseLeave={cancelHold}
      onClick={() => {
        if (holdClaimedRef.current) {
          holdClaimedRef.current = false
          return
        }
        step()
      }}
    >
      <span className={`fa-solid ${icon}`} aria-hidden="true" />
    </button>
  )
}
