// Live-browser verification for Phase 2 slice 20: the half-cell edge-
// breathing-room shift (slice 19) must always land on a whole device pixel,
// even when lineHeightPx/cellWidthPx are odd.
//
// Found live: at the default settings (lineHeightPx=26), half is a clean
// 13 -- but bumping the y-box (line-height) slider by two steps lands on
// lineHeightPx=27, an ODD number, whose true half (13.5) is fractional.
// Setting contentDOM.style.paddingTop and the grid overlay's
// backgroundPosition to a fractional pixel value forces the grid's own
// hard color-stop edges to sub-pixel blend, rendering that one line
// visibly wider/blurrier than every other (whole-pixel-positioned) line in
// the same grid -- confirmed via a before/after screenshot pixel scan.
// Fixed by rounding halfCellWidthPx/halfLineHeightPx to the nearest whole
// pixel everywhere they're used (the padding, the grid's backgroundPosition,
// and every phase-aware quantizeToPhase call) -- the shift only needs to be
// "about half a cell" for breathing room, not exactly half, so rounding
// costs nothing.
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

const PORT = 5282

function assertWholePixel(label, cssValue) {
  const value = parseFloat(cssValue)
  if (Math.abs(value - Math.round(value)) > 0.001) {
    throw new Error(`FAIL: ${label} is fractional (${cssValue}) -- will render a visibly blurred grid line`)
  }
}

async function main() {
  console.error('[verify] starting dev server...')
  const server = await startDevServer(PORT)
  let browser
  const consoleErrors = []
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))
    await page.addInitScript(() => window.localStorage.setItem('thockdown:cm6-editor-spike', '1'))
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })

    await page.evaluate(async () => {
      const note = await window.thockdownNotes.createNote({ initialText: '# Title: Ulysses' })
      await window.thockdownSections.setActiveNote('default', note.id)
    })
    await page.reload()
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })
    await page.waitForTimeout(400)

    // Drive to an ODD lineHeightPx (default 16*1.6=25.6 -> round 26, EVEN;
    // two 0.05 steps -> 16*1.7=27.2 -> round 27, ODD -- half is fractional).
    await page.click('[aria-label="View options"]')
    await page.waitForTimeout(300)
    const spacingSlider = page.locator('#typography-spacing')
    await spacingSlider.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)

    const info = await page.evaluate(() => {
      const layer = document.querySelector('.cm6-editor-root').parentElement
      const gridLines = layer.querySelector('.thockdown-grid-lines')
      const gridOutline = layer.querySelector('.thockdown-grid-outline-lines')
      const content = document.querySelector('.cm6-editor-root .cm-content')
      const cs = getComputedStyle(content)
      return {
        lineHeight: cs.getPropertyValue('--editor-line-height'),
        paddingTop: cs.paddingTop,
        paddingLeft: cs.paddingLeft,
        gridPosition: getComputedStyle(gridLines).backgroundPosition,
        outlinePosition: getComputedStyle(gridOutline).backgroundPosition,
      }
    })

    if (parseFloat(info.lineHeight) % 2 === 0) {
      throw new Error(`FAIL: test setup did not reach an odd lineHeightPx (got ${info.lineHeight}) -- can't verify the fractional-rounding fix`)
    }
    console.error(`[verify] reached odd lineHeightPx=${info.lineHeight} (half would be fractional without rounding)`)

    assertWholePixel('contentDOM paddingTop', info.paddingTop)
    assertWholePixel('contentDOM paddingLeft', info.paddingLeft)
    const [gridX, gridY] = info.gridPosition.split(' ')
    assertWholePixel('grid-lines backgroundPosition x', gridX)
    assertWholePixel('grid-lines backgroundPosition y', gridY)
    console.error(`[verify] all half-cell shift offsets are whole pixels (paddingTop=${info.paddingTop}, paddingLeft=${info.paddingLeft}, gridPosition=${info.gridPosition})`)

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
