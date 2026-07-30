import {
  $getNodeByKey,
  ParagraphNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type NodeMutation,
} from 'lexical'
import { Text as RopeText } from '@codemirror/state'
import { ParagraphOffsetIndex } from './ParagraphOffsetIndex'
import { normalizeInternalText } from './TextPolicy'

/**
 * Keeps an immutable, incrementally-updated `@codemirror/state` `Text` rope
 * in sync with a Lexical editor's paragraph tree, as an alternative source
 * of truth to the "read every paragraph, join with '\n'" canonical-text
 * model used elsewhere (ContractBridgePlugin.tsx's readCanonicalRootText,
 * TextPolicy.ts's canonicalizeParagraphSegments(Incremental)). Per
 * docs/large-document-performance-handover.md's own finding, that model has
 * an irreducible O(document length) floor -- producing a fresh joined
 * string every keystroke -- that no amount of skipping "expensive per-item
 * work" avoids, because the array-build-and-join mechanics themselves are
 * the cost (confirmed by measurement, not assumed: two prior attempts at
 * exactly that were built, fuzz-tested, and reverted after measuring flat-
 * to-worse). A rope's `.replace(from, to, text)` is O(log n + edit size)
 * via structural sharing, genuinely below that floor -- but only if this
 * sync layer feeds it precise per-edit ranges instead of re-diffing two
 * full strings.
 *
 * THIS MODULE IS NOT WIRED INTO THE LIVE APP YET. It exists and is verified
 * (fuzz-tested against a real Lexical editor, see LexicalRopeSync.test.ts)
 * as a standalone building block -- the same phased approach this codebase
 * used for ParagraphOffsetIndex (built and fuzz-tested standalone first,
 * wired into ContractBridgePlugin's selection/caret path in a later,
 * separately-verified step). Wiring this into onTextChange and migrating
 * hot consumers (preview split, markdown inline-state, title derivation,
 * word count) to read from the rope instead of forcing a full string every
 * keystroke is deliberately out of scope here -- see the handover doc for
 * why that's scoped as its own, separately-verified effort.
 *
 * Sync strategy mirrors LexicalParagraphOffsetSync.ts's own empirically-
 * derived approach exactly (see that file's doc comment for the underlying
 * Lexical-behavior findings this reuses): `registerMutationListener`
 * filtered to 'created'/'destroyed' for structural changes, and
 * `registerUpdateListener`'s `dirtyElements` for in-place content changes to
 * an existing, still-live paragraph. This module keeps its OWN private
 * ParagraphOffsetIndex (not shared with whatever instance
 * ContractBridgePlugin uses for caret placement) purely as bookkeeping to
 * answer "what was this paragraph's offset/length before this edit" --
 * the exact information needed to compute a precise rope.replace() range.
 *
 * Separator convention, matching ParagraphOffsetIndex.ts's own "length + 1
 * per non-last paragraph" model exactly: every paragraph except the
 * document's actual last one owns a trailing LF immediately after its own
 * text. "Is this paragraph currently last" is always answered from
 * Lexical's own live tree (`node.getNextSibling() !== null`), never
 * inferred from this sync's own possibly-mid-batch-inconsistent index
 * state -- multiple paragraphs can be created or destroyed within a single
 * update tick (a large paste, a multi-paragraph delete), and intermediate
 * rope/index state while working through such a batch is allowed to be
 * transiently inconsistent with itself as long as it converges to the
 * correct final state once the whole batch is processed -- exactly the
 * same tolerance LexicalParagraphOffsetSync's own insertRun() relies on.
 *
 * Every read entry point (`snapshot()`) simply returns whatever this sync
 * currently believes the rope is -- there is no "fall back to a slow path"
 * escape hatch the way LexicalParagraphOffsetSync's resolveParagraph has,
 * because this module isn't wired into anything yet; correctness rests
 * entirely on the fuzz suite in LexicalRopeSync.test.ts, which checks
 * `.toString()` against a full ground-truth recompute after every single
 * step of a long randomized real-editor edit sequence, the same discipline
 * every other incremental structure in this codebase has been held to.
 */
