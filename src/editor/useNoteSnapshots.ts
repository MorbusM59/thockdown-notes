import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type PlacedSnapshot,
  type SnapshotLike,
  computeSnapshotPlacements,
} from './SnapshotTimelineCurve'

export type NoteSnapshotRecord = {
  id: number
  noteId: string
  content: string
  timestamp: string
  isManual: boolean
}

export type UseNoteSnapshotsResult = {
  /** All snapshots for the note, placed on the 0..1 rail. Empty while loading or if noteId is null. */
  placements: PlacedSnapshot[]
  /** Raw records, newest first -- keyed lookup for previewing a specific snapshot's content. */
  snapshotsById: Map<number, NoteSnapshotRecord>
  /** Snapshot ids whose content exactly matches the current live present text. */
  snapshotIdsMatchingPresent: Set<number>
  /** True while the initial fetch for the current noteId is in flight. */
  isLoading: boolean
  /** Content of the most recent *manual* snapshot, or null if none exists yet. */
  latestManualContent: string | null
  /** Content of the most recent snapshot, whether manual or automatic. */
  latestSnapshotContent: string | null
  /** Whether `liveText` differs from the latest manual snapshot (or there is no manual snapshot at all). */
  hasPendingManualChanges: boolean
  /** Re-fetches from the DB -- call after a save or a branch so the rail reflects the new snapshot immediately. */
  refresh: () => Promise<void>
  /** Records a manual snapshot of `liveText` and refreshes. */
  createManualSnapshot: () => Promise<void>
}

/**
 * Fetches and derives everything the snapshot timeline needs for one note.
 * Deliberately does not know about pixels, sliders, or DOM -- see
 * SnapshotTimelineSlider.tsx for the rendering layer that consumes this.
 */
export function useNoteSnapshots(noteId: string | null, liveText: string, curveConstant = 10): UseNoteSnapshotsResult {
  const [snapshots, setSnapshots] = useState<NoteSnapshotRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const requestIdRef = useRef(0)

  const fetchSnapshots = useCallback(async () => {
    if (!noteId || !window.measlyNotes) {
      setSnapshots([])
      return
    }
    const notesApi = window.measlyNotes
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    try {
      const rows = await notesApi.getNoteSnapshots({ id: noteId })
      if (requestIdRef.current === requestId) {
        setSnapshots(rows)
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false)
      }
    }
  }, [noteId])

  useEffect(() => {
    fetchSnapshots()
  }, [fetchSnapshots])

  const placements = useMemo(() => {
    const likeSnapshots: SnapshotLike[] = snapshots.map((s) => ({
      id: s.id,
      timestamp: s.timestamp,
      isManual: s.isManual,
    }))
    return computeSnapshotPlacements(likeSnapshots, Date.now(), { curveConstant })
  }, [curveConstant, snapshots])

  const snapshotsById = useMemo(() => {
    const map = new Map<number, NoteSnapshotRecord>()
    for (const snap of snapshots) map.set(snap.id, snap)
    return map
  }, [snapshots])

  const latestManualContent = useMemo(() => {
    const manualOnes = snapshots.filter((s) => s.isManual)
    if (manualOnes.length === 0) return null
    // snapshots come back newest-first from getNoteSnapshots
    return manualOnes[0].content
  }, [snapshots])

  const snapshotIdsMatchingPresent = useMemo(() => {
    const normalizedLive = normalizeForComparison(liveText)
    const result = new Set<number>()
    for (const snapshot of snapshots) {
      if (normalizeForComparison(snapshot.content) === normalizedLive) {
        result.add(snapshot.id)
      }
    }
    return result
  }, [liveText, snapshots])

  const latestSnapshotContent = useMemo(() => {
    return snapshots.length > 0 ? snapshots[0].content : null
  }, [snapshots])

  const hasPendingManualChanges = useMemo(() => {
    if (latestManualContent === null) return true // nothing to be "on" yet
    return normalizeForComparison(liveText) !== normalizeForComparison(latestManualContent)
  }, [latestManualContent, liveText])

  const createManualSnapshot = useCallback(async () => {
    if (!noteId || !window.measlyNotes) return
    await window.measlyNotes.saveNoteSnapshot({ id: noteId, content: liveText, isManual: true })
    await fetchSnapshots()
  }, [fetchSnapshots, liveText, noteId])

  return {
    placements,
    snapshotsById,
    snapshotIdsMatchingPresent,
    isLoading,
    latestManualContent,
    hasPendingManualChanges,
    latestSnapshotContent,
    refresh: fetchSnapshots,
    createManualSnapshot,
  }
}

// Trailing-whitespace/line-ending differences shouldn't make the present
// indicator flicker "pending" for content that's semantically identical.
function normalizeForComparison(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '')
}
