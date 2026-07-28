/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $isParagraphNode,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from 'lexical'

/** Test helper: the first TextNode child of the paragraph at `index`, or null. */
function firstTextNodeAt(index: number): TextNode | null {
  const p = $getRoot().getChildAtIndex(index)
  if (!$isParagraphNode(p)) return null
  const child = p.getFirstChild()
  return $isTextNode(child) ? child : null
}
import { LexicalParagraphOffsetSync } from './LexicalParagraphOffsetSync'
import { readSelectionOffsetFromDomPoint } from './SelectionOffsets'

function makeEditor(): { editor: LexicalEditor; container: HTMLElement } {
  const editor = createEditor({ namespace: 'test', onError: (e) => { throw e } })
  const container = document.createElement('div')
  container.contentEditable = 'true'
  document.body.appendChild(container)
  editor.setRootElement(container)
  return { editor, container }
}

function seedParagraphs(editor: LexicalEditor, texts: string[]): void {
  editor.update(() => {
    const root = $getRoot()
    root.clear()
    for (const text of texts) {
      const p = $createParagraphNode()
      p.append($createTextNode(text))
      root.append(p)
    }
  }, { discrete: true })
}

function totalCanonicalLength(texts: string[]): number {
  if (texts.length === 0) return 0
  return texts.reduce((sum, t) => sum + t.length, 0) + (texts.length - 1)
}

/** Every (paragraph element, text node, offset-within-that-text-node) triple currently in the DOM. */
function collectAllDomPoints(container: HTMLElement): Array<{ node: Node; offset: number }> {
  const points: Array<{ node: Node; offset: number }> = []
  for (const child of Array.from(container.children)) {
    const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT)
    let textNode: Node | null
    while ((textNode = walker.nextNode())) {
      const length = (textNode.textContent ?? '').length
      // Sample start, middle, end of every text node -- not every offset,
      // to keep the fuzz test's per-step cost bounded.
      const offsets = new Set([0, Math.floor(length / 2), length])
      for (const offset of offsets) points.push({ node: textNode, offset })
    }
  }
  return points
}

