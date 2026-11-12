/**
 * A right press held on a scrollbar track pages towards the press for as long
 * as the button is held, exactly like holding PageUp/PageDown, and lets go by
 * itself once the thumb has reached the pointer. The same for every scrollbar
 * that has page keys (scroll/pageKeys.ts): it presses and releases them
 * directly, never through a synthesized key event, which would reach every
 * other scroller listening on the window.
 *
 * What differs per surface is where its thumb is NOW (`liveThumb`), computed
 * from the scroll position rather than read from the painted thumb, which may
 * be held by a drag or a rubber band.
 */

import type { PageKey, PageKeys } from './pageKeys'

export interface TrackRightHold {
  /** A right press at `clientY` on the track; ignored when it lands on the thumb. */
  begin: (clientY: number) => void
  /** End the hold now (the button's release, a cancel, an unmount). */
  stop: () => void
}

export function createTrackRightHold({
  track,
  pageKeys,
  liveThumb,
}: {
  track: () => HTMLElement | null
  pageKeys: () => PageKeys | null
  /** The thumb's top and height in track pixels, at the current scroll position. */
  liveThumb: () => { topPx: number; heightPx: number } | null
}): TrackRightHold {
  let hold: { key: PageKey; direction: 1 | -1; cursorYPx: number; rafId: number | null } | null = null

  const onPointerUp = (event: PointerEvent) => {
    if (event.button === 2 || event.type === 'pointercancel') stop()
  }
  const onPointerMove = (event: PointerEvent) => {
    const el = track()
    if (hold && el) hold.cursorYPx = event.clientY - el.getBoundingClientRect().top
  }

  function stop() {
    if (!hold) return
    if (hold.rafId !== null) cancelAnimationFrame(hold.rafId)
    const { key } = hold
    hold = null
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('pointermove', onPointerMove)
    pageKeys()?.release(key)
  }

  const watch = () => {
    if (!hold) return
    const thumb = liveThumb()
    if (thumb) {
      const reached = hold.direction === 1
        ? thumb.topPx + thumb.heightPx >= hold.cursorYPx
        : thumb.topPx <= hold.cursorYPx
      if (reached) {
        stop()
        return
      }
    }
    hold.rafId = requestAnimationFrame(watch)
  }

  const begin = (clientY: number) => {
    stop()
    const el = track()
    const thumb = liveThumb()
    if (!el || !thumb) return
    const cursorYPx = clientY - el.getBoundingClientRect().top
    if (cursorYPx >= thumb.topPx && cursorYPx <= thumb.topPx + thumb.heightPx) return
    const direction: 1 | -1 = cursorYPx > thumb.topPx + thumb.heightPx ? 1 : -1
    const key: PageKey = direction === 1 ? 'PageDown' : 'PageUp'
    pageKeys()?.press(key, false)
    hold = { key, direction, cursorYPx, rafId: null }
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('pointermove', onPointerMove)
    hold.rafId = requestAnimationFrame(watch)
  }

  return { begin, stop }
}
