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
  documentReplaceQuery: string
  setDocumentReplaceQuery: Dispatch<SetStateAction<string>>
  isDocumentReplaceMode: boolean
  setIsDocumentReplaceMode: Dispatch<SetStateAction<boolean>>
  /** Raw state behind the "Aa" toggle button -- means "case sensitive" in
   * plain find mode, but "keep case" (case-insensitive search + preserve-case
   * replace) once replace mode is active. Use `effectiveCaseSensitive` /
   * `preserveCase` below to read its meaning for the current mode. */
  isDocumentFindCaseSensitive: boolean
  setIsDocumentFindCaseSensitive: Dispatch<SetStateAction<boolean>>
  effectiveCaseSensitive: boolean
  preserveCase: boolean
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
  // What the (potentially expensive) search actually runs against --
  // deliberately a separate state from documentFindQuery, updated only
  // after a debounce. buildDocumentFindHits is a synchronous full-document
  // scan; a short, unspecific query (e.g. the first letter typed) against a
  // large note can produce enormous hit counts and take long enough to
  // block the main thread mid-keystroke. If that scan ran directly off
  // documentFindQuery, the render committing each new character would be
  // gated behind it -- exactly what caused characters to appear "swallowed"
  // while typing a whole word quickly. Keeping documentFindQuery (which
  // only drives the input's own displayed value) untouched by the debounce
  // means every keystroke's own render+commit stays cheap and immediate
  // regardless of how long the debounced search takes once it does run.
  const [debouncedFindQuery, setDebouncedFindQuery] = useState('')
  const [documentReplaceQuery, setDocumentReplaceQuery] = useState('')
  const [isDocumentReplaceMode, setIsDocumentReplaceMode] = useState(false)
  const [isDocumentFindCaseSensitive, setIsDocumentFindCaseSensitive] = useState(false)

  useEffect(() => {
    if (initialCaseSensitive !== undefined && initialCaseSensitive !== null) {
      setIsDocumentFindCaseSensitive(initialCaseSensitive)
    }
    // Deliberately only reacting to the restored value arriving, not every
    // render -- this is a one-time hand-off from persisted app state, not a
    // controlled prop.
  }, [initialCaseSensitive])

  // In replace mode the same toggle is repurposed as "keep case" (VSCode's
  // preserve-case): off means case-sensitive find + literal replace, on
  // means case-insensitive find + recase the replacement per match.
  const effectiveCaseSensitive = isDocumentReplaceMode ? !isDocumentFindCaseSensitive : isDocumentFindCaseSensitive
  const preserveCase = isDocumentReplaceMode && isDocumentFindCaseSensitive

  // Debounced at 1/(character count) seconds: 1s of no further typing after
  // the 1st character before the search runs, 500ms after the 2nd, ~333ms
  // after the 3rd, and so on. Each keystroke resets the timer at the new,
  // shorter delay -- a short query is exactly the case that tends to match
  // everywhere (most lag-prone), so it gets the most patience; once enough
  // characters have narrowed things down, search resumes almost instantly.
  // An empty query clears immediately since matching nothing is free.
  useEffect(() => {
    const charCount = documentFindQuery.length
    if (charCount === 0) {
      setDebouncedFindQuery('')
      return
    }
    const delayMs = 1000 / charCount
    const timeoutId = window.setTimeout(() => {
      setDebouncedFindQuery(documentFindQuery)
    }, delayMs)
    return () => window.clearTimeout(timeoutId)
  }, [documentFindQuery])

  const documentFindDirective = useMemo<DocumentFindDirective>(() => {
    return resolveDocumentFindDirective(debouncedFindQuery, documentReplaceQuery, isDocumentReplaceMode)
  }, [debouncedFindQuery, documentReplaceQuery, isDocumentReplaceMode])

  const documentFindHits = useMemo<DocumentFindHit[]>(() => {
    return buildDocumentFindHits(sourceText, documentFindDirective.findText, effectiveCaseSensitive)
  }, [sourceText, documentFindDirective.findText, effectiveCaseSensitive])

  return {
    documentFindQuery,
    setDocumentFindQuery,
    documentReplaceQuery,
    setDocumentReplaceQuery,
    isDocumentReplaceMode,
    setIsDocumentReplaceMode,
    isDocumentFindCaseSensitive,
    setIsDocumentFindCaseSensitive,
    effectiveCaseSensitive,
    preserveCase,
    documentFindDirective,
    documentFindHits,
  }
}
