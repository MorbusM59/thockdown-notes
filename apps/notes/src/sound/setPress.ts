import { armHold, hasLeftHoldGrace, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'

/**
 * How a press on a music set's button changes what plays, wherever the set
 * buttons are (the music player, the Music Library's selector, the
 * visualizer's bucket list): a CLICK toggles that one set in or out of the
 * pool and leaves the others alone; a HOLD plays from that set alone. A press
 * that travels past the hold grace (a drag) does neither.
 *
 * Armed from the button's left `pointerdown`; decides on the release, which
 * it watches on the window so a release off the button is still seen.
 */
export function pressMusicSet(event: PointerEvent, actions: { toggle: () => void; solo: () => void }): void {
  if (event.button !== 0) return
  const origin = { pointerType: event.pointerType, screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY }
  const pointerId = event.pointerId
  let held = false
  const cancelHold = armHold(() => { held = true; actions.solo() }, HOLD_CONFIRM_MS)
  const end = (release: PointerEvent) => {
    if (release.pointerId !== pointerId) return
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('pointercancel', end, true)
    cancelHold()
    if (!held && release.type === 'pointerup' && !hasLeftHoldGrace(origin, release)) actions.toggle()
  }
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
}
