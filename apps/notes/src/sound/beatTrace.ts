// The opt-in beat-pulse trace: what the drum responses and the caret read,
// for a beat that drifts out of step or a hit that shows wrong in a real session.
//
// `localStorage['thockdown:debug-beat'] = '1'` (read live, so it can be set
// from the console with the music already playing), then
// `copy(window.__beatTrace.join('\n'))`. Attaches nothing when unset.
//
// The lines, all stamped with media time:
// - `score sec`: once a second, how far ahead the score is written and its
//   signals (`musicAnalysis.ts`'s `signalLabel`).
// - `score kicks` / `score hits`: every instance a tracker took.
// - `caret`: once a second, the caret's beat (`musicBeat.ts`'s `traceCaret`).
// - `beat RESYNC`: the analysis started over at the listener (a seek, a new
//   track, a changed source or band), decoding the window around it afresh.

const BEAT_TRACE_FLAG = 'thockdown:debug-beat'
const BEAT_TRACE_LIMIT = 400

interface BeatTraceHost {
  __beatTrace?: string[]
}

export function isBeatTraceOn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(BEAT_TRACE_FLAG) === '1'
  } catch {
    return false
  }
}

export function appendBeatTrace(line: string): void {
  if (typeof window === 'undefined') return
  const host = window as unknown as BeatTraceHost
  if (!host.__beatTrace) host.__beatTrace = []
  host.__beatTrace.push(line)
  if (host.__beatTrace.length > BEAT_TRACE_LIMIT) host.__beatTrace.splice(0, host.__beatTrace.length - BEAT_TRACE_LIMIT)
  console.log(line)
}
