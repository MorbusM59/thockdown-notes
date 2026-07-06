// Illustrative wiring, not a drop-in component -- shows how a single mark on
// the timeline slider would use useHoldToBranch to turn a right-click-hold
// into a new, editable branch note that opens immediately.

import { useCallback, useState } from 'react'
import { useHoldToBranch } from './useHoldToBranch'

type SnapshotMarkProps = {
  sourceNoteId: string
  snapshotId: number
  ratio: number // 0..1 position along the slider rail, from the log-curve mapping
  isManual: boolean
  onNoteOpened: (noteId: string) => void
}

export function SnapshotMarkBranchExample({
  sourceNoteId,
  snapshotId,
  ratio,
  isManual,
  onNoteOpened,
}: SnapshotMarkProps) {
  const [isBranching, setIsBranching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doBranch = useCallback(() => {
    if (isBranching) return
    setIsBranching(true)
    setError(null)

    window.measlyNotes
      .branchNoteFromSnapshot({ sourceNoteId, snapshotId })
      .then((branchedNote) => {
        onNoteOpened(branchedNote.id)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not branch this snapshot.')
      })
      .finally(() => {
        setIsBranching(false)
      })
  }, [isBranching, onNoteOpened, snapshotId, sourceNoteId])

  const { isHolding, progress, handlers } = useHoldToBranch(doBranch)

  return (
    <div
      className={[
        'timeline-mark',
        isManual ? 'manual' : 'automatic',
        isHolding ? 'is-holding' : '',
        isBranching ? 'is-branching' : '',
      ].join(' ').trim()}
      style={{ left: `${ratio * 100}%` }}
      title={error ?? undefined}
      {...handlers}
    >
      {isHolding && (
        // Fill ring showing hold progress toward the branch threshold --
        // gives the user a chance to bail out before anything is created.
        <svg viewBox="0 0 20 20" className="timeline-mark-hold-ring" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            strokeWidth="2"
            strokeDasharray={`${progress * 50.3} 50.3`}
          />
        </svg>
      )}
    </div>
  )
}
