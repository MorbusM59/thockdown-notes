import type { EditorSelectionState } from './EditorContract'

export interface ChecklistTypingTransformEvent {
  char: string
  text: string
  selection: EditorSelectionState
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function resolveMarkdownChecklistTypeoverTransform(
  event: ChecklistTypingTransformEvent,
): { text: string; selection: EditorSelectionState } | null {
  if (!event.selection.isCollapsed) {
    return null
  }

  if (event.char.length !== 1 || event.char === ' ') {
    return null
  }

  const sourceText = event.text ?? ''
  const caretOffset = clamp(event.selection.focus, 0, sourceText.length)
  if (caretOffset <= 0 || caretOffset + 1 >= sourceText.length) {
    return null
  }

  // Only type-over when caret is exactly between '[' and ' ]'.
  if (
    sourceText.charCodeAt(caretOffset - 1) !== 91 ||
    sourceText.charCodeAt(caretOffset) !== 32 ||
    sourceText.charCodeAt(caretOffset + 1) !== 93
  ) {
    return null
  }

  const lineStart = sourceText.lastIndexOf('\n', Math.max(0, caretOffset - 1)) + 1
  const linePrefixToCaret = sourceText.slice(lineStart, caretOffset)

  // Restrict to unordered markdown list task checkboxes only.
  const checklistPrefixMatch = linePrefixToCaret.match(/^\s*(?:> ?)*\s*[-*+]\s+\[$/)
  if (!checklistPrefixMatch) {
    return null
  }

  const nextText = `${sourceText.slice(0, caretOffset)}${event.char}${sourceText.slice(caretOffset + 1)}`
  const nextCaret = caretOffset + 1

  return {
    text: nextText,
    selection: {
      anchor: nextCaret,
      focus: nextCaret,
      start: nextCaret,
      end: nextCaret,
      isCollapsed: true,
    },
  }
}
