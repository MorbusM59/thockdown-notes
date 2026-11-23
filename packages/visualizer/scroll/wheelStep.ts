// How far one notch of the wheel moves the page, in each pane's own units.
//
// ## Why this is a setting at all
//
// A wheel notch is a fixed physical gesture that has never had a fixed
// meaning: the OS decides how many "lines" it is worth and the browser
// turns that into a pixel delta, so the same flick moves a different
// distance on every machine. `wheelNotch.ts` measures the delta a device
// sends so that a notch reliably counts as ONE nudge; this module decides
// what one nudge is then worth to the reader.
//
// ## Why both panes measure it in text, not pixels
//
// The edit view has always scrolled by whole rows -- a row is the unit the
// pane is built on. The render view used to scroll by whatever pixel delta
// the device happened to send, which meant the same wheel moved a different
// amount of TEXT depending on the reader's font size and line spacing: turn
// the text up and the page scrolled less of it per notch. Both panes now
// measure a notch in line heights, so the gesture keeps its meaning -- so
// many lines of reading per notch -- at any text size.
//
// The two settings are separate because the panes' units genuinely differ.
// The edit view lands on row boundaries (interaction design 3d), so its step
// can only be a whole number of rows. The render view has no grid to land
// on, so its step is continuous and can be a fraction of a line.

/** Edit view: whole rows per notch. */
export const WHEEL_STEP_ROWS_MIN = 1
export const WHEEL_STEP_ROWS_MAX = 10
export const WHEEL_STEP_ROWS_STEP = 1
/** One row per notch: the edit view's behaviour before this was settable. */
export const DEFAULT_WHEEL_STEP_ROWS = 1

/** Render view: line heights per notch, fractional. */
export const WHEEL_STEP_LINES_MIN = 0.5
export const WHEEL_STEP_LINES_MAX = 5
export const WHEEL_STEP_LINES_STEP = 0.1
/**
 * Three lines per notch: the convention every desktop OS ships with, and
 * what Chromium's own 100px-per-notch default is an approximation of.
 *
 * The render view used to scroll by the device's raw delta, which on a
 * 120px-per-notch wheel and default text came to a little under five lines.
 * Three is the honest default rather than a reproduction of that: the point
 * of the setting is that the number is now the reader's, stated in the unit
 * they actually read in.
 */
export const DEFAULT_WHEEL_STEP_LINES = 3

const clampNumber = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

/** The rows a notch is worth, whatever the caller has stored. */
export function resolveWheelStepRows(rows: number): number {
  return Math.round(clampNumber(rows, WHEEL_STEP_ROWS_MIN, WHEEL_STEP_ROWS_MAX, DEFAULT_WHEEL_STEP_ROWS))
}

/** The line heights a notch is worth, whatever the caller has stored. */
export function resolveWheelStepLines(lines: number): number {
  return clampNumber(lines, WHEEL_STEP_LINES_MIN, WHEEL_STEP_LINES_MAX, DEFAULT_WHEEL_STEP_LINES)
}

/** What the render view's step slider shows: one decimal, always. */
export function formatWheelStepLines(lines: number): string {
  return resolveWheelStepLines(lines).toFixed(1)
}

// ---------------------------------------------------------------------------
// Live tunables.
//
// Same shape and same reason as wheelSpin.ts's: both wheel handlers are
// attached once, at mount, and need the current value at event time. The
// sliders write here; the handlers read here.
// ---------------------------------------------------------------------------

let wheelStepRows = DEFAULT_WHEEL_STEP_ROWS
let wheelStepLines = DEFAULT_WHEEL_STEP_LINES

export function setWheelStepRows(next: number): void {
  wheelStepRows = resolveWheelStepRows(next)
}
export function getWheelStepRows(): number { return wheelStepRows }

export function setWheelStepLines(next: number): void {
  wheelStepLines = resolveWheelStepLines(next)
}
export function getWheelStepLines(): number { return wheelStepLines }
