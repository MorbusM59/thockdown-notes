// The opt-in trace for the render view's settle gate: why the preview was
// revealed, and what moved afterwards.
//
// `localStorage['thockdown:debug-preview-settle'] = '1'`, open a note in
// render view, then `copy(window.__previewSettleTrace.join('\n'))`. Attaches
// nothing when unset.
//
// ## What this exists to answer
//
// The gate (previewSettleGate.ts) holds the preview unpainted until its
// geometry reaches a fixed point, so in principle the first frame the reader
// sees is the final one. A settle that is still VISIBLE therefore does not
// mean "the gate is too short" -- it means one of three quite different
// things, and they need different fixes:
//
//   1. the gate revealed at a genuine fixed point, and something moved the
//      geometry AFTER it (a late measurement commit, an image decoding, a
//      font swap) -- the gate is working and the mover is the bug;
//   2. the gate never reached a fixed point and revealed on its safety bound
//      or safety timer -- the reveal is a give-up, not a decision;
//   3. the gate never engaged at all (no container, a superseded generation,
//      the frozen-section early return) -- nothing was ever hidden.
//
// From outside they are indistinguishable: all three look like "the note
// appears, then shuffles". So every reveal names its own reason, and a
// watcher then follows the geometry for a while afterwards.
//
// ## Why the post-reveal watcher reports four numbers, not one
//
// A movement of the SCROLLER and a movement of the TEXT look identical from
// outside and are not the same event -- the same lesson the caret-cage trace
// records ("text movement is scroll movement minus height change"). A
// measurement commit that lands above the reader is compensated by a
// matching scrollTop write, so scrollTop moves and the reader sees nothing;
// one that lands in the mounted run reflows the text with scrollTop
// untouched. Reading either number alone gets this backwards.
//
// So each sample carries scrollTop, scrollHeight and the virtualizer's sizer
// height separately, plus `textShift`: the on-screen position of one latched
// block (its own offset minus scrollTop), followed across the whole watch.
// That last number is the only one that says what the READER saw. A
// scrollHeight jump with textShift at 0 is the scrollbar thumb resizing and
// nothing else; a non-zero textShift is the reflow being reported.
//
// Survey commits are written into this same buffer, for the same reason
// scrollTrace.ts keeps its three sources together: if the reflow line and
// the commit line land in the same frame, the question is answered outright
// rather than reconstructed by eye from two buffers.

const SETTLE_TRACE_FLAG = 'thockdown:debug-preview-settle'
const SETTLE_TRACE_LIMIT = 400

interface SettleTraceHost {
  __previewSettleTrace?: string[]
}

/** Read live, not latched -- see scrollTrace.ts's isScrollTraceOn for why. */
export function isSettleTraceOn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SETTLE_TRACE_FLAG) === '1'
  } catch {
    return false
  }
}

export function appendSettleTrace(line: string): void {
  if (typeof window === 'undefined') return
  const host = window as unknown as SettleTraceHost
  if (!host.__previewSettleTrace) host.__previewSettleTrace = []
  host.__previewSettleTrace.push(line)
  if (host.__previewSettleTrace.length > SETTLE_TRACE_LIMIT) {
    host.__previewSettleTrace.splice(0, host.__previewSettleTrace.length - SETTLE_TRACE_LIMIT)
  }
  console.log('[preview-settle] ' + line)
}

/** Trace `line` only when the flag is on, building it lazily. */
export function traceSettle(build: () => string): void {
  if (!isSettleTraceOn()) return
  appendSettleTrace(build())
}

/** One geometry sample, in the three components that move independently. */
export interface SettleGeometrySample {
  scrollTop: number
  scrollHeight: number
  sizerHeightPx: number
  /**
   * On-screen top of the latched block: its own offset within the sizer
   * minus scrollTop. Null when that block is not mounted (the reader has
   * been carried past it, or the window re-anchored). This is the number
   * that says whether the READER saw anything move.
   */
  latchedBlockScreenTop: number | null
}

