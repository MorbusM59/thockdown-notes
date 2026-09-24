import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Attaches `handler` as a real native, non-passive `wheel` listener directly
 * on the DOM node -- not React's synthetic `onWheel` prop. React dispatches
 * its synthetic wheel event from a listener delegated at the root, which
 * runs late enough that by the time a synthetic handler's
 * event.preventDefault() fires, the browser can already be partway into
 * scrolling the nearest real scrollable ancestor on the very first wheel
 * tick of a gesture -- an ancestor nudge a value slider must never produce.
 * A listener attached directly to the element itself, before the event ever
 * reaches that ancestor, closes that gap (same mechanism App.tsx's
 * options-panel HSVA/texture-control guard already relies on, just owned by
 * the control itself instead of a distant ancestor keeping a selector list).
 *
 * The listener is bound when the effect runs, which is on mount and when
 * `handler` changes -- not when the element behind `ref` is replaced. So the
 * element must live exactly as long as the component calling this: an
 * element rendered conditionally inside a longer-lived parent should be its
 * own component owning its own ref (see AudioControls.tsx's SoundLevelButton
 * and AmbientNoiseButton).
 */
export function useNonPassiveWheel<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: (event: WheelEvent) => void,
) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('wheel', handler, { passive: false })
    return () => {
      el.removeEventListener('wheel', handler)
    }
  }, [ref, handler])
}
