/**
 * Speed reading: the reader's settings. The session that reads them is
 * `speedReading/speedReadingSession.ts`; this file is only the persisted
 * shape, its ranges, its defaults and its sanitizer, kept free of the DOM so
 * the main process's `sanitizeMenu` can use the same sanitizer the renderer
 * does.
 *
 * The two views read at different speeds on purpose -- following a scrolling
 * page and taking in a few words at a fixed point are different skills -- so
 * each keeps its own words per minute. Everything else is shared: the row
 * width belongs to the edit view alone, and ONE speed curve shapes both the
 * edit view's ease into a held advance and the render view's slow-down to a
 * pause and speed-up out of it. The curve's three numbers are the same three
 * the Animations section has (ramp, shape, speed), fed to the same bell
 * (`@thockdown/interaction/smoothCurve`), but they are their own values: a
 * page key's half-second journey and a reading pace's ease are different
 * lengths of the same gesture, and tying one to the other would make tuning
 * either break the other.
 */

export interface SpeedReadingSettings {
  /** Words per minute the render view scrolls at. */
  renderWpm: number
  /** Words per minute a held Space advances the edit view's row at. */
  editWpm: number
  /** The edit view's reading row, in boxes. A chunk holds as many words as fit. */
  rowWidth: number
  /**
   * Milliseconds every chunk stays on screen before its letters are counted:
   * the time to see and recognise a fixation's worth of text, which does not
   * shrink with a shorter chunk (`chunkDurationSec`).
   */
  fixationMs: number
  /** The bell's dynamic `a`, as the Animations section's `ramp`. */
  curveRamp: number
  /** Where the bell's apex sits, 0..1, as the Animations section's `shape`. */
  curveShape: number
  /** Seconds the whole bell takes, as the Animations section's `speed`: the ease in is `shape` of it, the ease out the rest. */
  curveSpeedSec: number
}

export const SPEED_READING_WPM_MIN = 50
export const SPEED_READING_WPM_MAX = 1500
export const SPEED_READING_WPM_STEP = 5
export const SPEED_READING_ROW_WIDTH_MIN = 6
export const SPEED_READING_ROW_WIDTH_MAX = 60
/** Average letters to a word, with its space: how many words a full row holds. */
export const SPEED_READING_LETTERS_PER_WORD = 6

export const SPEED_READING_FIXATION_MAX_MS = 600

/**
 * Seconds a chunk stays on screen at full pace, as rapid serial visual
 * presentation times it: a fixed FIXATION every chunk pays, plus a time per
 * letter, plus a pause after a sentence's end (one fixation) or a clause's
 * (half of one). The per-letter time is solved from the words per minute so
 * that a full row of average text -- `rowWidth / LETTERS_PER_WORD` words, each
 * of `LETTERS_PER_WORD - 1` letters -- takes exactly what the pace says it
 * should; when the fixation alone already exceeds that, the per-letter time is
 * zero and the fixation is the floor, so a high pace stops shortening chunks
 * below what can be recognised.
 */
export function chunkDurationSec(text: string, wpm: number, rowWidth: number, fixationMs: number): number {
  const fixation = Math.max(0, fixationMs) / 1000
  const fullRowWords = Math.max(1, rowWidth / SPEED_READING_LETTERS_PER_WORD)
  const fullRowSec = (fullRowWords * 60) / Math.max(1, wpm)
  const fullRowLetters = fullRowWords * (SPEED_READING_LETTERS_PER_WORD - 1)
  const perLetter = Math.max(0, fullRowSec - fixation) / fullRowLetters
  const letters = text.replace(/\s/g, '').length
  const last = text.replace(/[\s"')\]*_-]+$/, '').slice(-1)
  const pause = '.!?'.includes(last) && last !== '' ? fixation : ',;:'.includes(last) && last !== '' ? fixation / 2 : 0
  return fixation + perLetter * letters + pause
}

export const SPEED_READING_CURVE_RAMP_MIN = 0.1
export const SPEED_READING_CURVE_RAMP_MAX = 5
export const SPEED_READING_CURVE_SHAPE_MIN = 0.1
export const SPEED_READING_CURVE_SHAPE_MAX = 0.9
export const SPEED_READING_CURVE_SPEED_MAX_SEC = 4

export const DEFAULT_SPEED_READING_SETTINGS: SpeedReadingSettings = {
  renderWpm: 250,
  editWpm: 300,
  rowWidth: 24,
  fixationMs: 200,
  curveRamp: 5 / 3,
  curveShape: 0.5,
  curveSpeedSec: 1.5,
}

/** A words-per-minute value on the step grid and inside the range. */
export function clampWpm(value: number): number {
  const stepped = Math.round(value / SPEED_READING_WPM_STEP) * SPEED_READING_WPM_STEP
  return Math.max(SPEED_READING_WPM_MIN, Math.min(SPEED_READING_WPM_MAX, stepped))
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

export function sanitizeSpeedReadingSettings(input: unknown): SpeedReadingSettings {
  const record = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const d = DEFAULT_SPEED_READING_SETTINGS
  return {
    renderWpm: typeof record.renderWpm === 'number' && Number.isFinite(record.renderWpm) ? clampWpm(record.renderWpm) : d.renderWpm,
    editWpm: typeof record.editWpm === 'number' && Number.isFinite(record.editWpm) ? clampWpm(record.editWpm) : d.editWpm,
    rowWidth: Math.round(numberIn(record.rowWidth, SPEED_READING_ROW_WIDTH_MIN, SPEED_READING_ROW_WIDTH_MAX, d.rowWidth)),
    fixationMs: Math.round(numberIn(record.fixationMs, 0, SPEED_READING_FIXATION_MAX_MS, d.fixationMs)),
    curveRamp: numberIn(record.curveRamp, SPEED_READING_CURVE_RAMP_MIN, SPEED_READING_CURVE_RAMP_MAX, d.curveRamp),
    curveShape: numberIn(record.curveShape, SPEED_READING_CURVE_SHAPE_MIN, SPEED_READING_CURVE_SHAPE_MAX, d.curveShape),
    curveSpeedSec: numberIn(record.curveSpeedSec, 0, SPEED_READING_CURVE_SPEED_MAX_SEC, d.curveSpeedSec),
  }
}
