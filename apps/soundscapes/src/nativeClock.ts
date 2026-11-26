/**
 * The native output's clock on the page's. Every report the native side
 * sends about what is heard (the music's `heard`, the calibration loop's
 * `loopHeard`, the soundscape's `visuals`) carries `heardNanos`, when its
 * frame is HEARD on System.nanoTime's clock (AudioOutput.heardNanos: the
 * track's presentation timestamp, so the device's and the route's latency are
 * in it), and `sentNanos`, when the report left. This turns those into the
 * page's `performance.now()` seconds.
 *
 * The two clocks differ by a constant (both are monotonic) that the page
 * cannot read directly: a report's arrival minus its `sentNanos` is that
 * constant PLUS how long the bridge took, which varies by tens of
 * milliseconds. The least of these over the recent reports is the constant
 * with the shortest delivery, which is the best estimate there is; a window
 * rather than all time, so a clock that drifts (the page's clock is not
 * guaranteed to run at the system's rate) is followed.
 */

/** How many recent reports the offset is the least of. */
const WINDOW = 64

const offsets: number[] = []
let offsetSec = NaN

/** A report's `heardNanos` as `performance.now()` seconds, learning from its `sentNanos` as it arrives. */
export function heardAtSec(report: { heardNanos: number; sentNanos: number }): number {
  const sample = performance.now() / 1000 - report.sentNanos / 1e9
  offsets.push(sample)
  if (offsets.length > WINDOW) {
    const dropped = offsets.shift()!
    offsetSec = dropped === offsetSec ? Math.min(...offsets) : Math.min(offsetSec, sample)
  } else {
    offsetSec = Number.isNaN(offsetSec) ? sample : Math.min(offsetSec, sample)
  }
  return report.heardNanos / 1e9 + offsetSec
}
