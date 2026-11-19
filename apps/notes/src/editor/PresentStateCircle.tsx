import { useCallback, useEffect, useState } from 'react'
import { useHoldToBranch } from './useHoldToBranch'

// The "empty scrollbar that's just a circle" affordance. Single
// responsibility, deliberately: it only reflects/toggles the present manual
// save-point state. Returning from a history preview to the live document is
// the timeline slider's job (dragging/navigating to the rightmost mark) --
// see the design discussion this was built from for why splitting these two
// jobs apart is preferable to v1's single overloaded "present box".

export type PresentStateCircleProps = {
  hasPendingManualChanges: boolean
  /** The present text equals some saved snapshot, of any kind: drawn as the mark's band. */
  isPresentSaved: boolean
  onCreateManualSnapshot: () => void
  onGoToPresent?: () => void
  onMergeAdjacentSnapshots?: () => void
  isPresent?: boolean
  disabled?: boolean
  /** Overrides the default "create a manual save point" aria-label/tooltip -- used when this button doesn't mean "take a snapshot" at all (the auto-TOC/auto-Open-Items chapters, where it means "regenerate from live state"). */
  pendingActionLabel?: string
}

export function PresentStateCircle({
  hasPendingManualChanges,
  isPresentSaved,
  onCreateManualSnapshot,
  onGoToPresent,
  onMergeAdjacentSnapshots,
  isPresent = true,
  disabled,
  pendingActionLabel = 'Create a manual save point',
}: PresentStateCircleProps) {
  const doMerge = useCallback(() => {
    onMergeAdjacentSnapshots?.()
  }, [onMergeAdjacentSnapshots])

  const { isHolding, progress, lastFiredAt, handlers } = useHoldToBranch(doMerge)

  const [showComplete, setShowComplete] = useState(false)
  const [isFading, setIsFading] = useState(false)

  // When the hold completes, keep the full indicator visible for 150ms,
  // then fade it over 500ms.
  useEffect(() => {
    if (!lastFiredAt) return
    setShowComplete(true)
    setIsFading(false)
    const holdTimer = window.setTimeout(() => setIsFading(true), 150)
    const hideTimer = window.setTimeout(() => {
      setShowComplete(false)
      setIsFading(false)
    }, 150 + 500)
    return () => {
      window.clearTimeout(holdTimer)
      window.clearTimeout(hideTimer)
    }
  }, [lastFiredAt])

  return (
    <button
      type="button"
      className={[
        'manual-snapshot-circle btn-icon',
      ].filter(Boolean).join(' ')}
      disabled={disabled}
      aria-pressed={!hasPendingManualChanges}
      aria-label={
        hasPendingManualChanges
          ? pendingActionLabel
          : 'Current text matches your last manual save'
      }
      data-tooltip={
        hasPendingManualChanges
          ? pendingActionLabel
          : 'On your last manual save'
      }
      onClick={() => {
        if (disabled) return
        if (!isPresent) {
          onGoToPresent?.()
          return
        }
        if (hasPendingManualChanges) {
          onCreateManualSnapshot()
        } else {
          onGoToPresent?.()
        }
      }}
      {...handlers}
    >
      {/* The same layer stack as a snapshot's mark (.timeline-mark in
          editor.css): both borders always, the inner fill while the present
          is what is shown, the band while the present is saved, and the
          compacting hold's progress played in the band. */}
      <span
        className={[
          'timeline-mark has-outer-ring',
          isPresent ? 'has-inner-fill' : '',
          isPresentSaved ? 'has-band' : '',
        ].filter(Boolean).join(' ')}
        aria-hidden="true"
      >
        {(isHolding || showComplete) && (
          <span
            className={`timeline-mark-hold${isFading ? ' is-fading' : ''}`}
            style={{ '--hold-progress': showComplete ? 1 : Math.max(0, Math.min(1, progress)), '--hold-arcs': 3 } as React.CSSProperties}
          />
        )}
      </span>
    </button>
  )
}
