import { HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'

// Raising the quick-actions ring is a deliberate press rather than a stray
// Escape -- the app's CONFIRM threshold (`shared/holdTiming.ts`), which it
// already happened to equal. No cursor twitch: this is a KEY hold, and the
// twitch is a reversal of what a mouse press is doing to the orbit, which
// here is nothing.
export const ESCAPE_HOLD_MS = HOLD_CONFIRM_MS

export function didEscapeHoldTrigger(heldMs: number): boolean {
  return heldMs >= ESCAPE_HOLD_MS
}
