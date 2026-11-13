import { useEffect, useRef } from 'react'
import { armHold, HOLD_COMMIT_MS } from '@thockdown/interaction/holdTiming'

/**
 * An xmark that does what cannot be undone (deleting, emptying) only once it
 * is HELD for HOLD_COMMIT_MS. A click does nothing, and is stopped, so the
 * button can sit inside a fold's summary without folding it.
 */
export function HoldToDeleteButton({ label, onHold, className = '' }: { label: string; onHold: () => void; className?: string }) {
  const cancelRef = useRef<(() => void) | null>(null)
  const cancel = () => {
    cancelRef.current?.()
    cancelRef.current = null
  }
  useEffect(() => cancel, [])
  return (
    <button
      type="button"
      className={`options-curve-cell options-curve-button ${className}`}
      data-tooltip={`Hold to ${label}`}
      aria-label={label}
      data-secondary-press="none"
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.button !== 0) return
        cancel()
        cancelRef.current = armHold(() => {
          cancelRef.current = null
          onHold()
        }, HOLD_COMMIT_MS)
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
    >
      <span className="fa-solid fa-xmark" aria-hidden="true" />
    </button>
  )
}
