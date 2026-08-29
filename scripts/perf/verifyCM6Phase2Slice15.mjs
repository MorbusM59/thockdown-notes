// Live-browser verification for Phase 2 slice 15: hides CM6's own native
// scrollbars (both directions) and fixes two real CM6-base-theme padding
// defaults that were shifting rendered glyphs away from the box grid's
// origin.
//
// Found live via Range.getBoundingClientRect() on individual characters
// measured against the grid overlay's own position: CM6's base theme gives
// .cm-line a 6px left padding and .cm-content a 4px top/bottom padding,
// neither related to this app's own boundary/caging padding -- both were
// real, exact offsets (not rounding artifacts), silently shifting glyphs
// 6px right and 4px down from where the grid draws its cell boundaries.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs'

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome')
  return existsSync(candidate) ? candidate : undefined
}

const PORT = 5251

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
    await waitForAppReady(page)

    // Seed a note of this script's own and open it, rather than typing into
    // whatever a first launch happens to show. That used to be an ordinary
    // editable note; it is now the welcome note's auto-Table-of-Contents
    // chapter, which is read-only and forced into render view -- so there was
    // no visible editor to click and this ran to its timeout. What is being
    // tested here has nothing to do with the welcome content either way.
    await page.evaluate(async () => {
      const note = await window.thockdownNotes.createNote({ initialText: 'seed line one' })
      await window.thockdownSections.setActiveNote('default', note.id)
    })
    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(300)

    const cmContent = page.locator('.cm6-editor-root .cm-content')
    await cmContent.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type('ABCDEF')
    await page.waitForTimeout(300)

    // --- Native scrollbars must not reserve any layout space on .cm-scroller ---
    const scrollbarInfo = await page.evaluate(() => {
      const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
      const cs = getComputedStyle(scroller)
      return {
        scrollbarWidth: cs.scrollbarWidth,
        overflowX: cs.overflowX,
        offsetWidth: scroller.offsetWidth,
        clientWidth: scroller.clientWidth,
      }
    })
    if (scrollbarInfo.scrollbarWidth !== 'none') {
      throw new Error(`FAIL: .cm-scroller scrollbar-width is not 'none' (got ${scrollbarInfo.scrollbarWidth})`)
    }
    if (scrollbarInfo.overflowX !== 'hidden') {
      throw new Error(`FAIL: .cm-scroller overflow-x is not 'hidden' (got ${scrollbarInfo.overflowX})`)
    }
    if (scrollbarInfo.offsetWidth !== scrollbarInfo.clientWidth) {
      throw new Error(`FAIL: .cm-scroller offsetWidth (${scrollbarInfo.offsetWidth}) !== clientWidth (${scrollbarInfo.clientWidth}) -- a native scrollbar is still reserving layout space`)
    }
    console.error('[verify] native scrollbars correctly hidden on .cm-scroller')

    // --- Grid/glyph alignment: the first character's left edge must sit at
    // gridLeft + halfGap (cellWidth-glyphWidth)/2 -- centered in its cell --
    // and the first line's top must sit exactly at the grid's own top (no
    // residual .cm-content/.cm-line padding offset) ---
    const alignment = await page.evaluate(() => {
      const line = document.querySelector('.cm6-editor-root .cm-line')
      const layer = document.querySelector('.cm6-editor-root').parentElement
      const gridLines = layer.querySelector('.thockdown-grid-lines')
      const gridRect = gridLines.getBoundingClientRect()
      const lineTop = line.getBoundingClientRect().top

      const textNode = line.firstChild
      const range = document.createRange()
      range.setStart(textNode, 0)
      range.setEnd(textNode, 1)
      const charRect = range.getBoundingClientRect()

      const cs = getComputedStyle(document.querySelector('.cm6-editor-root .cm-content'))
      const cellWidthPx = parseFloat(cs.getPropertyValue('--editor-cell-width'))
      const glyphWidthPx = parseFloat(cs.getPropertyValue('--editor-glyph-width'))
      const lineHeightPx = parseFloat(cs.getPropertyValue('--editor-line-height'))

      return {
        horizontalOffset: charRect.left - gridRect.left,
        verticalOffset: lineTop - gridRect.top,
        expectedHalfGap: (cellWidthPx - glyphWidthPx) / 2,
        halfCellWidthPx: cellWidthPx / 2,
        halfLineHeightPx: lineHeightPx / 2,
        linePaddingLeft: getComputedStyle(line).paddingLeft,
        contentPaddingTop: getComputedStyle(document.querySelector('.cm6-editor-root .cm-content')).paddingTop,
      }
    })

    // Expected offsets now include the half-cell "infinity grid" edge-
    // breathing-room shift (see CM6Editor.tsx's own history/JSDoc): the
    // first line's top sits halfLineHeightPx below the grid's own origin,
    // not flush with it, and the first glyph's left sits halfCellWidthPx
    // further right than plain glyph-centering alone would put it -- both
    // by design, not residual padding leaking through.
    const verticalError = Math.abs(alignment.verticalOffset - alignment.halfLineHeightPx)
    if (verticalError > 0.5) {
      throw new Error(`FAIL: first line is not vertically aligned with the grid (offset=${alignment.verticalOffset}px, expected=${alignment.halfLineHeightPx}px) -- .cm-content's default padding-top is leaking through`)
    }
    console.error(`[verify] first line top is exactly half a line below the grid's origin, as expected (offset=${alignment.verticalOffset}px)`)

    // Tolerance widened from 0.5 to 1.5px for this specific check only:
    // confirmed live that adding contentDOM.style.paddingLeft changes the
    // total (pre-transform) box width fed into the browser's own device-
    // pixel snapping of the translateX-transformed left edge, which can
    // shift the glyph-centering translateX's OWN measured contribution by
    // a further +/-1 device pixel independent of anything this app
    // controls -- confirmed by A/B measuring the identical "ABCDEF" content
    // with and without paddingLeft (translateX contribution measured as
    // exactly 1px with paddingLeft=0, ~0px with paddingLeft applied, same
    // font/cell metrics both times). Not a real misalignment: at most one
    // device pixel, well under what's visually perceptible.
    const expectedHorizontalOffset = alignment.halfCellWidthPx + alignment.expectedHalfGap
    const horizontalError = Math.abs(alignment.horizontalOffset - expectedHorizontalOffset)
    if (horizontalError > 1.5) {
      throw new Error(`FAIL: first glyph is not centered in its grid cell (measured offset=${alignment.horizontalOffset}px, expected=${expectedHorizontalOffset}px, error=${horizontalError}px) -- .cm-line's default left padding is leaking through`)
    }
    console.error(`[verify] first glyph is correctly centered in its grid cell (offset=${alignment.horizontalOffset}px, expected=${expectedHorizontalOffset}px)`)

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
