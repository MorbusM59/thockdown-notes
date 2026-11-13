import { useEffect, useRef, type ReactNode } from 'react'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'

/**
 * THE APP'S ROW ACTIONS: archive, trash, restore, remove, delete for good,
 * close, save. One rule for every list (notes, images, songs): a row shows
 * its plain information, and while the pointer is on it (`data-hovered` on
 * the row that carries `data-hover-host`) its actions take that
 * information's place as bare icons. Every action is a HOLD of
 * `HOLD_CONFIRM_MS` on its icon: a click does nothing, so a stray click
 * never files anything away, and nothing is ever primed.

 */

export interface HoverAction {
  /** Font Awesome class, e.g. "fa-box-archive". */
  icon: string
  /** What the hold does, as a tooltip and accessible name ("Archive note"). */
  label: string
  onHold: () => void
}

/** One action's icon: no button look, held to act. */
export function HoldIcon({ action, className = '' }: { action: HoverAction; className?: string }) {
  const cancelRef = useRef<(() => void) | null>(null)
  const cancel = () => {
    cancelRef.current?.()
    cancelRef.current = null
  }
  useEffect(() => () => cancelRef.current?.(), [])
  return (
    <span
      className={`hold-icon fa-solid ${action.icon}${className ? ` ${className}` : ''}`}
      role="button"
      aria-label={action.label}
      data-tooltip={`Hold to ${action.label.charAt(0).toLowerCase()}${action.label.slice(1)}`}
      data-secondary-press="none"
      onPointerDown={(event) => {
        // The row's own press (select, drag, fold) is not this one's.
        event.stopPropagation()
        if (event.button !== 0) return
        cancel()
        cancelRef.current = armHold(() => {
          cancelRef.current = null
          action.onHold()
        }, HOLD_CONFIRM_MS)
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onMouseLeave={cancel}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    />
  )
}

/**
 * `rest`, and in its place while the host row is hovered, the actions. Both
 * stay in layout, stacked in one grid cell, so the row neither grows nor
 * moves when they swap. With `rest` null the actions show alone on hover and
 * take no room otherwise (a song's title then has the whole row). `align`
 * places the actions within the cell `rest` sizes, matching how `rest` sits:
 * `end` (the default) for right-aligned meta, `start` for a left-aligned one
 * such as a divider's (count).
 */
export function HoverActions({ rest, actions, align = 'end' }: { rest: ReactNode; actions: readonly HoverAction[]; align?: 'start' | 'end' }) {
  if (actions.length === 0) return <>{rest}</>
  const icons = actions.map((action) => <HoldIcon key={action.icon} action={action} />)
  if (rest === null) return <span className="hover-swap-actions is-alone">{icons}</span>
  return (
    <span className={align === 'start' ? 'hover-swap is-start' : 'hover-swap'}>
      <span className="hover-swap-rest">{rest}</span>
      <span className="hover-swap-actions">{icons}</span>
    </span>
  )
}
