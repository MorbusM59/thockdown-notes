// Live-browser verification for Phase 2 slice 9 (paste sanitization ported
// into CM6Editor: PasteSanitizationPlugin.tsx's own clipboard handling --
// HTML-tag stripping, emoji/control-char stripping, tab normalization,
// paragraph reconstruction, bullet normalization, and the Ctrl+Shift+V
// "plain paste" escape hatch).
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

const PORT = 5234

async function dispatchPaste(page, plainText, htmlText) {
  await page.evaluate(({ plainText, htmlText }) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', plainText)
    if (htmlText) dt.setData('text/html', htmlText)
    const target = document.querySelector('.cm6-editor-root .cm-content')
    const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
  }, { plainText, htmlText })
}

async function readSavedText(page) {
  // Ground truth via the real save pipeline, not DOM textContent -- matching
  // this project's own established discipline (DOM text serialization has
  // known artifacts for adjacent block elements). Same lookup pattern as
  // verifyCM6Phase2Slice1.mjs: most-recently-updated note is the one just
  // edited (there's a single default note through this whole script, so
  // this just resolves it).
  await page.waitForTimeout(400) // let the debounced save queue flush
  return page.evaluate(async () => {
    const notes = await window.thockdownNotes.listNotes()
    const sorted = [...notes].sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
    const target = sorted[0]
    if (!target) return null
    const loaded = await window.thockdownNotes.loadNote({ id: target.id })
    return loaded?.text ?? null
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

    const cmContent = page.locator('.cm6-editor-root .cm-content')
    await cmContent.click()

    // --- HTML tags, emoji, and tabs must be sanitized out ---
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await dispatchPaste(page, 'Hello <b>world</b> 🎉 with\ttabs', '<b>Hello world</b>')
    const sanitized = await readSavedText(page)
    if (sanitized.includes('<b>') || sanitized.includes('</b>')) {
      throw new Error(`FAIL: HTML tags not stripped from pasted text. Got: ${JSON.stringify(sanitized)}`)
    }
    if (sanitized.includes('🎉')) {
      throw new Error(`FAIL: emoji not stripped from pasted text. Got: ${JSON.stringify(sanitized)}`)
    }
    if (sanitized.includes('\t')) {
      throw new Error(`FAIL: tab character not normalized to spaces. Got: ${JSON.stringify(sanitized)}`)
    }
    console.error(`[verify] HTML/emoji/tabs sanitized: ${JSON.stringify(sanitized)}`)

    // --- Paragraph reconstruction (extended sanitization): a sentence
    // wrapped across lines by a PDF/word-processor should rejoin into one
    // line, since the wrap wasn't a real paragraph break ---
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await dispatchPaste(page, 'This is one sentence that was\nhard-wrapped mid-thought.', null)
    const reconstructed = await readSavedText(page)
    if (reconstructed !== 'This is one sentence that was hard-wrapped mid-thought.') {
      throw new Error(`FAIL: wrapped paragraph not reconstructed. Got: ${JSON.stringify(reconstructed)}`)
    }
    console.error(`[verify] paragraph reconstruction: ${JSON.stringify(reconstructed)}`)

    // --- Ctrl+Shift+V requests plain (non-extended) sanitization: the same
    // wrapped text should NOT be rejoined. Dispatched as a synthetic
    // KeyboardEvent rather than a real Playwright keypress -- a real,
    // CDP-level Ctrl+Shift+V triggers Chromium's own native
    // "paste without formatting" clipboard action (with the test's empty
    // sandboxed OS clipboard), producing a SECOND, unwanted real paste event
    // that consumes plainPasteRequested before this test's own synthetic
    // dispatchPaste() below gets to it. A synthetic keydown carries the same
    // key/modifier info CM6's keymap reads without triggering that native
    // browser behavior.
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.evaluate(() => {
      const target = document.querySelector('.cm6-editor-root .cm-content')
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    })
    await dispatchPaste(page, 'This is one sentence that was\nhard-wrapped mid-thought.', null)
    const plainPasted = await readSavedText(page)
    if (plainPasted !== 'This is one sentence that was\nhard-wrapped mid-thought.') {
      throw new Error(`FAIL: Ctrl+Shift+V plain paste incorrectly reconstructed paragraphs. Got: ${JSON.stringify(plainPasted)}`)
    }
    console.error(`[verify] Ctrl+Shift+V plain paste preserved line breaks: ${JSON.stringify(plainPasted)}`)

    // --- Paste at a mid-document cursor position must insert, not replace ---
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type('before-AFTER')
    await page.keyboard.press('Home')
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight') // caret between "before-" and "AFTER"
    await dispatchPaste(page, 'INSERTED', null)
    const inserted = await readSavedText(page)
    if (inserted !== 'before-INSERTEDAFTER') {
      throw new Error(`FAIL: paste at cursor did not insert correctly. Got: ${JSON.stringify(inserted)}`)
    }
    console.error(`[verify] paste at mid-document cursor inserted correctly: ${JSON.stringify(inserted)}`)

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
