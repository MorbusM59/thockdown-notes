// The opt-in trace for windowed scrolling: the window, the journey, the curtain.
//
// `localStorage['thockdown:debug-preview-window'] = '1'`, reproduce, then
// `copy(window.__previewWindowTrace.join('\n'))`. Attaches nothing when unset.
//
// ## Why these three share one buffer
//
// They are three views of one event. A travel across a large note plans a
// journey, the journey clamps against whatever the mounted window can
// actually hold, the window re-anchors under the curtain, and the curtain
// covers the moment it does. A defect in any one of them presents as a
// symptom of the others: a scroll that "does not arrive" is a journey whose
// target was never in the scroller's space, a "stall" is a window declining
// to move, and a curtain that never appears may be either, or its own fault.
// Read in three separate buffers, the halves have to be reordered by eye --
// which is exactly the reconstruction that hides ordering bugs.
//
// So every line goes in one place, in the order it happened, and names its
// own source: `win` for the block window, `journey` for the travel engine,
// `bridge` for the curtain.
//
// The key and the global keep the names they already had, so a habit or a
// note that says `__previewWindowTrace` still works.

const SCROLL_TRACE_FLAG = 'thockdown:debug-preview-window'
const SCROLL_TRACE_LIMIT = 400

interface ScrollTraceHost {
  __previewWindowTrace?: string[]
}

/**
 * Read live, not cached at first use.
 *
 * The flag used to be latched on the first call, which meant turning the
 * trace on required a reload and gave no hint of that. These defects are
 * intermittent -- a stall the reader has just produced and cannot reliably
 * produce again -- so the one thing the trace must support is being switched
 * on while the app is running, with the symptom still on screen. One
 * `getItem` against the work a scroll frame is already doing is not a cost
 * worth reintroducing that for.
 */
export function isScrollTraceOn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SCROLL_TRACE_FLAG) === '1'
  } catch {
    return false
  }
}

export function appendScrollTrace(line: string): void {
  if (typeof window === 'undefined') return
  const host = window as unknown as ScrollTraceHost
  if (!host.__previewWindowTrace) host.__previewWindowTrace = []
  host.__previewWindowTrace.push(line)
  if (host.__previewWindowTrace.length > SCROLL_TRACE_LIMIT) {
    host.__previewWindowTrace.splice(0, host.__previewWindowTrace.length - SCROLL_TRACE_LIMIT)
  }
  console.log('[scroll] ' + line)
}

/** Trace `line` only when the flag is on, building it lazily. */
export function traceScroll(build: () => string): void {
  if (!isScrollTraceOn()) return
  appendScrollTrace(build())
}
