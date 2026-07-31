// Live-browser verification for Phase 2 slice 18: scrolling all the way to
// the end of a note must not break grid/line alignment.
//
// Root cause: the DOM's own natural max scrollTop is
// `scrollHeight - clientHeight`. scrollHeight is always an exact multiple
// of lineHeightPx (every line and boundary is), but clientHeight is
// whatever arbitrary pixel height the window/pane happens to be --
// essentially never itself a multiple of lineHeightPx. So the natural
// max-scroll lands on a non-grid-aligned value, and reaching it (wheel
// scrolling past the end, dragging the custom scrollbar thumb to the
// bottom, drag-select auto-scroll, Ctrl+End, PageDown) visibly broke the
// fixed grid overlay's alignment with the now off-grid last rows -- by up
// to lineHeightPx-1 px. Fixed by padding the bottom of the content by
// exactly (clientHeight mod lineHeightPx), so the DOM's OWN natural
// max-scroll already lands on a grid-quantized value -- every other piece
// of this file's scroll math reads scrollHeight/clientHeight fresh from the
// DOM rather than caching it, so all of it inherits the fix for free.
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

const PORT = 5273

async function measureGridAlignment(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
    const layer = document.querySelector('.cm6-editor-root').parentElement
    const gridLines = layer.querySelector('.thockdown-grid-lines')
    const gridRect = gridLines.getBoundingClientRect()
    const cs = getComputedStyle(document.querySelector('.cm6-editor-root .cm-content'))
    const lineHeightVar = parseFloat(cs.getPropertyValue('--editor-line-height'))
    const lines = Array.from(document.querySelectorAll('.cm6-editor-root .cm-line'))
    const errors = lines.map((line) => {
      // Fixed (non-scrolling) grid vs. the line's own viewport position --
      // the actual visual alignment check, not a scroll-relative one.
      const viewportRelativeTop = line.getBoundingClientRect().top - gridRect.top
      const remainder = viewportRelativeTop % lineHeightVar
      return Math.min(Math.abs(remainder), Math.abs(lineHeightVar - remainder))
    })
    return {
      maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
      maxScrollTopMod: (scroller.scrollHeight - scroller.clientHeight) % lineHeightVar,
      maxErr: Math.max(...errors, 0),
    }
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

    const longText = generateSyntheticDocument(50_000)
    await page.evaluate(async (text) => {
      const note = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, longText)
    await page.reload()
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })
    await page.waitForTimeout(400)

    // The DOM's own natural max scroll must itself be grid-quantized --
    // the root fix every other check below depends on.
    const atTop = await measureGridAlignment(page)
    if (atTop.maxScrollTopMod > 0.5) {
      throw new Error(`FAIL: the scroller's natural max scrollTop is not grid-quantized (remainder=${atTop.maxScrollTopMod}px) -- the alignment padding fix regressed`)
    }
    console.error(`[verify] natural max scrollTop is grid-quantized (maxScrollTop=${atTop.maxScrollTop})`)

    // --- Wheel scroll far past the end ---
    const scrollerBox = await page.locator('.cm6-editor-root .cm-scroller').boundingBox()
    await page.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2)
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, 2000)
    }
    await page.waitForTimeout(400)
    const afterWheel = await measureGridAlignment(page)
    if (afterWheel.maxErr > 0.5) throw new Error(`FAIL: grid misaligned after wheel-scrolling past the end (error=${afterWheel.maxErr}px)`)
    console.error('[verify] grid alignment holds after wheel-scrolling past the end')

    // --- Ctrl+End / PageDown to the end ---
    await page.evaluate(() => { document.querySelector('.cm6-editor-root .cm-scroller').scrollTop = 0 })
    await page.waitForTimeout(300)
    const cmContent = page.locator('.cm6-editor-root .cm-content')
    await cmContent.click()
    await page.keyboard.press('Control+End')
    await page.waitForTimeout(300)
    const afterCtrlEnd = await measureGridAlignment(page)
    if (afterCtrlEnd.maxErr > 0.5) throw new Error(`FAIL: grid misaligned after Ctrl+End (error=${afterCtrlEnd.maxErr}px)`)
    console.error('[verify] grid alignment holds after Ctrl+End')

    // --- Dragging the custom scrollbar thumb to the very bottom ---
    await page.evaluate(() => { document.querySelector('.cm6-editor-root .cm-scroller').scrollTop = 0 })
    await page.waitForTimeout(300)
    const thumbBox = await page.locator('.thockdown-scroll-thumb').boundingBox()
    const trackBox = await page.locator('.thockdown-scroll-track').boundingBox()
    await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(thumbBox.x + thumbBox.width / 2, trackBox.y + trackBox.height + 50, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const afterThumbDrag = await measureGridAlignment(page)
    if (afterThumbDrag.maxErr > 0.5) throw new Error(`FAIL: grid misaligned after dragging the scrollbar thumb to the bottom (error=${afterThumbDrag.maxErr}px)`)
    console.error('[verify] grid alignment holds after dragging the scrollbar thumb to the bottom')

    // --- Drag-select past the bottom edge (native auto-scroll) ---
    await page.evaluate(() => { document.querySelector('.cm6-editor-root .cm-scroller').scrollTop = 0 })
    await page.waitForTimeout(300)
    await page.mouse.move(scrollerBox.x + 50, scrollerBox.y + 20)
    await page.mouse.down()
    for (let i = 0; i < 60; i++) {
      await page.mouse.move(scrollerBox.x + 50, scrollerBox.y + scrollerBox.height - 2, { steps: 1 })
      await page.waitForTimeout(30)
    }
    await page.mouse.move(scrollerBox.x + 50, scrollerBox.y + scrollerBox.height / 2, { steps: 5 })
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(300)
    const afterDragSelect = await measureGridAlignment(page)
    if (afterDragSelect.maxErr > 0.5) throw new Error(`FAIL: grid misaligned after drag-select auto-scroll toward the bottom (error=${afterDragSelect.maxErr}px)`)
    console.error('[verify] grid alignment holds after drag-select auto-scroll')

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
