/** @vitest-environment jsdom */
// Integration-level fuzz test for LexicalRopeSync: drives a real Lexical
// editor through a long randomized sequence of structural + text edits and
// checks the synced rope's `.toString()` against a full ground-truth
// recompute after every single step. Same discipline as
// LexicalParagraphOffsetSync.test.ts (the identical dirtyElements/mutation-
// listener signals, verified there for offset resolution, verified here for
// content), and the fuzz-op generator below is deliberately the same shape
// as that file's (and TextPolicy.dirtyElements.test.ts's) own, since those
// are already proven to exercise the right edit classes: in-place text
// edits, Enter-splits, Backspace-merges, multi-paragraph paste, deletes.
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
} from 'lexical'
import { LexicalRopeSync } from './LexicalRopeSync'
import { canonicalizeParagraphSegments } from './TextPolicy'

function makeEditor(): LexicalEditor {
  const editor = createEditor({ namespace: 'test', onError: (e) => { throw e } })
  const container = document.createElement('div')
  container.contentEditable = 'true'
  document.body.appendChild(container)
  editor.setRootElement(container)
  return editor
}

function firstTextNodeAt(index: number) {
  const p = $getRoot().getChildAtIndex(index)
  if (!$isParagraphNode(p)) return null
  const child = p.getFirstChild()
  return $isTextNode(child) ? child : null
}

/**
 * Sets paragraph `index`'s text, creating a TextNode child if it doesn't
 * have one. Needed because Lexical prunes a TextNode whose content becomes
 * "" -- confirmed live in a prior session's fuzz test on the exact same
 * kind of op generator (see git history / TextPolicy.dirtyElements.test.ts):
 * a plain `firstTextNodeAt(index)?.setTextContent(...)` on an already-
 * emptied paragraph silently no-ops via optional chaining.
 */
