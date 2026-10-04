// What the app is doing that the reader is not doing.
//
// Some work outlives the gesture that asked for it: parsing a note's block
// map, projecting its visible text, rendering a texture. None of it blocks
// the app any more -- that was the point of moving it off the main thread --
// but "not blocked" and "finished" are different states, and until now the
// interface said nothing about which one the reader was in. A find that will
// answer in two seconds and a find that has already answered with nothing
// look identical.
//
// So there is one register of work in flight, and one indicator driven by it
// (the sidebar's cogwheel turns while it is non-empty -- see
// workIndicatorSpin.ts).
//
// ## Why this is not "is a worker running"
//
// Because a reader waits on things that are not workers, and an indicator
// that is honest about SOME waiting is worse than none: stillness stops
// meaning anything the first time the app is busy without it moving. The
// register is about work the reader might be waiting on, whatever performs
// it, and the workers are contributors rather than the definition.
//
// ## Where it is wired, and why that is the whole design
//
// At the TRANSPORTS -- documentFactsClient's request path, the texture
// worker's lifecycle -- not at each call site. A new kind of document fact,
// or a second reason to ask the worker something, is registered by the code
// that already exists, without its author knowing this file is here. That is
// the same reason `armHold` owns the hold thresholds rather than each gesture
// arming its own timer.

/**
 * A kind of work, for a reader of this register that wants to distinguish
 * them. The indicator does not: it asks only whether anything is in flight.
 * Named rather than free-form so the register can be read in a debugger and
 * mean something.
 */
export type BackgroundWorkKind =
  | 'document-split'
  | 'document-find'
  | 'texture'

export interface BackgroundWorkState {
  /** How many pieces of work are in flight. Zero means the app is idle. */
  pending: number
  /**
   * How far along, in [0, 1], or null when nothing in flight can say.
   *
   * Kept in the contract even though the indicator ignores it, because one of
   * these tasks genuinely knows: the block split arrives in instalments and
   * can report accumulated lines against the document's. The other two cannot.
   * An indicator that is precise for one task and vague for two reads as
   * broken for the two, so the cogwheel turns at a constant rate -- but the
   * fact exists, and a consumer that only ever watches a split can use it
   * without this register being redesigned first.
   */
  progress: number | null
}

export interface BackgroundWorkHandle {
  /** Report how far along, or null if unknown. Optional; never required. */
  report: (progress: number | null) => void
  /**
   * Finished. Idempotent, exactly like `armHold`'s own settle latch and for
   * the same reason: several of these are ended on a path that may also have
   * ended them already (a worker error handler that resolves every pending
   * request, then the request's own resolution), and a second `done()` would
   * retract a count belonging to work still running underneath.
   */
  done: () => void
}

interface Entry {
  kind: BackgroundWorkKind
  progress: number | null
  startedAtMs: number
}

/**
 * What is turning the cogwheel, when the answer is not obvious.
 *
 * `localStorage['thockdown:debug-background-work'] = '1'`, read live. The
 * indicator deliberately says only THAT the app is working, which is right
 * for a reader and useless the moment someone asks WHICH work -- and that
 * question came up the day the wheel shipped, with three plausible answers
 * and no way to tell them apart from outside.
 *
 * Each line carries the kind, how long it took, and what is left in flight.
 */
function traceBackgroundWork(line: string): void {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem('thockdown:debug-background-work') !== '1') return
  } catch {
    return
  }
  console.log(`[background-work] ${line}`)
}

let nextId = 1
const entries = new Map<number, Entry>()
const listeners = new Set<(state: BackgroundWorkState) => void>()

function currentState(): BackgroundWorkState {
  // The MINIMUM of what the reporters know, not an average: two tasks in
  // flight are finished when the slowest is, and averaging would show a
  // progress that runs backwards as new work joins.
  let progress: number | null = null
  for (const entry of entries.values()) {
    if (entry.progress === null) continue
    progress = progress === null ? entry.progress : Math.min(progress, entry.progress)
  }
  return { pending: entries.size, progress }
}

function publish(): void {
  const state = currentState()
  for (const listener of listeners) listener(state)
}

export function beginBackgroundWork(kind: BackgroundWorkKind): BackgroundWorkHandle {
  const id = nextId
  nextId += 1
  const startedAtMs = Date.now()
  entries.set(id, { kind, progress: null, startedAtMs })
  traceBackgroundWork(`begin ${kind} (pending=${entries.size})`)
  publish()

  let settled = false
  return {
    report: (progress) => {
      const entry = entries.get(id)
      if (!entry || settled) return
      entry.progress = progress === null ? null : Math.max(0, Math.min(1, progress))
      publish()
    },
    done: () => {
      if (settled) return
      settled = true
      const entry = entries.get(id)
      entries.delete(id)
      traceBackgroundWork(
        `end   ${kind} after ${entry ? Date.now() - entry.startedAtMs : 0}ms (pending=${entries.size})`,
      )
      publish()
    },
  }
}

export function subscribeToBackgroundWork(
  listener: (state: BackgroundWorkState) => void,
): () => void {
  listeners.add(listener)
  listener(currentState())
  return () => { listeners.delete(listener) }
}

/** For tests, which must not inherit another test's in-flight work. */
export function resetBackgroundWorkForTests(): void {
  entries.clear()
  listeners.clear()
}
