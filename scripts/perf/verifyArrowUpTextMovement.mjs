// THE invariant, measured directly: one ArrowUp must move the TEXT by
// exactly zero rows or exactly one row -- never more -- even when CM6
// revises its height map underneath the press.
//
// Why not measure scrollTop. Because scrollTop conflates two different
// things. When CM6 learns the real heights of text that was only estimated,
// it shifts scrollTop by the revision's cost specifically so the text does
// NOT move. A press that reports a scrollTop delta of -208px may have moved
// the reader by one row (-26) while absorbing a -182px revision, which is
// correct, or it may have moved them by eight rows, which is the bug. The
// number alone cannot tell you, and verifyCM6ArrowUpChunkBoundary.mjs
// reports exactly that number.
//
// So this tracks the text. Before each press it records every rendered line's
// content and screen position; after the press it finds those same lines
// again and takes the median shift. That is what the reader sees, and it is
// the only thing the invariant is about.
//
// IT IS NOT AN OFF-BY-ONE. Measured skips of two and four rows in one press;
// the reporter sees four to six. A rounding error can only ever be one row,
// so whatever this is, it is computing a different POSITION rather than
// mis-rounding one. Recorded because the rounding theory is seductive -- the
// code is full of Math.round on row positions -- and it was tested and
// rejected: quantizing the movement instead of the absolute position took
// violations from 4 to 3 out of 350, which is noise, and that change was
// reverted rather than kept on a hypothesis the numbers did not support.
//
// The standing hypothesis instead: measuring a gap redistributes positions
// WITHIN it. Beforehand every offset inside is interpolated by character
// count; afterwards each line has its real height. CM6 corrects one anchor
// position exactly, so the text at that anchor holds still -- but the rest of
// the viewport was redistributed by a different amount, and moves. That is
// structural and unbounded by a row, which is what the measurements show.
//
// Three things this file had to get right, each wrong in an earlier version:
//   - Prose, not the standard synthetic document. Skip size scales with how
//     wrong the height estimate was, and the estimate assumes a line takes
//     about one row: nearly right for short lines, seven rows wrong for a
//     paragraph that wraps across eight. Short-line documents show a 2-row
//     skip where prose shows 4.
//   - A settle after each press. CM6 revises and compensates on LATER frames,
//     so measuring immediately splits one skip across two samples and halves
//     it.
//   - Matching on unique paragraph prefixes (P0, P1, ...) so a match is an
//     identity rather than a guess, which also allows trusting a single one.
//     Prose renders few line elements at a time and demanding three threw
//     away five presses in six.
//
// Run: node scripts/perf/verifyArrowUpTextMovement.mjs [--presses=N] [--chars=N] [--settle=MS]
import { chromium } from 'playwright'
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs'

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...rest] = a.replace(/^--/, '').split('=')
  return [k, rest.join('=')]
}))
const numeric = (key, fallback) => (args[key] !== undefined && Number.isFinite(Number(args[key])) ? Number(args[key]) : fallback)

const PORT = 5251

// Long wrapped paragraphs, not the usual synthetic mix. The size of a skip
// scales with how wrong the height estimate was, and the estimate for an
// unrendered line assumes it occupies about one row. A short line makes that
// nearly right; a paragraph that wraps across eight rows makes it seven rows
// wrong. The document this was reported on is prose.
const WORDS = ('stately plump buck mulligan came from the stairhead bearing a bowl of lather on which a mirror '
  + 'and a razor lay crossed the mild morning air held them gently behind him as he went about his business '
  + 'and the sea was a great sweet mother scrotumtightening and grey beneath the bowl of the sky ').split(/\s+/).filter(Boolean)

const proseDocument = (targetChars) => {
  const parts = []
  let total = 0
  let seed = 11
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let index = 0
  while (total < targetChars) {
    const words = [`P${index}`]
    const length = 90 + Math.floor(next() * 140)
    for (let i = 0; i < length; i += 1) words.push(WORDS[Math.floor(next() * WORDS.length)])
    const paragraph = words.join(' ')
    parts.push(paragraph)
    total += paragraph.length + 2
    index += 1
  }
  const body = parts.join('\n\n')
  return `# Ulysses\n\n${body}\n`
}

const snapshotLines = (page) => page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('.cm-line')) {
    const text = (el.textContent ?? '').trim()
    if (!text) continue
    out.push([text, Math.round(el.getBoundingClientRect().top)])
  }
  return out
})

