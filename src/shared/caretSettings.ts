// Bounds/defaults for the editor's block caret (see components/CM6Editor.tsx,
// `.thockdown-block-caret` in index.css, and the "Caret" section of
// SidebarOptionsPanel.tsx). Kept separate from appState.ts so the editor, the
// keyframe builder and the options UI can all import bounds without pulling in
// the persistence types -- same split as cursorSettings.ts, which this file
// deliberately mirrors.
//
// These are LAYOUT-scoped settings (they live in UiLayoutLoadout, next to
// highlightColors.caret which supplies the caret's fill colour), not
// PersistedMenuState -- switching layouts switches the caret's whole look with
// everything else it belongs to.

import { clampAlphaChannel, clampColorChannel, parseCssColorToRgba, type RgbaColor } from './colorMath'

export type CaretAnimationPresetKey =
  | 'heartbeat'
  | 'bigBeat'
  | 'fadeMid'
  | 'fadeEarly'
  | 'fadeLate'
  | 'bounce'

export interface CaretSettings {
  /**
   * Deviation in px from the caret's default box on EVERY side -- 0 is the
   * historical geometry (covering a grid cell's content but not the grid line
   * around it), -1 leaves a 1px gap to the surrounding primary grid lines, +1
   * spills 1px past them. See CM6Editor.tsx's updateCaret for the arithmetic.
   */
  sizeDeviationPx: number
  /** Outline drawn around the caret rectangle. 0 = no outline. */
  outlineWidthPx: number
  /** Halo: a box-shadow with no x/y offset and no blur -- pure spread. 0 = no halo. */
  haloSpreadPx: number
  outlineColor: string
  haloColor: string
  animationPreset: CaretAnimationPresetKey
  /** Length of one full blink cycle. */
  animationDurationMs: number
  /**
   * Quantization: how long the caret holds each animation frame. At the
   * minimum the animation is left continuous (a step finer than one display
   * frame is not a step anyone can see) -- see buildCaretBlinkKeyframesCss.
   */
  frameDurationMs: number
}

// Deliberately symmetric around 0 so the slider's centre detent is the
// historical look; see CaretSettings.sizeDeviationPx.
export const CARET_SIZE_DEVIATION_MIN_PX = -5
export const CARET_SIZE_DEVIATION_MAX_PX = 5
export const CARET_SIZE_DEVIATION_STEP_PX = 1
export const CARET_SIZE_DEVIATION_DEFAULT_PX = 0

export const CARET_OUTLINE_WIDTH_MIN_PX = 0
export const CARET_OUTLINE_WIDTH_MAX_PX = 5
export const CARET_OUTLINE_WIDTH_STEP_PX = 1
export const CARET_OUTLINE_WIDTH_DEFAULT_PX = 0

export const CARET_HALO_SPREAD_MIN_PX = 0
export const CARET_HALO_SPREAD_MAX_PX = 20
export const CARET_HALO_SPREAD_STEP_PX = 1
export const CARET_HALO_SPREAD_DEFAULT_PX = 0

export const CARET_ANIMATION_DURATION_MIN_MS = 100
export const CARET_ANIMATION_DURATION_MAX_MS = 5000
export const CARET_ANIMATION_DURATION_STEP_MS = 100
// 1200ms is the rhythm the caret has always blinked at.
export const CARET_ANIMATION_DURATION_DEFAULT_MS = 1200

export const CARET_FRAME_DURATION_MIN_MS = 5
export const CARET_FRAME_DURATION_MAX_MS = 500
export const CARET_FRAME_DURATION_STEP_MS = 5
// The minimum is the "don't quantize at all" setting -- see
// buildCaretBlinkKeyframesCss.
export const CARET_FRAME_DURATION_DEFAULT_MS = CARET_FRAME_DURATION_MIN_MS

/** Last-resort fill colour if `highlightColors.caret` cannot be parsed. */
export const DEFAULT_CARET_FILL_COLOR = 'rgba(0, 0, 0, 0.3)'
export const DEFAULT_CARET_OUTLINE_COLOR = 'rgba(0, 0, 0, 0.45)'
export const DEFAULT_CARET_HALO_COLOR = 'rgba(0, 0, 0, 0.18)'

export const DEFAULT_CARET_SETTINGS: CaretSettings = {
  sizeDeviationPx: CARET_SIZE_DEVIATION_DEFAULT_PX,
  outlineWidthPx: CARET_OUTLINE_WIDTH_DEFAULT_PX,
  haloSpreadPx: CARET_HALO_SPREAD_DEFAULT_PX,
  outlineColor: DEFAULT_CARET_OUTLINE_COLOR,
  haloColor: DEFAULT_CARET_HALO_COLOR,
  animationPreset: 'heartbeat',
  animationDurationMs: CARET_ANIMATION_DURATION_DEFAULT_MS,
  frameDurationMs: CARET_FRAME_DURATION_DEFAULT_MS,
}

