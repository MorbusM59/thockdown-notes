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

/** Trims trailing zeroes so the generated CSS stays readable when inspected. */
function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/**
 * Scales a colour's own alpha by `alpha` without needing to know anything
 * about the colour. Mixing toward `transparent` in sRGB scales alpha only, so
 * for a flat-coloured box this is pixel-identical to `opacity: <alpha>` -- and
 * unlike opacity it does NOT put the caret on the compositor, which is the
 * whole point (see `.thockdown-block-caret` in index.css).
 */
function scaleAlpha(colorVar: string, alpha: number): string {
  const percent = Math.max(0, Math.min(1, alpha)) * 100
  return `color-mix(in srgb, var(${colorVar}) ${formatNumber(percent)}%, transparent)`
}

/**
 * Builds the `@keyframes thockdown-blink` rule for the current caret settings.
 * Generated at runtime rather than shipped statically because every part of it
 * -- the stop positions, the per-segment step counts, the number of stops --
 * depends on user settings.
 *
 * All three animatable caret surfaces (fill, outline, halo) are faded together
 * from the same alpha so the caret reads as one object rather than a solid
 * ring around a blinking centre.
 *
 * Stepping is expressed as a per-keyframe `animation-timing-function:
 * steps(n, jump-end)`, which also means a segment interpolates LINEARLY once
 * stepped (a keyframe's own timing function replaces the animation-level one).
 * At the minimum frame duration no timing function is emitted at all, so the
 * animation-level easing survives and the default blink is exactly what it has
 * always been -- a step shorter than one display frame is not a step anyone
 * could see, so there is nothing to gain by quantizing there.
 */
export function buildCaretBlinkKeyframesCss(
  presetKey: CaretAnimationPresetKey,
  animationDurationMs: number,
  frameDurationMs: number,
): string {
  const preset = CARET_ANIMATION_PRESETS[presetKey] ?? CARET_ANIMATION_PRESETS.heartbeat
  const stops = preset.stops
  const shouldQuantize = frameDurationMs > CARET_FRAME_DURATION_MIN_MS

  const blocks = stops.map((stop, index) => {
    const declarations = [
      `background-color: ${scaleAlpha('--color-caret', stop.alpha)};`,
      `outline-color: ${scaleAlpha('--caret-outline-color', stop.alpha)};`,
      `box-shadow: 0 0 0 var(--caret-halo-spread) ${scaleAlpha('--caret-halo-color', stop.alpha)};`,
    ]

    const nextStop = stops[index + 1]
    if (shouldQuantize && nextStop) {
      const segmentMs = ((nextStop.atPercent - stop.atPercent) / 100) * animationDurationMs
      const stepCount = resolveCaretSegmentStepCount(segmentMs, frameDurationMs)
      declarations.push(`animation-timing-function: steps(${stepCount}, jump-end);`)
    }

    return `  ${formatNumber(stop.atPercent)}% { ${declarations.join(' ')} }`
  })

  return `@keyframes thockdown-blink {\n${blocks.join('\n')}\n}\n`
}
