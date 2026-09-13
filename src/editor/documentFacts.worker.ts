/// <reference lib="webworker" />

// Facts derived from a note's whole text, computed off the main thread.
//
// Every one of these is a full remark parse of the document -- 1.6 seconds on
// a 320KB note, sixteen on a 2MB one. On the main thread that is a frozen
// app: no scroll, no sidebar, no window controls. That is the moment a reader
// decides whether an app is solid, so it is the one place a spinner would be
// an admission rather than a courtesy.
//
// They are an unusually clean fit for a worker: text in, small answers out,
// no DOM, no state, no clock. Everything here is already pure -- see
// PreviewBlockSplit.ts and PreviewVisibleText.ts -- so nothing had to be made
// safe to move it.
//
// The INCREMENTAL split deliberately stays on the main thread. It reparses
// the changed span plus one neighbouring block, which is small by
// construction and needs to be synchronous to keep a keystroke's result in
// the same frame as the keystroke. Only whole-document work comes here.

import { splitPreviewBlockRangesProgressively } from './PreviewBlockSplit'
import { buildPreviewVisibleDocumentFindHits } from './FindReplaceEngine'
import {
  appendProjectionNodes,
  buildPreviewVisibleTextProjection,
  createPreviewVisibleTextAccumulator,
  finishPreviewVisibleTextProjection,
  projectionNeedsWholeDocumentParse,
  rememberPreviewVisibleTextProjection,
} from './PreviewVisibleText'
import type {
  DocumentFactsRequest,
  DocumentFactsResponse,
} from './documentFactsMessages'

const workerScope = self as DedicatedWorkerGlobalScope

/**
 * ONE parse, TWO facts.
 *
 * The block map and the visible-text projection are both derived from a whole
 * document, with the same processor and the same configuration, and until now
 * each did its own parse: opening a note paid for one, and the reader's first
 * find paid for the other. Measured on a 2MB note, the projection cost
 * 30,437ms of parse against 1,170ms of actual walking -- so deriving it from
 * the split's existing pass does not shave the cost, it removes essentially
 * all of it.
 *
 * It also moves WHEN the work happens, which matters more to a reader than
 * how much of it there is: the projection is now finished by the time a note
 * has opened, so the first find is a string scan rather than a wait.
 *
 * The projection is only ever useful whole -- a find that searched a prefix
 * would miss matches below it and report a wrong count -- so it is handed to
 * the memo at the end, not streamed. The ranges are streamed, because a
 * reader can read the top of a document while the rest arrives.
 */
function handleSplit(id: number, text: string): void {
  // Ranges only. The blocks are text slices, and shipping a second copy of
  // the whole document back across the boundary would cost more than the
  // line split that reconstitutes them on the other side.
  //
  // Sent in order and in pieces, smallest first: a reader waiting on a 2MB
  // note should get the top of it in a few milliseconds rather than the
  // whole of it in seconds. See splitPreviewBlockRangesProgressively for why
  // a chunk discards its own last range and why the windows double.
  // A document carrying reference definitions cannot be projected window by
  // window -- see projectionNeedsWholeDocumentParse. Decided BEFORE the loop
  // so such a document does not pay for a walk whose result is discarded.
  const projection = projectionNeedsWholeDocumentParse(text)
    ? null
    : createPreviewVisibleTextAccumulator()

  for (const chunk of splitPreviewBlockRangesProgressively(text)) {
    if (projection) appendProjectionNodes(projection, chunk.nodes, chunk.sourceOffset)
    const partial: DocumentFactsResponse = { kind: 'split', id, ranges: chunk.ranges, done: false }
    workerScope.postMessage(partial)
  }

  rememberPreviewVisibleTextProjection(
    text,
    projection ? finishPreviewVisibleTextProjection(projection) : buildPreviewVisibleTextProjection(text),
  )
  // A separate terminal message rather than a flag on the last chunk: the
  // generator cannot know which chunk is last until it has tried to produce
  // another, and an empty message costs nothing next to the parse.
  const complete: DocumentFactsResponse = { kind: 'split', id, ranges: [], done: true }
  workerScope.postMessage(complete)
}

function handleFind(id: number, text: string, query: string, caseSensitive: boolean): void {
  // The projection this builds is memoized inside PreviewVisibleText, so a
  // second query against the same note is a string scan rather than a parse.
  // That memo is the reason searching feels instant after the first term --
  // and, when it lived on the main thread and held exactly one document, the
  // reason switching notes and coming back froze the app all over again.
  const hits = buildPreviewVisibleDocumentFindHits(text, query, caseSensitive)
  const response: DocumentFactsResponse = { kind: 'find', id, hits }
  workerScope.postMessage(response)
}

workerScope.onmessage = (event: MessageEvent<DocumentFactsRequest>) => {
  const request = event.data
  if (request.kind === 'split') {
    handleSplit(request.id, request.text)
    return
  }
  handleFind(request.id, request.text, request.query, request.caseSensitive)
}
