// Live-browser verification for Phase 2 slice 12 (CM6Editor's grid
// font-metric CSS custom properties): confirms --editor-font/--editor-
// font-size/--editor-line-height/--editor-glyph-width/--editor-cell-width
// are set from the real runtime props (not left at :root's hardcoded
// defaults), and that .editor-text's letter-spacing grid-alignment trick
// resolves against the real cell/glyph widths.
//
// This guards a real bug found live during this slice: CM6Editor previously
// set fontFamily/fontSize/lineHeight as plain inline style on .cm6-editor-root
// (an ancestor of .cm-content), which does nothing for actual text rendering
// -- .editor-text's own CSS rule (font-family/size/line-height driven by
// var(--editor-*)) always wins over inherited values regardless of what an
// ancestor sets inline. Without these vars, text silently rendered at
// :root's fallback metrics (10px cell width, 8px glyph width, a different
// font) instead of the real measured runtime values -- invisible only when
// those happened to coincide, a real text/grid misalignment the moment they
// didn't.
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

const PORT = 5241

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
    await page.waitForTimeout(300)

    const metrics = await page.evaluate(() => {
      const content = document.querySelector('.cm6-editor-root .cm-content')
      const layer = document.querySelector('.cm6-editor-root').parentElement
      const contentStyle = getComputedStyle(content)
      return {
        letterSpacingPx: parseFloat(contentStyle.letterSpacing),
        contentCellWidthVarPx: parseFloat(contentStyle.getPropertyValue('--editor-cell-width')),
        layerGlyphWidthVarPx: parseFloat(getComputedStyle(layer).getPropertyValue('--editor-glyph-width')),
        layerCellWidthVarPx: parseFloat(getComputedStyle(layer).getPropertyValue('--editor-cell-width')),
        fontFamily: contentStyle.fontFamily,
      }
    })

    // The var must actually be set on an ancestor (not silently falling back
    // to :root's hardcoded 10px) -- checked structurally, not by comparing
    // to a hardcoded expected pixel value, since the real measured cell
    // width varies by font/OS and shouldn't be hardcoded into this check.
    if (!Number.isFinite(metrics.layerCellWidthVarPx) || metrics.layerCellWidthVarPx <= 0) {
      throw new Error(`FAIL: --editor-cell-width not set on the layer ancestor (got ${metrics.layerCellWidthVarPx})`)
    }
    // .cm-content must see the SAME value as the layer that set it (inherited
    // correctly down through .cm6-editor-root/.cm-editor/.cm-scroller).
    if (Math.abs(metrics.contentCellWidthVarPx - metrics.layerCellWidthVarPx) > 0.01) {
      throw new Error(`FAIL: .cm-content sees a different --editor-cell-width than its ancestor set (layer=${metrics.layerCellWidthVarPx}, content=${metrics.contentCellWidthVarPx})`)
    }
    console.error(`[verify] --editor-cell-width correctly inherited down to .cm-content: ${metrics.contentCellWidthVarPx}px`)

    // The letter-spacing grid-alignment trick (index.css's .editor-text rule:
    // letter-spacing: calc(var(--editor-cell-width) - var(--editor-glyph-width)))
    // must resolve against these SAME real values, not :root's defaults.
    const expectedLetterSpacing = metrics.layerCellWidthVarPx - metrics.layerGlyphWidthVarPx;
    if (Math.abs(metrics.letterSpacingPx - expectedLetterSpacing) > 0.5) {
      throw new Error(`FAIL: letter-spacing (${metrics.letterSpacingPx}px) doesn't match cellWidth-glyphWidth (${expectedLetterSpacing}px) -- grid-alignment CSS is not using the real runtime metrics`)
    }
    console.error(`[verify] letter-spacing correctly resolves to cellWidth-glyphWidth (${metrics.letterSpacingPx}px)`)

    // Typing must still work and render legibly (basic sanity check that
    // this CSS change didn't break rendering).
    const cmContent = page.locator('.cm6-editor-root .cm-content')
    await cmContent.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type('grid metrics sanity check')
    await page.waitForTimeout(200)
    const text = await page.evaluate(() => document.querySelector('.cm6-editor-root .cm-content').textContent)
    if (!text.includes('grid metrics sanity check')) {
      throw new Error(`FAIL: typed text not present after CSS metrics change. Got: ${JSON.stringify(text)}`)
    }
    console.error('[verify] typing still works correctly')

    // Caret must render ABOVE the text in stacking order is NOT what we
    // want -- text should paint over the (semi-transparent) caret/selection
    // fills, matching Editor.tsx's own z-index design. Confirm the CM6
    // container's z-index is numerically above the caret/selection overlays.
    const zOrder = await page.evaluate(() => {
      const container = document.querySelector('.cm6-editor-root')
      const caret = document.querySelector('.thockdown-block-caret')
      return {
        containerZ: parseInt(getComputedStyle(container).zIndex, 10),
        caretZ: caret ? parseInt(getComputedStyle(caret).zIndex, 10) : null,
      }
    })
    if (!(zOrder.containerZ > (zOrder.caretZ ?? -Infinity))) {
      throw new Error(`FAIL: CM6 text container's z-index (${zOrder.containerZ}) is not above the caret's (${zOrder.caretZ}) -- text would render behind the caret instead of over it`)
    }
    console.error(`[verify] z-index ordering correct: text container (${zOrder.containerZ}) above caret (${zOrder.caretZ})`)

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