// ---------------------------------------------------------------------------
// Animation shapes
// ---------------------------------------------------------------------------

/** One stop on a blink curve: `alpha` scales the caret colours' own alpha. */
export interface CaretAnimationStop {
  atPercent: number
  alpha: number
}

export interface CaretAnimationPreset {
  /** Shown on the preset button's tooltip. */
  label: string
  /** Font Awesome glyph class for the preset button. */
  iconClass: string
  stops: readonly CaretAnimationStop[]
}

export const CARET_ANIMATION_PRESETS: Record<CaretAnimationPresetKey, CaretAnimationPreset> = {
  // The beloved ff-caret-heartbeat rhythm -- these are the exact numbers the
  // caret's opacity keyframes carried before any of this was configurable.
  heartbeat: {
    label: 'Heartbeat',
    iconClass: 'fa-heart-pulse',
    stops: [
      { atPercent: 0, alpha: 0.6 },
      { atPercent: 10, alpha: 0.1 },
      { atPercent: 65, alpha: 0.9 },
      { atPercent: 85, alpha: 0.3 },
      { atPercent: 100, alpha: 0.6 },
    ],
  },
  // The heartbeat with its trailing half-beat removed: one rise to the same
  // 65% apex, one fall, nothing else.
  bigBeat: {
    label: 'Big beat only',
    iconClass: 'fa-heart',
    stops: [
      { atPercent: 0, alpha: 0.1 },
      { atPercent: 65, alpha: 0.9 },
      { atPercent: 100, alpha: 0.1 },
    ],
  },
  fadeMid: {
    label: 'Fade in/out, peak at 50%',
    iconClass: 'fa-caret-up',
    stops: [
      { atPercent: 0, alpha: 0 },
      { atPercent: 50, alpha: 1 },
      { atPercent: 100, alpha: 0 },
    ],
  },
  fadeEarly: {
    label: 'Fade in/out, peak at 15%',
    iconClass: 'fa-caret-left',
    stops: [
      { atPercent: 0, alpha: 0 },
      { atPercent: 15, alpha: 1 },
      { atPercent: 100, alpha: 0 },
    ],
  },
  fadeLate: {
    label: 'Fade in/out, peak at 85%',
    iconClass: 'fa-caret-right',
    stops: [
      { atPercent: 0, alpha: 0 },
      { atPercent: 85, alpha: 1 },
      { atPercent: 100, alpha: 0 },
    ],
  },
  // The playful one: a dropped ball. Each bounce comes back lower (1 -> 0.92
  // -> 0.78 -> 0.6 -> 0.4) while the gaps between them stretch (6 -> 7 -> 8 ->
  // 9 -> 11 -> 13 percent), then it snaps back to full to be dropped again.
  bounce: {
    label: 'Bounce',
    iconClass: 'fa-basketball',
    stops: [
      { atPercent: 0, alpha: 1 },
      { atPercent: 6, alpha: 0.12 },
      { atPercent: 13, alpha: 0.92 },
      { atPercent: 20, alpha: 0.1 },
      { atPercent: 28, alpha: 0.78 },
      { atPercent: 37, alpha: 0.08 },
      { atPercent: 48, alpha: 0.6 },
      { atPercent: 60, alpha: 0.06 },
      { atPercent: 73, alpha: 0.4 },
      { atPercent: 86, alpha: 0.05 },
      { atPercent: 100, alpha: 1 },
    ],
  },
}

export const CARET_ANIMATION_PRESET_KEYS: readonly CaretAnimationPresetKey[] = [
  'heartbeat', 'bigBeat', 'fadeMid', 'fadeEarly', 'fadeLate', 'bounce',
]

export function isCaretAnimationPresetKey(value: unknown): value is CaretAnimationPresetKey {
  return typeof value === 'string'
    && (CARET_ANIMATION_PRESET_KEYS as readonly string[]).includes(value)
}

/**
 * How many equal sub-steps one keyframe segment is split into for a given
 * frame duration.
 *
 * The user-facing rule, verbatim: a frame duration longer than the segment
 * honours the segment (one step, the caret simply holds that keyframe's
 * value); a frame duration that would split the segment unevenly is spread
 * evenly across however many sections it would have produced. A 150ms segment
 * at 100ms per frame "would create two sections of 100ms and 50ms", so it
 * becomes two of 75ms -- i.e. ceil(segment / frame) equal steps.
 */
