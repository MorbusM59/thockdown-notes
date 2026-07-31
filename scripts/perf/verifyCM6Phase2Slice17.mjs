// Live-browser verification for Phase 2 slice 17: changing the y-box
// (line-height multiplier) slider while scrolled into a large (virtualized)
// document must not leave the visible lines PERSISTENTLY misaligned with
// the grid -- self-correcting on its own within a frame or two, not
// requiring the user to scroll to fix it.
//
// Found live via a tight polling loop across a real line-height integer
// transition (26px -> 27px, scrolled to the middle of a 200,000-character
// document): scrollHeight grew (CM6's own layout reflowed to the new line
// height) measurably before scrollTop was adjusted to preserve the same
// visual scroll position. Without an explicit nudge, the mismatch was
// still fully present up to 900ms later with no sign of resolving on its
// own -- exactly "upon scrolling, text snaps back into the correct
// position... it's really a text update issue" as reported. Fixed with
// view.requestMeasure() in the same effect that reacts to lineHeightPx/
// cellWidthPx changes, forcing CM6 to settle its own reflow and whatever
// scroll-position preservation it does across one immediately rather than
// on its own unforced schedule.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, generateSyntheticDocument } from './perfHarness.mjs'

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome')
  return existsSync(candidate) ? candidate : undefined
}

const PORT = 5263

async function measureMaxGridLineError(page) {
  return page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm6-editor-root .cm-line'))
    const layer = document.querySelector('.cm6-editor-root').parentElement
    const gridLines = layer.querySelector('.thockdown-grid-lines')
    const gridRect = gridLines.getBoundingClientRect()
    const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
    const cs = getComputedStyle(document.querySelector('.cm6-editor-root .cm-content'))
    const lineHeightVar = parseFloat(cs.getPropertyValue('--editor-line-height'))
    const scrollTop = scroller.scrollTop
    const errors = lines.map((line) => {
      const topInScroll = line.getBoundingClientRect().top - gridRect.top + scrollTop
      const remainder = topInScroll % lineHeightVar
      return Math.min(remainder, lineHeightVar - remainder)
    })
    return { lineHeightVar, maxErr: Math.max(...errors, 0) }
  })
}

async function main() {
  console.error('[verify] starting dev server...')
  const server = await startDevServer(PORT)
  let browser
  const consoleErrors = []
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))
    await page.addInitScript(() => window.localStorage.setItem('thockdown:cm6-editor-spike', '1'))
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })

    // Large enough to force CM6's own viewport virtualization -- the bug
    // only manifests when scrolled into a document where CM6 has to
    // reconcile scrollTop/scrollHeight against skipped-over content above
    // the viewport, not on a short, fully-rendered document.
    const longText = generateSyntheticDocument(200_000)
    await page.evaluate(async (text) => {
      const note = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, longText)
    await page.reload()
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })
    await page.waitForTimeout(400)

    await page.evaluate(() => {
      const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
      scroller.scrollTop = scroller.scrollHeight / 2
    })
    await page.waitForTimeout(300)

    const before = await measureMaxGridLineError(page)
    if (before.maxErr > 0.5) throw new Error(`FAIL: grid/line misalignment before any change (lineHeight=${before.lineHeightVar}, error=${before.maxErr})`)
    console.error(`[verify] grid/line alignment correct before any change (lineHeight=${before.lineHeightVar})`)

    // Drive the exact 26px -> 27px transition (default font size 16, default
    // spacing 1.6 -> two 0.05 steps lands at 1.7, i.e. round(16*1.7) = 27).
    await page.click('[aria-label="View options"]')
    await page.waitForTimeout(300)
    const spacingSlider = page.locator('#typography-spacing')
    await spacingSlider.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')

    // No explicit scroll anywhere below -- the fix must make this settle on
    // its own. 300ms is generous (the observed self-correction lands within
    // a single frame, ~16-30ms); the pre-fix bug did NOT resolve even after
    // 900ms of polling with no scroll.
    await page.waitForTimeout(300)

    const after = await measureMaxGridLineError(page)
    if (after.lineHeightVar === before.lineHeightVar) {
      throw new Error(`FAIL: the y-box slider did not actually change the line height (still ${after.lineHeightVar}) -- test setup is wrong, not a product bug`)
    }
    if (after.maxErr > 0.5) {
      throw new Error(`FAIL: grid/line misalignment persists ${after.lineHeightVar - before.lineHeightVar > 0 ? 'after' : 'around'} the line-height change (${before.lineHeightVar} -> ${after.lineHeightVar}) with no scroll to correct it: max error ${after.maxErr}px`)
    }
    console.error(`[verify] grid/line alignment self-corrected after the y-box change (${before.lineHeightVar} -> ${after.lineHeightVar}) with no scroll needed: max error ${after.maxErr}px`)

    if (consoleErrors.length > 0) {
      console.error('[verify] console errors:')
      for (const err of consoleErrors) console.error('  ' + err)
      throw new Error(`${consoleErrors.length} console error(s)`)
    }
    console.error('[verify] ALL PASS -- no console errors.')
  } finally {
    await browser?.close()
    server.stop()
  }
}

main().catch((err) => {
  console.error('[verify] FAIL:', err)
  process.exitCode = 1
})
