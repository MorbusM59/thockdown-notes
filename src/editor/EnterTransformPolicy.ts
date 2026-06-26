import type { EditorSelectionState } from './EditorContract'
import { applyMarkdownEnter } from './MarkdownContext'
import { normalizeInternalText } from './TextPolicy'

export interface EnterTransformEvent {
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  text: string
  selection: EditorSelectionState
}

export function resolveMarkdownEnterTransform(
  event: EnterTransformEvent,
): { text: string; selection: EditorSelectionState } | null {
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return null
  }

  const sourceText = normalizeInternalText(event.text)
  const next = applyMarkdownEnter(sourceText, event.selection)
  if (!next) {
    return null
  }

  return {
    text: next.text,
    selection: next.selection,
  }
}