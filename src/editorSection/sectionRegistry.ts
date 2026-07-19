import type { MutableRefObject } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { EditorSelectionState } from '../editor/EditorContract'

/**
 * What one `<EditorSection>` instance publishes about itself for "chrome"
 * (App-level code outside any single section -- export, tag handlers, the
 * sidebar's reveal/open-note actions, debug logging, etc.) to read or act
 * through. Chrome never reaches into a section's own hook state directly;
 * it goes through this handle, resolved via whichever section is currently
 * active (see `activeSectionId`/`markSectionActive`).
 *
 * This is scaffolding for the hook-relocation step of the split-view
 * effort -- expect it to grow as each concern moves from being an App.tsx
 * local into something owned by `<EditorSection>` itself. Nothing publishes
 * into the registry yet; `getActiveSectionHandle()` returns `undefined`
 * until a section actually registers.
 */
export interface SectionHandle {
  sectionId: string
  activeNoteId: string | null
  activeNoteText: string
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
