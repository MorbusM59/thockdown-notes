// One-off live-browser verification for Phase 2 slice 1 (CM6Editor wired
// in behind a dev-only flag). Not a committed test -- ad hoc per
// docs/document-scale-performance-philosophy.md's "live-browser check is
// mandatory for anything touching editor state" rule. Checks:
//   1. (Updated for the 0.5.4 production flip: CM6 is now the default, so
//      Part 1 now checks the rollback path instead of the old "off by
//      default" behavior.) With the flag set to '0', the editor falls back
//      to Lexical -- the rollback path stays intact.
//   2. With the flag unset (the real default), CM6Editor mounts, typing
//      works, and text round-trips through the REAL save pipeline (readback
//      via loadNote, not just in-memory state).
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

const PORT = 5220

async function main() {
  console.error('[verify] starting dev server...')
  const server = await startDevServer(PORT)
  let browser
  const consoleErrors = []
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })

    // --- Part 1: flag '0', rollback to Lexical still works ---
    {
      const page = await browser.newPage()
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[rollback] ${msg.text()}`) })
      page.on('pageerror', (err) => consoleErrors.push(`[rollback] ${String(err)}`))
      await page.addInitScript(() => {
        window.localStorage.setItem('thockdown:cm6-editor-spike', '0')
      })
      await page.goto(`http://localhost:${PORT}/`)
      await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 15000 })
      const hasCM6Root = await page.evaluate(() => Boolean(document.querySelector('.cm6-editor-root')))
      if (hasCM6Root) throw new Error("FAIL: CM6 editor mounted even with the rollback flag ('0') set")
      console.error('[verify] Part 1 PASS: rollback flag (\'0\') still falls back to the Lexical editor, no CM6 root present')
      await page.close()
    }

    // --- Part 2: default (no flag set), CM6Editor mounts and the save round-trip works ---
    {
      const page = await browser.newPage()
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[cm6] ${msg.text()}`) })
      page.on('pageerror', (err) => consoleErrors.push(`[cm6] ${String(err)}`))
      await page.goto(`http://localhost:${PORT}/`)
      await page.waitForSelector('.cm6-editor-root', { timeout: 15000 })
      console.error('[verify] CM6 editor root mounted')

      // The CM6 contentEditable surface is `.cm-content` inside `.cm6-editor-root`.
      const cmContent = page.locator('.cm6-editor-root .cm-content')
      await cmContent.waitFor({ state: 'visible', timeout: 10000 })
      await cmContent.click()
      await page.keyboard.press('Control+End')
      await page.keyboard.type('Hello from CM6 slice 1!')
      await page.waitForTimeout(600) // let the debounced save queue flush (350ms)

      const domText = await page.evaluate(() => document.querySelector('.cm6-editor-root .cm-content')?.textContent ?? '')
      if (!domText.includes('Hello from CM6 slice 1!')) {
        throw new Error(`FAIL: typed text not found in CM6 DOM. Got: ${JSON.stringify(domText)}`)
      }
      console.error('[verify] typed text present in the CM6 DOM')

      // Real save-pipeline readback: find whichever note is currently active
      // and confirm the saved DB content matches what was typed -- not just
      // in-memory React state.
      const savedText = await page.evaluate(async () => {
        const sections = await window.thockdownSections.listSections()
        const activeSection = sections.find((s) => s.position !== null) ?? sections[0]
        const notes = await window.thockdownNotes.listNotes()
        // Most-recently-updated note is the one just edited.
        const sorted = [...notes].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        const target = sorted[0]
        if (!target) return null
        const loaded = await window.thockdownNotes.loadNote({ id: target.id })
        return loaded?.text ?? null
      })

      if (!savedText || !savedText.includes('Hello from CM6 slice 1!')) {
        throw new Error(`FAIL: saved note text does not contain the typed text. Got: ${JSON.stringify(savedText)}`)
      }
      console.error('[verify] Part 2 PASS: typed text round-tripped through the real save pipeline correctly')

      await page.close()
    }

    if (consoleErrors.length > 0) {
      console.error('[verify] console errors encountered:')
      for (const err of consoleErrors) console.error('  ' + err)
      throw new Error(`${consoleErrors.length} console error(s) during the run`)
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
