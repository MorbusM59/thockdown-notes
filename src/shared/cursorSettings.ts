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
   * spin) and right-click widens it (larger radius, slower spin). Every
   * press is handled identically (no tap/hold distinction -- a plain click
   * is too fast for that to be perceptible): it attacks toward
   * `clickMaxSpeed` along a bell curve, sustains there while held (for at
   * least `clickMinHoldMs`, even if the physical click was shorter), then
   * decays back to exactly 0 on release. See CursorClickCurve.ts /
   * ScrollCurvePlan.ts -- ramp/skew/duration play the same roles as the
   * scroll "ramp"/"shape"/"speed" sliders.
   */
  clickRamp: number
  clickSkew: number
  /** Raw "click speed" slider position in [0, 1] (0 = slowest, 1 = fastest) -- NOT seconds. See CursorClickCurve.ts's resolveCursorClickDurationSec for the x -> actual-duration mapping (a cubic falloff that gives finer resolution as duration approaches 0). */
  clickSpeedX: number
  clickMaxSpeed: number
  clickMinHoldMs: number
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
// returns to exactly 0 once a press's release decay finishes -- 0 =
// neutral, negative = tightening, positive = widening. ramp/skew/duration
// mirror the scroll bell curve's "ramp"/"shape"/"speed" sliders 1:1 (same
// formula, same ranges). clickMaxSpeed is the plateau every press attacks
// toward and sustains at while held, expressed directly in axis units where
// 1.0 is the point axisToMultiplier saturates at the full 200%/50% swing.
export const CURSOR_CLICK_RAMP_MIN = 0.1
export const CURSOR_CLICK_RAMP_MAX = 5
export const CURSOR_CLICK_RAMP_DEFAULT = 1.5

export const CURSOR_CLICK_SKEW_MIN = 0.1
export const CURSOR_CLICK_SKEW_MAX = 0.9
export const CURSOR_CLICK_SKEW_DEFAULT = 0.5

// "Click speed" is a plain x in [0, 1], not seconds -- see
// CursorClickCurve.ts's resolveCursorClickDurationSec for the cubic mapping
// to an actual animation duration (internal max-duration, not user-facing).
export const CURSOR_CLICK_SPEED_X_MIN = 0
export const CURSOR_CLICK_SPEED_X_MAX = 1
export const CURSOR_CLICK_SPEED_X_STEP = 0.01
export const CURSOR_CLICK_SPEED_X_DEFAULT = 0.5

export const CURSOR_CLICK_MAX_SPEED_MIN = 0.05
export const CURSOR_CLICK_MAX_SPEED_MAX = 1
export const CURSOR_CLICK_MAX_SPEED_STEP = 0.05
// Holding long enough reaches the full 200%/50% swing.
export const CURSOR_CLICK_MAX_SPEED_DEFAULT = 1

// Floor on how long a press is treated as "held" internally, regardless of
// how quickly the physical mouse button actually came back up -- a plain
// click is usually too fast for the attack/sustain/release shape to read as
// anything but a flicker without this.
export const CURSOR_CLICK_MIN_HOLD_MIN_MS = 0
export const CURSOR_CLICK_MIN_HOLD_MAX_MS = 200
export const CURSOR_CLICK_MIN_HOLD_STEP_MS = 10
export const CURSOR_CLICK_MIN_HOLD_DEFAULT_MS = 80

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
  clickSpeedX: CURSOR_CLICK_SPEED_X_DEFAULT,
  clickMaxSpeed: CURSOR_CLICK_MAX_SPEED_DEFAULT,
  clickMinHoldMs: CURSOR_CLICK_MIN_HOLD_DEFAULT_MS,
  clickBalance: CURSOR_CLICK_BALANCE_DEFAULT,
}
