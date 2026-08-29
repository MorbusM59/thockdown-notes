// Live-browser verification for Phase 2 slice 13 (background box-grid
// lines ported to CM6Editor: thockdown-grid-outline-lines / thockdown-
// grid-lines, same classes and CSS as Editor.tsx, keyed off the real
// --editor-cell-width/--editor-line-height vars fixed in slice 12).
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

const PORT = 5243

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

    const gridInfo = await page.evaluate(() => {
      const layer = document.querySelector('.cm6-editor-root').parentElement
      const outline = layer.querySelector('.thockdown-grid-outline-lines')
      const lines = layer.querySelector('.thockdown-grid-lines')
      if (!outline || !lines) return { found: false }
      const outlineStyle = getComputedStyle(outline)
      const linesStyle = getComputedStyle(lines)
      return {
        found: true,
        outlineHasBackgroundImage: outlineStyle.backgroundImage !== 'none' && outlineStyle.backgroundImage.length > 0,
        linesHasBackgroundImage: linesStyle.backgroundImage !== 'none' && linesStyle.backgroundImage.length > 0,
        outlineZIndex: parseInt(outlineStyle.zIndex, 10),
        linesZIndex: parseInt(linesStyle.zIndex, 10),
        outlinePointerEvents: outlineStyle.pointerEvents,
        linesPointerEvents: linesStyle.pointerEvents,
      }
    })

    if (!gridInfo.found) throw new Error('FAIL: grid line elements (.thockdown-grid-outline-lines / .thockdown-grid-lines) not found')
    if (!gridInfo.outlineHasBackgroundImage) throw new Error('FAIL: .thockdown-grid-outline-lines has no background-image (repeating-linear-gradient) -- grid not rendering')
    if (!gridInfo.linesHasBackgroundImage) throw new Error('FAIL: .thockdown-grid-lines has no background-image -- grid not rendering')
    console.error('[verify] both grid line layers have their repeating-gradient background-image')

    if (gridInfo.outlinePointerEvents !== 'none' || gridInfo.linesPointerEvents !== 'none') {
      throw new Error(`FAIL: grid lines must not intercept pointer events (outline=${gridInfo.outlinePointerEvents}, lines=${gridInfo.linesPointerEvents})`)
    }
    console.error('[verify] grid lines correctly have pointer-events: none')

    // z-index ordering: grid must sit above caret/selection but below the
    // actual text container, matching Editor.tsx's own design (text paints
    // over the grid; the grid paints over caret/selection fills).
    const caretZ = await page.evaluate(() => {
      const caret = document.querySelector('.thockdown-block-caret')
      return caret ? parseInt(getComputedStyle(caret).zIndex, 10) : null
    })
    const containerZ = await page.evaluate(() => parseInt(getComputedStyle(document.querySelector('.cm6-editor-root')).zIndex, 10))

    if (!(gridInfo.outlineZIndex > (caretZ ?? -Infinity)) || !(gridInfo.linesZIndex > (caretZ ?? -Infinity))) {
      throw new Error(`FAIL: grid line z-index (outline=${gridInfo.outlineZIndex}, lines=${gridInfo.linesZIndex}) is not above the caret's (${caretZ})`)
    }
    if (!(containerZ > gridInfo.outlineZIndex) || !(containerZ > gridInfo.linesZIndex)) {
      throw new Error(`FAIL: text container z-index (${containerZ}) is not above the grid lines (outline=${gridInfo.outlineZIndex}, lines=${gridInfo.linesZIndex}) -- text would render behind the grid`)
    }
    console.error(`[verify] z-index ordering correct: text (${containerZ}) > grid lines (${gridInfo.outlineZIndex}/${gridInfo.linesZIndex}) > caret (${caretZ})`)

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
