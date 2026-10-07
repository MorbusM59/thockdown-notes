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
        hasPendingManualChanges ? 'is-hollow' : 'is-filled',
        !isPresent ? 'not-present' : '',
        isHolding ? 'is-holding' : '',
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
      <span className="manual-snapshot-circle-dot" aria-hidden="true" />
      {(isHolding || showComplete) && (() => {
        // Three arcs, each growing clockwise over a third of the ring from
        // 12, 4 and 8 o'clock. pathLength="1" makes every dash length a
        // fraction of the circle, so the radius can change without touching
        // this arithmetic; the CSS rotation puts the path's start at 12.
        const arcLength = Math.max(0, Math.min(1, progress)) / 3
        return (
          <svg viewBox="0 0 20 20" className={`snapshot-merge-circle${isFading ? ' is-fading' : ''}`} aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <circle
                key={i}
                cx="10"
                cy="10"
                r="5"
                pathLength={1}
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={`${arcLength} ${1 - arcLength}`}
                strokeDashoffset={-i / 3}
              />
            ))}
          </svg>
        )
      })()}
    </button>
  )
}
