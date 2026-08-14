import { useLayoutEffect, useRef } from 'react'
import { isExternalNote, type NoteSummary } from '../shared/noteLifecycle'
import type { EditorSelectionState } from '../editor/EditorContract'
import {
  CHAPTER_HEADLINE_LEVEL_RULE,
  NOTE_HEADLINE_LEVEL_RULE,
  clampHeadlineLevels,
  remapOffsetThroughHeadingLevelEdits,
} from '../shared/markdownHeadings'

export interface UseHeadlineLevelGuardOptions {
  activeNoteId: string | null
  notes: NoteSummary[]
  currentEditorText: string
  editorSelection: EditorSelectionState
  applyProgrammaticEditorText: (nextText: string, selectionStart?: number, selectionEnd?: number) => void
}

/**
 * Live invariant for every note's own headings, chapter or not: the first
 * line, if it's a heading, is always exactly level 1 (a regular note) or
 * level 2 (a real chapter -- one level under its parent's own level-1
 * title); every other heading is always one level deeper still. Never
 * applied to the auto-TOC/auto-Open-Items synthetic chapters, which are
 * generated output, not something the user edits -- and never to an
 * external note (isExternalNote), a file that lives outside this app's own
 * storage and may not be structured this way at all (a README, a plain
 * `.txt` file, someone else's markdown with its own conventions); this app
 * has no business silently rewriting a file it doesn't own. Runs on every
 * text change
 * rather than hooking a specific keystroke transform (Tab/Enter/character-
 * insert) -- those can't see backspace or paste, and this invariant has to
 * hold after any edit -- mirroring useMarkdownFormattingToolbar.ts's
 * single-note TOC auto-refresh effect: idempotent, recompute-and-diff
 * against the currently displayed text, only touch the editor when
 * something actually needs correcting. useLayoutEffect (not useEffect) so
 * the correction lands before paint, same timing as that TOC effect.
 *
 * The line the caret is still sitting on is exempted from correction (see
 * `clampHeadlineLevels`'s `skipLineIndex`) -- otherwise backspacing a
 * heading's `#` run down through the floor (or clearing it off entirely, to
 * turn a heading back into plain text) gets fought on every keystroke,
 * since each intermediate state is itself a violation. `activeHeadingLineRef`
 * remembers which line (and note) the caret was on last render; the moment
 * either changes -- the caret moved to a different line, or a different
 * note became active -- that line is fair game again, so leaving a heading
 * with a stray low-level `#` run behind corrects it immediately on the way
 * out.
 */
export function useHeadlineLevelGuard({
  activeNoteId,
  notes,
  currentEditorText,
  editorSelection,
  applyProgrammaticEditorText,
}: UseHeadlineLevelGuardOptions): void {
  const activeHeadingLineRef = useRef<{ noteId: string; lineIndex: number } | null>(null)

  useLayoutEffect(() => {
    if (!activeNoteId) {
      activeHeadingLineRef.current = null
      return
    }
    const activeNote = notes.find((note) => note.id === activeNoteId)
    if (!activeNote || activeNote.isAutoToc || activeNote.isAutoOpenItems || isExternalNote(activeNote)) {
      activeHeadingLineRef.current = null
      return
    }

    const rule = activeNote.chapterOnly ? CHAPTER_HEADLINE_LEVEL_RULE : NOTE_HEADLINE_LEVEL_RULE

    const focusOffset = Math.max(0, Math.min(editorSelection.focus, currentEditorText.length))
    const caretLineIndex = currentEditorText.slice(0, focusOffset).split('\n').length - 1
    const previous = activeHeadingLineRef.current
    const stillOnSameLine = previous?.noteId === activeNoteId && previous.lineIndex === caretLineIndex
    activeHeadingLineRef.current = { noteId: activeNoteId, lineIndex: caretLineIndex }

    const { text: clampedText, edits } = clampHeadlineLevels(currentEditorText, rule, stillOnSameLine ? caretLineIndex : null)
    if (clampedText === currentEditorText) return

    const nextAnchor = remapOffsetThroughHeadingLevelEdits(editorSelection.anchor, edits)
    const nextFocus = remapOffsetThroughHeadingLevelEdits(editorSelection.focus, edits)
    applyProgrammaticEditorText(clampedText, nextAnchor, nextFocus)
  }, [activeNoteId, notes, currentEditorText, editorSelection, applyProgrammaticEditorText])
}
