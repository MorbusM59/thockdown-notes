import { describe, expect, it } from 'vitest'
import { createDocumentCommitCoalescer } from './documentCommitCoalescer'

// The document is modelled as a version number; a selection records which
// text version it indexes. The committed pair is coherent exactly when the
// committed selection indexes the committed text.
interface Selection { textVersion: number; caret: number }

function createHarness() {
  const frames = new Map<number, () => void>()
  let nextFrameId = 1
  const live = { text: 0, selection: { textVersion: 0, caret: 0 } as Selection }
  const committed = { text: 0, selection: { textVersion: 0, caret: 0 } as Selection }
  const coalescer = createDocumentCommitCoalescer({
    requestFrame: (callback) => {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    },
    cancelFrame: (id) => { frames.delete(id) },
    commitText: () => { committed.text = live.text },
    commitSelection: () => { committed.selection = live.selection },
  })

  return {
    live,
    committed,
    coalescer,
    pendingFrames: () => frames.size,
    type: (defer: boolean) => {
      live.text += 1
      live.selection = { textVersion: live.text, caret: live.selection.caret + 1 }
      coalescer.text(defer)
    },
    moveCaret: (caret: number) => {
      live.selection = { textVersion: live.text, caret }
      coalescer.selection()
    },
    flushFrame: () => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback())
    },
  }
}

describe('createDocumentCommitCoalescer', () => {
  it('does not commit a deferred keystroke\'s selection ahead of its text', () => {
    const h = createHarness()
    h.type(true)
    expect(h.committed).toEqual({ text: 0, selection: { textVersion: 0, caret: 0 } })
    h.flushFrame()
    expect(h.committed).toEqual({ text: 1, selection: { textVersion: 1, caret: 1 } })
  })

  it('holds a caret move made while a deferred commit is pending for that frame', () => {
    const h = createHarness()
    h.type(true)
    h.moveCaret(0)
    expect(h.committed.selection.textVersion).toBe(0)
    h.flushFrame()
    expect(h.committed).toEqual({ text: 1, selection: { textVersion: 1, caret: 0 } })
  })

  it('commits a caret move at once when nothing is pending', () => {
    const h = createHarness()
    h.moveCaret(5)
    expect(h.committed.selection).toEqual({ textVersion: 0, caret: 5 })
    expect(h.pendingFrames()).toBe(0)
  })

  it('an immediate text change supersedes a pending frame and commits both', () => {
    const h = createHarness()
    h.type(true)
    h.type(false)
    expect(h.committed).toEqual({ text: 2, selection: { textVersion: 2, caret: 2 } })
    expect(h.pendingFrames()).toBe(0)
  })

  it('keeps the committed pair coherent, and loses nothing, over random interleavings', () => {
    // Small seeded LCG: reproducible sequences without a dependency.
    let seed = 0x2f6b
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let run = 0; run < 500; run += 1) {
      const h = createHarness()
      const steps = 1 + Math.floor(random() * 40)
      for (let step = 0; step < steps; step += 1) {
        const roll = random()
        if (roll < 0.45) h.type(true)
        else if (roll < 0.6) h.type(false)
        else if (roll < 0.8) h.moveCaret(Math.floor(random() * 50))
        else h.flushFrame()

        expect(h.committed.selection.textVersion).toBe(h.committed.text)
      }
      // The fixed point: once frames drain, the committed document is the live one.
      h.flushFrame()
      expect(h.committed).toEqual(h.live)
    }
  })
})
