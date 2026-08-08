// Bounds/defaults for the custom mouse cursor overlay (see
// components/MouseCursorOverlay.tsx and the "Mouse options" section of
// SidebarOptionsPanel.tsx). Kept separate from appState.ts so both the
// overlay and the options UI can import bounds without pulling in the
// persistence types.

export interface CustomCursorSettings {
  enabled: boolean
  dotColor: string
  centerColor: string
  trailColor: string
  dotCount: number
  radiusPx: number
  spinHz: number
  trailThicknessPx: number
  /** How long (ms) it takes a trail particle to fully decay after the head passes it. The trail's angular length is derived from this and spinHz at draw time (durationSec * spinHz * 360deg), not stored as degrees. */
  trailFadeMs: number
  dotSizePx: number
  centerSizePx: number
  pulseMagnitude: number
  pulseHz: number
  /**
   * Click response: left-click tightens the orbit (smaller radius, faster
   * spin) and right-click widens it (larger radius, slower spin). Tap/hold/
   * release feel is governed by the same bell-curve model as smooth
   * scrolling (see CursorClickCurve.ts / ScrollCurvePlan.ts) -- ramp/skew/
   * duration/maxSpeed play the same roles as the scroll "ramp", "shape",
   * "speed", and "max speed" sliders.
   */
  clickRamp: number
  clickSkew: number
  clickDurationSec: number
  clickMaxSpeed: number
  clickStep: number
  clickBalance: number
}

export const CURSOR_DOT_COUNT_MIN = 1
export const CURSOR_DOT_COUNT_MAX = 8
export const CURSOR_DOT_COUNT_DEFAULT = 3

export const CURSOR_RADIUS_MIN_PX = 4
export const CURSOR_RADIUS_MAX_PX = 30
export const CURSOR_RADIUS_DEFAULT_PX = 10

export const CURSOR_SPIN_HZ_MIN = 0.1
export const CURSOR_SPIN_HZ_MAX = 2
export const CURSOR_SPIN_HZ_STEP = 0.1
export const CURSOR_SPIN_HZ_DEFAULT = 0.8

export const CURSOR_TRAIL_THICKNESS_MIN_PX = 1
export const CURSOR_TRAIL_THICKNESS_MAX_PX = 6
export const CURSOR_TRAIL_THICKNESS_DEFAULT_PX = 3

export const CURSOR_TRAIL_FADE_MIN_MS = 50
export const CURSOR_TRAIL_FADE_MAX_MS = 3000
export const CURSOR_TRAIL_FADE_STEP_MS = 50
export const CURSOR_TRAIL_FADE_DEFAULT_MS = 500

export const CURSOR_DOT_SIZE_MIN_PX = 1
export const CURSOR_DOT_SIZE_MAX_PX = 6
export const CURSOR_DOT_SIZE_DEFAULT_PX = 2

export const CURSOR_CENTER_SIZE_MIN_PX = 0
export const CURSOR_CENTER_SIZE_MAX_PX = 6
export const CURSOR_CENTER_SIZE_DEFAULT_PX = 3

export const CURSOR_PULSE_MAGNITUDE_MIN = 0.5
export const CURSOR_PULSE_MAGNITUDE_MAX = 2
export const CURSOR_PULSE_MAGNITUDE_STEP = 0.05
export const CURSOR_PULSE_MAGNITUDE_DEFAULT = 1

export const CURSOR_PULSE_HZ_MIN = 0.1
export const CURSOR_PULSE_HZ_MAX = 2
export const CURSOR_PULSE_HZ_STEP = 0.1
export const CURSOR_PULSE_HZ_DEFAULT = 0.5

// Click response bounds/defaults. The axis is a *deviation* (like a scroll
// animation's current speed, not its resulting position) that always
// returns to exactly 0 once a tap or a release decay finishes -- 0 =
// neutral, negative = tightening, positive = widening. ramp/skew/duration
// mirror the scroll bell curve's "ramp"/"shape"/"speed" sliders 1:1 (same
// formula, same ranges). clickStep is the peak deviation a single un-held
// tap naturally reaches (proportional to the same "distance" role
// pageStepPx plays for a single PageDown press); clickMaxSpeed is the
// (typically higher) plateau ceiling continuous holding pins the deviation
// at -- both are expressed directly in axis units, where 1.0 is the point
// axisToMultiplier saturates at the full 200%/50% swing.
export const CURSOR_CLICK_RAMP_MIN = 0.1
export const CURSOR_CLICK_RAMP_MAX = 5
export const CURSOR_CLICK_RAMP_DEFAULT = 1.5