const main = async () => {
  const presses = numeric('presses', 400)
  const settleMs = numeric('settle', 70)
  const server = await startDevServer(PORT)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await waitForAppReady(page)
    await page.evaluate(async (text) => {
      const n = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', n.id)
    }, proseDocument(numeric('chars', 1500000)))
    await page.reload()
    await waitForAppReady(page)
    await ensureEditMode(page)
    await page.waitForTimeout(8000)

    // Start near the end, so ArrowUp walks back through text the editor has
    // never rendered -- which is where revisions happen.
    const track = await page.locator('.thockdown-scroll-track').boundingBox()
    await page.mouse.click(track.x + track.width / 2, track.y + track.height * 0.93, { delay: 0 })
    await page.waitForTimeout(6000)
    const textPoint = await page.evaluate(() => {
      const el = document.querySelector('.cm-scroller')
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.5) }
    })
    await page.mouse.click(textPoint.x, textPoint.y, { delay: 80 })
    await page.waitForTimeout(1000)

    const lineHeightPx = await page.evaluate(() => Math.round(
      parseFloat(getComputedStyle(document.querySelector('.cm-line')).lineHeight) || 26))

    const violations = []
    let measured = 0
    let before = await snapshotLines(page)

    for (let i = 0; i < presses; i += 1) {
      await page.keyboard.press('ArrowUp')
      // Let the press finish before measuring it. CM6 revises its height map
      // and compensates, and this app re-derives on the row grid, on frames
      // AFTER the key event. Snapshotting immediately splits one skip across
      // two samples and reports half of it -- which is how a five-row skip
      // came back looking like two.
      await page.waitForTimeout(settleMs)
      const after = await snapshotLines(page)

      const beforeMap = new Map(before)
      const shifts = []
      for (const [text, top] of after) {
        const wasAt = beforeMap.get(text)
        if (wasAt !== undefined) shifts.push(top - wasAt)
      }
      // One match is enough here: every paragraph carries a unique P{n}
      // prefix, so a match is an identity, not a guess. Prose renders few
      // line elements at a time (each is a whole paragraph), and demanding
      // three of them threw away five presses in six.
      if (shifts.length >= 1) {
        shifts.sort((a, b) => a - b)
        const median = shifts[Math.floor(shifts.length / 2)]
        const rows = median / lineHeightPx
        measured += 1
        // ArrowUp moves the text DOWN by one row, or not at all.
        if (Math.abs(rows) > 1.25) {
          violations.push({ press: i, movedPx: median, movedRows: Number(rows.toFixed(2)), sharedLines: shifts.length })
        }
      }
      before = after
    }

    // A press must not drag the caret to an edge it was not resting on.
    // The cage remembers which edge the reader is travelling along so it can
    // restore it after a height-map revision; remembering it too eagerly made
    // EVERY arrow press in any direction haul the caret back to the top line.
    const caretRowInCage = () => page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller')
      const caret = document.querySelector('.thockdown-block-caret, .block-caret')
      if (!scroller || !caret) return null
      const lh = parseFloat(getComputedStyle(document.querySelector('.cm-line')).lineHeight) || 26
      return (caret.getBoundingClientRect().top - scroller.getBoundingClientRect().top) / lh
    })

    const midPoint = await page.evaluate(() => {
      const el = document.querySelector('.cm-scroller')
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.5) }
    })
    await page.mouse.click(midPoint.x, midPoint.y, { delay: 80 })
    await page.waitForTimeout(700)
    const rowAfterClick = await caretRowInCage()
    for (let i = 0; i < 4; i += 1) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(settleMs) }
    const rowAfterDown = await caretRowInCage()
    const stayedPut = rowAfterClick !== null && rowAfterDown !== null && rowAfterDown > rowAfterClick - 1
    console.log(`ArrowDown from mid-pane: caret row ${rowAfterClick === null ? '?' : rowAfterClick.toFixed(2)}`
      + ` -> ${rowAfterDown === null ? '?' : rowAfterDown.toFixed(2)}`
      + `  ${stayedPut ? 'OK' : 'FAIL: dragged toward an edge it was not on'}`)
    if (!stayedPut) process.exitCode = 1
    console.log(`line height ${lineHeightPx}px, ${presses} presses, ${settleMs}ms settle, ${measured} comparable`)
    console.log(`TEXT MOVED MORE THAN ONE ROW ON ${violations.length} PRESSES`)
    for (const v of violations.slice(0, 12)) {
      console.log(`   press ${v.press}: text moved ${v.movedPx}px = ${v.movedRows} rows (${v.sharedLines} lines matched)`)
    }
    console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`)
    if (violations.length > 0) process.exitCode = 1
  } finally { await browser.close(); server.stop() }
}
main().catch((e) => { console.error(e); process.exit(1) })
