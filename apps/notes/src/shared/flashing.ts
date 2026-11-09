import { flatCurve, sameCurve, sampleCurve, sanitizeCurve, type CurvePlane, type CurvePoint, type DrawnCurve } from './drawnCurve'

/**
 * FLASHING: how anything that flashes does it (Options > Advanced > Animations
 * > Flashing). Global, never part of a layout; the caret's blink is the one
 * reader today, and a new flashing element reads these rather than growing
 * settings of its own. Pure, and shared with the main process's state
 * sanitizer.
 *
 * A flash is a CURVE the reader draws over ONE CYCLE (`drawnCurve.ts`, on
 * FLASH_PLANE): x is the share of the cycle, 0..1, y the element's opacity,
 * 0..1. The plane wraps, so the cycle's end runs smoothly into its start. The
 * curve is the whole of what a flash looks like: there is no separate depth or
 * shape.
 *
 * How long a cycle lasts is either the reader's own (`cycleMs`) or the music's
 * (`matching`): one of FLASH_MATCHINGS, read in bar notation -- 4/4 is four
 * cycles over a bar of four beats, one a beat; 1/4 one a bar; past 4/4 the
 * plain reverse fractions, 2/1 two a beat. Counted from the bar's one, so 1/4
 * lands on every one; the thirds run on across the bar line as a polyrhythm,
 * which is intended. Matched, the cycle follows the music's tempo whenever a
 * beat is found (Grid Beat on, music playing) and falls back to `cycleMs`
 * whenever there is none.
 *
 * PRESETS work as every preset list in the app does (`keystrokeSounds.ts`):
 * FACTORY presets, SAVED ones, and the UNSAVED preset (the reader's last edit)
 * shown as the plus exactly while it equals no other. A preset is a SHAPE, the
 * curve and the cycle; the matching is a property of how the reader likes the
 * music answered and stays as it is when a preset is chosen.
 */

/** One cycle's plane: x the share of the cycle, y the opacity. */
export const FLASH_PLANE: CurvePlane = {
  xMax: 1,
  yMin: 0,
  yMax: 1,
  minGap: 1 / 48,
  maxPoints: 16,
  handleMax: 2,
  wrap: true,
}

/** The editor's grid: twelve segments of a bar, each step a quarter of one. */
export const FLASH_SEGMENTS = 12
export const FLASH_X_STEP = 1 / 48
export const FLASH_Y_STEP = 0.05
export const FLASH_HANDLE_STEP = 0.05
/** The handle a point placed by the reader starts with. */
export const FLASH_DEFAULT_HANDLE = 1

export const FLASH_CYCLE_MIN_MS = 100
export const FLASH_CYCLE_MAX_MS = 5000
export const FLASH_CYCLE_STEP_MS = 100
// 1200ms is the rhythm the caret has always blinked at.
export const FLASH_CYCLE_DEFAULT_MS = 1200

/** The matching slider's stops, left to right. `cyclesPerBeat` 0 is off. */
export const FLASH_MATCHINGS = [
  { label: 'off', cyclesPerBeat: 0 },
  { label: '1/4', cyclesPerBeat: 1 / 4 },
  { label: '1/3', cyclesPerBeat: 1 / 3 },
  { label: '2/4', cyclesPerBeat: 2 / 4 },
  { label: '2/3', cyclesPerBeat: 2 / 3 },
  { label: '3/4', cyclesPerBeat: 3 / 4 },
  { label: '4/4', cyclesPerBeat: 1 },
  { label: '4/3', cyclesPerBeat: 4 / 3 },
  { label: '3/2', cyclesPerBeat: 3 / 2 },
  { label: '2/1', cyclesPerBeat: 2 },
  { label: '3/1', cyclesPerBeat: 3 },
  { label: '4/1', cyclesPerBeat: 4 },
] as const
export const FLASH_MATCHING_ONE_TO_ONE = 6

