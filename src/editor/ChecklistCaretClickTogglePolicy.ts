import type { EditorSelectionState } from './EditorContract'

export interface ChecklistCaretClickToggleEvent {
  text: string
  selection: EditorSelectionState
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Toggles a markdown checkbox (`- [ ]` / `- [x]`) when the caret is already
 * sitting exactly between the '[' and ']' and the user clicks on it (rather
 * than typing over it -- see ChecklistTypingTransformPolicy.ts's
 * resolveMarkdownChecklistTypeoverTransform for the typing counterpart).
 * Deliberately as narrow as the typeover transform: only a single char
 * between the brackets, only after an unordered-list/blockquote-prefixed
 * bullet marker.
 */
export function resolveMarkdownChecklistCaretClickToggleTransform(
  event: ChecklistCaretClickToggleEvent,
): { text: string; selection: EditorSelectionState } | null {
  if (!event.selection.isCollapsed) {
    return null
  }

  const sourceText = event.text ?? ''
  const caretOffset = clamp(event.selection.focus, 0, sourceText.length)
  if (caretOffset <= 0 || caretOffset + 1 >= sourceText.length) {
    return null
  }

  // Caret must sit exactly between '[' and the single checkbox-state
  // character, with ']' immediately after it.
  if (
    sourceText.charCodeAt(caretOffset - 1) !== 91 ||
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

  const stateChar = sourceText[caretOffset]
  const nextChar = stateChar === ' ' ? 'X' : ' '

  const nextText = `${sourceText.slice(0, caretOffset)}${nextChar}${sourceText.slice(caretOffset + 1)}`

  return {
    text: nextText,
    selection: {
      anchor: caretOffset,
      focus: caretOffset,
      start: caretOffset,
      end: caretOffset,
      isCollapsed: true,
    },
  }
}
