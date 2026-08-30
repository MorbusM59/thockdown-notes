// Is caret travel continuous when an arrow key is held down?
//
// Holding an arrow key should walk the caret to the viewport's edge and then
// move the text by exactly one row per keypress, with the caret pinned to that
// edge. The reported defect is that at chunk boundaries the text shifts by
// several rows at once and the caret snaps back toward the middle, so travel
// comes in lurches; and that travelling into an area the editor has not
// measured yet (resize, then jump) makes the text vibrate and flicker.
//
// A MEASUREMENT TOOL, NOT A GATE. It does not reproduce the defect, and is
// committed so the next attempt starts from a working instrument rather than
// rebuilding one. What it already rules out, on dev:browser with a 1.5M-char
// prose document:
//
//   settled document, 14s hold   9906px travelled, 0 backwards frames,
//                                0 jumps over two rows, caret drift 0.000
//   resize + jump, 14s hold     10686px travelled, same, caret drift 0.000
//
// Three things were needed to make those numbers mean anything, and each one
// was wrong in an earlier version of this file:
//
//   1. REAL auto-repeat. Playwright's keyboard.press never sets the repeat
//      flag, and this app branches on it. These are CDP rawKeyDown events
//      with autoRepeat set on everything after the first.
//   2. Sampling from INSIDE the page, every animation frame. Reading the
//      scroll position over the wire between keypresses adds ~20ms of pause
//      each time, which lets the app settle -- exactly what holding a key
//      does not do, and enough to hide any glitch completely.
//   3. Prose that wraps. The usual synthetic document is headings, lists and
//      blockquotes; a document of long paragraphs wraps the way the reported
//      one does, and wrapping is what makes rows and source lines disagree.
//
// So if this still shows nothing, the difference is somewhere else: real
// Electron, the reader's own typography, or a document whose block shapes
// differ from prose. Worth trying those before writing any code.
//
// Usage: node scripts/perf/measureCaretTravelContinuity.mjs
import { chromium } from 'playwright'
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs'

const PORT = 5249

const WORDS = ('stately plump buck mulligan came from the stairhead bearing a bowl of lather on which a mirror '
  + 'and a razor lay crossed the mild morning air held them gently behind him as he went about his business '
  + 'and the sea was a great sweet mother scrotumtightening and grey beneath the bowl of the sky ').split(/\s+/)

const proseDocument = (targetChars) => {
  const paragraphs = []
  let total = 0
  let seed = 7
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let index = 0
  while (total < targetChars) {
    const words = []
    const length = 90 + Math.floor(next() * 130)
    for (let i = 0; i < length; i += 1) words.push(WORDS[Math.floor(next() * WORDS.length)])
    const paragraph = words.join(' ')
    if (index % 12 === 0) paragraphs.push(`## Episode ${Math.floor(index / 12) + 1}`)
    paragraphs.push(paragraph)
    total += paragraph.length + 2
    index += 1
  }
  return `# Ulysses\n\n${paragraphs.join('\n\n')}\n`
}

const startSampling = (page) => page.evaluate(() => {
  const scroller = document.querySelector('.cm-scroller')
  window.__samples = []
  window.__sampling = true
  const tick = () => {
    if (!window.__sampling) return
    const caret = document.querySelector('.cm-cursor, .cm6-block-caret, .thockdown-block-caret')
    const sRect = scroller.getBoundingClientRect()
    const cRect = caret ? caret.getBoundingClientRect() : null
    window.__samples.push({
      t: Math.round(performance.now()),
      top: Math.round(scroller.scrollTop),
      caret: cRect && sRect.height ? Number(((cRect.top - sRect.top) / sRect.height).toFixed(3)) : null,
      hasCaret: !!caret,
    })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

const stopSampling = (page) => page.evaluate(() => {
  window.__sampling = false
  return window.__samples
})

const hold = async (client, ms, gapMs) => {
  const until = Date.now() + ms
  let first = true
  while (Date.now() < until) {
    await client.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40,
      key: 'ArrowDown', code: 'ArrowDown', autoRepeat: !first,
    })
    first = false
    await new Promise((r) => setTimeout(r, gapMs))
  }
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40, key: 'ArrowDown', code: 'ArrowDown',
  })
}

const report = (label, samples, lineHeightPx) => {
  const lh = lineHeightPx || 26
  const deltas = []
  for (let i = 1; i < samples.length; i += 1) deltas.push(samples[i].top - samples[i - 1].top)
  const backwards = deltas.filter((d) => d < -2)
  const bigJumps = deltas.filter((d) => d > lh * 2)
  const carets = samples.map((s) => s.caret).filter((v) => v !== null)
  // Once travelling, the caret should PIN near one edge. Wandering back
  // toward the middle is the reported "snaps back to mid viewport".
  const settled = carets.slice(Math.floor(carets.length / 3))
  const spread = settled.length ? Math.max(...settled) - Math.min(...settled) : 0
  console.log(`\n${label}`)
  console.log(`   frames=${samples.length}  travelled=${samples.length ? samples[samples.length - 1].top - samples[0].top : 0}px`)
  console.log(`   BACKWARDS frames: ${backwards.length}${backwards.length ? ` (worst ${Math.min(...backwards)}px)` : ''}`)
  console.log(`   jumps over two rows: ${bigJumps.length}${bigJumps.length ? ` (worst ${Math.max(...bigJumps)}px = ${(Math.max(...bigJumps) / lh).toFixed(1)} rows)` : ''}`)
  const withCaret = samples.filter((x) => x.hasCaret).length
  console.log(`   caret samples: ${withCaret} of ${samples.length} frames had a caret element`)
  console.log(`   caret drift within viewport once travelling: ${spread.toFixed(3)} of the viewport height`)
}

const main = async () => {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await waitForAppReady(page)
    const client = await page.context().newCDPSession(page)
    await page.evaluate(async (text) => {
      const n = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', n.id)
    }, proseDocument(1500000))
    await page.reload()
    await waitForAppReady(page)
    await ensureEditMode(page)
    await page.waitForTimeout(9000)

    const lineHeightPx = await page.evaluate(() => Math.round(
      parseFloat(getComputedStyle(document.querySelector('.cm-line') || document.querySelector('.cm-scroller')).lineHeight) || 26))

    const clickTrack = async (ratio) => {
      const box = await page.locator('.thockdown-scroll-track').boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * ratio, { delay: 0 })
      await page.waitForTimeout(6000)
    }
    const clickText = async () => {
      const p = await page.evaluate(() => {
        const el = document.querySelector('.cm-scroller')
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.35) }
      })
      await page.mouse.click(p.x, p.y, { delay: 80 })
      await page.waitForTimeout(900)
    }

    await clickTrack(0.45)
    await clickText()
    await startSampling(page)
    await hold(client, 14000, 28)
    report('A. settled document, held ArrowDown for 14s', await stopSampling(page), lineHeightPx)

    await page.setViewportSize({ width: 900, height: 620 })
    await page.waitForTimeout(3000)
    await clickTrack(0.72)
    await clickText()
    await startSampling(page)
    await hold(client, 14000, 28)
    report('B. after a resize + jump (undiscovered area)', await stopSampling(page), lineHeightPx)

    console.log(`\npage errors: ${errors.length ? errors.join(' | ') : 'none'}`)
  } finally { await browser.close(); server.stop() }
}
main().catch((e) => { console.error(e); process.exit(1) })
