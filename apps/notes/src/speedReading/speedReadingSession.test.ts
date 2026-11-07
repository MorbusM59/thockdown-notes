// @vitest-environment jsdom
/**
 * The session's own loop, timed on a simulated clock: what a reader actually
 * gets per minute, against the figure shown, with the frame jitter and the
 * ease in the real loop runs through. The pure pace (`speedReadingPace.ts`)
 * is tested on its own; this tests that the loop spends it faithfully.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSpeedReadingSession } from './speedReadingSession'
import { getSpeedReadingDisplay, setSpeedReadingSettings } from './speedReadingStore'
import { DEFAULT_SPEED_READING_SETTINGS } from './speedReadingSettings'
import { syntheticNote } from './speedReadingTestNote'

let now = 0
let queued: FrameRequestCallback | null = null
let seed = 3
/** Frames of 8-40ms, with an occasional dropped frame, as a busy window delivers them. */
function nextFrameMs(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648
  const r = seed / 2147483648
  return r < 0.02 ? 70 : 8 + r * 32
}
function runFor(ms: number, onFrame?: () => void) {
  const end = now + ms
  while (now < end && queued) {
    now += nextFrameMs()
    const cb = queued
    queued = null
    cb(now)
    onFrame?.()
  }
}

beforeEach(() => {
  now = 0
  queued = null
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queued = cb; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => { queued = null })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const key = (type: 'keydown' | 'keyup', code: string) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: code === 'Space' ? ' ' : code, code, bubbles: true, cancelable: true }))

describe('edit view session', () => {
  it.each([250, 300, 450])('holding Space reads at the figure shown: %i wpm', (wpm) => {
    setSpeedReadingSettings({ ...DEFAULT_SPEED_READING_SETTINGS, editWpm: wpm })
    const text = syntheticNote(200)
    const session = startSpeedReadingSession({ view: 'edit', text, from: 0 }, { onLeave: () => {} })!
    key('keydown', 'Space')
    runFor(5000) // past the ease in
    const startLeft = getSpeedReadingDisplay()!.secondsLeft
    let words = 0
    let lastRow = getSpeedReadingDisplay()!.row!.text
    const t0 = now
    runFor(240_000, () => {
      const row = getSpeedReadingDisplay()!.row!.text
      if (row !== lastRow) {
        words += lastRow.split(/\s+/).filter(Boolean).length
        lastRow = row
      }
    })
    const measured = (words / ((now - t0) / 1000)) * 60
    const endLeft = getSpeedReadingDisplay()!.secondsLeft
    key('keyup', 'Space')
    session.end()
    // Frames over the loop's 100ms stall clamp are not counted, by design; none occur here.
    expect(measured / wpm).toBeGreaterThan(0.98)
    expect(measured / wpm).toBeLessThan(1.02)
    // The time left went down by the time spent reading.
    expect((startLeft - endLeft) / ((now - t0) / 1000)).toBeGreaterThan(0.98)
    expect((startLeft - endLeft) / ((now - t0) / 1000)).toBeLessThan(1.02)
  })
})

describe('render view session', () => {
  /**
   * A pane of fake blocks with known words and heights and margins between
   * them; jsdom has no layout, so the geometry is supplied. True words per
   * minute is the words crossing the pane's top edge, gaps holding none.
   */
  function fakePane(blockCount: number) {
    const scroller = document.createElement('div')
    document.body.appendChild(scroller)
    const content = document.createElement('div')
    scroller.appendChild(content)
    const layout: Array<{ el: HTMLElement; top: number; height: number; words: number }> = []
    let y = 0
    for (let i = 0; i < blockCount; i += 1) {
      const kind = i % 5
      const el = document.createElement(kind === 3 ? 'ul' : 'p')
      el.setAttribute('data-index', String(i))
      let words: number
      let height: number
      if (kind === 3) {
        // A list: items with no whitespace between them, which textContent would merge.
        const items = 4
        for (let k = 0; k < items; k += 1) {
          const li = document.createElement('li')
          li.textContent = 'one two three four five six'
          el.appendChild(li)
        }
        words = items * 6
        height = items * 24
      } else if (kind === 4) {
        el.innerHTML = 'a <strong>bo</strong>ld heading here'
        words = 4
        height = 36
      } else {
        words = 40 + kind * 25
        el.textContent = Array.from({ length: words }, () => 'word').join(' ')
        height = Math.ceil(words / 12) * 24
      }
      content.appendChild(el)
      layout.push({ el, top: y, height, words })
      y += height + 16 // the margin
    }
    const scrollHeight = y
    const viewport = 600
    let scrollTop = 0
    Object.defineProperty(scroller, 'scrollTop', { get: () => scrollTop, set: (v: number) => { scrollTop = Math.max(0, Math.min(scrollHeight - viewport, Math.round(v))) } })
    Object.defineProperty(scroller, 'clientHeight', { get: () => viewport })
    Object.defineProperty(scroller, 'clientWidth', { get: () => 700 })
    Object.defineProperty(scroller, 'scrollHeight', { get: () => scrollHeight })
    scroller.getBoundingClientRect = () => ({ top: 0, left: 0, width: 700, height: viewport, bottom: viewport, right: 700, x: 0, y: 0, toJSON() {} })
    for (const b of layout) {
      b.el.getBoundingClientRect = () => ({ top: b.top - scrollTop, bottom: b.top + b.height - scrollTop, height: b.height, left: 0, right: 700, width: 700, x: 0, y: b.top - scrollTop, toJSON() {} })
    }
    document.elementFromPoint = (_x: number, py: number) => {
      const doc = py + scrollTop
      return layout.find((b) => doc >= b.top && doc < b.top + b.height)?.el ?? content
    }
    const wordsAbove = (top: number) => {
      let n = 0
      for (const b of layout) {
        if (b.top + b.height <= top) n += b.words
        else if (b.top < top) n += b.words * ((top - b.top) / b.height)
      }
      return n
    }
    const totalWords = layout.reduce((a, b) => a + b.words, 0)
    return { scroller, wordsAbove, totalWords, viewport, scroll: () => scrollTop }
  }

  it.each([150, 250, 600])('scrolls at the figure shown: %i wpm', (wpm) => {
    setSpeedReadingSettings({ ...DEFAULT_SPEED_READING_SETTINGS, renderWpm: wpm })
    const pane = fakePane(600)
    const session = startSpeedReadingSession({
      view: 'render',
      scroller: pane.scroller,
      readWordsBelow: () => pane.totalWords - pane.wordsAbove(pane.scroll() + pane.viewport),
    }, { onLeave: () => {} })!
    runFor(5000)
    const t0 = now
    const w0 = pane.wordsAbove(pane.scroll())
    const left0 = getSpeedReadingDisplay()!.secondsLeft
    runFor(120_000)
    const measured = ((pane.wordsAbove(pane.scroll()) - w0) / ((now - t0) / 1000)) * 60
    const left1 = getSpeedReadingDisplay()!.secondsLeft
    session.end()
    expect(measured / wpm).toBeGreaterThan(0.97)
    expect(measured / wpm).toBeLessThan(1.03)
    expect((left0 - left1) / ((now - t0) / 1000)).toBeGreaterThan(0.96)
    expect((left0 - left1) / ((now - t0) / 1000)).toBeLessThan(1.04)
  })
})
