import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export interface UseDisplayedNoteRenderModeResult {
  /** false = edit mode, true = render/preview view. */
  isPreviewMode: boolean
  setIsPreviewMode: Dispatch<SetStateAction<boolean>>
}

/**
 * Which view (edit vs. render) a section is currently showing. Per the
 * split-view design, this is deliberately per-section: an inactive section
 * stays in whichever mode the user left it in -- including edit-mode
 * syntax highlighting, not just render/preview -- rather than the whole
 * app sharing one mode. State ownership only here; `toggleRenderViewMode`
 * and the persistence functions that read/write this alongside the
 * adapter/snapshot-cache cluster stay in App.tsx for the next slice.
 */
export function useDisplayedNoteRenderMode(sectionId: string): UseDisplayedNoteRenderModeResult {
  void sectionId
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  return { isPreviewMode, setIsPreviewMode }
}