/**
 * Reads the geometry of the preview scroller, following `latchedBlockIndex`
 * if it is still mounted.
 *
 * The block's offset comes from its inline `transform: translateY(px)` --
 * the same value the virtualizer wrote -- rather than from
 * getBoundingClientRect, so that reading it cannot itself force a layout in
 * the middle of the very settle being observed.
 */
export function readSettleGeometry(
  container: HTMLElement,
  latchedBlockIndex: number | null,
): SettleGeometrySample {
  const sizer = container.firstElementChild as HTMLElement | null
  const sizerHeightPx = sizer ? Number.parseFloat(sizer.style.height) || 0 : 0

  let latchedBlockScreenTop: number | null = null
  if (sizer && latchedBlockIndex !== null) {
    const block = sizer.querySelector(`[data-index="${latchedBlockIndex}"]`) as HTMLElement | null
    if (block) {
      const match = /translateY\(([-\d.]+)px\)/.exec(block.style.transform)
      if (match) latchedBlockScreenTop = Number.parseFloat(match[1]) - container.scrollTop
    }
  }

  return {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    sizerHeightPx,
    latchedBlockScreenTop,
  }
}

/**
 * The lowest mounted block index, latched at reveal so the watcher can
 * follow one identifiable block rather than "whatever is on top now" --
 * which changes for reasons that are not movement.
 */
export function readTopMountedBlockIndex(container: HTMLElement): number | null {
  const sizer = container.firstElementChild as HTMLElement | null
  if (!sizer) return null
  let lowest: number | null = null
  for (const child of Array.from(sizer.children)) {
    const raw = (child as HTMLElement).dataset?.index
    if (raw === undefined) continue
    const index = Number.parseInt(raw, 10)
    if (Number.isNaN(index)) continue
    if (lowest === null || index < lowest) lowest = index
  }
  return lowest
}

const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))
const delta = (next: number, previous: number) => {
  const difference = next - previous
  if (difference === 0) return '0'
  return `${difference > 0 ? '+' : ''}${format(difference)}`
}

/** One watcher line: what each component is now, and how far it moved since the last change. */
export function formatSettleSample(
  elapsedMs: number,
  sample: SettleGeometrySample,
  previous: SettleGeometrySample,
): string {
  const textShift = sample.latchedBlockScreenTop === null || previous.latchedBlockScreenTop === null
    ? 'unmounted'
    : `${delta(sample.latchedBlockScreenTop, previous.latchedBlockScreenTop)}px`
  return `after +${Math.round(elapsedMs)}ms`
    + ` scrollTop=${format(sample.scrollTop)}(${delta(sample.scrollTop, previous.scrollTop)})`
    + ` scrollHeight=${format(sample.scrollHeight)}(${delta(sample.scrollHeight, previous.scrollHeight)})`
    + ` sizerH=${format(sample.sizerHeightPx)}(${delta(sample.sizerHeightPx, previous.sizerHeightPx)})`
    + ` textShift=${textShift}`
}

export function sampleDiffers(a: SettleGeometrySample, b: SettleGeometrySample): boolean {
  if (a.scrollTop !== b.scrollTop
    || a.scrollHeight !== b.scrollHeight
    || a.sizerHeightPx !== b.sizerHeightPx) return true

  // The latched block LEAVING the mounted range is not movement -- it is the
  // reader having scrolled past it, or the virtualizer narrowing its range.
  // Counted as a change, it reported "the reveal was followed by movement" on
  // traces where all three geometry numbers were flat at zero delta, which is
  // the opposite of what the watcher exists to say. Only a block that is
  // mounted in BOTH samples can have moved between them.
  if (a.latchedBlockScreenTop === null || b.latchedBlockScreenTop === null) return false
  return a.latchedBlockScreenTop !== b.latchedBlockScreenTop
}

/** How long the watcher follows the geometry after a reveal. */
export const SETTLE_WATCH_DURATION_MS = 2500
