/**
 * Why a find hit's card is, or is not, marked as visible on screen.
 *
 * Opt-in via `localStorage['thockdown:debug-find-marking'] = '1'`, read LIVE
 * rather than latched, so it can be switched on with the symptom already on
 * screen -- this defect is intermittent and a reload loses it.
 *
 * It exists because the marking failed for two days against a hypothesis
 * that was reasoned out of the code and never checked against the running
 * app. Every decision point is logged INCLUDING the silent returns: the
 * question "which of the five ways this can answer nothing did it take" is
 * unanswerable from outside, and each one needs a different fix.
 *
 * Buffered on `window.__findMarkingTrace` (last 200), because the answer is
 * usually one line inside a burst:
 *   copy(window.__findMarkingTrace.join('\n'))
 */

const BUFFER_LIMIT = 200

function enabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem('thockdown:debug-find-marking') === '1'
  } catch {
    return false
  }
}

export function traceFindMarking(line: () => string): void {
  if (!enabled()) return
  const text = `[find-mark] ${line()}`
  const w = window as unknown as { __findMarkingTrace?: string[] }
  if (!w.__findMarkingTrace) w.__findMarkingTrace = []
  w.__findMarkingTrace.push(text)
  if (w.__findMarkingTrace.length > BUFFER_LIMIT) w.__findMarkingTrace.shift()
  console.log(text)
}
