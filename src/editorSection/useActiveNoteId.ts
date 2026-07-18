import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export interface UseActiveNoteIdResult {
  activeNoteId: string | null
  setActiveNoteId: Dispatch<SetStateAction<string | null>>
}

/**
 * Which note a section is currently showing. Deliberately the *only* thing
 * this hook owns for now -- activeNoteText, save/debounce, selection
 * tracking, and viewport persistence are still global in App.tsx and read
 * this hook's value rather than a raw local state var. They're the next
 * slice of this extraction, not bundled in here, because they change
 * together atomically inside `activateNote` and are meaningfully riskier to
 * move; splitting `activeNoteId` out first keeps this step small and
 * independently verifiable.
 *
 * `sectionId` isn't used internally yet -- there's only ever one instance
 * of this hook called today -- but it's part of the signature now so the
 * call site already reads as "this section's active note" rather than "the
 * app's active note," ahead of there being more than one section to prove
 * that out.
 */
export function useActiveNoteId(sectionId: string): UseActiveNoteIdResult {
  void sectionId
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  return { activeNoteId, setActiveNoteId }
}
