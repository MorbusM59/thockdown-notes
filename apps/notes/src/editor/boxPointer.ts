import { EditorSelection, findClusterBreak } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * Pointer -> document position for an editor that draws its text as BOXES.
 *
 * The edit view shows a block caret: a box over the character the caret sits
 * before. CodeMirror's own mouse handling maps a click to the nearest
 * character BOUNDARY, so clicking the right half of a box put the caret after
 * that character -- on the next box. That used to be papered over by drawing
 * the custom mouse cursor 5px right of the true pointer (MouseCursorOverlay's
 * old "+5"): editor clicks landed, every other click in the app missed by
 * those 5px, and the fix only ever held at one font size.
 *
 * The rule here instead, in one place for every editor click: a click selects
 * the box UNDER the pointer, and a drag selects every box it covers, the box
 * under the pointer included.
 */

/**
 * The box under the pointer: the position before the character the pointer is
 * over, or the line's end when the pointer is past its last character. Null
 * when the coordinates are off the text altogether.
 */
export function resolveBoxAtCoords(view: EditorView, x: number, y: number): number | null {
  const hit = view.posAndSideAtCoords({ x, y })
  if (!hit) return null
  // Left half of the character after `pos`: that character's box starts at pos.
  if (hit.assoc === 1) return hit.pos

  const line = view.state.doc.lineAt(hit.pos)
  if (hit.pos === line.from) return hit.pos

  // Right half of the character before `pos` -- or past the end of the row
  // entirely, which posAndSideAtCoords reports the same way. The boundary's
  // own x tells them apart: over that character, the pointer is left of it.
  const boundary = view.coordsAtPos(hit.pos, -1)
  if (boundary && x >= boundary.left) return hit.pos
  return line.from + findClusterBreak(line.text, hit.pos - line.from, false)
}

/**
 * Where the box starting at `pos` ends: after its character -- or at `pos`
 * itself for the empty box past a line's last character, so a selection
 * reaching that box never runs on across the line break.
 */
export function boxEnd(view: EditorView, pos: number): number {
  const line = view.state.doc.lineAt(pos)
  if (pos >= line.to) return pos
  return line.from + findClusterBreak(line.text, pos - line.from, true)
}

/**
 * The selection a box gesture describes, as anchor/head. Pure, so the rule is
 * testable without a laid-out editor (boxPointer.test.ts).
 *
 * - A click (`current === pressed`) is a caret on that box.
 * - Dragging forward selects from the pressed box THROUGH the box under the
 *   pointer; dragging backward selects from the box under the pointer through
 *   the pressed box. Either way both end boxes are included -- the box the
 *   pointer is on is never left looking unselected.
 * - Extending (shift) keeps the existing anchor and reaches through the box
 *   clicked, by the same rule.
 */
export function resolveBoxDragSelection(
  pressed: number,
  current: number,
  boxEndOf: (pos: number) => number,
  extendAnchor: number | null,
): { anchor: number; head: number } {
  if (extendAnchor !== null) {
    return current >= extendAnchor
      ? { anchor: extendAnchor, head: boxEndOf(current) }
      : { anchor: extendAnchor, head: current }
  }
  if (current === pressed) return { anchor: pressed, head: pressed }
  return current > pressed
    ? { anchor: pressed, head: boxEndOf(current) }
    : { anchor: boxEndOf(pressed), head: current }
}

/**
 * CodeMirror's mouse selection, taken over for single presses and the drags
 * that follow them. Double and triple clicks fall through to CodeMirror's own
 * word and line selection, which are about words and lines, not boxes.
 */
export const boxMouseSelection: Extension = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.button !== 0 || event.detail > 1) return null
  const pressedAt = resolveBoxAtCoords(view, event.clientX, event.clientY)
  if (pressedAt === null) return null

  let pressed = pressedAt
  let startSelection = view.state.selection
  return {
    get(current, extend, multiple) {
      const at = resolveBoxAtCoords(view, current.clientX, current.clientY) ?? pressed
      const { anchor, head } = resolveBoxDragSelection(
        pressed,
        at,
        (pos) => boxEnd(view, pos),
        extend ? startSelection.main.anchor : null,
      )
      const range = EditorSelection.range(anchor, head)
      return multiple ? startSelection.addRange(range) : EditorSelection.create([range])
    },
    update(update) {
      if (!update.docChanged) return
      pressed = update.changes.mapPos(pressed)
      startSelection = startSelection.map(update.changes)
    },
  }
})