/**
 * Every matching's cycle starts again on the same beat every BEATS_REPEAT
 * beats (the least common multiple of the denominators), so a beat counted
 * modulo this is all a cycle's phase needs (`flashPhaseAt`).
 */
export const FLASH_BEATS_REPEAT = 12

/** The cycle's phase, 0..1, at beat `beat` (counted from a bar's one, modulo FLASH_BEATS_REPEAT). */
export function flashPhaseAt(beat: number, cyclesPerBeat: number): number {
  const at = beat * cyclesPerBeat
  return at - Math.floor(at)
}

/** What a flash looks like over one cycle, without the music. */
export interface FlashShape {
  curve: CurvePoint[]
  cycleMs: number
}

export interface FlashingSettings extends FlashShape {
  /** Index into FLASH_MATCHINGS. */
  matching: number
}

const point = (x48: number, y: number, handle = 1): CurvePoint => ({ x: x48 / 48, y, handle })

export interface FactoryFlashShape {
  id: string
  name: string
  icon: string
  shape: Readonly<FlashShape>
}

/**
 * The blink shapes the caret had before the curve, drawn as curves on the
 * editor's grid: each stop a point where the old eased segments turned
 * (level handles at a peak or a dip, which is what the old easing did there),
 * and Steady, the caret that does not flash at all.
 */
export const FACTORY_FLASH_SHAPES: readonly FactoryFlashShape[] = [
  { id: 'heartbeat', name: 'Heartbeat', icon: 'fa-solid fa-heart-pulse', shape: { cycleMs: 1200, curve: [point(0, 0.6), point(5, 0.1), point(31, 0.9), point(41, 0.3), point(48, 0.6)] } },
  { id: 'bigBeat', name: 'Big beat', icon: 'fa-solid fa-heart', shape: { cycleMs: 1200, curve: [point(0, 0.1), point(31, 0.9), point(48, 0.1)] } },
  { id: 'fadeMid', name: 'Fade, peak in the middle', icon: 'fa-solid fa-caret-up', shape: { cycleMs: 1200, curve: [point(0, 0), point(24, 1), point(48, 0)] } },
  { id: 'fadeEarly', name: 'Fade, peak early', icon: 'fa-solid fa-caret-right', shape: { cycleMs: 1200, curve: [point(0, 0), point(7, 1), point(48, 0)] } },
  { id: 'fadeLate', name: 'Fade, peak late', icon: 'fa-solid fa-caret-left', shape: { cycleMs: 1200, curve: [point(0, 0), point(41, 1), point(48, 0)] } },
  { id: 'blink', name: 'Blink', icon: 'fa-solid fa-square', shape: { cycleMs: 1200, curve: [point(0, 1, 0), point(23, 1, 0), point(24, 0, 0), point(47, 0, 0), point(48, 1, 0)] } },
  { id: 'steady', name: 'Steady', icon: 'fa-solid fa-minus', shape: { cycleMs: 1200, curve: flatCurve(FLASH_PLANE, 1) } },
]

export const DEFAULT_FLASHING_SETTINGS: FlashingSettings = {
  ...cloneFlashShape(FACTORY_FLASH_SHAPES[0].shape),
  matching: FLASH_MATCHING_ONE_TO_ONE,
}

export function cloneFlashShape(shape: Readonly<FlashShape>): FlashShape {
  return { cycleMs: shape.cycleMs, curve: shape.curve.map((p) => ({ ...p })) }
}

export function sameFlashShape(a: Readonly<FlashShape>, b: Readonly<FlashShape>): boolean {
  return a.cycleMs === b.cycleMs && sameCurve(a.curve, b.curve)
}

/** Whether the curve is one level all through: nothing to animate. */
export function isFlashSteady(curve: DrawnCurve): boolean {
  return curve.every((p) => p.y === curve[0].y)
}

/** Samples a cycle is drawn with: a point every 1/96 of it, both ends included, between which it runs straight. */
export const FLASH_SAMPLES = 97

