// Live-browser verification for Phase 2 slice 10 (drag-selection scroll
// quantization in CM6Editor). Native drag-to-select auto-scroll moves
// scrollTop by sub-pixel amounts each frame; this slice snaps it back onto
// the line-height grid one frame behind the native scroll so it doesn't
// fight the gesture. Confirms: a mouse-down-drag-past-the-bottom-edge
// gesture ends with a selection made AND a grid-quantized final scrollTop.
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

const PORT = 5236

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

    const scrollerBox = await page.locator('.cm6-editor-root .cm-scroller').boundingBox()

    // Mouse down near the top, drag down to and past the bottom edge
    // repeatedly to trigger native browser drag-to-select auto-scroll.
    await page.mouse.move(scrollerBox.x + 50, scrollerBox.y + 20)
    await page.mouse.down()
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(scrollerBox.x + 50, scrollerBox.y + scrollerBox.height - 2, { steps: 1 })
      await page.waitForTimeout(50)
    }
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(200)

    const result = await page.evaluate(() => {
      const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
      const container = document.querySelector('.cm6-editor-root')
      const lineHeightPx = parseFloat(getComputedStyle(container).lineHeight)
      const sel = window.getSelection()
      return {
        scrollTop: scroller.scrollTop,
        lineHeightPx,
        hasSelection: !!sel && !sel.isCollapsed,
      }
    })

    if (result.scrollTop <= 0) {
      throw new Error(`FAIL: drag past the bottom edge did not auto-scroll (scrollTop=${result.scrollTop})`)
    }
    if (!result.hasSelection) {
      throw new Error('FAIL: drag gesture did not produce a text selection')
    }
    const remainder = result.scrollTop % result.lineHeightPx
    const quantizationError = Math.min(remainder, result.lineHeightPx - remainder)
    if (quantizationError > 0.5) {
      throw new Error(`FAIL: post-drag scroll position not quantized to line grid (scrollTop=${result.scrollTop}, lineHeightPx=${result.lineHeightPx}, error=${quantizationError})`)
    }
    console.error(`[verify] drag-select auto-scrolled to scrollTop=${result.scrollTop} (quantized), selection made`)

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
