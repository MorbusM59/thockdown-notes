import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { EditorSelectionState } from '../editor/EditorContract'
import type { UseMarkdownFormattingToolbarResult } from './useMarkdownFormattingToolbar'
import type { UseNoteProtectionActionsResult } from './useNoteProtectionActions'
import type { UseDocumentFindResult } from '../find/useDocumentFind'
import type { UseDocumentFindNavigationResult } from './useDocumentFindNavigation'
import type { UseEditorSectionMountResult } from './useEditorSectionMount'
import type { UseNoteSaveQueueResult } from './useNoteSaveQueue'
import type { UseSectionTabsResult } from '../tabBar/useSectionTabs'

/**
 * What one `<EditorSection>` instance publishes about itself for "chrome"
 * (App-level code outside any single section -- export, tag handlers, the
 * sidebar's reveal/open-note actions, the global toolbar, debug logging,
 * etc.) to read or act through. Chrome never reaches into a section's own
 * hook state directly; it goes through this handle, resolved via whichever
 * section is currently active (see `activeSectionId`/`markSectionActive`).
 *
 * The section-scoped hooks live inside `<EditorSection>` (Phase 4a); App.tsx
 * mounts one instance per entry in `listSections()` (Phase 4c), each
 * registering its own handle here. Chrome resolves "the active section"
 * through this map rather than assuming there's only one.
 */
export interface SectionHandle extends
  UseMarkdownFormattingToolbarResult,
  UseNoteProtectionActionsResult,
  UseDocumentFindResult,
  UseDocumentFindNavigationResult,
  UseEditorSectionMountResult,
  UseNoteSaveQueueResult,
  UseSectionTabsResult {
  sectionId: string
  activeNoteId: string | null
  activeNoteText: string
  currentEditorText: string
  latestEditorTextRef: MutableRefObject<string>
  activeNoteSummary: NoteSummary | null
  /**
   * The note identity that "menu views" (sidebar highlight/reveal, tab bar
   * pill highlight/pinning) should treat as active. Equal to `activeNoteId`
   * except when the active note is a chapter (`chapterOnly`), in which case
   * this resolves to that note's `chapterParentId` -- chapters are never
   * shown in any menu view themselves, so menu-facing code should never see
   * a chapter's own id. A chapter belongs to exactly one parent, ever (DB-
   * enforced), so this is a plain DB-derived fact read straight off the
   * active note's own summary, not navigation state. A chapter is loaded
   * into the editor as the section's real `activeNoteId` (so save/restore/
   * snapshot machinery all work unmodified), while the menu/tab bar keep
   * showing the parent as "active" -- this is the single derived value both
   * of those consumers read instead of `activeNoteId` directly.
   */
  menuIdentityNoteId: string | null
  menuIdentityNoteSummary: NoteSummary | null
  editorSelection: EditorSelectionState
  previewedSnapshotId: number | null
  isPreviewMode: boolean
  setIsPreviewMode: Dispatch<SetStateAction<boolean>>
  setActiveNoteId: Dispatch<SetStateAction<string | null>>
  /** Switches which note this section shows -- the section's own, not a shared/parameterized one (see the handover doc's design decision). */
  activateNote: (noteId: string, overrideCursorPos?: number) => Promise<void>
}

export type SectionRegistry = MutableRefObject<Map<string, SectionHandle>>

/** Reads whichever section's handle matches `activeSectionId` -- `undefined` before that section has registered, or if `activeSectionId` doesn't match any live section. */
export function getActiveSectionHandle(registry: SectionRegistry, activeSectionId: string): SectionHandle | undefined {
  return registry.current.get(activeSectionId)
}