export class LexicalRopeSync {
  private readonly editor: LexicalEditor
  private readonly index = new ParagraphOffsetIndex()
  private readonly unregisterFns: Array<() => void> = []
  private rope: RopeText = RopeText.empty

  constructor(editor: LexicalEditor) {
    this.editor = editor
  }

  start(): void {
    const removeMutationListener = this.editor.registerMutationListener(
      ParagraphNode,
      (mutations) => this.onParagraphMutations(mutations),
      { skipInitialization: false },
    )
    const removeUpdateListener = this.editor.registerUpdateListener(({ dirtyElements }) => {
      this.onDirtyElements(dirtyElements)
    })
    this.unregisterFns.push(removeMutationListener, removeUpdateListener)
  }

  dispose(): void {
    for (const fn of this.unregisterFns.splice(0)) fn()
    this.index.clear()
    this.rope = RopeText.empty
  }

  /** Current synced rope. Immutable -- safe to hold onto across renders. */
  snapshot(): RopeText {
    return this.rope
  }

  /** This paragraph's own end offset (start + length, no separator) equals `totalLength()` iff nothing is indexed after it. */
  private isLastInIndex(key: NodeKey): boolean {
    return this.index.prefixOffset(key) + this.index.lengthOf(key) === this.index.totalLength()
  }

  private onParagraphMutations(mutations: Map<NodeKey, NodeMutation>): void {
    const created: NodeKey[] = []
    const destroyed: NodeKey[] = []
    for (const [key, mutation] of mutations) {
      if (mutation === 'created') created.push(key)
      else if (mutation === 'destroyed') destroyed.push(key)
      // 'updated' intentionally ignored -- see LexicalParagraphOffsetSync's
      // doc comment: it also fires for a mutated paragraph's siblings
      // (pointer-churn, not content), and this sync's own dirtyElements
      // listener is what catches real content changes.
    }
    if (created.length === 0 && destroyed.length === 0) return

    this.editor.getEditorState().read(() => {
      for (const key of destroyed) {
        if (this.index.has(key)) this.removeParagraph(key)
      }
      this.insertCreatedParagraphs(created)
    })
  }

  private removeParagraph(key: NodeKey): void {
    const ownStart = this.index.prefixOffset(key)
    const length = this.index.lengthOf(key)

    if (this.isLastInIndex(key)) {
      // No trailing separator of its own -- but if this wasn't also the
      // only paragraph, the separator immediately before it is now
      // dangling (nothing will follow it once this paragraph is gone), so
      // that's what needs to go instead, not a nonexistent trailing one.
      const start = ownStart > 0 ? ownStart - 1 : ownStart
      this.rope = this.rope.replace(start, ownStart + length, RopeText.empty)
    } else {
      this.rope = this.rope.replace(ownStart, ownStart + length + 1, RopeText.empty)
    }

    this.index.remove(key)
  }

  /**
   * Inserts every newly-created paragraph at its correct position, handling
   * an arbitrary number of them landing in the same update tick (a large
   * paste, or this sync's own initial population where every existing
   * paragraph arrives as 'created' at once) by processing each maximal
   * contiguous run of new siblings together, anchored to whichever already-
   * indexed neighbor bounds that run -- identical grouping strategy to
   * LexicalParagraphOffsetSync's own insertCreatedParagraphs.
   */
  private insertCreatedParagraphs(createdKeys: NodeKey[]): void {
    const pending = new Set(createdKeys)
    for (const key of createdKeys) {
      if (pending.has(key)) this.insertRun(key, pending)
    }
  }