export function resolveCaretSegmentStepCount(segmentMs: number, frameDurationMs: number): number {
  if (!Number.isFinite(segmentMs) || segmentMs <= 0) return 1
  if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) return 1
  if (frameDurationMs >= segmentMs) return 1
  return Math.max(1, Math.ceil(segmentMs / frameDurationMs))
}


// ---------------------------------------------------------------------------
// Keyframe generation
// ---------------------------------------------------------------------------

/**
 * A frame duration at or below this is treated as "don't quantize at all": a
 * step shorter than one display frame is not a step anyone can see, so the
 * blink is left continuous and the animation-level easing does the work. It
 * also bounds how many keyframe stops the baked path below can emit.
 */
export const CARET_FRAME_DURATION_SMOOTH_MAX_MS = 15

/**
 * Ceiling on baked steps per cycle. Only bites where each step would already
 * be shorter than a display frame (240 steps across the longest 5000ms cycle
 * is ~21ms each), so it costs nothing visible and keeps the generated rule
 * from growing without bound.
 */
export const CARET_MAX_BAKED_STEPS = 240

/**
 * The easing the caret's `animation` shorthand carries in index.css. Mirrored
 * here because the baked path samples this curve itself rather than leaving it
 * to the browser -- caretSettings.test.ts asserts the two never drift apart.
 */
export const CARET_BLINK_EASING_CONTROL_POINTS = [0.4, 0, 0.2, 1] as const

/** Solves a CSS cubic-bezier timing function for its output at progress `x`. */
function evaluateCubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1

  const axis = (t: number, a: number, b: number): number => {
    const inverse = 1 - t
    return (3 * inverse * inverse * t * a) + (3 * inverse * t * t * b) + (t * t * t)
  }

  // Bisection rather than Newton-Raphson: this runs a few hundred times per
  // rebuild at most, and bisection cannot diverge on the flat-derivative
  // stretches these curves have at their ends.
  let low = 0
  let high = 1
  let mid = x
  for (let iteration = 0; iteration < 32; iteration += 1) {
    mid = (low + high) / 2
    if (axis(mid, x1, x2) < x) low = mid
    else high = mid
  }

  return axis(mid, y1, y2)
}

export interface CaretBlinkKeyframeOptions {
  presetKey: CaretAnimationPresetKey
  animationDurationMs: number
  frameDurationMs: number
  /** The caret's fill colour -- `highlightColors.caret`, not a caret setting. */
  caretColor: string
  outlineColor: string
  haloColor: string
  haloSpreadPx: number
}

/** Trims trailing zeroes so the generated CSS stays readable when inspected. */
function formatNumber(value: number, decimals = 3): string {
  const factor = 10 ** decimals
  return String(Math.round(value * factor) / factor)
}

/**
 * Emits a concrete `rgba()` with the colour's own alpha scaled by `alphaScale`.
 *
 * Concrete, and resolved here rather than left to the stylesheet, because
 * `color-mix()` and `var()` inside an animated property are NOT interpolable
 * in every engine that runs this app: Chromium 124 (Electron 30) animates such
 * keyframes DISCRETELY, flipping between stop values instead of ramping
 * between them, which silently reduced the whole blink to four hard steps and
 * made the frame setting invisible. Newer Chromium interpolates them fine,
 * which is exactly why it survived review. Plain rgba() interpolates
 * everywhere -- do not reintroduce color-mix() or var() into these stops.
 */
function scaledRgba(color: RgbaColor, alphaScale: number): string {
  const alpha = clampAlphaChannel(color.a * Math.max(0, Math.min(1, alphaScale)))
  return `rgba(${clampColorChannel(color.r)}, ${clampColorChannel(color.g)}, ${clampColorChannel(color.b)}, ${formatNumber(alpha, 4)})`
}

function parseColorOrFallback(color: string, fallback: string): RgbaColor {
  return parseCssColorToRgba(color)
    ?? parseCssColorToRgba(fallback)
    ?? { r: 0, g: 0, b: 0, a: 1 }
}

/**
 * Expands a preset's stops into the stops actually emitted, quantizing each
 * segment into equal steps when the frame duration calls for it.
 *
 * Stepping is baked into explicit stops -- a stop at the step's start and
 * another a hair before the next one, both carrying the step's value -- rather
 * than expressed as a per-keyframe `steps()` timing function. Two reasons, one
 * defensive and one substantive: it removes the last piece of exotic CSS from
 * a path that already broke once on an older engine, and it lets each step
 * sample the REAL eased curve. A `steps()` timing function replaces the
 * animation-level easing for its segment, so the browser-side version could
 * only ever quantize a linear ramp; this quantizes the actual heartbeat.
 */
