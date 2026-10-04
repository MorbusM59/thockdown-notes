import type { EditorSelectionState, EditorTextEdit, EditorTransformResult } from './EditorContract'

/**
 * Builds a transform result from the edit the transform actually made.
 *
 * The point of going through here rather than assembling the object by hand
 * is that `text` cannot drift from `edit`: it is derived, not asserted. A
 * transform that spliced its own `nextText` and then described the change
 * slightly differently would produce a document the editor and the app
 * disagree about -- and a wrong offset in this codebase does not look wrong,
 * it edits the wrong place.
 *
 * The concatenation is cheap by V8's representation (two sliced strings and
 * a cons string, O(1) pointers, no copy) -- see EditorTransformResult's doc
 * comment for why the whole-document string is still carried at all.
 */
export function buildTransformResult(
  previousText: string,
  edit: EditorTextEdit,
  selection: EditorSelectionState,
): EditorTransformResult {
  return {
    text: `${previousText.slice(0, edit.from)}${edit.insert}${previousText.slice(edit.to)}`,
    selection,
    edit,
  }
}

/** A collapsed selection at `offset`, the shape almost every transform ends with. */
export function collapsedSelectionAt(offset: number): EditorSelectionState {
  return {
    anchor: offset,
    focus: offset,
    start: offset,
    end: offset,
    isCollapsed: true,
  }
}
