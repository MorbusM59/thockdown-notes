/**
 * What speed reading shares across the window: the reader's settings as the
 * session reads them, and what a session in progress shows.
 *
 * Settings follow the app's pattern for values a non-React engine reads
 * (`ScrollCurvePlan`'s `setRenderScrollSkew`): App owns them as state, pushes
 * every change in here, and the session reads the live value. The one write
 * in the other direction is a session's changed words per minute, handed back
 * once when the session ends (`commitSpeedReadingSettings`) rather than on
 * every step of a held arrow key, so a sweep from 300 to 600 is one persisted
 * write instead of sixty.
 *
 * There is at most one session in the window -- it holds the keyboard -- so a
 * session in progress is a single slot, not a map. The edit view's row is
 * drawn by the active slot's editor (`SpeedReadingEditOverlay`), which is the
 * slot the session belongs to: any key or click that could move the keyboard
 * to another slot ends the session first.
 */
import { DEFAULT_SPEED_READING_SETTINGS, type SpeedReadingSettings } from './speedReadingSettings'

let settings: SpeedReadingSettings = DEFAULT_SPEED_READING_SETTINGS
let commitListener: ((next: SpeedReadingSettings) => void) | null = null

export function getSpeedReadingSettings(): SpeedReadingSettings {
  return settings
}

/** App's push of its persisted state. */
export function setSpeedReadingSettings(next: SpeedReadingSettings): void {
  settings = next
}

/** App's one listener for a session's changes, persisted from there. */
export function onSpeedReadingSettingsCommit(listener: (next: SpeedReadingSettings) => void): () => void {
  commitListener = listener
  return () => {
    if (commitListener === listener) commitListener = null
  }
}

export function commitSpeedReadingSettings(next: SpeedReadingSettings): void {
  settings = next
  commitListener?.(next)
}

/** The edit view's row while a session shows one. */
export interface SpeedReadingRow {
  text: string
  widthBoxes: number
}

export interface SpeedReadingDisplay {
  /** The words per minute the session is running at. */
  wpm: number
  /** Null in the render view, which shows the page itself. */
  row: SpeedReadingRow | null
}

let display: SpeedReadingDisplay | null = null
const displayListeners = new Set<() => void>()

export function getSpeedReadingDisplay(): SpeedReadingDisplay | null {
  return display
}

export function setSpeedReadingDisplay(next: SpeedReadingDisplay | null): void {
  if (next === display) return
  display = next
  for (const listener of displayListeners) listener()
}

export function subscribeSpeedReadingDisplay(listener: () => void): () => void {
  displayListeners.add(listener)
  return () => {
    displayListeners.delete(listener)
  }
}