  private insertRun(startKey: NodeKey, pending: Set<NodeKey>): void {
    const startNode = $getNodeByKey(startKey)
    if (!startNode) {
      pending.delete(startKey)
      return
    }

    let first: LexicalNode = startNode
    for (;;) {
      const prev: LexicalNode | null = first.getPreviousSibling()
      if (!prev || !pending.has(prev.getKey())) break
      first = prev
    }

    const anchorNode = first.getPreviousSibling()
    const anchorKey = anchorNode ? anchorNode.getKey() : null
    if (anchorKey !== null && !this.index.has(anchorKey)) {
      // Anchor isn't indexed for some unexpected reason -- leave this run
      // out of the index/rope entirely rather than risk inserting at the
      // wrong position (mirrors LexicalParagraphOffsetSync's own safety
      // rule -- this sync has no fallback path, so an inconsistency here
      // would be silent corruption, not a degraded-but-correct answer;
      // dropping the run leaves ropeOffset bookkeeping for THIS run out of
      // sync, but every other already-indexed paragraph stays correct).
      for (const key of pending) {
        if (key === startKey) pending.delete(key)
      }
      return
    }

    // Where does whatever currently follows `anchorKey` in the rope start,
    // and does a real separator already sit there? Safe to query the index
    // for `anchorKey` here (unlike for a key created earlier in THIS run):
    // it either predates this whole batch, or was fully committed to both
    // rope and index in a previous iteration of this same loop, so its own
    // state is never mid-run-inconsistent.
    //
    // If `anchorKey` was previously the document's last paragraph, there is
    // NO separator sitting at that boundary yet -- inserting the first new
    // key here must supply one itself (a leading separator), not just rely
    // on its own trailing-separator decision (which only ever answers "does
    // *this* key need a separator after it," never "does the gap *before*
    // it already have one"). Only the first key in a run can ever face this
    // gap: every key after it in the same run was reached via
    // `node.getNextSibling()` off a key that (by definition of the loop
    // continuing) has a next sibling, i.e. already got a trailing separator
    // of its own moments ago.
    let ropeOffset: number
    let needsLeadingSeparator: boolean
    if (anchorKey === null) {
      ropeOffset = 0
      needsLeadingSeparator = false
    } else {
      const anchorWasLast = this.isLastInIndex(anchorKey)
      ropeOffset = this.index.prefixOffset(anchorKey) + this.index.lengthOf(anchorKey) + (anchorWasLast ? 0 : 1)
      needsLeadingSeparator = anchorWasLast
    }

    let runningAnchor = anchorKey
    let node: LexicalNode | null = first
    while (node && pending.has(node.getKey())) {
      const key = node.getKey()
      const text = normalizeInternalText(node.getTextContent())
      // Ground truth from Lexical's own live tree, not from this sync's
      // own (possibly still-partial, mid-batch) index -- a later key in
      // this same run may not be indexed yet even though it structurally
      // exists as this node's next sibling.
      const hasNext = node.getNextSibling() !== null

      const lines: string[] = []
      if (needsLeadingSeparator) lines.push('')
      lines.push(text)
      if (hasNext) lines.push('')

      this.rope = this.rope.replace(ropeOffset, ropeOffset, RopeText.of(lines))
      this.index.insertAfter(runningAnchor, key, text.length)

      ropeOffset += text.length + (needsLeadingSeparator ? 1 : 0) + (hasNext ? 1 : 0)
      needsLeadingSeparator = false
      pending.delete(key)
      runningAnchor = key
      node = node.getNextSibling()
    }
  }

  private onDirtyElements(dirtyElements: Map<NodeKey, boolean>): void {
    const keysToCheck: NodeKey[] = []
    for (const key of dirtyElements.keys()) {
      if (this.index.has(key)) keysToCheck.push(key)
    }
    if (keysToCheck.length === 0) return

    this.editor.getEditorState().read(() => {
      for (const key of keysToCheck) {
        const node = $getNodeByKey(key)
        if (!node) continue // Removed this same tick; already handled by destroy processing regardless of listener order.

        const newText = normalizeInternalText(node.getTextContent())
        const oldStart = this.index.prefixOffset(key)
        const oldLength = this.index.lengthOf(key)
        // Only this paragraph's own span -- never touches either
        // neighboring separator, since neither the paragraph's identity
        // nor its position changed.
        this.rope = this.rope.replace(oldStart, oldStart + oldLength, RopeText.of([newText]))
        this.index.updateLength(key, newText.length)
      }
    })
  }
}
