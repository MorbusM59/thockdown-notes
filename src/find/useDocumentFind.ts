import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { DocumentFindDirective, DocumentFindHit } from '../editor/FindReplaceEngine'
import {
  resolveDocumentFindDirective,
  buildDocumentFindHits,
} from '../editor/FindReplaceEngine'
import { requestPreviewFindHits } from '../editor/documentFactsClient'

/**
 * The one empty hit list, shared.
 *
 * A fresh `[]` per render is a different array every render, and this value
 * is a dependency of an effect and of a `useMemo` that walks the document to
 * find each hit's line. Returning a literal made both re-run on EVERY render
 * of the section -- caught by the find-marking trace emitting about a
 * thousand lines a second on an idle app, with no query typed.
 */
const NO_HITS: DocumentFindHit[] = []

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
  /**
   * Whether the section is currently showing the rendered pane. Switches the
   * search from the markdown source to what that pane actually displays --
   * a match hiding inside syntax the reader can't see (`[anchor](#anchor)`'s
   * second "anchor", an image URL, a link definition) is not a hit anyone
   * looking at rendered output can be shown or scrolled to, and counting it
   * anyway also misaligned every later hit's position. See
   * buildPreviewVisibleDocumentFindHits.
   */
  isPreviewMode: boolean
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
  /**
   * A render-view search is running on the worker and this list is not the
   * answer yet.
   *
   * Only ever true in render view: an edit-mode search is an indexOf scan
   * that has already finished by the time anyone can read this. It exists
   * because "no hits yet" and "no such text" look identical in an empty
   * list, and on a large note the reader would be shown the wrong one of
   * those for several seconds.
   */
  isDocumentFindSearching: boolean
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
  const { sectionId, sourceText, initialCaseSensitive, isPreviewMode } = options
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

  /**
   * The hits, which render-view searches WAIT for rather than compute.
   *
   * This was one `useMemo` covering both views. In edit mode that is right
   * and stays: `buildDocumentFindHits` is an indexOf scan over the raw text,
   * cheap enough to run in render and needed in the same frame as the query.
   *
   * In render view it was a full remark parse of the whole document, run
   * synchronously during React's render phase -- the same shape, in a third
   * module, as the two found the day before. Measured on a 2MB note in a
   * packaged build: 115 SECONDS on the first query, then instant for every
   * later term (the projection is memoized), then frozen again after
   * switching notes and back, because that memo held exactly one document.
   *
   * So preview hits come from the worker. `isSearching` is a real state,
   * not an absence: a reader who typed a query and sees an empty list has
   * been told the wrong thing, and on a large note they would be told it for
   * a long time.
   */
  /**
   * The worker's last answer, WITH the question it answers.
   *
   * Storing the question alongside the hits is what makes "still searching"
   * a derived fact rather than a flag someone has to remember to raise and
   * lower. A separate boolean was the first attempt and it lied for exactly
   * one frame: the render in which the query changed had an empty hit list
   * and a not-yet-raised flag, so the sidebar said "No matches in the
   * current note" before it said "Searching this note...". Caught in a
   * packaged build, not in a test -- which is the argument for deriving it.
   */
  const [previewAnswer, setPreviewAnswer] = useState<{
    text: string
    query: string
    caseSensitive: boolean
    hits: DocumentFindHit[]
  } | null>(null)

  const editModeHits = useMemo<DocumentFindHit[]>(() => {
    if (isPreviewMode) return NO_HITS
    return buildDocumentFindHits(sourceText, documentFindDirective.findText, effectiveCaseSensitive)
  }, [sourceText, documentFindDirective.findText, effectiveCaseSensitive, isPreviewMode])

  useEffect(() => {
    if (!isPreviewMode || !documentFindDirective.findText) return
    let cancelled = false
    void requestPreviewFindHits(sourceText, documentFindDirective.findText, effectiveCaseSensitive)
      .then((hits: DocumentFindHit[]) => {
        if (cancelled) return
        setPreviewAnswer({
          text: sourceText,
          query: documentFindDirective.findText,
          caseSensitive: effectiveCaseSensitive,
          hits,
        })
      })
    // An answer the reader has already typed past is not worth showing, and
    // showing it would make the list flicker backwards through superseded
    // queries on a slow note.
    return () => { cancelled = true }
  }, [sourceText, documentFindDirective.findText, effectiveCaseSensitive, isPreviewMode])

  const previewAnswerIsCurrent = previewAnswer !== null
    && previewAnswer.text === sourceText
    && previewAnswer.query === documentFindDirective.findText
    && previewAnswer.caseSensitive === effectiveCaseSensitive

  const isSearchingPreview = isPreviewMode
    && documentFindDirective.findText !== ''
    && !previewAnswerIsCurrent

  const documentFindHits = !isPreviewMode
    ? editModeHits
    : previewAnswerIsCurrent
      ? previewAnswer.hits
      : NO_HITS

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
    isDocumentFindSearching: isPreviewMode && isSearchingPreview,
  }
}
