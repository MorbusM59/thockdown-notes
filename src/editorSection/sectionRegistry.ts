import type { MutableRefObject } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { EditorSelectionState } from '../editor/EditorContract'
import type { UseMarkdownFormattingToolbarResult } from './useMarkdownFormattingToolbar'

/**
 * What one `<EditorSection>` instance publishes about itself for "chrome"
 * (App-level code outside any single section -- export, tag handlers, the
 * sidebar's reveal/open-note actions, the global toolbar, debug logging,
 * etc.) to read or act through. Chrome never reaches into a section's own
 * hook state directly; it goes through this handle, resolved via whichever
 * section is currently active (see `activeSectionId`/`markSectionActive`).
 *
 * Phase 4b of the split-view effort: the section-scoped hooks still all
 * live in App.tsx today, hardcoded to one section, but that single call
 * site now publishes its results here so chrome can be repointed through
 * the registry ahead of the hooks themselves moving into a real per-section
 * component (Phase 4c). At N=1 this is pure indirection with no behavior
 * change -- there's only ever one entry, matching what chrome already saw.
 */
export interface SectionHandle extends UseMarkdownFormattingToolbarResult {
  sectionId: string
  activeNoteId: string | null
  activeNoteText: string
  currentEditorText: string
  latestEditorTextRef: MutableRefObject<string>
  activeNoteSummary: NoteSummary | null
  editorSelection: EditorSelectionState
  previewedSnapshotId: number | null
  isPreviewMode: boolean
  /** Switches which note this section shows -- the section's own, not a shared/parameterized one (see the handover doc's design decision). */
  activateNote: (noteId: string, overrideCursorPos?: number) => Promise<void>
  toggleRenderViewMode: () => Promise<void>
}

export type SectionRegistry = MutableRefObject<Map<string, SectionHandle>>

/** Reads whichever section's handle matches `activeSectionId` -- `undefined` before that section has registered, or if `activeSectionId` doesn't match any live section. */
export function getActiveSectionHandle(registry: SectionRegistry, activeSectionId: string): SectionHandle | undefined {
  return registry.current.get(activeSectionId)
}
