import { type ReactNode, useEffect, useRef, useState } from 'react'
import { armHold, HOLD_CONFIRM_MS } from './holdTiming'

/**
 * A DOCK ENTRY ROW: the row a sidebar view docks below its list for the
 * entry it is open on (a music set, a soundscape). Its mark is a button: a
 * click opens the icon picker for the entry (and closes it again), a held
 * click gives the entry back its default mark. Its name is renamed by a
 * right-click, or by a finger held still on it (a finger has no right
 * button; the phone app has only fingers). What follows is the host's own cells (`children`), and the
 * row's columns are the host's too (`className`).
 */
export interface DockEntryRowProps {
  className: string
  /** The entry's name, as shown and as renamed. */
  name: string
  /** Every other entry's name: a rename onto one of them is refused here, in words. */
  takenNames: readonly string[]
  /** Rename; a rejection is shown on the field and keeps it open. */
  onRename: (name: string) => Promise<void> | void
  /** The entry's mark, drawn in its icon button; an entry without one (a schedule entry) has no icon button. */
  mark?: { node: ReactNode; picking: boolean; onTogglePicker: () => void; onResetMark: () => void }
  /** Text kept whole after the name, never cut by its ellipsis (a set's song count, "(42)"); not part of what is renamed. */
  nameSuffix?: string
  /** A line under the name, in the name's field (the phone's time left). */
  detail?: ReactNode
  children?: ReactNode
}

export function DockEntryRow({ className, name, nameSuffix, takenNames, onRename, mark, detail, children }: DockEntryRowProps) {
  return (
    <div className={`options-curve-row ${className}`}>
      {mark ? <MarkButton name={name} mark={mark.node} picking={mark.picking} onToggle={mark.onTogglePicker} onReset={mark.onResetMark} /> : null}
      <EntryName name={name} nameSuffix={nameSuffix} takenNames={takenNames} onRename={onRename} detail={detail} />
      {children}
    </div>
  )
}

function MarkButton({ name, mark, picking, onToggle, onReset }: { name: string; mark: ReactNode; picking: boolean; onToggle: () => void; onReset: () => void }) {
  const cancelHoldRef = useRef<(() => void) | null>(null)
  /** Set when the hold completes; the click its release dispatches then opens nothing. */
  const holdClaimedRef = useRef(false)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])
  return (
    <button
      type="button"
      className={`options-curve-cell options-curve-button options-dock-entry-icon${picking ? ' is-active' : ''}`}
      data-tooltip={`Change icon`}
      aria-label={`Pick an icon for ${name}`}
      aria-pressed={picking}
      data-secondary-press="none"
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.button !== 0) return
        holdClaimedRef.current = false
        cancelHold()
        cancelHoldRef.current = armHold(() => {
          cancelHoldRef.current = null
          holdClaimedRef.current = true
          onReset()
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
        onToggle()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {/* Blank while the picker is open: the icon is being chosen. */}
      {picking ? null : mark}
    </button>
  )
}

function EntryName({ name, nameSuffix, takenNames, onRename, detail }: { name: string; nameSuffix?: string; takenNames: readonly string[]; onRename: (name: string) => Promise<void> | void; detail?: ReactNode }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cancelTouchHoldRef = useRef<(() => void) | null>(null)
  const cancelTouchHold = () => {
    cancelTouchHoldRef.current?.()
    cancelTouchHoldRef.current = null
  }
  useEffect(() => cancelTouchHold, [])
  const startEditing = () => {
    setDraft(name)
    setError(null)
    setEditing(true)
  }

  useEffect(() => {
    if (!editing) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  const commit = async () => {
    const next = draft.trim()
    if (!next) {
      setEditing(false)
      return
    }
    // Names are unique; a clash is answered here, in words, rather than by
    // whatever stores the name.
    if (next !== name && takenNames.some((taken) => taken.toLowerCase() === next.toLowerCase())) {
      setError('That name is taken.')
      inputRef.current?.focus()
      return
    }
    try {
      await onRename(next)
      setError(null)
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename this.')
      inputRef.current?.focus()
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="options-curve-cell options-curve-display options-curve-input options-dock-entry-name"
        aria-label={`Name of ${name}`}
        aria-invalid={error !== null}
        data-tooltip={error ?? undefined}
        maxLength={64}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => { void commit() }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(name)
            setError(null)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className={`options-curve-cell options-curve-display options-dock-entry-name${detail ? ' has-detail' : ''}${nameSuffix ? ' has-suffix' : ''}`}
      data-tooltip="Rename"
      aria-label={`${nameSuffix ? `${name} ${nameSuffix}` : name}; right-click to rename`}
      data-secondary-press="action"
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.pointerType !== 'touch') return
        cancelTouchHold()
        cancelTouchHoldRef.current = armHold(() => {
          cancelTouchHoldRef.current = null
          startEditing()
        }, HOLD_CONFIRM_MS)
      }}
      onPointerUp={cancelTouchHold}
      onPointerCancel={cancelTouchHold}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        // A touch long press may also raise a contextmenu; the hold above
        // has already opened the field, and opening it twice is harmless.
        startEditing()
      }}
    >
      {detail || nameSuffix ? (<>
        <span className="options-dock-entry-title">
          {nameSuffix ? (<>
            <span className="options-dock-entry-label">{name}</span>
            {/* The space is the suffix's own, so it stays with it when the name wraps. */}
            <span className="options-dock-entry-suffix">{` ${nameSuffix}`}</span>
          </>) : name}
        </span>
        {detail ? <span className="options-dock-entry-detail">{detail}</span> : null}
      </>) : name}
    </button>
  )
}
