// Live-browser verification for Phase 2 slice 4 (viewport/scroll event
// reporting + snapshot restore in CM6Editor). Tests the real end-to-end
// flow: scroll, switch to a different note, switch back, and confirm the
// scroll position is restored -- not just that the wiring doesn't throw.
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

const PORT = 5227

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
    const { noteAId, noteBId } = await page.evaluate(async (text) => {
      const noteA = await window.thockdownNotes.createNote({ initialText: text })
      const noteB = await window.thockdownNotes.createNote({ initialText: 'note B' })
      await window.thockdownSections.setActiveNote('default', noteA.id)
      return { noteAId: noteA.id, noteBId: noteB.id }
    }, longText)
    await page.reload()
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })
    await page.waitForTimeout(300)

    // Scroll down in note A. `.cm-scroller` is the real scrolling element
    // (view.scrollDOM) -- NOT the `.cm6-editor-root` container, which has
    // no overflow of its own (see CM6Editor.tsx's EditorView.theme()
    // comment for why: CM6's own base theme makes `.cm-scroller`
    // `height: 100%` of `.cm-editor`, which needs an explicit height from
    // the host to constrain it, or it just grows to content height and
    // never overflows internally at all -- a real bug this round's own
    // testing caught, since the container's `overflow: auto` was silently
    // doing the real scrolling instead until this was found and fixed).
    const targetScrollTop = await page.evaluate(() => {
      const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
      scroller.scrollTop = 2000
      return scroller.scrollTop
    })
    if (targetScrollTop < 500) throw new Error(`FAIL: scroll did not actually move the editor (scrollTop=${targetScrollTop}); document may be too short, or .cm-scroller isn't the real scrolling element`)
    await page.waitForTimeout(500) // let any debounced viewport-save settle

    // Switch to note B, then back to note A.
    await page.evaluate(async (id) => { await window.thockdownSections.setActiveNote('default', id) }, noteBId)
    await page.waitForTimeout(300)
    await page.evaluate(async (id) => { await window.thockdownSections.setActiveNote('default', id) }, noteAId)
    await page.waitForTimeout(500)

    const restoredScrollTop = await page.evaluate(() => document.querySelector('.cm6-editor-root .cm-scroller')?.scrollTop ?? 0)
    console.error(`[verify] scrollTop before switch: ${targetScrollTop}, after switching away and back: ${restoredScrollTop}`)

    if (Math.abs(restoredScrollTop - targetScrollTop) > 50) {
      throw new Error(`FAIL: scroll position was NOT restored after switching notes (before=${targetScrollTop}, after=${restoredScrollTop})`)
    }
    console.error('[verify] scroll position correctly restored after switching notes and back')

    if (consoleErrors.length > 0) {
      console.error('[verify] console errors:')
      for (const err of consoleErrors) console.error('  ' + err)
      throw new Error(`${consoleErrors.length} console error(s)`)
    }
    console.error('[verify] no console errors.')
  } finally {
    await browser?.close()
    server.stop()
  }
}

main().catch((err) => {
  console.error('[verify] FAIL:', err)
  process.exitCode = 1
})
