// Live-browser verification for Phase 2 slice 3 (typing-sound wiring:
// arrow keys, undo/redo, Tab click sounds ported to CM6Editor). Audio
// playback itself can't be verified headless, so this checks the things
// that CAN be verified: no console errors from the new event registrations,
// and that the functional side effects they sit alongside (undo/redo,
// arrow-key caret movement) still work correctly.
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

const PORT = 5226

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
    await page.keyboard.type('hello world')

    // Arrow keys -- should move the caret without error.
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowDown')
    console.error('[verify] arrow keys did not throw')

    // Undo/redo -- functional check, not just "no error".
    await page.keyboard.type('!!!')
    await page.waitForTimeout(150)
    const beforeUndo = await page.evaluate(() => document.querySelector('.cm6-editor-root .cm-content')?.textContent ?? '')
    if (!beforeUndo.includes('!!!')) throw new Error(`FAIL: typed "!!!" not present before undo. Got: ${JSON.stringify(beforeUndo)}`)

    await page.keyboard.press('Control+z')
    await page.waitForTimeout(200)
    const afterUndo = await page.evaluate(() => document.querySelector('.cm6-editor-root .cm-content')?.textContent ?? '')
    if (afterUndo.includes('!!!')) throw new Error(`FAIL: Ctrl+Z did not undo. Got: ${JSON.stringify(afterUndo)}`)
    console.error('[verify] Ctrl+Z correctly undid the last insertion')

    await page.keyboard.press('Control+y')
    await page.waitForTimeout(200)
    const afterRedo = await page.evaluate(() => document.querySelector('.cm6-editor-root .cm-content')?.textContent ?? '')
    if (!afterRedo.includes('!!!')) throw new Error(`FAIL: Ctrl+Y did not redo. Got: ${JSON.stringify(afterRedo)}`)
    console.error('[verify] Ctrl+Y correctly redid the insertion')

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
