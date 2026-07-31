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
import { startDevServer } from './perfHarness.mjs'

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
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })

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

      return {
        horizontalOffset: charRect.left - gridRect.left,
        verticalOffset: lineTop - gridRect.top,
        expectedHalfGap: (cellWidthPx - glyphWidthPx) / 2,
        linePaddingLeft: getComputedStyle(line).paddingLeft,
        contentPaddingTop: getComputedStyle(document.querySelector('.cm6-editor-root .cm-content')).paddingTop,
      }
    })

    if (Math.abs(alignment.verticalOffset) > 0.5) {
      throw new Error(`FAIL: first line is not vertically aligned with the grid (offset=${alignment.verticalOffset}px) -- .cm-content's default padding-top is leaking through`)
    }
    console.error('[verify] first line top is exactly flush with the grid (no residual .cm-content padding)')

    const horizontalError = Math.abs(alignment.horizontalOffset - alignment.expectedHalfGap)
    if (horizontalError > 0.5) {
      throw new Error(`FAIL: first glyph is not centered in its grid cell (measured offset=${alignment.horizontalOffset}px, expected half-gap=${alignment.expectedHalfGap}px, error=${horizontalError}px) -- .cm-line's default left padding is leaking through`)
    }
    console.error(`[verify] first glyph is correctly centered in its grid cell (offset=${alignment.horizontalOffset}px, expected=${alignment.expectedHalfGap}px)`)

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
