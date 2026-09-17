// WHO MAY HOLD THE KEYBOARD.
//
// The app's standing rule is that the keyboard belongs to the ACTIVE SLOT's
// surface -- the editor, or the ring when a mode owns that slot (see
// escapeMenuContract.ts) -- and that a control the reader presses is not a
// place for it to go. A button being focusable is the browser's default, not
// a decision anybody here made: it comes with a tab order nobody designed,
// and it is why pressing a toolbar button used to take the keyboard away
// from the text being written.
//
// So the press is stopped from moving focus at all, at ONE window-level
// listener, and this module is the only thing that decides where the
// exception is. It asks WHAT KIND of element was pressed rather than
// consulting a list of elements allowed to hold focus: a list has to be
// joined by every new field somebody adds, and the one this replaces had
// seven named refs and five CSS selectors in it and had already fallen
// behind. A predicate about the element itself cannot go stale.
//
// Three kinds genuinely need the browser's own behaviour on a press:
//
//   TEXT ENTRY -- an input, a textarea, a select, or the editor itself.
//   Typing is the whole point; these are the only things the reader ever
//   deliberately hands the keyboard to.
//
//   TEXT THE READER MAY SELECT -- read-only editor text (a sealed note, a
//   snapshot preview). Suppressing the press default suppresses the native
//   selection drag with it, so a carve-out here is what keeps select-and-copy
//   working where there is nothing to type into.
//
//   A DRAG SOURCE -- `draggable="true"`. A native drag begins from the press
//   default; prevent it and the element simply cannot be dragged.
//
// Everything else -- every button, pill, gauge, tab and bar in the app --
// gets the press and not the keyboard.

/** Text-entry surfaces: the things a reader deliberately types into. */
const TEXT_ENTRY_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/** Read-only text (selectable) and drag sources: native press behaviour, no typing. */
const NATIVE_PRESS_SELECTOR = '[contenteditable="false"], [draggable="true"]'

/**
 * Is this element one the reader types into?
 *
 * Used both to let a press through and to recognise a legitimate holder of
 * the keyboard afterwards -- the same question, asked from two sides, which
 * is why it is one function.
 */
export function isTextEntryElement(element: Element | null | undefined): boolean {
  return Boolean(element?.closest(TEXT_ENTRY_SELECTOR))
}

/**
 * May a press on this element move focus to it?
 *
 * `closest` rather than a test on the element itself, because a press lands
 * on whatever is under the pointer -- the span inside a pill, the text node's
 * parent inside a contenteditable -- and the decision belongs to the nearest
 * ancestor that is one of the three kinds above.
 */
export function mayTakeFocusOnPress(target: Element | null | undefined): boolean {
  if (!target) return false
  return isTextEntryElement(target) || Boolean(target.closest(NATIVE_PRESS_SELECTOR))
}

/**
 * MAY THIS ELEMENT HOLD THE KEYBOARD?
 *
 * Two kinds, and the second is a DECLARATION the markup already makes:
 *
 *   A TEXT-ENTRY SURFACE, as above -- including the editor, which is a
 *   contenteditable.
 *
 *   ANYTHING CARRYING AN EXPLICIT `tabindex`. A control that is meant to be
 *   driven from the keyboard says so by carrying one: the ring's cells, the
 *   snapshot timeline, the compact scrollbar, the render pane. Native
 *   focusability is NOT that declaration -- a `<button>` is focusable because
 *   the browser makes every button focusable, which is a fact about HTML and
 *   not a decision anybody here took. That is the whole distinction: the
 *   things that should hold the keyboard already say so, in the one place
 *   that cannot be forgotten, because without the attribute they would not be
 *   reachable from the keyboard at all.
 *
 * ONE PREDICATE, TWO QUESTIONS. Who may hold the keyboard and who owns the
 * Tab key are the same set, deliberately: a surface holding the keyboard owns
 * the keys pressed into it, Tab included, and anything else is holding it by
 * accident -- which is the case the reconciler exists to end. Two predicates
 * would let a surface be in one answer and not the other, which is precisely
 * how Tab came to walk a tour of the chrome in the first place.
 */
export function mayHoldKeyboard(holder: Element | null | undefined): boolean {
  if (!holder) return false
  return isTextEntryElement(holder) || Boolean(holder.closest('[tabindex]'))
}