export const CURSOR_CLICK_SKEW_MIN = 0.1
export const CURSOR_CLICK_SKEW_MAX = 0.9
export const CURSOR_CLICK_SKEW_DEFAULT = 0.5

export const CURSOR_CLICK_DURATION_MIN_SEC = 0
export const CURSOR_CLICK_DURATION_MAX_SEC = 2
export const CURSOR_CLICK_DURATION_STEP_SEC = 0.05
export const CURSOR_CLICK_DURATION_DEFAULT_SEC = 0.3

export const CURSOR_CLICK_MAX_SPEED_MIN = 0.05
export const CURSOR_CLICK_MAX_SPEED_MAX = 1
export const CURSOR_CLICK_MAX_SPEED_STEP = 0.05
// Holding long enough reaches the full 200%/50% swing.
export const CURSOR_CLICK_MAX_SPEED_DEFAULT = 1

export const CURSOR_CLICK_STEP_MIN = 0.05
export const CURSOR_CLICK_STEP_MAX = 1
export const CURSOR_CLICK_STEP_STEP = 0.05
// A quick, un-held tap gives a moderate nudge -- noticeably less than what
// holding through to clickMaxSpeed reaches.
export const CURSOR_CLICK_STEP_DEFAULT = 0.35

export const CURSOR_CLICK_BALANCE_MIN = -1
export const CURSOR_CLICK_BALANCE_MAX = 1
export const CURSOR_CLICK_BALANCE_STEP = 0.05
export const CURSOR_CLICK_BALANCE_DEFAULT = 0

// Fixed (not user-configurable) deviation bounds for the click-response
// multiplier: widening tops out at 200% of the base value, tightening
// bottoms out at 50%.
export const CURSOR_CLICK_WIDEN_MAX_MULTIPLIER = 2
export const CURSOR_CLICK_TIGHTEN_MIN_MULTIPLIER = 0.5

export const DEFAULT_CURSOR_DOT_COLOR = 'rgba(0, 0, 0, 0.6)'
export const DEFAULT_CURSOR_CENTER_COLOR = 'rgba(0, 0, 0, 0.85)'
export const DEFAULT_CURSOR_TRAIL_COLOR = 'rgba(0, 0, 0, 0.35)'

export const DEFAULT_CUSTOM_CURSOR_SETTINGS: CustomCursorSettings = {
  enabled: false,
  dotColor: DEFAULT_CURSOR_DOT_COLOR,
  centerColor: DEFAULT_CURSOR_CENTER_COLOR,
  trailColor: DEFAULT_CURSOR_TRAIL_COLOR,
  dotCount: CURSOR_DOT_COUNT_DEFAULT,
  radiusPx: CURSOR_RADIUS_DEFAULT_PX,
  spinHz: CURSOR_SPIN_HZ_DEFAULT,
  trailThicknessPx: CURSOR_TRAIL_THICKNESS_DEFAULT_PX,
  trailFadeMs: CURSOR_TRAIL_FADE_DEFAULT_MS,
  dotSizePx: CURSOR_DOT_SIZE_DEFAULT_PX,
  centerSizePx: CURSOR_CENTER_SIZE_DEFAULT_PX,
  pulseMagnitude: CURSOR_PULSE_MAGNITUDE_DEFAULT,
  pulseHz: CURSOR_PULSE_HZ_DEFAULT,
  clickRamp: CURSOR_CLICK_RAMP_DEFAULT,
  clickSkew: CURSOR_CLICK_SKEW_DEFAULT,
  clickDurationSec: CURSOR_CLICK_DURATION_DEFAULT_SEC,
  clickMaxSpeed: CURSOR_CLICK_MAX_SPEED_DEFAULT,
  clickStep: CURSOR_CLICK_STEP_DEFAULT,
  clickBalance: CURSOR_CLICK_BALANCE_DEFAULT,
}
