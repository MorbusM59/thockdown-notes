import { secondaryPressMeaning } from '@thockdown/interaction/pressTracking'
import { resolveScopeRange } from '../editor/ContractBridgeRangeUtils'

/**
 * Right-click selection in every plain text field (`<input>`, `<textarea>`):
 * the first right-click selects the word under the pointer, the next selects
 * the field's whole value -- the editor's right-click ladder (CM6Editor's
 * `contextmenu` handler), cut down to the two steps a field has room for. The
 * word is the editor's own (`resolveScopeRange('word', ...)`), so a word
 * means the same thing in a field as in a note.
 *
 * STATELESS: the next step is the first rung that strictly contains the
 * current selection, so there is no cycle record to go stale. The click's
 * position is the caret the browser placed on the right press (Chromium moves
 * the caret there unless the press lands inside the selection, which is
 * exactly the case where the selection is the thing to grow).
 *
 * A field, or an ancestor, that DECLARES a right press of its own
 * (`data-secondary-press="action"`, required beside every `onContextMenu` by
 * pressTracking's contract) keeps it: the declaration is the one statement
 * of "this gesture means something here", so it is read rather than a list
 * of exempt fields kept. The editor is a contenteditable, never an input, so
 * its own ladder is untouched.
 *
 * Bubble phase, so it runs after a field's own handler and only for
 * right-clicks nobody stopped. One listener; costs nothing until a
 * right-click.
 */
export function installFieldRightClickSelection(): void {
  window.addEventListener('contextmenu', (event) => {
    const field = event.target
    if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) return
    if (field.disabled || secondaryPressMeaning(field) === 'action') return
    const start = field.selectionStart
    const end = field.selectionEnd
    // Input types with no text selection (number, color, checkbox...)
    // report null here.
    if (start === null || end === null) return
    event.preventDefault()
    const next = nextFieldSelection(field.value, start, end)
    if (next) field.setSelectionRange(next.start, next.end)
  })
}

/** The next rung above the selection [start, end), or null at the top. */
export function nextFieldSelection(
  value: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const word = resolveScopeRange('word', value, start, null)
  const rungs = [word.range, { start: 0, end: value.length }]
  for (const rung of rungs) {
    const contains = rung.start <= start && rung.end >= end
    const grows = rung.end - rung.start > end - start
    if (contains && grows) return rung
  }
  return null
}
