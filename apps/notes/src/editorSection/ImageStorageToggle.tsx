import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'
import { armHold, HOLD_COMMIT_MS } from '@thockdown/interaction/holdTiming'
import type { ImageStorageButton } from './useImageStorageButton'

// The image button: a globe while any image in the note points at the web or
// a file, the database (pressed) once every one is stored. A left hold
// stores them all; a right hold puts every stored image back to where it came
// from. Holds rather than clicks, at the commit threshold, because both
// rewrite the note (one undo step, with a snapshot taken first).
export function ImageStorageToggle({ button }: { button: ImageStorageButton }) {
  const cancelRef = useRef<(() => void) | null>(null)
  const cancel = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
  }, [])
  useEffect(() => cancel, [cancel])

  const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.button !== 2) return
    cancel()
    const action = event.button === 0 ? button.store : button.restore
    cancelRef.current = armHold(() => {
      cancelRef.current = null
      action()
    }, HOLD_COMMIT_MS)
  }, [button.restore, button.store, cancel])

  const isStored = button.state === 'stored'
  const failureLine = button.failures.length > 0 ? `\nNot stored: ${button.failures.join('; ')}` : ''
  const tooltip = isStored
    ? 'All images are stored in the app.\nHold right-click: point them back to where they came from.'
    : `Some images are loaded from the web or a file.\nHold left-click: download and store them in the app (works even with remote images off).\nHold right-click: point stored images back to where they came from.${failureLine}`

  return (
    <button
      type="button"
      className={`chapter-toggle-button btn-icon${isStored ? ' is-active' : ''}`}
      aria-pressed={isStored}
      aria-busy={button.busy}
      aria-label={isStored ? 'Images are stored in the app' : 'Some images are not stored in the app'}
      data-tooltip={tooltip}
      data-secondary-press="action"
      onPointerDown={handlePointerDown}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event: MouseEvent<HTMLButtonElement>) => { event.preventDefault() }}
    >
      <span className={isStored ? 'fa-solid fa-database' : 'fa-solid fa-globe'} aria-hidden="true" />
    </button>
  )
}
