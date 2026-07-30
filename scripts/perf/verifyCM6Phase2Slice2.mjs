// Live-browser verification for Phase 2 slice 2 (Tab/Enter/markdown-shortcut
// transforms wired into CM6Editor). Not a committed test suite -- ad hoc per
// docs/document-scale-performance-philosophy.md's live-browser-check rule.
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

const PORT = 5223

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

    // --- Tab must never escape the editor (focus must stay put) ---
    await page.keyboard.press('Control+a')
    await page.keyboard.type('one line')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
    const focusedAfterTab = await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))
    if (!focusedAfterTab) throw new Error('FAIL: focus left the editor after Tab')
    console.error('[verify] Tab did not escape the editor (focus stayed)')

    // --- Ctrl+B (markdown bold shortcut, Ctrl not Cmd -- app-specific) ---
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type('hello')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+b')
    await page.waitForTimeout(200)
    const textAfterBold = await page.evaluate(() => document.querySelector('.cm6-editor-root .cm-content')?.textContent ?? '')
    console.error('[verify] text after Ctrl+A, Ctrl+B on "hello":', JSON.stringify(textAfterBold))
    if (textAfterBold === 'hello') {
      throw new Error('FAIL: Ctrl+B had no visible effect -- the markdown-shortcut transform callback likely never fired (check bindings wiring)')
    }
    if (!textAfterBold.includes('hello')) {
      throw new Error(`FAIL: Ctrl+B mangled the text instead of transforming it. Got: ${JSON.stringify(textAfterBold)}`)
    }

    // --- Enter still produces a working document (default or transformed) ---
    // Checked via .cm-line count + the real save pipeline, NOT .cm-content's
    // .textContent -- that concatenates sibling block-level .cm-line divs
    // with no separator, which looks like a missing newline but isn't (the
    // same class of DOM-serialization illusion this project's own handover
    // doc already documented once for innerText/<p> margin-collapse).
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type('line one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line two')
    await page.waitForTimeout(500) // let the debounced save flush
    const lineTexts = await page.evaluate(() => Array.from(document.querySelectorAll('.cm6-editor-root .cm-line')).map((l) => l.textContent))
    if (lineTexts.length !== 2 || lineTexts[0] !== 'line one' || lineTexts[1] !== 'line two') {
      throw new Error(`FAIL: Enter did not produce two correct lines. Got: ${JSON.stringify(lineTexts)}`)
    }
    const savedAfterEnter = await page.evaluate(async () => {
      const notes = await window.thockdownNotes.listNotes()
      const sorted = [...notes].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      const target = sorted[0]
      if (!target) return null
      const loaded = await window.thockdownNotes.loadNote({ id: target.id })
      return loaded?.text ?? null
    })
    if (savedAfterEnter !== 'line one\nline two') {
      throw new Error(`FAIL: saved ground-truth text after Enter is wrong. Got: ${JSON.stringify(savedAfterEnter)}`)
    }
    console.error('[verify] Enter produced correct two-line content, confirmed via the real save pipeline:', JSON.stringify(savedAfterEnter))

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
