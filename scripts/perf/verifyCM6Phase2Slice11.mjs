// Live-browser verification for Phase 2 slice 11 (fixed-focus caging
// boundary UI in CM6Editor: draggable top/bottom padding-zone handles,
// content padding driven by real topBoundaryPx/bottomBoundaryPx, the caging
// reconcile respecting the boundary instead of the raw viewport edge, and
// viewport-lines snapshot round-trip for the boundary).
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

const PORT = 5239

async function getDragHandles(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('.cm6-editor-root').parentElement
    const divs = Array.from(layer.children).filter((el) => getComputedStyle(el).cursor === 'ns-resize')
    return divs.map((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, left: r.left, width: r.width, height: r.height }
    })
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
    await waitForAppReady(page)

    const longText = generateSyntheticDocument(50_000)
    const { noteAId, noteBId } = await page.evaluate(async (text) => {
      const noteA = await window.thockdownNotes.createNote({ initialText: text })
      const noteB = await window.thockdownNotes.createNote({ initialText: 'note B' })
      await window.thockdownSections.setActiveNote('default', noteA.id)
      return { noteAId: noteA.id, noteBId: noteB.id }
    }, longText)
    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(300)

    // --- Two drag handles must exist, and be reachable/clickable even at a
    // 0 boundary (the negative-offset-clamped-to-0 case) ---
    const handles = await getDragHandles(page)
    if (handles.length !== 2) {
      throw new Error(`FAIL: expected 2 drag handles, found ${handles.length}`)
    }
    console.error('[verify] both drag handles present')

    // --- Dragging the bottom handle up creates a bottom boundary, applied
    // as real content padding ---
    const bottomHandle = handles[1]
    const startX = bottomHandle.left + bottomHandle.width / 2
    const startY = bottomHandle.top + bottomHandle.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX, startY - 78, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    const paddingBottom = await page.evaluate(() => parseFloat(document.querySelector('.cm6-editor-root .cm-content').style.paddingBottom || '0'))
    if (paddingBottom <= 0) {
      throw new Error(`FAIL: dragging the bottom handle did not create a content padding boundary (paddingBottom=${paddingBottom})`)
    }
    console.error(`[verify] bottom drag handle created a ${paddingBottom}px content boundary`)

    // --- The caging reconcile must respect the boundary: after scrolling to
    // the fold with ArrowDown, the caret must sit ABOVE the boundary zone,
    // not flush against the raw viewport edge ---
    const cmContent = page.locator('.cm6-editor-root .cm-content')
    await cmContent.click()
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(100)
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(400)

    const cageResult = await page.evaluate(() => {
      const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
      const caret = document.querySelector('.thockdown-block-caret')
      if (!caret) return { caretVisible: false }
      const caretRect = caret.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      return {
        caretVisible: true,
        caretBottomInScroller: caretRect.bottom - scrollerRect.top,
        clientHeight: scroller.clientHeight,
      }
    })
    if (!cageResult.caretVisible) throw new Error('FAIL: caret hidden after scrolling to the fold with a bottom boundary set')
    const middleZoneBottom = cageResult.clientHeight - paddingBottom
    if (cageResult.caretBottomInScroller > middleZoneBottom + 0.5) {
      throw new Error(`FAIL: caret sits inside the bottom boundary zone (caretBottomInScroller=${cageResult.caretBottomInScroller}, middleZoneBottom=${middleZoneBottom}) -- caging reconcile is not respecting the real boundary`)
    }
    console.error(`[verify] caret correctly stopped above the bottom boundary zone (caretBottomInScroller=${cageResult.caretBottomInScroller}, middleZoneBottom=${middleZoneBottom})`)

    // --- Boundary must round-trip through the real note-switch snapshot
    // flow (viewportLines), same as scroll position does ---
    await page.evaluate(async (id) => { await window.thockdownSections.setActiveNote('default', id) }, noteBId)
    await page.waitForTimeout(300)
    await page.evaluate(async (id) => { await window.thockdownSections.setActiveNote('default', id) }, noteAId)
    await page.waitForTimeout(400)
    const paddingBottomAfterSwitch = await page.evaluate(() => parseFloat(document.querySelector('.cm6-editor-root .cm-content').style.paddingBottom || '0'))
    if (Math.abs(paddingBottomAfterSwitch - paddingBottom) > 0.5) {
      throw new Error(`FAIL: boundary was not restored after switching notes and back (before=${paddingBottom}, after=${paddingBottomAfterSwitch})`)
    }
    console.error(`[verify] boundary correctly restored after switching notes and back (${paddingBottomAfterSwitch}px)`)

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