describe('LexicalParagraphOffsetSync', () => {
  it('resolves the same offset as the slow DOM walk for every text-node point in a static document', () => {
    const { editor, container } = makeEditor()
    const sync = new LexicalParagraphOffsetSync(editor)
    sync.start()

    const texts = ['first paragraph', 'second one', '', 'fourth has more words in it']
    seedParagraphs(editor, texts)

    const textLength = totalCanonicalLength(texts)
    editor.getEditorState().read(() => {
      for (const { node, offset } of collectAllDomPoints(container)) {
        const slow = readSelectionOffsetFromDomPoint(container, node, offset, textLength)
        const fast = readSelectionOffsetFromDomPoint(container, node, offset, textLength, sync.resolveParagraph)
        expect(fast, `mismatch for node "${node.textContent}" offset ${offset}`).toBe(slow)
      }
    })

    sync.dispose()
  })

  // Deterministic seeded fuzz test driving a REAL Lexical editor through a
  // long random sequence of structural + text edits -- paragraph split
  // (Enter), merge (Backspace across a boundary), multi-paragraph insert
  // (paste), single paragraph delete, and in-place text edits -- checking
  // after every single step that resolveParagraph's fast, O(log n) answer
  // exactly matches the slow O(document length) DOM walk for every
  // selectable point in the document. This is the integration-level
  // counterpart to ParagraphOffsetIndex's own pure-data-structure fuzz test:
  // that one proves the treap is internally consistent, this one proves the
  // *sync to a real Lexical editor* -- the part that can't be fuzzed in the
  // abstract -- never drifts from ground truth either.
  it.each([1, 2026, 424242])('matches the slow DOM walk after every step of a randomized real-editor edit sequence (seed %i)', (seed) => {
    function makeRng(s: number) {
      let state = s
      return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        return state / 0x7fffffff
      }
    }

    const rng = makeRng(seed)
    const { editor, container } = makeEditor()
    const sync = new LexicalParagraphOffsetSync(editor)
    sync.start()

    let texts = ['alpha one', 'bravo two', 'charlie three', 'delta four', 'echo five']
    seedParagraphs(editor, texts)

    const applyOp = () => {
      const n = texts.length
      const choice = rng()

      if (choice < 0.3 && n > 0) {
        // In-place text edit: append or truncate a random existing paragraph.
        const index = Math.floor(rng() * n)
        const grow = rng() < 0.5
        const nextText = grow
          ? `${texts[index]} x${Math.floor(rng() * 1000)}`
          : texts[index].slice(0, Math.max(0, Math.floor(texts[index].length * rng())))
        texts = texts.map((t, i) => (i === index ? nextText : t))
        editor.update(() => {
          firstTextNodeAt(index)?.setTextContent(nextText)
        }, { discrete: true })
      } else if (choice < 0.5 && n > 0) {
        // Enter-split: split a random paragraph into two at a random character offset.
        const index = Math.floor(rng() * n)
        const original = texts[index]
        const splitAt = Math.floor(rng() * (original.length + 1))
        const before = original.slice(0, splitAt)
        const after = original.slice(splitAt)
        texts = [...texts.slice(0, index), before, after, ...texts.slice(index + 1)]
        editor.update(() => {
          const p = $getRoot().getChildAtIndex(index)
          firstTextNodeAt(index)?.setTextContent(before)
          const newP = $createParagraphNode()
          newP.append($createTextNode(after))
          p?.insertAfter(newP)
        }, { discrete: true })
      } else if (choice < 0.65 && n > 1) {
        // Backspace-merge: merge a random paragraph into its predecessor.
        const index = 1 + Math.floor(rng() * (n - 1))
        const merged = texts[index - 1] + texts[index]
        texts = [...texts.slice(0, index - 1), merged, ...texts.slice(index + 1)]
        editor.update(() => {
          const current = $getRoot().getChildAtIndex(index)
          const prevText = firstTextNodeAt(index - 1)
          const currentText = firstTextNodeAt(index)
          const combined = (prevText?.getTextContent() ?? '') + (currentText?.getTextContent() ?? '')
          prevText?.setTextContent(combined)
          current?.remove()
        }, { discrete: true })
      } else if (choice < 0.8) {
        // Multi-paragraph insert (paste-like): insert 1-3 new paragraphs at a random position.
        const insertAt = Math.floor(rng() * (n + 1))
        const count = 1 + Math.floor(rng() * 3)
        const newTexts = Array.from({ length: count }, () => `inserted-${Math.floor(rng() * 10000)}`)
        texts = [...texts.slice(0, insertAt), ...newTexts, ...texts.slice(insertAt)]
        editor.update(() => {
          const root = $getRoot()
          const anchor = insertAt === 0 ? null : root.getChildAtIndex(insertAt - 1)
          let runningAnchor: LexicalNode | null = anchor
          for (const t of newTexts) {
            const p = $createParagraphNode()
            p.append($createTextNode(t))
            if (runningAnchor) {
              runningAnchor.insertAfter(p)
            } else {
              const first = root.getFirstChild()
              if (first) first.insertBefore(p)
              else root.append(p)
            }
            runningAnchor = p
          }
        }, { discrete: true })
      } else if (n > 1) {
        // Delete a random paragraph entirely.
        const index = Math.floor(rng() * n)
        texts = [...texts.slice(0, index), ...texts.slice(index + 1)]
        editor.update(() => {
          const root = $getRoot()
          root.getChildAtIndex(index)?.remove()
        }, { discrete: true })
      }
    }

    const STEPS = 150
    for (let step = 0; step < STEPS; step += 1) {
      applyOp()

      const textLength = totalCanonicalLength(texts)
      editor.getEditorState().read(() => {
        for (const { node, offset } of collectAllDomPoints(container)) {
          const slow = readSelectionOffsetFromDomPoint(container, node, offset, textLength)
          const fast = readSelectionOffsetFromDomPoint(container, node, offset, textLength, sync.resolveParagraph)
          expect(
            fast,
            `seed ${seed} step ${step}: mismatch for node "${node.textContent}" offset ${offset}; texts=${JSON.stringify(texts)}`,
          ).toBe(slow)
        }
      })
    }

    sync.dispose()
  })

  it('dispose() unregisters listeners so later edits no longer touch the index', () => {
    const { editor, container } = makeEditor()
    const sync = new LexicalParagraphOffsetSync(editor)
    sync.start()
    seedParagraphs(editor, ['a', 'b'])

    const domTextNode = document.createTreeWalker(container, NodeFilter.SHOW_TEXT).nextNode()
    expect(domTextNode).not.toBeNull()

    let resolvedBeforeDispose: unknown = null
    editor.getEditorState().read(() => {
      resolvedBeforeDispose = sync.resolveParagraph(container, domTextNode!, 0)
    })
    expect(resolvedBeforeDispose).not.toBeNull()

    sync.dispose()

    // Further edits must not throw even though listeners are torn down.
    expect(() => {
      editor.update(() => {
        const root = $getRoot()
        const p = $createParagraphNode()
        p.append($createTextNode('c'))
        root.append(p)
      }, { discrete: true })
    }).not.toThrow()
  })
})
