// The worker boundary's vocabulary, in a module neither side owns -- so the
// worker does not import the client and the client does not import the
// worker's implementation.
//
// ## Why this is not just "the block split protocol" any more
//
// Three separate defects in two days were the same one: a whole-document
// remark parse, run synchronously on the main thread at the moment somebody
// needed its answer -- the block map inside a `useMemo` during React's
// render, the visible-text projection inside another one, and a consumer
// polling for a fact because nothing told it when the fact was ready. Moving
// the block split alone off the thread left its sibling to be discovered
// later, at a cost of several frozen seconds on every first find.
//
// So the worker owns DERIVED FACTS about a document's text, and answers
// questions about them. The text crosses once per question; the answers are
// small. Deliberately: the alternative, shipping a projection back so the
// main thread could search it, means moving ~1.5MB of string plus a segment
// per text node across the boundary, where a hit list is a few hundred small
// objects.

import type { PersistedPreviewBlockCache } from '../shared/noteLifecycle'
import type { DocumentFindHit } from './FindReplaceEngine'

/** Correlates a reply with its request; a stale reply is dropped, not applied. */
interface RequestEnvelope {
  id: number
  text: string
}

/** The note's block map, delivered progressively. */
export interface SplitRequest extends RequestEnvelope {
  kind: 'split'
}

/**
 * Find hits against what the RENDERED pane shows, not against the markdown
 * source -- see buildPreviewVisibleDocumentFindHits. The whole document is
 * sent with every query rather than negotiated: cloning a string is memcpy
 * next to the parse it avoids, and a handshake for a cache the worker may or
 * may not still hold is a protocol that can disagree with itself.
 */
export interface PreviewFindRequest extends RequestEnvelope {
  kind: 'find'
  query: string
  caseSensitive: boolean
}

export type DocumentFactsRequest = SplitRequest | PreviewFindRequest

export interface SplitRangesMessage {
  kind: 'split'
  id: number
  /**
   * The ranges finished since this id's previous message, in document order
   * -- a DELTA, not the running total. Resending everything each time would
   * make the boundary cost O(n log n) in a document's ranges for no reason;
   * the client accumulates.
   */
  ranges: PersistedPreviewBlockCache['ranges']
  /**
   * The last message for this id. Only then do the accumulated ranges tile
   * the whole document, which is what makes the result safe to persist and
   * to use as the incremental path's base.
   */
  done: boolean
}

export interface PreviewFindHitsMessage {
  kind: 'find'
  id: number
  hits: DocumentFindHit[]
}

export type DocumentFactsResponse = SplitRangesMessage | PreviewFindHitsMessage
