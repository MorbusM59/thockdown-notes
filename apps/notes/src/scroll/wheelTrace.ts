// The opt-in wheel trace, shared by every pane that scrolls under a wheel.
//
// `localStorage['thockdown:debug-wheel'] = '1'`, reload, reproduce, then
// `copy(window.__wheelTrace.join('\n'))`. Attaches nothing when unset.
//
// One buffer for both panes on purpose. The questions this trace answers --
// what is the device actually sending, did a spin start, why did a coast
// end -- are asked about a gesture, and in split view a gesture can cross
// from one pane to the other. Two buffers would mean reading the halves of
// one story side by side and reconstructing the order by eye. Every line
// therefore names its pane (`wheel`/`edit`, `preview`), so a single-pane
// read is still a filter away.

const WHEEL_TRACE_FLAG = 'thockdown:debug-wheel'
const WHEEL_TRACE_LIMIT = 400

interface WheelTraceHost {
  __wheelTrace?: string[]
}

/**
 * Read live rather than cached, unlike the preview-window trace's flag.
 *
 * The wheel trace is the one people turn on WHILE the app is running, from
 * the console, because the defect is already in front of them and a reload
 * would lose it. A cached flag would make that not work and give no hint why.
 */
export function isWheelTraceOn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(WHEEL_TRACE_FLAG) === '1'
  } catch {
    return false
  }
}

export function appendWheelTrace(line: string): void {
  if (typeof window === 'undefined') return
  const host = window as unknown as WheelTraceHost
  if (!host.__wheelTrace) host.__wheelTrace = []
  host.__wheelTrace.push(line)
  if (host.__wheelTrace.length > WHEEL_TRACE_LIMIT) {
    host.__wheelTrace.splice(0, host.__wheelTrace.length - WHEEL_TRACE_LIMIT)
  }
  console.log(line)
}
