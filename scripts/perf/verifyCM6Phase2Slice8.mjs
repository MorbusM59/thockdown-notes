// Live-browser verification for Phase 2 slice 8 (keyboard caret-refocus
// caging in CM6Editor: arrows/typing/Enter/Backspace/Delete keep the caret
// inside the visible viewport, scrolled to a line-grid-quantized position).
//
// This guards a real bug found live during this slice's own development:
// CM6's native scrollIntoView on arrow-key movement brings the caret
// in-bounds but NOT row-grid-quantized, which left the block-caret overlay's
// own quantized bounds check rejecting it as still (barely) off-screen -- the
// caret overlay simply vanished on every arrow-key scroll past the fold
// before the reconcile this slice adds.
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

const PORT = 5232

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

    const longText = generateSyntheticDocument(50_000)
    await page.evaluate(async (text) => {
      const note = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, longText)
    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(300)

    const readState = () => {
      const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
      const container = document.querySelector('.cm6-editor-root .cm-content')
      const lineHeightPx = container ? parseFloat(getComputedStyle(container).lineHeight) : 0
      const caretVisible = !!document.querySelector('.thockdown-block-caret')
      return { scrollTop: scroller.scrollTop, lineHeightPx, caretVisible }
    }

    const cmContent = page.locator('.cm6-editor-root .cm-content')
    await cmContent.click()
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(100)

    // --- Arrow-down past the fold must keep the caret visible and land the
    // scroll position on the line grid ---
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('ArrowDown')
    }
    await page.waitForTimeout(400)
    const afterDown = await page.evaluate(readState)
    if (afterDown.scrollTop <= 0) throw new Error(`FAIL: arrow-down did not scroll (scrollTop=${afterDown.scrollTop})`)
    if (!afterDown.caretVisible) throw new Error('FAIL: caret overlay is hidden after scrolling past the fold with ArrowDown -- the caging reconcile regressed')
    const remainder = afterDown.scrollTop % afterDown.lineHeightPx
    const quantizationError = Math.min(remainder, afterDown.lineHeightPx - remainder)
    if (quantizationError > 0.5) {
      throw new Error(`FAIL: caged scroll position not quantized to line grid (scrollTop=${afterDown.scrollTop}, lineHeightPx=${afterDown.lineHeightPx}, error=${quantizationError})`)
    }
    console.error(`[verify] ArrowDown past the fold: scrollTop=${afterDown.scrollTop}, caret visible, quantized to line grid`)

    // --- Arrow back up to the very start must return scroll to 0 ---
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('ArrowUp')
    }
    await page.waitForTimeout(400)
    const afterUp = await page.evaluate(readState)
    if (afterUp.scrollTop !== 0) throw new Error(`FAIL: arrow-up back to document start did not return scrollTop to 0 (got ${afterUp.scrollTop})`)
    if (!afterUp.caretVisible) throw new Error('FAIL: caret overlay is hidden after scrolling back to the top with ArrowUp')
    console.error('[verify] ArrowUp back to document start: scrollTop=0, caret visible')

    // --- Typing near the caged edge must keep the caret visible ---
    await page.keyboard.type('hello world, typed near the cage edge')
    await page.waitForTimeout(300)
    const afterTyping = await page.evaluate(readState)
    if (!afterTyping.caretVisible) throw new Error('FAIL: caret overlay hidden after typing')
    console.error('[verify] typing kept the caret visible')

    // --- Ctrl+B (a shortcut transform, not a refocus key) must NOT trigger
    // a cage reconcile -- confirms the isRefocusKey exclusion (ctrlKey) still
    // holds, i.e. this slice didn't regress the "preserve scroll" semantics
    // Tab/shortcut/character transforms rely on ---
    const beforeShortcut = await page.evaluate(readState)
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+b')
    await page.waitForTimeout(200)
    const afterShortcut = await page.evaluate(readState)
    if (afterShortcut.scrollTop !== beforeShortcut.scrollTop) {
      throw new Error(`FAIL: Ctrl+B shortcut transform moved the scroll position (before=${beforeShortcut.scrollTop}, after=${afterShortcut.scrollTop}) -- should be scroll-preserving`)
    }
    console.error('[verify] Ctrl+B shortcut transform did not move the scroll position (correctly excluded from caging)')

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