function resolveEmittedStops(
  preset: CaretAnimationPreset,
  animationDurationMs: number,
  frameDurationMs: number,
): CaretAnimationStop[] {
  const stops = preset.stops
  if (frameDurationMs <= CARET_FRAME_DURATION_SMOOTH_MAX_MS) return [...stops]

  const [x1, y1, x2, y2] = CARET_BLINK_EASING_CONTROL_POINTS
  const segmentMsAt = (index: number) =>
    ((stops[index + 1].atPercent - stops[index].atPercent) / 100) * animationDurationMs

  const countStepsAt = (frameMs: number) => {
    let total = 0
    for (let index = 0; index < stops.length - 1; index += 1) {
      total += resolveCaretSegmentStepCount(segmentMsAt(index), frameMs)
    }
    return total
  }

  // Size the whole cycle first, so the cap scales every segment together
  // instead of truncating whichever ones happen to come last. Each segment
  // rounds its own step count up, so one division can still land over the cap;
  // stretch and re-measure until it genuinely fits (converges in a pass or
  // two -- the loop bound is only there so this can never spin).
  let effectiveFrameMs = frameDurationMs
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const totalSteps = countStepsAt(effectiveFrameMs)
    if (totalSteps <= CARET_MAX_BAKED_STEPS) break
    effectiveFrameMs *= totalSteps / CARET_MAX_BAKED_STEPS
  }

  const emitted: CaretAnimationStop[] = []
  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index]
    const to = stops[index + 1]
    const stepCount = resolveCaretSegmentStepCount(segmentMsAt(index), effectiveFrameMs)
    const stepPercent = (to.atPercent - from.atPercent) / stepCount
    // Small enough to read as an instant jump at any cycle length, and always
    // a small fraction of the step it closes.
    const holdEpsilon = Math.min(0.01, stepPercent / 8)

    for (let step = 0; step < stepCount; step += 1) {
      const eased = evaluateCubicBezier(x1, y1, x2, y2, step / stepCount)
      const alpha = from.alpha + ((to.alpha - from.alpha) * eased)
      const startPercent = from.atPercent + (step * stepPercent)
      emitted.push({ atPercent: startPercent, alpha })
      emitted.push({ atPercent: startPercent + stepPercent - holdEpsilon, alpha })
    }
  }

  emitted.push({ ...stops[stops.length - 1] })
  return emitted
}

/**
 * Builds the `@keyframes thockdown-blink` rule for the current caret settings.
 * Generated at runtime rather than shipped statically because every part of it
 * -- the stop positions, the step counts, the resolved colours -- depends on
 * user settings.
 *
 * All three animatable caret surfaces (fill, outline, halo) are faded together
 * from the same alpha so the caret reads as one object rather than a solid
 * ring around a blinking centre. None of them animates `opacity`, which would
 * put the caret on the compositor -- see `.thockdown-block-caret` in index.css
 * for the black edit pane that causes.
 */
export function buildCaretBlinkKeyframesCss(options: CaretBlinkKeyframeOptions): string {
  const {
    presetKey,
    animationDurationMs,
    frameDurationMs,
    caretColor,
    outlineColor,
    haloColor,
    haloSpreadPx,
  } = options

  const preset = CARET_ANIMATION_PRESETS[presetKey] ?? CARET_ANIMATION_PRESETS.heartbeat
  const fill = parseColorOrFallback(caretColor, DEFAULT_CARET_FILL_COLOR)
  const outline = parseColorOrFallback(outlineColor, DEFAULT_CARET_OUTLINE_COLOR)
  const halo = parseColorOrFallback(haloColor, DEFAULT_CARET_HALO_COLOR)
  const spread = formatNumber(Math.max(0, haloSpreadPx))

  const blocks = resolveEmittedStops(preset, animationDurationMs, frameDurationMs).map((stop) => {
    const declarations = [
      `background-color: ${scaledRgba(fill, stop.alpha)};`,
      `outline-color: ${scaledRgba(outline, stop.alpha)};`,
      `box-shadow: 0 0 0 ${spread}px ${scaledRgba(halo, stop.alpha)};`,
    ]
    return `  ${formatNumber(stop.atPercent, 4)}% { ${declarations.join(' ')} }`
  })

  return `@keyframes thockdown-blink {\n${blocks.join('\n')}\n}\n`
}
