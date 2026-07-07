import { useCallback, useMemo, useRef } from 'react'
import type { PlacedSnapshot } from './SnapshotTimelineCurve'
import { clusterPlacements } from './SnapshotTimelineCurve'
import { useHoldToBranch } from './useHoldToBranch'

// Reuses the same rail/thumb visual language and CSS custom properties as
// CompactScrollbarSlider (the filter/settings sliders) via the shared
// .utility-setting-scrollbar-* classes -- this is meant to look like a
// sibling of that component, not a new visual idiom.

export type SnapshotTimelineSliderProps = {
  sourceNoteId: string
  placements: PlacedSnapshot[]
  /** null = viewing the live present text. A snapshot id = previewing history (read-only). */
  activeSnapshotId: number | null
  onNavigate: (snapshotId: number | null) => void
  onBranchOpened: (newNoteId: string) => void
  onBranchError?: (message: string) => void
}

// A synthetic entry representing "now" -- always the rightmost point on the
// rail, even when there are zero real snapshots yet.
const PRESENT_RATIO = 1

export function SnapshotTimelineSlider({
  sourceNoteId,
  placements,
  activeSnapshotId,
  onNavigate,
  onBranchOpened,
  onBranchError,
}: SnapshotTimelineSliderProps) {
  const railRef = useRef<HTMLDivElement | null>(null)

  const clusters = useMemo(() => clusterPlacements(placements), [placements])

  // One representative mark per cluster (the newest member), plus the
  // synthetic present mark. Clustering keeps visually-overlapping snapshots
  // from fighting for the same pixels; clicking/holding a cluster acts on
  // its newest member. (A flyout to pick a specific member of a dense
  // cluster is a natural follow-up, not implemented here yet.)
  const marks = useMemo(() => {
    const fromClusters = clusters.map((cluster) => cluster[0])
    return [...fromClusters].sort((a, b) => a.ratio - b.ratio)
  }, [clusters])

  const orderedNavTargets = useMemo(
    () => [...marks.map((m) => m.id as number | null), null],
    [marks],
  )

  const ratioForClientX = useCallback((clientX: number): number => {
    const rail = railRef.current
    if (!rail) return PRESENT_RATIO
    const rect = rail.getBoundingClientRect()
    if (rect.width <= 0) return PRESENT_RATIO
    return clamp01((clientX - rect.left) / rect.width)
  }, [])

  const nearestMarkIdForRatio = useCallback((ratio: number): number | null => {
    let best: { id: number | null; distance: number } = { id: null, distance: Math.abs(PRESENT_RATIO - ratio) }
    for (const mark of marks) {
      const distance = Math.abs(mark.ratio - ratio)
      if (distance < best.distance) {
        best = { id: mark.id, distance }
      }
    }
    return best.id
  }, [marks])

  const handleRailPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const ratio = ratioForClientX(event.clientX)
    onNavigate(nearestMarkIdForRatio(ratio))
  }, [nearestMarkIdForRatio, onNavigate, ratioForClientX])

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const currentIndex = orderedNavTargets.findIndex((id) => id === activeSnapshotId)
    const safeIndex = currentIndex === -1 ? orderedNavTargets.length - 1 : currentIndex

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const prev = orderedNavTargets[Math.max(0, safeIndex - 1)]
      onNavigate(prev)
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      const next = orderedNavTargets[Math.min(orderedNavTargets.length - 1, safeIndex + 1)]
      onNavigate(next)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onNavigate(orderedNavTargets[0])
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      onNavigate(null)
    }
  }, [activeSnapshotId, onNavigate, orderedNavTargets])

  const activeRatio = useMemo(() => {
    if (activeSnapshotId === null) return PRESENT_RATIO
    return marks.find((m) => m.id === activeSnapshotId)?.ratio ?? PRESENT_RATIO
  }, [activeSnapshotId, marks])

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Snapshot history"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={marks.length}
      aria-valuenow={orderedNavTargets.findIndex((id) => id === activeSnapshotId)}
      className="utility-setting-scrollbar-shell snapshot-timeline-shell"
      onKeyDown={handleKeyDown}
    >
      <div
        className="utility-setting-scrollbar-rail snapshot-timeline-rail"
        ref={railRef}
        onPointerDown={handleRailPointerDown}
      >
        {marks.map((mark) => (
          <SnapshotMark
            key={mark.id}
            sourceNoteId={sourceNoteId}
            placement={mark}
            isActive={mark.id === activeSnapshotId}
            onNavigate={onNavigate}
            onBranchOpened={onBranchOpened}
            onBranchError={onBranchError}
          />
        ))}
        <div
          className="utility-setting-scrollbar-thumb snapshot-timeline-thumb"
          style={{ left: `${activeRatio * 100}%` }}
        />
      </div>
    </div>
  )
}

type SnapshotMarkProps = {
  sourceNoteId: string
  placement: PlacedSnapshot
  isActive: boolean
  onNavigate: (snapshotId: number | null) => void
  onBranchOpened: (newNoteId: string) => void
  onBranchError?: (message: string) => void
}

function SnapshotMark({
  sourceNoteId,
  placement,
  isActive,
  onNavigate,
  onBranchOpened,
  onBranchError,
}: SnapshotMarkProps) {
  const doBranch = useCallback(() => {
    if (!window.measlyNotes) return
    window.measlyNotes
      .branchNoteFromSnapshot({ sourceNoteId, snapshotId: placement.id })
      .then((branched) => onBranchOpened(branched.id))
      .catch((err: unknown) => {
        onBranchError?.(err instanceof Error ? err.message : 'Could not branch this snapshot.')
      })
  }, [onBranchError, onBranchOpened, placement.id, sourceNoteId])

  const { isHolding, progress, handlers } = useHoldToBranch(doBranch)

  return (
    <div
      className={[
        'snapshot-timeline-mark',
        placement.isManual ? 'is-manual' : 'is-automatic',
        isActive ? 'is-active' : '',
        isHolding ? 'is-holding' : '',
      ].join(' ').trim()}
      style={{ left: `${placement.ratio * 100}%` }}
      onClick={(event) => {
        event.stopPropagation()
        onNavigate(placement.id)
      }}
      {...handlers}
    >
      {isHolding && (
        <svg viewBox="0 0 20 20" className="snapshot-timeline-hold-ring" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2" strokeDasharray={`${progress * 50.3} 50.3`} />
        </svg>
      )}
    </div>
  )
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
