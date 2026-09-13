// Asking the worker for a note's block map, with the main thread as the
// fallback rather than as the plan.
//
// ## One worker, kept
//
// The texture worker is created and terminated per image, which is right for
// something generated once on a settings change. This one is asked on every
// cold note open, and spinning up a module worker means parsing and
// instantiating remark again each time -- more than the parse it is there to
// move. So it is created on first use and kept.
//
// ## A reply is matched, not assumed
//
// Every request carries an id and every reply is matched against the request
// still outstanding for that text. Two large notes opened in quick succession
// otherwise resolve in whatever order the worker finishes them, and the
// second note gets the first note's block map -- which is not a slow note, it
// is a caret in the wrong place.
//
// ## The fallback is silent and correct
//
// Where a worker cannot be constructed at all -- an environment without them,
// a bundler that did not emit the chunk, a CSP that refuses it -- this runs
// the same pure function on the main thread. That is exactly today's
// behaviour, so the fallback is a slow path rather than a broken one, and it
// is what keeps this testable without a worker harness.

import { splitMarkdownIntoPreviewBlocksIncremental, restorePreviewBlockSplitCacheFromRanges, type PreviewBlockSplitCache } from './PreviewBlockSplit'
import type {
  DocumentFactsRequest,
  DocumentFactsResponse,
  SplitRangesMessage,
  PreviewFindHitsMessage,
} from './documentFactsMessages'
import { buildPreviewVisibleDocumentFindHits, type DocumentFindHit } from './FindReplaceEngine'
import type { PersistedPreviewBlockCache } from '../shared/noteLifecycle'
import { beginBackgroundWork, type BackgroundWorkHandle } from '../shared/backgroundWork'

type PartialListener = (cache: PreviewBlockSplitCache) => void

type Pending = {
  resolve: (cache: PreviewBlockSplitCache) => void
  text: string
  /** Accumulated across this id's delta messages; tiles the document only at `done`. */
  ranges: PersistedPreviewBlockCache['ranges']
  /**
   * A SET, because the answer is shared by text (below) while the wish to
   * watch it arrive is per-caller: the background prewarm only wants the
   * finished map, the preview pane wants every instalment, and whichever of
   * them asked first must not decide that for the other.
   */
  listeners: Set<PartialListener>
  /**
   * Registered here rather than by the callers, so a future reason to ask the
   * worker for a block map is announced to the reader without its author
   * knowing the indicator exists -- the same argument that puts the hold
   * thresholds inside `armHold`.
   */
  work: BackgroundWorkHandle
  /** Total lines, for turning accumulated ranges into a real fraction. */
  totalLines: number
}

/**
 * A find query awaiting its answer. Kept separately from split requests
 * because the two are not variants of one thing: a split has instalments and
 * is shared by text between callers, a find is one question with one answer
 * and is superseded by the next question rather than joined.
 */
type PendingFind = { resolve: (hits: DocumentFindHit[]) => void; work: BackgroundWorkHandle }

let worker: Worker | null | undefined
let nextRequestId = 1
const pending = new Map<number, Pending>()
const pendingFinds = new Map<number, PendingFind>()
// One parse per TEXT, not per asker. Two independent callers now want the
// same map for the same note -- the background prewarm and the preview pane
// itself -- and parsing a 2MB document twice because two of them asked is
// the same waste whether it happens on a worker or here.
const inFlightByText = new Map<string, Promise<PreviewBlockSplitCache>>()
/** The same entries as `pending`, keyed the way a joining caller can find them. */
const pendingByText = new Map<string, Pending>()

function ensureWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    const created = new Worker(new URL('./documentFacts.worker.ts', import.meta.url), { type: 'module' })
    created.onmessage = (event: MessageEvent<DocumentFactsResponse>) => {
      if (event.data.kind === 'find') {
        const { id, hits } = event.data as PreviewFindHitsMessage
        const waiting = pendingFinds.get(id)
        if (!waiting) return
        pendingFinds.delete(id)
        waiting.work.done()
        waiting.resolve(hits)
        return
      }
      const { id, ranges, done } = event.data as SplitRangesMessage
      const request = pending.get(id)
      if (!request) return
      if (ranges.length > 0) request.ranges.push(...ranges)
      // The split is the one piece of background work that genuinely knows
      // how far along it is: instalments arrive in document order, so the
      // last range's end line against the document's total is a real
      // fraction rather than an animation pretending to be one.
      const reached = request.ranges.length > 0
        ? request.ranges[request.ranges.length - 1].rangeEndLine1
        : 0
      request.work.report(request.totalLines > 0 ? reached / request.totalLines : null)
      const cache = restorePreviewBlockSplitCacheFromRanges(request.text, request.ranges)
      if (!done) {
        for (const listener of request.listeners) listener(cache)
        return
      }
      pending.delete(id)
      pendingByText.delete(request.text)
      inFlightByText.delete(request.text)
      request.work.done()
      request.resolve(cache)
    }
    created.onerror = () => {
      // One failure retires the worker for the session: whatever broke it is
      // not going to be better on the next note, and every request from here
      // takes the main-thread path rather than hanging on a dead port.
      for (const [, request] of pending) {
        request.work.done()
        request.resolve(splitMarkdownIntoPreviewBlocksIncremental(request.text, null))
      }
      pending.clear()
      pendingByText.clear()
      inFlightByText.clear()
      for (const [, waiting] of pendingFinds) {
        waiting.work.done()
        waiting.resolve([])
      }
      pendingFinds.clear()
      worker = null
    }
    worker = created
  } catch {
    worker = null
  }
  return worker
}

/**
 * The full block map for `text`, parsed off the main thread where possible.
 *
 * Always resolves -- there is no error path a caller could do anything useful
 * with, since the answer is derivable here too, just slowly.
 */
export function requestFullBlockSplit(
  text: string,
  /**
   * Called with every instalment as it lands -- ranges from the top of the
   * document down, each covering more of it than the last. Never called
   * after the promise resolves; the resolved value is the same cache the
   * final instalment would have carried.
   */
  onPartial?: PartialListener,
): Promise<PreviewBlockSplitCache> {
  const active = ensureWorker()
  if (!active) return Promise.resolve(splitMarkdownIntoPreviewBlocksIncremental(text, null))

  const alreadyRunning = inFlightByText.get(text)
  if (alreadyRunning) {
    if (onPartial) pendingByText.get(text)?.listeners.add(onPartial)
    return alreadyRunning
  }

  const id = nextRequestId
  nextRequestId += 1
  const entry: Pending = {
    resolve: () => {},
    text,
    ranges: [],
    listeners: onPartial ? new Set([onPartial]) : new Set(),
    work: beginBackgroundWork('document-split'),
    totalLines: text.length === 0 ? 0 : text.split('\n').length,
  }
  const answer = new Promise<PreviewBlockSplitCache>((resolve) => {
    entry.resolve = resolve
    pending.set(id, entry)
    pendingByText.set(text, entry)
    const request: DocumentFactsRequest = { kind: 'split', id, text }
    active.postMessage(request)
  })
  inFlightByText.set(text, answer)
  return answer
}

/**
 * Find hits against what the RENDERED pane shows, computed off the main
 * thread.
 *
 * This used to run inside a `useMemo` in `useDocumentFind` -- a full remark
 * parse of the document, synchronously, during React's render phase, which
 * is the third time that exact shape has been found in this codebase. On a
 * 2MB note it froze the app for a minute or more on the first search, went
 * instant for every later term (a single-entry memo on the projection), and
 * froze again the moment the reader switched notes and came back, because
 * that one entry then held the other note.
 *
 * Not deduplicated by query, and deliberately: a find is one question with
 * one answer, superseded by the next keystroke's question rather than joined
 * by it. The caller drops answers it no longer wants.
 */
export function requestPreviewFindHits(
  text: string,
  query: string,
  caseSensitive: boolean,
): Promise<DocumentFindHit[]> {
  const active = ensureWorker()
  if (!active) return Promise.resolve(buildPreviewVisibleDocumentFindHits(text, query, caseSensitive))

  const id = nextRequestId
  nextRequestId += 1
  return new Promise<DocumentFindHit[]>((resolve) => {
    pendingFinds.set(id, { resolve, work: beginBackgroundWork('document-find') })
    const request: DocumentFactsRequest = { kind: 'find', id, text, query, caseSensitive }
    active.postMessage(request)
  })
}