function setParagraphText(index: number, text: string): void {
  const p = $getRoot().getChildAtIndex(index)
  if (!p) return
  const existing = firstTextNodeAt(index)
  if (existing) {
    existing.setTextContent(text)
  } else if ($isParagraphNode(p)) {
    p.append($createTextNode(text))
  }
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

function groundTruth(texts: string[]): string {
  return canonicalizeParagraphSegments(texts)
}

describe('LexicalRopeSync', () => {
  it('matches ground truth for an empty document, then after seeding', () => {
    const editor = makeEditor()
    const sync = new LexicalRopeSync(editor)
    sync.start()

    expect(sync.snapshot().toString()).toBe('')

    seedParagraphs(editor, ['first paragraph', 'second one', '', 'fourth has more words'])
    expect(sync.snapshot().toString()).toBe(groundTruth(['first paragraph', 'second one', '', 'fourth has more words']))

    sync.dispose()
  })

  it('matches ground truth after an in-place text edit (identity-preserving case)', () => {
    const editor = makeEditor()
    const sync = new LexicalRopeSync(editor)
    sync.start()

    const texts = ['alpha', 'bravo', 'charlie']
    seedParagraphs(editor, texts)
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

    editor.update(() => {
      setParagraphText(1, 'BRAVO, EDITED')
    }, { discrete: true })
    texts[1] = 'BRAVO, EDITED'

    expect(sync.snapshot().toString()).toBe(groundTruth(texts))
    sync.dispose()
  })

  it('matches ground truth after inserting at the very front and very end', () => {
    const editor = makeEditor()
    const sync = new LexicalRopeSync(editor)
    sync.start()

    let texts = ['middle one', 'middle two']
    seedParagraphs(editor, texts)

    editor.update(() => {
      const root = $getRoot()
      const first = root.getFirstChild()
      const p = $createParagraphNode()
      p.append($createTextNode('NEW FRONT'))
      if (first) first.insertBefore(p)
    }, { discrete: true })
    texts = ['NEW FRONT', ...texts]
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

    editor.update(() => {
      const root = $getRoot()
      const last = root.getLastChild()
      const p = $createParagraphNode()
      p.append($createTextNode('NEW END'))
      if (last) last.insertAfter(p)
    }, { discrete: true })
    texts = [...texts, 'NEW END']
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

    sync.dispose()
  })

  it('matches ground truth after deleting down to a single paragraph and back up', () => {
    const editor = makeEditor()
    const sync = new LexicalRopeSync(editor)
    sync.start()

    let texts = ['a', 'b', 'c', 'd']
    seedParagraphs(editor, texts)

    editor.update(() => {
      const root = $getRoot()
      root.getChildAtIndex(1)?.remove()
      root.getChildAtIndex(1)?.remove() // now index 1 is what was originally 'd'
    }, { discrete: true })
    texts = ['a', 'd']
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

    editor.update(() => {
      const root = $getRoot()
      root.getChildAtIndex(0)?.remove()
      root.getChildAtIndex(0)?.remove()
    }, { discrete: true })
    texts = []
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

    editor.update(() => {
      const root = $getRoot()
      const p = $createParagraphNode()
      p.append($createTextNode('x'))
      root.append(p)
    }, { discrete: true })
    texts = ['x']
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

    sync.dispose()
  })

  it.each([1, 2026, 424242, 90210, 7])('matches ground truth after every step of a randomized real-editor edit sequence (seed %i)', (seed) => {
    function makeRng(s: number) {
      let state = s
      return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        return state / 0x7fffffff
      }
    }

    const rng = makeRng(seed)
    const editor = makeEditor()
    const sync = new LexicalRopeSync(editor)
    sync.start()

    let texts = ['alpha one', 'bravo two', 'charlie three', 'delta four', 'echo five']
    seedParagraphs(editor, texts)
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

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
          setParagraphText(index, nextText)
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
          setParagraphText(index, before)
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
          const prevText = firstTextNodeAt(index - 1)?.getTextContent() ?? ''
          const currentText = firstTextNodeAt(index)?.getTextContent() ?? ''
          const combined = prevText + currentText
          setParagraphText(index - 1, combined)
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
      expect(
        sync.snapshot().toString(),
        `seed ${seed} step ${step}: mismatch; texts=${JSON.stringify(texts)}`,
      ).toBe(groundTruth(texts))
    }

    sync.dispose()
  })

  it('handles a large document (10,000 paragraphs) with edits at start, middle, and end', () => {
    const editor = makeEditor()
    const sync = new LexicalRopeSync(editor)
    sync.start()

    const N = 10_000
    const texts = Array.from({ length: N }, (_, i) => `paragraph number ${i} with some ordinary prose content`)
    seedParagraphs(editor, texts)
    expect(sync.snapshot().length).toBe(groundTruth(texts).length)
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

    // Edit at start, middle, and end -- the "page 1 must feel identical to
    // page 1,000" property this codebase's other O(log n) structures are
    // held to (see docs/document-scale-performance-philosophy.md): none of
    // these should behave differently depending on position.
    for (const index of [0, Math.floor(N / 2), N - 1]) {
      const edited = `${texts[index]} EDITED`
      editor.update(() => {
        setParagraphText(index, edited)
      }, { discrete: true })
      texts[index] = edited
    }
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

    // Insert and delete near start, middle, and end too.
    editor.update(() => {
      const root = $getRoot()
      const p = $createParagraphNode()
      p.append($createTextNode('inserted near start'))
      root.getChildAtIndex(1)?.insertBefore(p)
    }, { discrete: true })
    texts.splice(1, 0, 'inserted near start')
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

    editor.update(() => {
      $getRoot().getChildAtIndex(Math.floor(texts.length / 2))?.remove()
    }, { discrete: true })
    texts.splice(Math.floor(texts.length / 2), 1)
    expect(sync.snapshot().toString()).toBe(groundTruth(texts))

    sync.dispose()
  })

  it('dispose() unregisters listeners so later edits no longer touch the rope', () => {
    const editor = makeEditor()
    const sync = new LexicalRopeSync(editor)
    sync.start()
    seedParagraphs(editor, ['a', 'b'])
    expect(sync.snapshot().toString()).toBe('a\nb')

    sync.dispose()
    expect(sync.snapshot().toString()).toBe('')

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
