/** Geometric interpolation: equal steps of `t` are equal ratios. */
export function logLerp(from: number, to: number, t: number): number {
  return from * ((to / from) ** t);
}
