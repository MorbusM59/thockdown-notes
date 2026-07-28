import {
  $getNodeByKey,
  $getNodeFromDOMNode,
  ParagraphNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type NodeMutation,
} from 'lexical'
import { ParagraphOffsetIndex } from './ParagraphOffsetIndex'
import { normalizeInternalText } from './TextPolicy'
import type { FastParagraphResolution } from './SelectionOffsets'

/**
 * Keeps a ParagraphOffsetIndex (see that file for the data structure and
 * why an O(document length) walk needs to become this) live-synced to a
 * Lexical editor's actual paragraph tree. The sync strategy below was
 * derived empirically against Lexical 0.44 -- see the git history for the
 * throwaway jsdom spikes that found each of these -- not assumed from
 * reading the types:
 *
 * - registerMutationListener(ParagraphNode, ...), filtered to 'created'/
 *   'destroyed' only. 'updated' *also* fires for a paragraph's immediate
 *   siblings whenever a neighbor is inserted or removed (their own
 *   __prev/__next pointers changed) -- that's pointer-churn noise, not a
 *   content change, and must be ignored here. Confirmed separately: a plain
 *   text edit inside a paragraph fires *no* ParagraphNode mutation at all,
 *   so this signal alone cannot detect content/length changes.
 * - registerUpdateListener's `dirtyElements`, filtered to keys that still
 *   resolve to a live, indexed paragraph. This is what reflects "this
 *   paragraph's own text content changed" -- confirmed: a plain text edit
 *   inside one paragraph marks exactly that paragraph's key in
 *   dirtyElements (as an "unintentional"/descendant-driven dirty entry),
 *   and no other paragraph's.
 * - $-prefixed Lexical functions (getPreviousSibling, $getNodeByKey, ...)
 *   are NOT usable from inside a mutation-listener callback without an
 *   explicit wrapping `editor.getEditorState().read()` -- confirmed via a
 *   spike; omitting it throws "Unable to find an active editor state."
 *
 * New paragraphs' insertion position is derived purely from
 * getPreviousSibling()/getNextSibling() (confirmed O(1) in Lexical's
 * source: a direct key-pointer follow, not a sibling scan), never from
 * Lexical's own getIndexWithinParent() (confirmed O(index) in Lexical's
 * source -- exactly the kind of document-scoped operation this structure
 * exists to avoid).
 *
 * Every read entry point returns null on any doubt (key not found, index
 * not yet populated for that paragraph, DOM node not resolvable to a live
 * indexed paragraph) -- callers MUST treat null as "fall back to the
 * slow-but-always-correct path," never as a resolved answer of zero. That
 * fallback is the safety net for anything this sync logic gets wrong that
 * the fuzz/live-browser verification didn't catch -- matching this
 * codebase's established rule that a caching/incremental scheme is only
 * ever as trustworthy as its fallback, per
 * docs/document-scale-performance-philosophy.md.
 */
export class LexicalParagraphOffsetSync {
  private readonly editor: LexicalEditor
  private readonly index = new ParagraphOffsetIndex()
  private readonly unregisterFns: Array<() => void> = []

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
  }

  /**
   * Resolves which paragraph a DOM (node, offset) selection point falls in,
   * in O(log n), for SelectionOffsets.ts's FastParagraphResolver contract --
   * or null if it can't be resolved this way, in which case the caller
   * (getOffsetWithinRoot) falls back to its O(document length) walk.
   *
   * Opens its own `editor.read()` scope rather than relying on an ambient
   * one from the caller: confirmed via a failing test, not assumed --
   * $getNodeFromDOMNode needs Lexical's *active editor* (not just an active
   * editor *state*), which plain `editorState.read()` does not set on its
   * own (it needs an explicit `{ editor }` option, or `editor.read()`
   * itself). Lexical read scopes nest safely, so this is safe to call from
   * within a caller's own editor.getEditorState().read() block too.
   */
  resolveParagraph = (rootEl: HTMLElement, domNode: Node, _domOffset: number): FastParagraphResolution | null => {
    // Rare element-type point directly on the root editable (offset is a
    // child index into rootEl, not a position within one paragraph) --
    // deliberately not fast-pathed; the slow walk already handles it.
    if (domNode === rootEl) return null

    const paragraphEl = this.findParagraphElement(rootEl, domNode);
    if (!paragraphEl) return null

    return this.editor.read(() => {
      const node = $getNodeFromDOMNode(paragraphEl)
      if (!node) return null
      const key = node.getKey()
      if (!this.index.has(key)) return null

      return {
        paragraphEl,
        prefixOffset: this.index.prefixOffset(key),
        paragraphTextLength: this.index.lengthOf(key),
        hasNextParagraph: node.getNextSibling() !== null,
      }
    })
  }

  private findParagraphElement(rootEl: HTMLElement, domNode: Node): HTMLElement | null {
    let el: HTMLElement | null = domNode instanceof HTMLElement ? domNode : domNode.parentElement
    while (el && el.parentElement !== rootEl) {
      el = el.parentElement
    }
    return el && el.parentElement === rootEl ? el : null
  }

  private onParagraphMutations(mutations: Map<NodeKey, NodeMutation>): void {
    const created: NodeKey[] = []
    const destroyed: NodeKey[] = []
    for (const [key, mutation] of mutations) {
      if (mutation === 'created') created.push(key)
      else if (mutation === 'destroyed') destroyed.push(key)
      // 'updated' intentionally ignored -- see class doc comment.
    }
    if (created.length === 0 && destroyed.length === 0) return

    this.editor.getEditorState().read(() => {
      for (const key of destroyed) {
        if (this.index.has(key)) this.index.remove(key)
      }
      this.insertCreatedParagraphs(created)
    })
  }

  /**
   * Inserts every newly-created paragraph at its correct position, handling
   * an arbitrary number of them landing in the same update tick (a large
   * paste, or this sync's own initial population where every existing
   * paragraph arrives as 'created' at once) by processing each maximal
   * contiguous run of new siblings together, anchored to whichever already-
   * indexed neighbor bounds that run.
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
      // out of the fast index entirely rather than risk inserting at the
      // wrong position. resolveOffset() safely falls back to the slow path
      // for any paragraph this sync never successfully indexes.
      for (const key of pending) {
        if (key === startKey) pending.delete(key)
      }
      return
    }

    let runningAnchor = anchorKey
    let node: LexicalNode | null = first
    while (node && pending.has(node.getKey())) {
      const key = node.getKey()
      const length = normalizeInternalText(node.getTextContent()).length
      this.index.insertAfter(runningAnchor, key, length)
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
        const newLength = normalizeInternalText(node.getTextContent()).length
        this.index.updateLength(key, newLength)
      }
    })
  }
}
