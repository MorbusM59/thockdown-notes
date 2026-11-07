/**
 * Pure helpers for the music levels (volume, reverb, room) as the music bar's
 * headphones wheel, the visualizer's level bars and the hold gesture read
 * them.
 *
 * Everything here is a total function over plain values so what a wheel notch
 * is worth is testable without mounting the player or touching Web Audio.
 *
 * ## The two number spaces, and why they are separate
 * The audio graph (`MusicPlayerService`) has always taken 0-1 fractions, and
 * persisted state stores them that way. Levels are adjusted in 0-99 steps, the
 * two-digit readout that once fit a square button. `toDisplayLevel` /
 * `fromDisplayLevel` are the only place that conversion happens, and they are
 * exact inverses on the display side (`fromDisplayLevel(toDisplayLevel(d))`
 * round-trips every integer 0-99), so scrolling up and back down lands on the
 * value it started from rather than drifting.
 *
 * ## Mute and bypass are flags, not remembered values
 * The spec asks that toggling mute "remember the pre-toggled state to restore
 * that volume". Storing a separate remembered number would mean two sources of
 * truth for one setting and a sentinel for "not muted". Instead the level is
 * never destroyed: `musicVolume` keeps its value and a boolean says whether it
 * is currently audible. Restoring is then not an operation at all, and a level
 * adjusted while muted is already correct when sound comes back.
 */

/** Number of distinct display steps: levels read 0-99 inclusive. */
export const SOUND_LEVEL_MAX_DISPLAY = 99;

/** One wheel notch moves a level by this much; Shift multiplies it. */
export const SOUND_LEVEL_WHEEL_STEP = 1;
export const SOUND_LEVEL_WHEEL_STEP_COARSE = 10;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 0-1 audio fraction -> the 0-99 integer the button prints. */
export function toDisplayLevel(fraction: number): number {
  return Math.round(clamp01(fraction) * SOUND_LEVEL_MAX_DISPLAY);
}

/** 0-99 integer -> the 0-1 fraction the audio graph consumes. */
export function fromDisplayLevel(display: number): number {
  if (!Number.isFinite(display)) return 0;
  const clamped = Math.min(SOUND_LEVEL_MAX_DISPLAY, Math.max(0, Math.round(display)));
  return clamped / SOUND_LEVEL_MAX_DISPLAY;
}

/**
 * Apply a wheel gesture to a 0-1 level, in display steps so the printed number
 * always moves by exactly the step (a fractional nudge that rounds back to the
 * same digit would read as a dead control).
 */
export function nudgeLevel(fraction: number, deltaY: number, coarse: boolean): number {
  if (deltaY === 0) return clamp01(fraction);
  const step = coarse ? SOUND_LEVEL_WHEEL_STEP_COARSE : SOUND_LEVEL_WHEEL_STEP;
  // Wheel up (negative deltaY) increases, matching every other value control.
  const direction = deltaY < 0 ? 1 : -1;
  return fromDisplayLevel(toDisplayLevel(fraction) + direction * step);
}
