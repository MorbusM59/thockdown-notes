import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { DocumentFindDirective, DocumentFindHit } from '../editor/FindReplaceEngine'
import { resolveDocumentFindDirective, buildDocumentFindHits } from '../editor/FindReplaceEngine'

export interface UseDocumentFindOptions {
  /**
   * Which section this instance belongs to. Not read internally yet -- there's
   * only one call site today -- but part of the signature now (mirroring
   * useActiveNoteId/useSectionTabs) so the call site already reads as "this
   * section's find state" rather than "the app's find state," and so a
   * consistency check can confirm it matches the sectionId every sibling
   * section-scoped hook was given.
   */
  sectionId: string
  /**
   * The text to search -- deliberately just a string, not "the active
   * note" or "the active editor". The caller decides which section's live
   * text this is; today there's only one, but this is the seam a future
   * "find targets whichever section last had focus" story plugs into
   * without this hook needing to know sections exist.
   */
  sourceText: string
  /** Applied once (e.g. after the persisted app-state round-trip resolves); null/omitted leaves the default (case-insensitive). */
  initialCaseSensitive?: boolean | null
}

export interface UseDocumentFindResult {
  documentFindQuery: string
  setDocumentFindQuery: Dispatch<SetStateAction<string>>
  isDocumentFindCaseSensitive: boolean
  setIsDocumentFindCaseSensitive: Dispatch<SetStateAction<boolean>>
  documentFindDirective: DocumentFindDirective
  documentFindHits: DocumentFindHit[]
}

/**
 * Owns the find/replace query, case-sensitivity toggle, and the resulting
 * directive + hit list. Deliberately has no idea how to jump to a hit or
 * apply a replacement in the editor -- those need the not-yet-extracted
 * editor mount (Lexical selection, preview DOM ranges), so the caller
 * still owns those actions and just reads `documentFindHits` /
 * `documentFindDirective` back out to drive them.
 */
export function useDocumentFind(options: UseDocumentFindOptions): UseDocumentFindResult {
  const { sectionId, sourceText, initialCaseSensitive } = options
  void sectionId

  const [documentFindQuery, setDocumentFindQuery] = useState('')
  const [isDocumentFindCaseSensitive, setIsDocumentFindCaseSensitive] = useState(false)

  useEffect(() => {
    if (initialCaseSensitive !== undefined && initialCaseSensitive !== null) {
      setIsDocumentFindCaseSensitive(initialCaseSensitive)
    }
    // Deliberately only reacting to the restored value arriving, not every
    // render -- this is a one-time hand-off from persisted app state, not a
    // controlled prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCaseSensitive])

  const documentFindDirective = useMemo<DocumentFindDirective>(() => {
    return resolveDocumentFindDirective(documentFindQuery, sourceText, isDocumentFindCaseSensitive)
  }, [documentFindQuery, sourceText, isDocumentFindCaseSensitive])

  const documentFindHits = useMemo<DocumentFindHit[]>(() => {
    return buildDocumentFindHits(sourceText, documentFindDirective.findText, isDocumentFindCaseSensitive)
  }, [sourceText, documentFindDirective.findText, isDocumentFindCaseSensitive])

  return {
    documentFindQuery,
    setDocumentFindQuery,
    isDocumentFindCaseSensitive,
    setIsDocumentFindCaseSensitive,
    documentFindDirective,
    documentFindHits,
  }
}
