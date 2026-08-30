// Does a mode toggle put the reader back where they were?
//
// KNOWN FAILING. This reproduces a real, reported defect end to end; it is
// committed as the gate the fix has to pass, not as a passing check.
//
// The reported sequence, which this performs exactly: a scrollbar jump in edit
// mode, a click to set the caret, toggle to render view, toggle back, then
// ArrowUp to reveal where the caret actually is.
//
// What it measures, and what was measured when it was written (200k chars):
//
//   after the jump      edit at 31590px
//   entering render     edit reports source line 429 and carries it over,
//                       but the preview lands on line 75 (previewTop 2607)
//   back in edit        5382px -- 26,208px adrift
//   ArrowUp             slams to the document end, because the caret was
//                       never restored either
//
// The chain is faithful arithmetic on a corrupted input: only the FIRST step
// is wrong. usePreviewMarkdownRendering's scrollPreviewToSourceLine resolves
// the block index correctly and calls virtualizer.scrollToIndex, which does
// not converge on a distant block while heights are still estimates. The
// retry around it (useEditorSectionMount's applyPreviewSourceAnchor ->
// attemptFindAndScroll) then waits for that block's element to mount, which
// in a virtualized preview can only happen if the scroll had arrived -- so it
// spends all ten attempts looking for something that will never appear and
// gives up silently.
//
// Recorded negative result: simply re-issuing the same scrollToIndex on each
// retry does NOT fix it. Tried, measured, reverted. Measurements only improve
// for blocks that mount, and blocks only mount where the scroll reaches, so
// re-asking the same question gets the same answer.
//
// Usage: node scripts/perf/verifyModeToggleRoundTrip.mjs
import { chromium } from 'playwright'
import { startDevServer, waitForAppReady, ensureEditMode, generateSyntheticDocument } from './perfHarness.mjs'

const PORT = 5247
const TOLERANCE_PX = 60

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
    await page.evaluate(async (text) => {
      const note = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, generateSyntheticDocument(200000))
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
    // The preview should be somewhere comparable, as a fraction of its own
    // scrollable range, to where edit was. Generous on purpose: this is here
    // to catch "landed near the top", not to police a few percent.
    const editFraction = before.editMax > 0 ? before.editTop / before.editMax : 0
    const previewMax = await page.evaluate(() => {
      const pv = document.querySelector('.markdown-preview')
      return pv ? Math.round(pv.scrollHeight - pv.clientHeight) : 0
    })
    const previewFraction = previewMax > 0 ? inRender.previewTop / previewMax : 0
    check('entering render view lands near where edit was',
      Math.abs(previewFraction - editFraction) < 0.15,
      `edit at ${(editFraction * 100).toFixed(1)}%, preview at ${(previewFraction * 100).toFixed(1)}%`)

    await toggle.first().click()
    await page.waitForTimeout(2500)
    const back = await readState(page)
    check('toggling back returns to where edit was',
      Math.abs(back.editTop - before.editTop) <= TOLERANCE_PX,
      `${before.editTop}px -> ${back.editTop}px, drift ${back.editTop - before.editTop}px`)

    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(1200)
    const afterArrow = await readState(page)
    const atEnd = afterArrow.editMax > 0 && afterArrow.editTop > afterArrow.editMax * 0.9
    check('the caret survives the round trip', !atEnd,
      `ArrowUp revealed the caret at ${afterArrow.editTop}px of ${afterArrow.editMax}px${atEnd ? ' (the document end -- no cursor was restored)' : ''}`)

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
