// Live-browser verification for Phase 2 slice 7 (cage-quantized wheel
// scroll + PageUp/PageDown paging in CM6Editor). Confirms wheel scroll moves
// in line-height-quantized steps, and that PageUp/PageDown move the
// viewport by roughly a page and land quantized to the line grid.
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

const PORT = 5228

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

    const longText = generateSyntheticDocument(50_000)
    await page.evaluate(async (text) => {
      const note = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, longText)
    await page.reload()
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })
    await page.waitForTimeout(300)

    const readState = () => {
      const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
      const container = document.querySelector('.cm6-editor-root .cm-content')
      // The scroll-quantization math uses the lineHeightPx prop (set as the
      // container's inline CSS lineHeight), not a rendered line's measured
      // rect -- reading the same source of truth the component itself uses.
      const lineHeightPx = container ? parseFloat(getComputedStyle(container).lineHeight) : 0
      return { scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight, lineHeightPx }
    }

    const cmContent = page.locator('.cm6-editor-root .cm-content')
    // .cm-content's own bounding box spans the full (unclipped) document
    // height, not just what's visible -- its midpoint can land outside the
    // real browser viewport on a long document, which silently drops
    // synthetic mouse events. Use .cm-scroller's box (clipped to what's
    // actually on screen) to position the pointer for the wheel gesture.
    const scrollerBox = await page.locator('.cm6-editor-root .cm-scroller').boundingBox()

    // --- Wheel: should move by line-height-quantized steps ---
    const before = await page.evaluate(readState)
    await page.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(200)
    const afterWheel = await page.evaluate(readState)

    if (afterWheel.scrollTop <= before.scrollTop) {
      throw new Error(`FAIL: wheel did not scroll down (before=${before.scrollTop}, after=${afterWheel.scrollTop})`)
    }
    const lineHeightPx = afterWheel.lineHeightPx
    if (lineHeightPx <= 0) throw new Error('FAIL: could not measure line height')
    const remainder = afterWheel.scrollTop % lineHeightPx
    const quantizationError = Math.min(remainder, lineHeightPx - remainder)
    if (quantizationError > 0.5) {
      throw new Error(`FAIL: wheel scroll not quantized to line grid (scrollTop=${afterWheel.scrollTop}, lineHeightPx=${lineHeightPx}, error=${quantizationError})`)
    }
    console.error(`[verify] wheel scrolled from ${before.scrollTop} to ${afterWheel.scrollTop}, quantized to line grid`)

    // --- PageDown: should move by roughly a page, quantized ---
    await cmContent.click()
    const beforePage = await page.evaluate(readState)
    await page.keyboard.press('PageDown')
    await page.waitForTimeout(600) // let the quantized-smooth-scroll animation settle
    const afterPageDown = await page.evaluate(readState)

    if (afterPageDown.scrollTop <= beforePage.scrollTop) {
      throw new Error(`FAIL: PageDown did not scroll down (before=${beforePage.scrollTop}, after=${afterPageDown.scrollTop})`)
    }
    const pageDelta = afterPageDown.scrollTop - beforePage.scrollTop
    const expectedMinDelta = beforePage.clientHeight * 0.5 // generous lower bound -- exact row count depends on boundary math
    if (pageDelta < expectedMinDelta) {
      throw new Error(`FAIL: PageDown moved too little to be a real page (delta=${pageDelta}, clientHeight=${beforePage.clientHeight})`)
    }
    const pageRemainder = afterPageDown.scrollTop % lineHeightPx
    const pageQuantizationError = Math.min(pageRemainder, lineHeightPx - pageRemainder)
    if (pageQuantizationError > 0.5) {
      throw new Error(`FAIL: PageDown landing not quantized to line grid (scrollTop=${afterPageDown.scrollTop}, error=${pageQuantizationError})`)
    }
    console.error(`[verify] PageDown scrolled from ${beforePage.scrollTop} to ${afterPageDown.scrollTop} (delta=${pageDelta}), quantized to line grid`)

    // --- PageUp: should move back up ---
    const beforePageUp = await page.evaluate(readState)
    await page.keyboard.press('PageUp')
    await page.waitForTimeout(600)
    const afterPageUp = await page.evaluate(readState)
    if (afterPageUp.scrollTop >= beforePageUp.scrollTop) {
      throw new Error(`FAIL: PageUp did not scroll up (before=${beforePageUp.scrollTop}, after=${afterPageUp.scrollTop})`)
    }
    console.error(`[verify] PageUp scrolled from ${beforePageUp.scrollTop} to ${afterPageUp.scrollTop}`)

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
