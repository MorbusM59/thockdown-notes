import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useNoteSnapshots } from '../editor/useNoteSnapshots'
import type { PlacedSnapshot } from '../editor/SnapshotTimelineCurve'
import { normalizeInternalText } from '../editor/TextPolicy'
import { ZERO_EDITOR_SELECTION, ZERO_PERSISTED_VIEWPORT, type EditRestoreSnapshot } from '../editor/EditRestoreMath'
import { DEFAULT_EDITOR_SECTION_ID } from '../shared/sections'

const MERGE_ADJACENCY_THRESHOLD_PX = 10

function normalizeForComparison(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '')
}

function computeSnapshotsToDelete(
  placements: readonly PlacedSnapshot[],
  trackLengthPx: number,
  automaticOnly: boolean,
): number[] {
  if (placements.length < 2 || trackLengthPx <= 0) return []

  const sortedByNewestFirst = [...placements].sort((a, b) => {
    if (a.ageMs !== b.ageMs) return a.ageMs - b.ageMs
    return b.timestamp.localeCompare(a.timestamp)
  })

  const toDelete: number[] = []
  let anchor = sortedByNewestFirst[0]

  for (let i = 1; i < sortedByNewestFirst.length; i += 1) {
    const candidate = sortedByNewestFirst[i]
    const isAdjacent = (anchor.ratio - candidate.ratio) * trackLengthPx <= MERGE_ADJACENCY_THRESHOLD_PX

    if (!isAdjacent) {
      anchor = candidate
      continue
    }

    const anchorIsManual = anchor.isManual
    const candidateIsManual = candidate.isManual
    const oneManualOneAutomatic = anchorIsManual !== candidateIsManual
    const bothManual = anchorIsManual && candidateIsManual

    if (oneManualOneAutomatic) {
      const automaticSnapshot = anchorIsManual ? candidate : anchor
      const latestSnapshot = sortedByNewestFirst[0]
      if (automaticSnapshot.id === latestSnapshot.id) {
        // Never delete the latest snapshot, even if it's automatic and
        // adjacent to a manual snapshot. Continue compacting from the
        // manual snapshot instead.
        if (automaticSnapshot === anchor) {
          anchor = candidate
        }
        continue
      }

      toDelete.push(automaticSnapshot.id)
      if (automaticSnapshot === anchor) {
        anchor = candidate
      }
      continue
    }

    if (automaticOnly && bothManual) {
      anchor = candidate
      continue
    }

    // Same type (both manual or both automatic): delete the older snapshot.
    toDelete.push(candidate.id)
  }

  return toDelete
}

export interface UseNoteSnapshotTimelineOptions {
  activeNoteId: string | null
  activeNoteText: string
  currentEditorText: string
  latestEditorTextRef: MutableRefObject<string>
  previewedSnapshotId: number | null
  setPreviewedSnapshotId: (id: number | null) => void
  captureEditModeSnapshotFromEditor: (noteId: string) => EditRestoreSnapshot | null
  flushPendingSaveNow: () => Promise<void>
  applyEditRestoreSnapshot: (
    snapshot: EditRestoreSnapshot,
    options?: { restoreFullSelection?: boolean; focusAfterApply?: boolean; onComplete?: () => void },
  ) => void
  editModeSnapshotByNoteIdRef: MutableRefObject<Map<string, EditRestoreSnapshot>>
  refreshNotes: (preferredId?: string | null) => Promise<string | null>
  activateNote: (noteId: string, overrideCursorPos?: number) => Promise<void>
}

/**
 * Time Machine snapshot state and history-compaction logic for one editor
 * section -- extracted verbatim from App.tsx with zero behavior change.
 */
