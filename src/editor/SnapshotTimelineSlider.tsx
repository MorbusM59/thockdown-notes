import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PlacedSnapshot } from './SnapshotTimelineCurve'
import { clusterPlacements } from './SnapshotTimelineCurve'
import { useHoldToBranch } from './useHoldToBranch'

// Reuses the same rail visual language as CompactScrollbarSlider (the
// filter/settings sliders) via the shared .utility-setting-scrollbar-*
// classes -- this is meant to look like a sibling of that component, not a
// new visual idiom.
//
// All marks (including the synthetic "present" mark) share ONE position
// formula (markLeftStyle, below), inset by half a mark's width on each end
// so a mark at ratio 0 or 1 stays fully inside the rail instead of having
// its center sit exactly on the boundary (which pushes half of it outside).
// There's deliberately no separately-positioned "thumb" element: earlier
// versions had one, positioned with a different formula than the marks, so
// the two could only ever coincide by coincidence. The active mark's own
// ring is the selection indicator now, so there's nothing to keep in sync.

export type SnapshotTimelineSliderProps = {
  sourceNoteId: string
  placements: PlacedSnapshot[]
  /** null = viewing the live present text. A snapshot id = previewing history (read-only). */
  activeSnapshotId: number | null
  onNavigate: (snapshotId: number | null) => void
  onBranchOpened: (newNoteId: string) => void
  onBranchError?: (message: string) => void
}

const PRESENT_RATIO = 1
// Half the widest mark's rendered width (the manual-snapshot dot, 8px) --
// how far a mark's center gets pulled in from each rail edge so it never
// renders partially outside the track.
const MARK_INSET_PX = 10

function markLeftStyle(ratio: number): string {
  return `calc(${MARK_INSET_PX}px + (${ratio} * (100% - ${MARK_INSET_PX * 2}px)))`
}

export function SnapshotTimelineSlider({
  sourceNoteId,
  placements,
  activeSnapshotId,
  onNavigate,
  onBranchOpened,
  onBranchError,
}: SnapshotTimelineSliderProps) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const [railWidthPx, setRailWidthPx] = useState(0)

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return

    const updateWidth = () => setRailWidthPx(rail.getBoundingClientRect().width)
    updateWidth()

    const observer = new ResizeObserver(() => updateWidth())
    observer.observe(rail)
    return () => observer.disconnect()
  }, [])

  const automaticClusters = useMemo(
    () => clusterPlacements(placements.filter((placement) => !placement.isManual)),
    [placements],
  )
  const manualMarks = useMemo(
    () => placements.filter((placement) => placement.isManual),
    [placements],
  )

  // Manual snapshots should always render individually; only automatic
  // history marks get clustered to reduce visual clutter.
  const historyMarks = useMemo(() => {
    const fromClusters = automaticClusters.map((cluster) => cluster[0])
    return [...manualMarks, ...fromClusters].sort((a, b) => a.ratio - b.ratio)
  }, [automaticClusters, manualMarks])

  const historyMarksToRender = historyMarks

  const orderedNavTargets = useMemo(
    () => [...historyMarks.map((m) => m.id as number | null), null],
    [historyMarks],
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
    for (const mark of historyMarks) {
      const distance = Math.abs(mark.ratio - ratio)
      if (distance < best.distance) {
        best = { id: mark.id, distance }
      }
    }
    return best.id
  }, [historyMarks])

  const historyMarkLeftStyles = useMemo(() => {
    const marks = historyMarksToRender
    if (railWidthPx <= 0 || marks.length === 0) {
      return marks.map(() => undefined)
    }

    const usableWidth = Math.max(0, railWidthPx - MARK_INSET_PX * 2)
    const targetCenters = marks.map((mark) => MARK_INSET_PX + mark.ratio * usableWidth)
    const renderedCenters: number[] = []

    let nextCenter = railWidthPx - MARK_INSET_PX
    let nextOuterHalf = 0

    for (let i = marks.length - 1; i >= 0; i -= 1) {
      const mark = marks[i]
      const outerHalf = mark.isManual ? 5 : 4
      const targetCenter = targetCenters[i]
      if (i === marks.length - 1) {
        renderedCenters[i] = Math.max(MARK_INSET_PX, Math.min(targetCenter, nextCenter))
      } else {
        const minGap = outerHalf + nextOuterHalf + 2
        const center = Math.min(targetCenter, nextCenter - minGap)
        renderedCenters[i] = Math.max(MARK_INSET_PX, center)
      }
      nextCenter = renderedCenters[i]
      nextOuterHalf = outerHalf
    }

    return renderedCenters.map((center) => `${center}px`)
  }, [historyMarksToRender, railWidthPx])

  const handleRailPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('.snapshot-timeline-mark')) {
      return
    }
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

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Snapshot history"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={orderedNavTargets.length - 1}
      aria-valuenow={orderedNavTargets.findIndex((id) => id === activeSnapshotId)}
      className="utility-setting-scrollbar-shell snapshot-timeline-shell"
      onKeyDown={handleKeyDown}
    >
      <div
        className="utility-setting-scrollbar-rail snapshot-timeline-rail"
        ref={railRef}
        onPointerDown={handleRailPointerDown}
      >
        {historyMarksToRender.map((mark, index) => (
          <SnapshotMark
            key={mark.id}
            sourceNoteId={sourceNoteId}
            placement={mark}
            isActive={mark.id === activeSnapshotId}
            onNavigate={onNavigate}
            onBranchOpened={onBranchOpened}
            onBranchError={onBranchError}
            leftStyle={historyMarkLeftStyles[index]}
          />
        ))}
      </div>
    </div>
  )
}

type SnapshotMarkProps = {
  sourceNoteId: string
  placement: PlacedSnapshot
  isActive: boolean
  leftStyle?: string
  onNavigate: (snapshotId: number | null) => void
  onBranchOpened: (newNoteId: string) => void
  onBranchError?: (message: string) => void
}

function SnapshotMark({
  sourceNoteId,
  placement,
  isActive,
  leftStyle,
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
      style={{ left: leftStyle ?? markLeftStyle(placement.ratio) }}
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
