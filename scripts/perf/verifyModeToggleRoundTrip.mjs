// Does a mode toggle put the reader back where they were?
//
// The reported sequence, which this performs exactly: a scrollbar jump in edit
// mode, a click to set the caret, toggle to render view, toggle back, then
// ArrowUp to reveal where the caret actually is.
//
// WHAT IT CAUGHT (200k chars, and why the numbers below are worth keeping):
//
//   after the jump      edit at 31590px, 45% through
//   entering render     edit reported source line 429 and carried it over,
//                       and the preview landed on line 75 -- 8%
//   back in edit        5382px, 26,208px adrift
//   ArrowUp             slammed to the document end
//
// Three symptoms, one wrong number: only the FIRST step was wrong, and the
// rest was faithful arithmetic on a corrupted input.
//
// THE CAUSE, which took three wrong guesses to find. `estimateSize` has three
// tiers -- a fitted model, lines x line height, and a flat per-block guess --
// and toggling INTO render view is the one moment the top two are empty,
// because the probe they are measured from has only just mounted. The flat
// guess answered: 47 blocks x 56px = 2632px, and the pane duly landed at
// 2607px. `scrollToIndex` was not failing to converge; it was arriving
// exactly where a bad map said to go.
//
// Two recorded negative results, so nobody spends the time again:
//   1. Re-issuing the same scrollToIndex on each retry changes nothing. The
//      retry also listened for COMMITS, and a preview settled in the wrong
//      place has stopped re-rendering, so it fired once or twice and then
//      waited forever. Driving it on frames instead gives it real attempts
//      and still does not help, because the map it consults never improves.
//   2. Populating the line estimates alone changes nothing either.
//      react-virtual caches the measurements it computed from the old
//      estimates, and improving what estimateSize returns does not invalidate
//      that cache. `virtualizer.measure()` is what makes it ask again -- that
//      single call is what moved the preview from 8% to 44%.
//
// Usage: node scripts/perf/verifyModeToggleRoundTrip.mjs
import { chromium } from 'playwright'
import { startDevServer, waitForAppReady, ensureEditMode, generateSyntheticDocument } from './perfHarness.mjs'

const PORT = 5247
// A block in this synthetic document is ~37 lines at 26px. Two of them is
// the outer edge of "landed on a block boundary near where it left".
const APPROX_BLOCK_HEIGHT_PX = 960
const TOLERANCE_BLOCKS = 2

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const readState = (page) => page.evaluate(() => {
  const cm = document.querySelector('.cm-scroller')
  const pv = document.querySelector('.markdown-preview')
  return {
    editTop: cm ? Math.round(cm.scrollTop) : null,
    editMax: cm ? Math.round(cm.scrollHeight - cm.clientHeight) : null,
    previewTop: pv ? Math.round(pv.scrollTop) : null,
  }
})

const main = async () => {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await waitForAppReady(page)
    const documentText = generateSyntheticDocument(200000)
    const totalSourceLines = documentText.split('\n').length
    await page.evaluate(async (text) => {
      const note = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, documentText)
    await page.reload()
    await waitForAppReady(page)
    await ensureEditMode(page)
    await page.waitForTimeout(5000)

    const toggle = page.getByRole('button', { name: /Switch to/ })

    const track = await page.locator('.thockdown-scroll-track').boundingBox()
    await page.mouse.click(track.x + track.width / 2, track.y + track.height * 0.45, { delay: 0 })
    await page.waitForTimeout(4000)

    const textPoint = await page.evaluate(() => {
      const el = document.querySelector('.cm-scroller')
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
    await page.mouse.click(textPoint.x, textPoint.y, { delay: 90 })
    await page.waitForTimeout(1200)
    const before = await readState(page)
    console.log(`left edit mode at ${before.editTop}px of ${before.editMax}px`)

    await toggle.first().click()
    await page.waitForTimeout(2500)
    const inRender = await readState(page)
    // The preview should be somewhere comparable, as a fraction of the
    // DOCUMENT, to where edit was. Read from the source line of the first
    // block showing at the pane's top, not from the pane's scrollTop: a note
    // this size is windowed in render view (previewWindow.ts), so its scroller
    // holds only the mounted run and a fraction of its scroll range says
    // nothing about where in the document the reader is. Generous on purpose:
    // this is here to catch "landed near the top", not to police a few percent.
    const editFraction = before.editMax > 0 ? before.editTop / before.editMax : 0
    const previewTopLine = await page.evaluate(() => {
      const pv = document.querySelector('.markdown-preview')
      if (!pv) return null
      const top = pv.getBoundingClientRect().top
      const first = [...pv.querySelectorAll('[data-source-line-start]')]
        .find((el) => el.getBoundingClientRect().bottom > top)
      return first ? Number(first.getAttribute('data-source-line-start')) : null
    })
    const previewFraction = previewTopLine === null ? 0 : previewTopLine / totalSourceLines
    check('entering render view lands near where edit was',
      Math.abs(previewFraction - editFraction) < 0.15,
      `edit at ${(editFraction * 100).toFixed(1)}%, preview at ${(previewFraction * 100).toFixed(1)}%`)

    await toggle.first().click()
    await page.waitForTimeout(2500)
    const back = await readState(page)
    // Tolerance in BLOCKS, not pixels, because a block is the unit the
    // position is stored in: the note remembers which block the reader was
    // on, never a pixel offset, so a round trip legitimately lands at a
    // block boundary rather than exactly where it left. Anything inside a
    // couple of blocks is that design working; the failure this file exists
    // for was 26,208px, which is twenty-seven of them.
    const driftPx = back.editTop - before.editTop
    check('toggling back returns to within a block or two of where edit was',
      Math.abs(driftPx) <= TOLERANCE_BLOCKS * APPROX_BLOCK_HEIGHT_PX,
      `${before.editTop}px -> ${back.editTop}px, drift ${driftPx}px (${(Math.abs(driftPx) / APPROX_BLOCK_HEIGHT_PX).toFixed(1)} blocks)`)

    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(1200)
    const afterArrow = await readState(page)
    // The caret comes back where it was. This used to be REPORTED rather than
    // checked because it was intermittent -- and the intermittency was render
    // view's landing: when it failed (the split not yet arrived), render view
    // never moved and edit was simply shown again; when it succeeded, the
    // landing's own scroll was misread as the reader moving (the line asked
    // for against the block line read back), and the trip back rebuilt edit
    // from render view with its caret-at-the-end fallback. Both are fixed, so
    // this asserts. A caret thrown to the document end also drags the view
    // there on ArrowUp, which is what this measures.
    const caretDriftPx = afterArrow.editTop - before.editTop
    check('the caret comes back on the line it left',
      Math.abs(caretDriftPx) <= TOLERANCE_BLOCKS * APPROX_BLOCK_HEIGHT_PX,
      `ArrowUp from the restored caret shows ${afterArrow.editTop}px of ${afterArrow.editMax}px, left at ${before.editTop}px`)

    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  } finally {
    await browser.close()
    server.stop()
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed -- see this file's header; the first failure is the cause of the rest`)
    process.exit(1)
  }
  console.log('\nall checks passed')
}

main().catch((err) => { console.error(err); process.exit(1) })
