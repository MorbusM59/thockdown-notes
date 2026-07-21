import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'

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
  } = options

  const isActiveSection = sectionId === activeSectionId
  const wasActiveRef = useRef(isActiveSection)
  const wasLiveWhenLastActiveRef = useRef(true)

  useEffect(() => {
    const wasActive = wasActiveRef.current
    wasActiveRef.current = isActiveSection

    if (wasActive && !isActiveSection) {
      // Just lost active-section status.
      if (previewedSnapshotId !== null) {
        // Already showing a specific historical snapshot -- nothing to
        // freeze, and reactivating should leave it exactly where it is.
        wasLiveWhenLastActiveRef.current = false
        return
      }

      wasLiveWhenLastActiveRef.current = true
      if (!noteId || !window.thockdownNotes) return
      if (!isNoteOpenInOtherSection(sectionId, noteId)) return

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
  }, [isActiveSection, noteId, previewedSnapshotId, setPreviewedSnapshotId, getLiveText, flushPendingSaveNow, isNoteOpenInOtherSection, sectionId])
}
