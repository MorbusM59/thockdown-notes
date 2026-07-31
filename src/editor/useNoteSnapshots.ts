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
 *
 * `sectionId` isn't read internally yet -- there's only one call site today,
 * and snapshots are looked up by `noteId` alone -- but it's part of the
 * signature now (mirroring useActiveNoteId/useSectionTabs) so the call site
 * already reads as "this section's timeline" rather than "the app's
 * timeline," and so a consistency check can confirm it matches the
 * sectionId every sibling section-scoped hook was given.
 */
export function useNoteSnapshots(sectionId: string, noteId: string | null, liveText: string, curveConstant = 10): UseNoteSnapshotsResult {
  void sectionId
  const [snapshots, setSnapshots] = useState<NoteSnapshotRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const requestIdRef = useRef(0)

  const fetchSnapshots = useCallback(async () => {
    if (!noteId || !window.thockdownNotes) {
      setSnapshots([])
      return
    }
    const notesApi = window.thockdownNotes
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    try {
      const rows = await notesApi.getNoteSnapshots({ id: noteId })
      if (requestIdRef.current === requestId) {
        setSnapshots(rows)
      }
    } catch (error) {
      // Previously uncaught: a rejected getNoteSnapshots call (e.g. a
      // database/IPC failure) surfaced as an "Uncaught (in promise)" that no
      // user would ever see, and just left the timeline silently empty.
      console.error('[useNoteSnapshots] failed to fetch snapshots for note', noteId, error)
      if (requestIdRef.current === requestId) {
        setSnapshots([])
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

  // Snapshot content is immutable once fetched -- normalizing it only
  // depends on `snapshots`, never on `liveText`. Without this, every
  // snapshot's content was re-normalized from scratch on every keystroke
  // (liveText changes every edit), an O(document length x snapshot count)
  // cost for work whose actual result never changes between keystrokes.
  // This useMemo is still keyed on `snapshots` itself, so a fresh fetch
  // (even one returning identical records) still recomputes the whole map
  // once -- the win is specifically eliminating the *per-keystroke*
  // re-normalization, not caching across refetches. Keyed by id internally
  // so snapshotIdsMatchingPresent's own lookup below is O(1) per snapshot.
  const normalizedSnapshotContentById = useMemo(() => {
    const map = new Map<number, string>()
    for (const snapshot of snapshots) {
      map.set(snapshot.id, normalizeForComparison(snapshot.content))
    }
    return map
  }, [snapshots])

  // Debounced rather than tracking `liveText` directly: normalizeForComparison
  // is an O(document length) regex-replace pass, and snapshotIdsMatchingPresent/
  // hasPendingManualChanges below (its only consumers) purely drive the Time
  // Machine timeline's "present" dot -- a passive display, not editor state or
  // save logic -- so recomputing it synchronously on every keystroke (measured
  // live on a 1.5M-character note: ~2.9ms/keystroke mean, real but avoidable)
  // buys no correctness the debounced value doesn't already provide. Same
  // "deferred/off-critical-path work" fix as EditorSection.tsx's
  // activeNoteDocumentStats (see docs/large-document-performance-handover.md).
  const [debouncedLiveText, setDebouncedLiveText] = useState(liveText)
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedLiveText(liveText), 200)
    return () => window.clearTimeout(timeoutId)
  }, [liveText])

  // Also shared between snapshotIdsMatchingPresent and hasPendingManualChanges
  // below so debouncedLiveText is only normalized once per settle, not twice.
  const normalizedLiveText = useMemo(() => normalizeForComparison(debouncedLiveText), [debouncedLiveText])

  const snapshotIdsMatchingPresent = useMemo(() => {
    const result = new Set<number>()
    for (const snapshot of snapshots) {
      if (normalizedSnapshotContentById.get(snapshot.id) === normalizedLiveText) {
        result.add(snapshot.id)
      }
    }
    return result
  }, [snapshots, normalizedSnapshotContentById, normalizedLiveText])

  const latestSnapshotContent = useMemo(() => {
    return snapshots.length > 0 ? snapshots[0].content : null
  }, [snapshots])

  const normalizedLatestManualContent = useMemo(() => {
    return latestManualContent !== null ? normalizeForComparison(latestManualContent) : null
  }, [latestManualContent])

  const hasPendingManualChanges = useMemo(() => {
    if (normalizedLatestManualContent === null) return true // nothing to be "on" yet
    return normalizedLiveText !== normalizedLatestManualContent
  }, [normalizedLatestManualContent, normalizedLiveText])

  const createManualSnapshot = useCallback(async () => {
    if (!noteId || !window.thockdownNotes) return
    await window.thockdownNotes.saveNoteSnapshot({ id: noteId, content: liveText, isManual: true })
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
