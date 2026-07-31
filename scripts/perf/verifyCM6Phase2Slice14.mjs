// Live-browser verification for Phase 2 slice 14 (custom scrollbar ported
// to CM6Editor: track/thumb rendering via a portal into scrollbarHost,
// passive geometry sync reflecting real scroll position, thumb drag, track
// click-to-jump, and track right-click-hold-to-page).
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

const PORT = 5246

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
    await page.waitForTimeout(500)

    // --- Rendering + passive sync: thumb must exist, be active (content
    // taller than viewport), and track real scroll position ---
    const initialThumb = await page.evaluate(() => {
      const thumb = document.querySelector('.thockdown-scroll-thumb')
      return thumb ? { isInactive: thumb.classList.contains('is-inactive'), top: parseFloat(thumb.style.top) } : null
    })
    if (!initialThumb) throw new Error('FAIL: scroll thumb not found')
    if (initialThumb.isInactive) throw new Error('FAIL: scroll thumb marked inactive on a document taller than the viewport')
    console.error('[verify] scroll thumb rendered and active')

    await page.evaluate(() => { document.querySelector('.cm6-editor-root .cm-scroller').scrollTop = 2000 })
    await page.waitForTimeout(300)
    const thumbAfterScroll = await page.evaluate(() => parseFloat(document.querySelector('.thockdown-scroll-thumb').style.top))
    if (thumbAfterScroll <= initialThumb.top) {
      throw new Error(`FAIL: thumb did not move down after scrolling (before=${initialThumb.top}, after=${thumbAfterScroll})`)
    }
    console.error(`[verify] thumb tracks real scroll position (top ${initialThumb.top} -> ${thumbAfterScroll})`)

    // --- Track click-to-jump ---
    await page.evaluate(() => { document.querySelector('.cm6-editor-root .cm-scroller').scrollTop = 0 })
    await page.waitForTimeout(200)
    const trackBox = await page.locator('.thockdown-scroll-track').boundingBox()
    await page.mouse.click(trackBox.x + trackBox.width / 2, trackBox.y + trackBox.height * 0.5)
    await page.waitForTimeout(700)
    const scrollTopAfterClick = await page.evaluate(() => document.querySelector('.cm6-editor-root .cm-scroller').scrollTop)
    if (scrollTopAfterClick <= 0) {
      throw new Error(`FAIL: clicking the middle of the track did not scroll (scrollTop=${scrollTopAfterClick})`)
    }
    console.error(`[verify] track click-to-jump scrolled to ${scrollTopAfterClick}`)

    // --- Thumb drag ---
    await page.evaluate(() => { document.querySelector('.cm6-editor-root .cm-scroller').scrollTop = 0 })
    await page.waitForTimeout(200)
    const thumbBox = await page.locator('.thockdown-scroll-thumb').boundingBox()
    await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + 300, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const scrollTopAfterDrag = await page.evaluate(() => document.querySelector('.cm6-editor-root .cm-scroller').scrollTop)
    if (scrollTopAfterDrag <= 0) {
      throw new Error(`FAIL: dragging the thumb down did not scroll (scrollTop=${scrollTopAfterDrag})`)
    }
    console.error(`[verify] thumb drag scrolled to ${scrollTopAfterDrag}`)

    // --- Right-click-hold on the track pages continuously, dispatched at
    // view.contentDOM (not scrollDOM) so it reaches this file's own
    // Prec.highest PageUp/PageDown keymap handler ---
    await page.evaluate(() => { document.querySelector('.cm6-editor-root .cm-scroller').scrollTop = 0 })
    await page.waitForTimeout(200)
    const trackBox2 = await page.locator('.thockdown-scroll-track').boundingBox()
    await page.mouse.move(trackBox2.x + trackBox2.width / 2, trackBox2.y + trackBox2.height * 0.8)
    await page.mouse.down({ button: 'right' })
    await page.waitForTimeout(500)
    const scrollTopDuringHold = await page.evaluate(() => document.querySelector('.cm6-editor-root .cm-scroller').scrollTop)
    await page.mouse.up({ button: 'right' })
    if (scrollTopDuringHold <= 0) {
      throw new Error(`FAIL: right-click-hold on the track below the thumb did not page down (scrollTop=${scrollTopDuringHold})`)
    }
    console.error(`[verify] right-click-hold paged down to ${scrollTopDuringHold} while held`)

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
