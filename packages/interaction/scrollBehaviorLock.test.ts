// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { borrowAutoScrollBehavior, isScrollBehaviorBorrowed } from './scrollBehaviorLock'

const makeElement = (inline = ''): HTMLElement => {
  const element = document.createElement('div')
  element.style.scrollBehavior = inline
  return element
}

describe('borrowAutoScrollBehavior', () => {
  it('holds auto for one borrower and gives the inline value back', () => {
    const element = makeElement()
    const release = borrowAutoScrollBehavior(element)
    expect(element.style.scrollBehavior).toBe('auto')
    release()
    expect(element.style.scrollBehavior).toBe('')
  })

  it('restores whatever was really there, not a guess', () => {
    const element = makeElement('smooth')
    const release = borrowAutoScrollBehavior(element)
    expect(element.style.scrollBehavior).toBe('auto')
    release()
    expect(element.style.scrollBehavior).toBe('smooth')
  })

  it('survives the inner borrower finishing first', () => {
    // The leak: the inner borrower hands back what it found, which is the
    // OUTER borrower's `auto`, and the pane never sees its CSS again.
    const element = makeElement()
    const outer = borrowAutoScrollBehavior(element)
    const inner = borrowAutoScrollBehavior(element)
    inner()
    expect(element.style.scrollBehavior).toBe('auto')
    outer()
    expect(element.style.scrollBehavior).toBe('')
  })

  it('survives the outer borrower finishing first', () => {
    // The stall: the outer borrower restores the real value while the inner
    // one is still animating, so every remaining write is natively
    // smooth-scrolled and the animation dies a few pixels in. Measured on a
    // 400px journey: it moved four pixels and stopped.
    const element = makeElement()
    const outer = borrowAutoScrollBehavior(element)
    const inner = borrowAutoScrollBehavior(element)
    outer()
    expect(element.style.scrollBehavior).toBe('auto')
    inner()
    expect(element.style.scrollBehavior).toBe('')
  })

  it('ignores a release that has already run', () => {
    // Teardown here is reached from a frame loop finishing, a cancel and an
    // unmount, and any two of them can fire for the same borrow.
    const element = makeElement()
    const outer = borrowAutoScrollBehavior(element)
    const inner = borrowAutoScrollBehavior(element)
    inner()
    inner()
    inner()
    expect(element.style.scrollBehavior).toBe('auto')
    expect(isScrollBehaviorBorrowed(element)).toBe(true)
    outer()
    expect(element.style.scrollBehavior).toBe('')
    expect(isScrollBehaviorBorrowed(element)).toBe(false)
  })

  it('starts over cleanly once every borrow is done', () => {
    const element = makeElement('smooth')
    borrowAutoScrollBehavior(element)()
    element.style.scrollBehavior = 'auto'
    // A caller that changed the property between borrows is what the next
    // borrow records, so the lock never restores a value from an older run.
    const release = borrowAutoScrollBehavior(element)
    release()
    expect(element.style.scrollBehavior).toBe('auto')
  })

  it('keeps borrows on different elements apart', () => {
    const a = makeElement('smooth')
    const b = makeElement()
    const releaseA = borrowAutoScrollBehavior(a)
    const releaseB = borrowAutoScrollBehavior(b)
    releaseA()
    expect(a.style.scrollBehavior).toBe('smooth')
    expect(b.style.scrollBehavior).toBe('auto')
    releaseB()
    expect(b.style.scrollBehavior).toBe('')
  })
})
