/**
 * Keeps a full-screen surface (the visualizer page) at its size while the
 * on-screen keyboard is up, and lifts it so the focused field stays in view.
 *
 * Android's keyboard shrinks the WebView: Capacitor pads the window by the
 * keyboard's height (its SystemBars insets listener), whatever the activity's
 * soft input mode. A page that lays itself out from its own size then lays
 * itself out again for a screen a third shorter, and the visualizer's scene
 * has no room for its pool filter on that screen: the field the keyboard
 * opened for unmounted, which closed the keyboard, which gave the room back.
 * That is the keyboard flickering open and shut.
 *
 * So while a text field inside `element` holds focus, the surface keeps the
 * height it had when the field was focused (its width still follows the
 * window: a rotation is a new screen), and is moved up by as much as the
 * field's bottom edge would otherwise be under the keyboard, as Android's own
 * adjustPan does for a window. Written to the element's style directly: a
 * keyboard is not a reason to render anything.
 */
/** Clearance kept between the field's bottom edge and the keyboard. */
const FIELD_GAP_PX = 8

export function holdFrameWhileTyping(element: HTMLElement): () => void {
  let heldHeight: number | null = null
  let field: HTMLElement | null = null
  let lift = 0
  let width = window.innerWidth

  const place = () => {
    if (heldHeight === null || !field) {
      lift = 0
      element.style.removeProperty('height')
      element.style.removeProperty('bottom')
      element.style.removeProperty('transform')
      return
    }
    element.style.bottom = 'auto'
    element.style.height = `${heldHeight}px`
    // Where the field's bottom edge is on the held surface, unlifted.
    const fieldBottom = field.getBoundingClientRect().bottom + lift
    lift = Math.max(0, fieldBottom + FIELD_GAP_PX - window.innerHeight)
    element.style.transform = lift > 0 ? `translateY(${-lift}px)` : ''
  }

  const isTextField = (target: EventTarget | null): target is HTMLElement =>
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

  const onFocusIn = (event: FocusEvent) => {
    if (!isTextField(event.target)) return
    // Taken before the keyboard has shrunk the window: the focus comes first.
    heldHeight ??= element.getBoundingClientRect().height
    field = event.target
    place()
  }
  const onFocusOut = (event: FocusEvent) => {
    // Focus moving on to another field of the surface keeps the hold.
    if (isTextField(event.relatedTarget) && element.contains(event.relatedTarget)) return
    heldHeight = null
    field = null
    place()
  }
  const onResize = () => {
    // A new width is a new screen (a rotation), so the hold is let go: the
    // surface follows the window again until the next field takes focus.
    if (window.innerWidth !== width) {
      width = window.innerWidth
      heldHeight = null
      field = null
    }
    place()
  }

  element.addEventListener('focusin', onFocusIn)
  element.addEventListener('focusout', onFocusOut)
  window.addEventListener('resize', onResize)
  return () => {
    element.removeEventListener('focusin', onFocusIn)
    element.removeEventListener('focusout', onFocusOut)
    window.removeEventListener('resize', onResize)
    heldHeight = null
    field = null
    place()
  }
}
