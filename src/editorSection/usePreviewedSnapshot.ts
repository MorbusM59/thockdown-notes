import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export interface UsePreviewedSnapshotResult {
  /** null = showing live text; otherwise the ID of the specific Time Machine snapshot this section is displaying. */
  previewedSnapshotId: number | null
  setPreviewedSnapshotId: Dispatch<SetStateAction<number | null>>
}

/**
 * Which snapshot (or live text) a section is currently displaying -- the
 * state `useSnapshotFreeze` reads and writes to hibernate/restore a
 * section, and that manual Time Machine browsing (clicking the timeline,
 * the present-state circle, hold-to-branch) also drives directly. Not
 * referenced by buildMenuStateSnapshot, so this doesn't need the
 * ref-mirror pattern used for tabBarMode / isDocumentFindCaseSensitive.
 */
export function usePreviewedSnapshot(sectionId: string): UsePreviewedSnapshotResult {
  void sectionId
  const [previewedSnapshotId, setPreviewedSnapshotId] = useState<number | null>(null)
  return { previewedSnapshotId, setPreviewedSnapshotId }
}
