// Select-all in the render view, which mounts only a window of the note's
// blocks (usePreviewWindow.tsx), so no DOM selection can hold the whole note.
//
// Select-all is therefore a RANGE OF A KNOWN SHAPE -- the pane's contents,
// bounded by the pane element itself -- and the copy handler asks for that
// shape and writes the note's full text in place of the mounted window's.
// A selection the reader drags ends inside the text, never at the pane, so
// the two cannot be confused and no flag has to be kept or cleared: a
// select-all the reader has since replaced simply no longer has the shape.

export function selectWholePane(pane: HTMLElement): void {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(pane)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function isWholePaneSelection(pane: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount !== 1) return false
  const range = selection.getRangeAt(0)
  return range.startContainer === pane && range.startOffset === 0
    && range.endContainer === pane && range.endOffset === pane.childNodes.length
}