export function useNoteSnapshotTimeline({
  activeNoteId,
  activeNoteText,
  currentEditorText,
  latestEditorTextRef,
  previewedSnapshotId,
  setPreviewedSnapshotId,
  captureEditModeSnapshotFromEditor,
  flushPendingSaveNow,
  applyEditRestoreSnapshot,
  editModeSnapshotByNoteIdRef,
  refreshNotes,
  activateNote,
}: UseNoteSnapshotTimelineOptions) {
  const [timelineCurveConstant, setTimelineCurveConstant] = useState(10)
  const [timelineTrackLengthPx, setTimelineTrackLengthPx] = useState(0)
  const noteSnapshots = useNoteSnapshots(DEFAULT_EDITOR_SECTION_ID, activeNoteId, currentEditorText, timelineCurveConstant)
  const { latestSnapshotContent, refresh: refreshSnapshots } = noteSnapshots
  const lastAutoCompactNoteIdRef = useRef<string | null>(null)

  // Leaving a note (or its history disappearing from under us, e.g. after a
  // retention pass or a delete) should never leave the UI pointed at a
  // snapshot id that no longer applies to the note now on screen.
  useEffect(() => {
    setPreviewedSnapshotId(null)
    setTimelineCurveConstant(16)
  }, [activeNoteId, setPreviewedSnapshotId])

  const previewedSnapshotContent = previewedSnapshotId !== null
    ? noteSnapshots.snapshotsById.get(previewedSnapshotId)?.content
    : undefined

  const isPreviewingSnapshot = previewedSnapshotContent !== undefined
  // Two panes, two different non-preview sources -- preserved exactly as
  // they were before snapshot preview existed (editorDisplayText mirrors the
  // Editor's original `activeNoteText`, renderedDisplayText mirrors the
  // rendered pane's original `currentEditorText`). Unifying these into one
  // variable would mean feeding the Editor its own live-typed text back
  // through `initialText` on every keystroke instead of only on save-commit
  // -- cheap per keystroke, but an unnecessary behavior change for a
  // performance-sensitive component. Word count / find-in-document /
  // autosave keep using currentEditorText directly, untouched by preview.
  const editorDisplayText = isPreviewingSnapshot ? previewedSnapshotContent : activeNoteText
  const renderedDisplayText = isPreviewingSnapshot ? previewedSnapshotContent : currentEditorText

  const handleNavigateSnapshot = useCallback((snapshotId: number | null) => {
    // Capture exactly where the user was in the live document before
    // switching away from it -- this is the position "return to present"
    // restores. Only meaningful when actually leaving live editing; scrubbing
    // between two historical snapshots has no live position to save, and
    // would otherwise overwrite a good cached position with a snapshot's
    // read-only (zeroed) one.
    if (previewedSnapshotId === null && activeNoteId) {
      captureEditModeSnapshotFromEditor(activeNoteId)
    }

    // Flush any in-flight edit before switching the editor's content out from
    // under the user -- scrubbing history should never silently drop an
    // unsaved edit to the live document.
    void flushPendingSaveNow().then(() => {
      setPreviewedSnapshotId(snapshotId)
    })
  }, [flushPendingSaveNow, previewedSnapshotId, activeNoteId, captureEditModeSnapshotFromEditor, setPreviewedSnapshotId])

  const compactAutomaticSnapshots = useCallback(async () => {
    if (!activeNoteId || timelineTrackLengthPx <= 0 || noteSnapshots.placements.length < 2 || !window.thockdownNotes) return

    const compactDeletes = computeSnapshotsToDelete(noteSnapshots.placements, timelineTrackLengthPx, true)
    if (compactDeletes.length === 0) return

    for (const snapshotId of compactDeletes) {
      await window.thockdownNotes.deleteNoteSnapshot({ snapshotId })
    }

    await noteSnapshots.refresh()
    if (previewedSnapshotId !== null && compactDeletes.includes(previewedSnapshotId)) {
      setPreviewedSnapshotId(null)
    }
  }, [activeNoteId, noteSnapshots, previewedSnapshotId, timelineTrackLengthPx, setPreviewedSnapshotId])

  const handleCreateManualSnapshot = useCallback(async () => {
    await noteSnapshots.createManualSnapshot()
    await compactAutomaticSnapshots()
    if (previewedSnapshotId !== null) {
      setPreviewedSnapshotId(null)
    }
  }, [compactAutomaticSnapshots, noteSnapshots, previewedSnapshotId, setPreviewedSnapshotId])

  const handleMergeAdjacentSnapshots = useCallback(async () => {
    if (!activeNoteId || timelineTrackLengthPx <= 0 || noteSnapshots.placements.length < 2 || !window.thockdownNotes) return

    const toDelete = computeSnapshotsToDelete(noteSnapshots.placements, timelineTrackLengthPx, false)

    for (const snapshotId of toDelete) {
      await window.thockdownNotes.deleteNoteSnapshot({ snapshotId })
    }

    await noteSnapshots.refresh()
    if (previewedSnapshotId !== null && toDelete.includes(previewedSnapshotId)) {
      setPreviewedSnapshotId(null)
    }
  }, [activeNoteId, noteSnapshots, previewedSnapshotId, timelineTrackLengthPx, setPreviewedSnapshotId])

  useEffect(() => {
    if (!activeNoteId || isPreviewingSnapshot) return
    const notesApi = window.thockdownNotes
    if (!notesApi) return

    const intervalId = window.setInterval(async () => {
      if (!activeNoteId || !notesApi || isPreviewingSnapshot) return

      const currentText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
      const normalizedLatestSnapshot = latestSnapshotContent ? normalizeForComparison(latestSnapshotContent) : null
      const normalizedCurrent = normalizeForComparison(currentText)

      if (noteSnapshots.placements.length >= 2 && timelineTrackLengthPx > 0) {
        const automaticDeletes = computeSnapshotsToDelete(noteSnapshots.placements, timelineTrackLengthPx, true)
        for (const snapshotId of automaticDeletes) {
          await notesApi.deleteNoteSnapshot({ snapshotId })
        }
        if (automaticDeletes.length > 0) {
          await refreshSnapshots()
        }
      }

      if (normalizedLatestSnapshot !== normalizedCurrent) {
        await notesApi.saveNoteSnapshot({ id: activeNoteId, content: currentText, isManual: false })
        await refreshSnapshots()
      }
    }, 60 * 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeNoteId, activeNoteText, latestSnapshotContent, noteSnapshots.placements.length, refreshSnapshots, isPreviewingSnapshot, timelineTrackLengthPx])

  const handleReturnToPresent = useCallback(() => {
    if (previewedSnapshotId !== null) {
      setPreviewedSnapshotId(null)
    }

    // Ensure the editor is returned to edit mode even when the note text
    // itself didn't change (e.g. the selected snapshot was identical to
    // the present). Reapply the cached edit-mode snapshot and focus the
    // editor so that contentEditable and input handlers are active.
    if (activeNoteId) {
      const cached = editModeSnapshotByNoteIdRef.current.get(activeNoteId)
      applyEditRestoreSnapshot(
        cached ?? {
          noteId: activeNoteId,
          collapsedSelection: ZERO_EDITOR_SELECTION,
          fullSelection: ZERO_EDITOR_SELECTION,
          viewport: ZERO_PERSISTED_VIEWPORT,
        },
        { restoreFullSelection: Boolean(cached), focusAfterApply: true },
      )
    }
  }, [previewedSnapshotId, activeNoteId, applyEditRestoreSnapshot, editModeSnapshotByNoteIdRef, setPreviewedSnapshotId])

  const handleBranchOpened = useCallback(async (newNoteId: string) => {
    setPreviewedSnapshotId(null)
    await refreshNotes(newNoteId)
    void activateNote(newNoteId)
  }, [activateNote, refreshNotes, setPreviewedSnapshotId])

  const handleBranchError = useCallback((message: string) => {
    console.error('Snapshot branch failed:', message)
  }, [])

  useEffect(() => {
    if (!activeNoteId || isPreviewingSnapshot || timelineTrackLengthPx <= 0 || noteSnapshots.placements.length < 2 || !window.thockdownNotes) return
    if (lastAutoCompactNoteIdRef.current === activeNoteId) return

    lastAutoCompactNoteIdRef.current = activeNoteId
    void compactAutomaticSnapshots()
  }, [activeNoteId, compactAutomaticSnapshots, isPreviewingSnapshot, noteSnapshots.placements.length, timelineTrackLengthPx])

  return {
    noteSnapshots,
    timelineCurveConstant,
    setTimelineCurveConstant,
    timelineTrackLengthPx,
    setTimelineTrackLengthPx,
    isPreviewingSnapshot,
    editorDisplayText,
    renderedDisplayText,
    handleNavigateSnapshot,
    handleCreateManualSnapshot,
    handleMergeAdjacentSnapshots,
    handleReturnToPresent,
    handleBranchOpened,
    handleBranchError,
  }
}