/** The opacity at FLASH_SAMPLES evenly spaced moments of one cycle. */
export function flashLevels(curve: DrawnCurve): Float64Array {
  return sampleCurve(FLASH_PLANE, curve, FLASH_SAMPLES)
}

/** The opacity at `phase` (0..1), straight between the samples. */
export function flashLevelAt(levels: ArrayLike<number>, phase: number): number {
  const at = phase * (levels.length - 1)
  const i = Math.min(levels.length - 2, Math.max(0, Math.floor(at)))
  const t = at - i
  return levels[i] + (levels[i + 1] - levels[i]) * t
}

const integer = (value: unknown, min: number, max: number, fallback: number) => (
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback
)

function sanitizeFlashShape(value: unknown, fallback: Readonly<FlashShape>): FlashShape {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    curve: sanitizeCurve(FLASH_PLANE, input.curve, fallback.curve),
    cycleMs: integer(input.cycleMs, FLASH_CYCLE_MIN_MS, FLASH_CYCLE_MAX_MS, fallback.cycleMs),
  }
}

export function sanitizeFlashingSettings(value: unknown): FlashingSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    ...sanitizeFlashShape(input, DEFAULT_FLASHING_SETTINGS),
    matching: integer(input.matching, 0, FLASH_MATCHINGS.length - 1, DEFAULT_FLASHING_SETTINGS.matching),
  }
}

// ── Presets ─────────────────────────────────────────────────────────────────

export interface SavedFlashShape {
  id: string
  shape: FlashShape
}

/** Not a design limit, only a bound on a list nobody should reach. */
export const MAX_SAVED_FLASH_SHAPES = 100

/** What is persisted (`flashingPresets`). */
export interface FlashShapePreferences {
  unsaved: FlashShape
  saved: SavedFlashShape[]
}

export const DEFAULT_FLASH_SHAPE_PREFERENCES: FlashShapePreferences = { unsaved: cloneFlashShape(DEFAULT_FLASHING_SETTINGS), saved: [] }

export type ActiveFlashShape =
  | { kind: 'factory'; id: string }
  | { kind: 'saved'; id: string }
  | { kind: 'unsaved' }

export function matchingFlashShape(live: Readonly<FlashShape>, preferences: FlashShapePreferences): ActiveFlashShape {
  const factory = FACTORY_FLASH_SHAPES.find((entry) => sameFlashShape(entry.shape, live))
  if (factory) return { kind: 'factory', id: factory.id }
  const saved = preferences.saved.find((entry) => sameFlashShape(entry.shape, live))
  if (saved) return { kind: 'saved', id: saved.id }
  return { kind: 'unsaved' }
}

export function isUnsavedFlashShapeShown(preferences: FlashShapePreferences): boolean {
  return matchingFlashShape(preferences.unsaved, preferences).kind === 'unsaved'
}

/** After an EDIT of the live shape (never a selection), the edit is the unsaved preset. Same object when nothing changes. */
export function unsavedFlashShapeAfterEdit(live: Readonly<FlashShape>, preferences: FlashShapePreferences): FlashShapePreferences {
  if (sameFlashShape(preferences.unsaved, live)) return preferences
  return { ...preferences, unsaved: cloneFlashShape(live) }
}

export function sanitizeFlashShapePreferences(value: unknown): FlashShapePreferences {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const saved: SavedFlashShape[] = []
  if (Array.isArray(input.saved)) {
    for (const entry of input.saved) {
      if (saved.length >= MAX_SAVED_FLASH_SHAPES) break
      const record = (entry && typeof entry === 'object' ? entry : null) as Record<string, unknown> | null
      if (!record || typeof record.id !== 'string' || record.id === '' || saved.some((item) => item.id === record.id)) continue
      saved.push({ id: record.id, shape: sanitizeFlashShape(record.shape, DEFAULT_FLASHING_SETTINGS) })
    }
  }
  return { unsaved: sanitizeFlashShape(input.unsaved, DEFAULT_FLASHING_SETTINGS), saved }
}
