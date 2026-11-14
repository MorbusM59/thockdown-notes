import { emptyPresetList, sanitizePresetList, type Preset, type PresetKind, type PresetList } from '@thockdown/interaction/presetList'

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
 * cycles over a bar of four beats, one a beat, the fastest; 1/4 one a bar.
 * Counted from the bar's one, so 1/4
 * lands on every one; the thirds run on across the bar line as a polyrhythm,
 * which is intended. Matched, the cycle follows the music's tempo whenever a
 * beat is found (Grid Beat on, music playing) and falls back to `cycleMs`
 * whenever there is none.
 *
 * The shapes are a PRESET LIST (`packages/interaction/presetList.ts`): one is
 * always active, the live shape IS its shape, and an edit is written into it.
 * A preset is a SHAPE, the curve and the cycle; the matching is a property of
 * how the reader likes the music answered, kept on its own (`flashMatching`)
 * and left as it is when a preset is chosen.
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
] as const
/** The default stop: 2/4, a cycle every two beats. */
export const FLASH_MATCHING_DEFAULT = 3

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

/**
 * The blink shapes the caret had before the curve, drawn as curves on the
 * editor's grid: each stop a point where the old eased segments turned
 * (level handles at a peak or a dip, which is what the old easing did there),
 * and Steady, the caret that does not flash at all.
 */
export const FACTORY_FLASH_SHAPES: readonly Preset<FlashShape>[] = [
  { id: 'heartbeat', name: 'Heartbeat', icon: 'fa-heart-pulse', settings: { cycleMs: 1200, curve: [point(0, 0.6), point(5, 0.1), point(31, 0.9), point(41, 0.3), point(48, 0.6)] } },
  { id: 'bigBeat', name: 'Big beat', icon: 'fa-heart', settings: { cycleMs: 1200, curve: [point(0, 0.1), point(31, 0.9), point(48, 0.1)] } },
  { id: 'fadeMid', name: 'Fade, peak in the middle', icon: 'fa-caret-up', settings: { cycleMs: 1200, curve: [point(0, 0), point(24, 1), point(48, 0)] } },
  { id: 'fadeEarly', name: 'Fade, peak early', icon: 'fa-caret-right', settings: { cycleMs: 1200, curve: [point(0, 0), point(7, 1), point(48, 0)] } },
  { id: 'fadeLate', name: 'Fade, peak late', icon: 'fa-caret-left', settings: { cycleMs: 1200, curve: [point(0, 0), point(41, 1), point(48, 0)] } },
  { id: 'blink', name: 'Blink', icon: 'fa-square', settings: { cycleMs: 1200, curve: [point(0, 1, 0), point(23, 1, 0), point(24, 0, 0), point(47, 0, 0), point(48, 1, 0)] } },
  { id: 'steady', name: 'Steady', icon: 'fa-minus', settings: { cycleMs: 1200, curve: flatCurve(FLASH_PLANE, 1) } },
]

export const DEFAULT_FLASHING_SETTINGS: FlashingSettings = {
  ...cloneFlashShape(FACTORY_FLASH_SHAPES[0].settings),
  matching: FLASH_MATCHING_DEFAULT,
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

export function sanitizeFlashShape(value: unknown, fallback: Readonly<FlashShape> = DEFAULT_FLASHING_SETTINGS): FlashShape {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    curve: sanitizeCurve(FLASH_PLANE, input.curve, fallback.curve),
    cycleMs: integer(input.cycleMs, FLASH_CYCLE_MIN_MS, FLASH_CYCLE_MAX_MS, fallback.cycleMs),
  }
}

/** The matching, persisted on its own as the menu's `flashMatching`. */
export function sanitizeFlashMatching(value: unknown): number {
  return integer(value, 0, FLASH_MATCHINGS.length - 1, FLASH_MATCHING_DEFAULT)
}

// ── Presets ─────────────────────────────────────────────────────────────────

/** What the dock's reset writes into the active preset: Steady, the flash that does not flash. */
export const NEUTRAL_FLASH_SHAPE: Readonly<FlashShape> = FACTORY_FLASH_SHAPES.find((preset) => preset.id === 'steady')!.settings

export const FLASH_SHAPE_KIND: PresetKind<FlashShape> = {
  factory: FACTORY_FLASH_SHAPES,
  defaultId: FACTORY_FLASH_SHAPES[0].id,
  noun: 'Flashing',
  maxCustom: 100,
  clone: cloneFlashShape,
  sanitizeSettings: (value) => sanitizeFlashShape(value),
}

/** What is persisted (`flashingPresets`). */
export type FlashShapePreferences = PresetList<FlashShape>

export const DEFAULT_FLASH_SHAPE_PREFERENCES: FlashShapePreferences = emptyPresetList(FLASH_SHAPE_KIND)

export function sanitizeFlashShapePreferences(value: unknown): FlashShapePreferences {
  return sanitizePresetList(FLASH_SHAPE_KIND, value)
}
