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
}
