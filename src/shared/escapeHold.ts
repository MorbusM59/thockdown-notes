export const ESCAPE_HOLD_MS = 250

export function didEscapeHoldTrigger(heldMs: number): boolean {
  return heldMs >= ESCAPE_HOLD_MS
}
