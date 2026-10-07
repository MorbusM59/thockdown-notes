/**
 * `value` limited to the range `min`..`max`.
 *
 * NaN passes through unchanged, which is deliberate: a NaN here means an
 * upstream computation went wrong, and quietly turning it into an edge of the
 * range would hide that. Callers that receive untrusted input and want a
 * fallback for it (the glaze and music-option sanitizers) guard for it
 * themselves, because the right fallback is theirs to choose.
 *
 * When the range is empty (`min > max`) the result is `min`; every caller
 * either guards against that case or cannot produce it.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
