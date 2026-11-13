import { type ReactNode, useEffect, useRef, useState } from 'react'
import { armHold, HOLD_CONFIRM_MS } from './holdTiming'

/**
 * A DOCK ENTRY ROW: the row a sidebar view docks below its list for the
 * entry it is open on (a music set, a soundscape). Its mark is a button: a
 * click opens the icon picker for the entry (and closes it again), a held
 * click gives the entry back its default mark. Its name is renamed by a
 * right-click. What follows is the host's own cells (`children`), and the
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
  /** The entry's mark, drawn in its icon button. */
  mark: ReactNode
  /** Whether the icon picker is open for this entry. */
  picking: boolean
  onTogglePicker: () => void
  /** A held click on the mark: back to the entry's default mark. */
  onResetMark: () => void
  children?: ReactNode
}

export function DockEntryRow({ className, name, takenNames, onRename, mark, picking, onTogglePicker, onResetMark, children }: DockEntryRowProps) {
  return (
    <div className={`options-curve-row ${className}`}>
      <MarkButton name={name} mark={mark} picking={picking} onToggle={onTogglePicker} onReset={onResetMark} />
      <EntryName name={name} takenNames={takenNames} onRename={onRename} />
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
      data-tooltip={`Pick an icon for ${name}; hold for its default`}
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
      {mark}
    </button>
  )
}

function EntryName({ name, takenNames, onRename }: { name: string; takenNames: readonly string[]; onRename: (name: string) => Promise<void> | void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

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
      className="options-curve-cell options-curve-display options-dock-entry-name"
      data-tooltip="Right-click to rename"
      aria-label={`${name}; right-click to rename`}
      data-secondary-press="action"
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setDraft(name)
        setError(null)
        setEditing(true)
      }}
    >
      {name}
    </button>
  )
}
