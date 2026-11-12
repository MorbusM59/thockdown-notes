/**
 * An ENTRY LIST's field (an `<input>` with `.options-curve-cell`: a curve
 * point's value, a dictionary's or a set's name being typed over, the set
 * list's filter) is left by a press anywhere outside it, as it is by Enter
 * and Escape.
 *
 * The browser would do that by itself, but a press in this app does not move
 * focus (`@thockdown/interaction/focusOwnership`: the window's mousedown
 * default is suppressed unless the press lands on text entry), so a click
 * elsewhere in the sidebar left the field holding the keyboard. Blurring it
 * runs the field's own `onBlur`, which is where each one commits.
 */
export function installEntryFieldOutsidePress(): void {
  window.addEventListener('pointerdown', (event) => {
    const field = document.activeElement
    if (!(field instanceof HTMLInputElement) || !field.classList.contains('options-curve-cell')) return
    if (event.target instanceof Node && field.contains(event.target)) return
    field.blur()
  }, { capture: true })
}
