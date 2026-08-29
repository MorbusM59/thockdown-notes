// Live-browser verification for Phase 2 slice 16: the native OS caret must
// stay hidden (this app draws its own block caret), and the box grid must
// stay pixel-perfectly aligned with rendered text across the FULL range of
// the font-size and line-height-multiplier ("y-box") settings, not just the
// defaults -- a real bug (CM6's base theme's own caret-color rule, scoped
// to a higher-specificity selector than .editor-text) and a real regression
// class (fixed-pixel padding defaults that are more visually obvious at
// small line-heights) were both found live during this slice's own
// development.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, generateSyntheticDocument, waitForAppReady, ensureEditMode } from './perfHarness.mjs'

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome')
  return existsSync(candidate) ? candidate : undefined
}

const PORT = 5258

async function measureMaxGridLineError(page) {
  return page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm6-editor-root .cm-line'))
    const layer = document.querySelector('.cm6-editor-root').parentElement
    const gridLines = layer.querySelector('.thockdown-grid-lines')
    const gridRect = gridLines.getBoundingClientRect()
    // The grid's own vertical phase (backgroundPosition-y) -- since the
    // "infinity grid" edge-breathing-room shift, this is halfLineHeightPx,
    // not 0, so a line's real row boundary no longer falls at a plain
    // multiple of lineHeightVar from gridRect.top; it falls at
    // (gridY + n*lineHeightVar).
    const gridY = parseFloat(getComputedStyle(gridLines).backgroundPosition.split(' ')[1])
    const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
    const cs = getComputedStyle(document.querySelector('.cm6-editor-root .cm-content'))
    const lineHeightVar = parseFloat(cs.getPropertyValue('--editor-line-height'))
    const scrollTop = scroller.scrollTop
    const errors = lines.map((line) => {
      const topInScroll = line.getBoundingClientRect().top - gridRect.top + scrollTop
      const remainder = ((topInScroll - gridY) % lineHeightVar + lineHeightVar) % lineHeightVar
      return Math.min(remainder, lineHeightVar - remainder)
    })
    return Math.max(...errors, 0)
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
    await waitForAppReady(page)

    const longText = generateSyntheticDocument(20_000)
    await page.evaluate(async (text) => {
      const note = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, longText)
    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(400)

    // --- Native caret must be hidden -- this app draws its own block caret ---
    const cmContent = page.locator('.cm6-editor-root .cm-content');
    await cmContent.click();
    const caretColor = await page.evaluate(() => getComputedStyle(document.querySelector('.cm6-editor-root .cm-content')).caretColor)
    // Transparent computes as rgba(r, g, b, 0) -- any other alpha (typically
    // 1, from CM6's own base theme's `.ͼN .cm-content { caret-color: black }`
    // / `{ caret-color: white }` for dark mode) means the native caret shows.
    const alpha = Number(caretColor.match(/[\d.]+/g)?.at(-1))
    if (alpha !== 0) {
      throw new Error(`FAIL: .cm-content's caret-color is not transparent (got ${caretColor}) -- the native OS caret is showing through`)
    }
    console.error(`[verify] native caret correctly hidden (caret-color: ${caretColor})`)

    // --- Grid/line alignment must hold at the extremes of font size and
    // line-height multiplier ("y-box"), not just the defaults ---
    await page.click('[aria-label="View options"]')
    await page.waitForTimeout(300)

    const fontSizeSlider = page.locator('#typography-font-size')
    await fontSizeSlider.focus()
    await page.keyboard.press('End') // jumps to max, per CompactScrollbarSlider's own Home/End handling
    await page.waitForTimeout(300)
    const fontSizeNow = await fontSizeSlider.getAttribute('aria-valuenow')

    const errAtMaxFontSize = await measureMaxGridLineError(page)
    if (errAtMaxFontSize > 0.5) {
      throw new Error(`FAIL: grid/line misalignment at max font size (${fontSizeNow}px): max error ${errAtMaxFontSize}px`)
    }
    console.error(`[verify] grid/line alignment holds at max font size (${fontSizeNow}px): max error ${errAtMaxFontSize}px`)

    const spacingSlider = page.locator('#typography-spacing')
    await spacingSlider.focus()
    await page.keyboard.press('Home') // jumps to min
    await page.waitForTimeout(300)
    const spacingNow = await spacingSlider.getAttribute('aria-valuenow')

    const errAtMinSpacing = await measureMaxGridLineError(page)
    if (errAtMinSpacing > 0.5) {
      throw new Error(`FAIL: grid/line misalignment at min spacing (${spacingNow}x): max error ${errAtMinSpacing}px`)
    }
    console.error(`[verify] grid/line alignment holds at min spacing (${spacingNow}x): max error ${errAtMinSpacing}px`)

    // Also check after scrolling, at this same extreme setting combination --
    // scrolling shouldn't introduce drift since it's always row-quantized.
    await page.evaluate(() => { document.querySelector('.cm6-editor-root .cm-scroller').scrollTop = 3000 })
    await page.waitForTimeout(300)
    const errAfterScroll = await measureMaxGridLineError(page)
    if (errAfterScroll > 0.5) {
      throw new Error(`FAIL: grid/line misalignment after scrolling at extreme settings: max error ${errAfterScroll}px`)
    }
    console.error(`[verify] grid/line alignment holds after scrolling at extreme settings: max error ${errAfterScroll}px`)

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
