import { useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

export interface UseSnapshotFreezeOptions {
  sectionId: string
  activeSectionId: string
  noteId: string | null
  /** null means "showing live text", matching the existing Time Machine preview convention. */
  previewedSnapshotId: number | null
  setPreviewedSnapshotId: Dispatch<SetStateAction<number | null>>
  /** Reads the note's current live text at the moment of freezing -- a ref read, not reactive state. */
  getLiveText: () => string
  flushPendingSaveNow: () => Promise<void>
  /** Whether some *other* section currently has `noteId` open -- the only situation where this note could change out from under an inactive section. */
  isNoteOpenInOtherSection: (sectionId: string, noteId: string) => boolean
  /**
   * Captures this section's own scroll/caret position from the still-live
   * editor and writes it into this section's edit-mode snapshot cache --
   * called right before freezing so the position the section thaws back
   * into is whatever the user was just looking at, not whatever the last
   * debounced autosave (up to 280ms stale) happened to catch.
   */
  captureEditModeSnapshotFromEditor: (noteId: string) => void
  /**
   * Set to true right before freezing, so the restore effect in
   * useEditorSectionMount knows this "preview" is a hibernated live section
   * (restore its real scroll/caret) rather than the user genuinely browsing
   * Time Machine (start from the top). See that ref's own doc comment.
   */
  isFrozenSectionPreviewRef: MutableRefObject<boolean>
  /**
   * True while `noteId` is the auto-TOC/auto-Open-Items chapter -- a
   * materialized view regenerated from live state, not something a person
   * edits, so it has no Time Machine snapshot history of its own (see
   * useNoteSnapshotTimeline.ts's isViewingEphemeralAutoChapter, which
   * suppresses this same automatic-snapshot behavior for the section that's
   * actually showing it). Without this, hibernating one of two sections
   * that both have the same ephemeral chapter open would still snapshot and
   * freeze the inactive one, silently reintroducing the very snapshot
   * history this note type is meant to never have.
   */
  skipFreeze: boolean
}

/**
 * Inactive sections are deliberately left "frozen in time" rather than
 * mirroring the active editor's live text: on losing active-section status,
 * if the section was showing live text, an automatic snapshot is taken
 * (through the normal saveNoteSnapshot path -- ordinary compaction/dedup
 * applies, nothing special-cased) and the section switches to previewing
 * it. Regaining active-section status only switches back to live if the
 * section was live at the moment it was hibernated; a section that was
 * already showing a specific historical snapshot (the user was genuinely
 * browsing Time Machine) stays exactly where it was. This is deliberate:
 * comparing or copying from an older version of a note stays stable even
 * while another section keeps editing the same note live.
 *
 * Skipped entirely when no other section has this note open: nothing could
 * change out from under an inactive section showing a note that's not open
 * anywhere else, so there's nothing to freeze -- and skipping avoids an
 * unnecessary snapshot + Editor remount (the synthetic `key` on <Editor> in
 * SectionEditorArea is keyed on previewedSnapshotId) on every section
 * switch in the overwhelmingly common case of one note per section.
 */
export function useSnapshotFreeze(options: UseSnapshotFreezeOptions): void {
  const {
    sectionId,
    activeSectionId,
    noteId,
    previewedSnapshotId,
    setPreviewedSnapshotId,
    getLiveText,
    flushPendingSaveNow,
    isNoteOpenInOtherSection,
    captureEditModeSnapshotFromEditor,
    isFrozenSectionPreviewRef,
    skipFreeze,
  } = options

  const isActiveSection = sectionId === activeSectionId
  const wasActiveRef = useRef(isActiveSection)
  const wasLiveWhenLastActiveRef = useRef(true)

  useEffect(() => {
    const wasActive = wasActiveRef.current
    wasActiveRef.current = isActiveSection

    if (wasActive && !isActiveSection) {
      // Just lost active-section status.
      if (skipFreeze) {
        // This note has no Time Machine history of its own -- see
        // skipFreeze's own doc comment. Leave it live and unfrozen.
        wasLiveWhenLastActiveRef.current = true
        return
      }
      if (previewedSnapshotId !== null) {
        // Already showing a specific historical snapshot -- nothing to
        // freeze, and reactivating should leave it exactly where it is.
        wasLiveWhenLastActiveRef.current = false
        return
      }

      wasLiveWhenLastActiveRef.current = true
      if (!noteId || !window.thockdownNotes) return
      if (!isNoteOpenInOtherSection(sectionId, noteId)) return

      // Capture this section's own position now, while the editor is still
      // live -- this is what gets restored on thaw, so it must reflect
      // exactly where the user was, not a stale debounced value.
      captureEditModeSnapshotFromEditor(noteId)

      const hibernatingNoteId = noteId
      void (async () => {
        await flushPendingSaveNow()
        const text = getLiveText()
        try {
          const snapshotId = await window.thockdownNotes!.saveNoteSnapshot({
            id: hibernatingNoteId,
            content: text,
            isManual: false,
          })
          // If the section was reactivated while the snapshot was being
          // written, there's nothing left to freeze -- the live view already
          // won.
          if (wasActiveRef.current) return
          isFrozenSectionPreviewRef.current = true
          setPreviewedSnapshotId(snapshotId)
        } catch (error) {
          console.error('Failed to freeze section on hibernate', error)
        }
      })()
      return
    }

    if (!wasActive && isActiveSection) {
      // Just regained active-section status.
      if (wasLiveWhenLastActiveRef.current) {
        setPreviewedSnapshotId(null)
      }
    }
  }, [isActiveSection, noteId, previewedSnapshotId, setPreviewedSnapshotId, getLiveText, flushPendingSaveNow, isNoteOpenInOtherSection, captureEditModeSnapshotFromEditor, isFrozenSectionPreviewRef, sectionId, skipFreeze])
}
