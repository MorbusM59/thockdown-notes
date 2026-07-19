const ENABLE_SECTION_ID_ASSERTIONS = import.meta.env.DEV

/**
 * Every section-scoped hook (useActiveNoteId, useDisplayedNoteText,
 * usePreviewedSnapshot, useDisplayedNoteSelection, useDisplayedNoteRenderMode,
 * useSnapshotFreeze, useSectionTabs, useDocumentFind, useNoteSnapshots, ...)
 * takes its own `sectionId` argument today even though there's only one
 * section and every call site hardcodes the same `DEFAULT_EDITOR_SECTION_ID`
 * constant. Most of these hooks don't read `sectionId` internally yet, so a
 * call site that drifts (e.g. a future second-section wiring pass that
 * updates most but not all of these) would otherwise fail silently instead
 * of throwing a type or test error.
 *
 * Dev-only tripwire: call once per render with every sectionId currently in
 * play, keyed by hook/call-site name for a legible warning.
 */
export function assertSectionIdsConsistent(sectionIdsByCallSite: Record<string, string>): void {
  if (!ENABLE_SECTION_ID_ASSERTIONS) return

  const entries = Object.entries(sectionIdsByCallSite)
  if (entries.length === 0) return

  const [, expected] = entries[0]
  const mismatched = entries.filter(([, sectionId]) => sectionId !== expected)
  if (mismatched.length === 0) return

  console.warn('[section-wiring] sectionId mismatch across section-scoped hooks', sectionIdsByCallSite)
}
