import type { EditorSelectionState, EditorTransformResult } from './EditorContract'
import { buildTransformResult, collapsedSelectionAt } from './TransformResult'

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
): EditorTransformResult | null {
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

  return buildTransformResult(
    sourceText,
    { from: caretOffset, to: caretOffset + 1, insert: event.char },
    collapsedSelectionAt(caretOffset + 1),
  )
}
