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

/**
 * Same toggle, addressed by source line rather than an exact caret offset --
 * for callers (the render/preview pane's own checkbox click) that only know
 * which line was clicked, not a character offset. Finds that line's leading
 * checklist checkbox (same eligibility shape as the caret-click transform
 * above: an unordered/blockquote-prefixed bullet immediately followed by
 * `[ ]`/`[x]`/`[X]`) and delegates the actual flip to
 * resolveMarkdownChecklistCaretClickToggleTransform, so both entry points
 * share one single toggle implementation. Returns null when the line has no
 * such checkbox, or is out of range.
 */
export function resolveMarkdownChecklistLineToggleTransform(
  text: string,
  sourceLine: number,
): { text: string; selection: EditorSelectionState } | null {
  const sourceText = text ?? ''
  const lines = sourceText.split('\n')
  if (sourceLine < 0 || sourceLine >= lines.length) {
    return null
  }

  let lineStart = 0
  for (let index = 0; index < sourceLine; index += 1) {
    lineStart += lines[index].length + 1
  }

  const checkboxMatch = /^(\s*(?:> ?)*\s*[-*+]\s+\[)[ xX]\]/.exec(lines[sourceLine])
  if (!checkboxMatch) {
    return null
  }

  const caretOffset = lineStart + checkboxMatch[1].length

  return resolveMarkdownChecklistCaretClickToggleTransform({
    text: sourceText,
    selection: {
      anchor: caretOffset,
      focus: caretOffset,
      start: caretOffset,
      end: caretOffset,
      isCollapsed: true,
    },
  })
}
