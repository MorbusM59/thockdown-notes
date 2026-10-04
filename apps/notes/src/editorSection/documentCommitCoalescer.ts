/**
 * How the displayed document -- its text AND its selection -- is committed to
 * React state, including under "Allow asynchronous input"
 * (`deferPreviewOnRapidInput`), which holds a typed character's text commit
 * back to the next frame so a burst of keystrokes costs one render.
 *
 * The invariant: the committed text and the committed selection are always
 * one snapshot. Every consumer of the pair (the formatting toolbar's active
 * state, extract-to-chapter, ...) indexes the
 * selection into the text, so a selection one keystroke newer than its text
 * is not a slightly stale answer but a wrong one: typing at the end of a
 * heading put the caret one past the old line's end -- the start of the NEXT
 * line -- and the toolbar lit that line's formatting for a frame, which read
 * as a flicker (deleting never did: its caret moves back, inside the line).
 * The same mismatch also defeated the markdown inline-state cache's O(edit)
 * path on every keystroke, falling back to a whole-document line diff.
 *
 * Hence the rule, in one place: while a text commit is pending, the selection
 * waits for it and the frame commits both. A selection-only change with
 * nothing pending commits at once, as it always did.
 *
 * Frame scheduling is injected so the rule can be tested as a property over
 * arbitrary interleavings (documentCommitCoalescer.test.ts) rather than
 * reasoned about -- the real path is rAF-driven and cannot run in the
 * browser pane at all.
 */
export interface DocumentCommitCoalescerOptions {
  requestFrame: (callback: () => void) => number
  cancelFrame: (handle: number) => void
  /** Commits whatever text is latest. `reason` lets the caller bundle work that only the coalesced frame does (the title preview). */
  commitText: (reason: 'frame' | 'immediate') => void
  /** Commits whatever selection is latest. */
  commitSelection: () => void
}

export interface DocumentCommitCoalescer {
  /** The text changed. `defer`: commit it, with the selection, on the next frame. Otherwise commit both now, superseding any pending frame. */
  text: (defer: boolean) => void
  /** Only the selection changed. Commits now, unless a deferred text commit is pending -- then it rides that frame. */
  selection: () => void
  /** Drops a pending frame without committing it (unmount). */
  cancel: () => void
}

export function createDocumentCommitCoalescer(options: DocumentCommitCoalescerOptions): DocumentCommitCoalescer {
  let pendingFrame: number | null = null

  const cancel = () => {
    if (pendingFrame === null) return
    options.cancelFrame(pendingFrame)
    pendingFrame = null
  }

  return {
    text: (defer) => {
      if (defer) {
        if (pendingFrame !== null) return
        pendingFrame = options.requestFrame(() => {
          pendingFrame = null
          options.commitText('frame')
          options.commitSelection()
        })
        return
      }
      cancel()
      options.commitText('immediate')
      options.commitSelection()
    },
    selection: () => {
      if (pendingFrame !== null) return
      options.commitSelection()
    },
    cancel,
  }
}
