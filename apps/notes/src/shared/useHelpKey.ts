import { useEffect, useRef, useState } from 'react'
import { HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { matchShortcut } from './keyboardShortcuts'

/**
 * The help key (F1, declared as `userGuide` and `shortcutReference` in
 * shared/keyboardShortcuts.ts): a TAP toggles the User Guide, a HOLD shows
 * the keyboard shortcut reference for as long as it is held.
 *
 * The two are told apart by the release, so the tap acts on KEYUP: a guide
 * opened on keydown would already be on screen when the hold turned out to be
 * a hold. Past `HOLD_CONFIRM_MS` -- the app's "I meant this" threshold, the
 * same one that raises the Escape menu -- the press is a hold, the reference
 * goes up, and its release takes it down again and does nothing else, so the
 * reader is back exactly where they were.
 *
 * Window-level and capture phase, because F1 means this everywhere: in the
 * editor, in a field, over the ring. Its keydown is always cancelled, which is
 * what keeps Chromium's own F1 behaviour out of it, and while the reference
 * is up every other keydown is cancelled too: the app under it is out of
 * sight, so nothing typed may reach it.
 *
 * Losing the window ends the press: the release would never be seen, so the
 * pending hold is cancelled and a reference that is up comes down.
 */
export function useHelpKey(onTap: () => void): boolean {
  const [isReferenceOpen, setIsReferenceOpen] = useState(false)
  const onTapRef = useRef(onTap)
  onTapRef.current = onTap

  useEffect(() => {
    let timer: number | null = null
    // Whether a press is in progress, and whether it became a hold. Kept
    // here rather than read from state, so a release landing before React
    // has rendered the reference is still read as the end of a hold.
    let pressed = false
    let held = false

    const end = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      pressed = false
      held = false
      setIsReferenceOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // While the reference is up the app under it is out of sight, so no key
      // may act on it -- the same rule that has the overlay take the clicks.
      if (held) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      // A press in progress owns every F1 keydown, by key alone: a modifier
      // pressed mid-hold must not let its auto-repeats through to the app.
      if (pressed && event.key === 'F1') {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      // A press starts only on a real keydown. An auto-repeat that matches
      // after a modifier is let go belongs to a press that began as another
      // chord, and starting one there would read its release as a tap.
      if (event.repeat || !matchShortcut(event, 'userGuide')) return
      event.preventDefault()
      event.stopPropagation()
      pressed = true
      timer = window.setTimeout(() => {
        timer = null
        held = true
        setIsReferenceOpen(true)
      }, HOLD_CONFIRM_MS)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      // By key alone: modifiers pressed or released during the hold do not
      // make it a different key's release.
      if (event.key !== 'F1' || !pressed) {
        // Several of the app's keys act on RELEASE (Escape's view toggle), so
        // a release under the reference is swallowed like a press would be.
        if (held) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const wasHold = held
      end()
      if (!wasHold) onTapRef.current()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', end)
      end()
    }
  }, [])

  return isReferenceOpen
}
