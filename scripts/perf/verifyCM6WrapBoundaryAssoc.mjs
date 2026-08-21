#!/usr/bin/env node
// Live-browser regression check for docs/cm6-parity-hardening-plan.md's
// "wrap-boundary caret assoc" bug: CM6's own default text-insertion path
// (EditorState.replaceSelection, what handles every ordinary keystroke)
// always produces a collapsed cursor with assoc 0 ("no preference"), so
// CM6's own enforceCursorAssoc() correction (gated on a truthy assoc --
// see @codemirror/view's ViewState.update) never engaged for typing, only
// for arrow-key navigation (moveByChar/moveVisually always sets a real
// assoc). The fix in CM6Editor.tsx follows up any docChanged transaction
// that leaves a collapsed, assoc-0 selection with a microtask-deferred
// re-dispatch setting assoc: 1 ("downstream"/new-line, matching
// CaretRect.ts's own established wrap-boundary convention), giving CM6's
// own correction something to act on.
//
// What this script can and can't prove, recorded honestly (see this bug's
// own section in docs/cm6-parity-hardening-plan.md for the full account):
// enforceCursorAssoc() only touches the *native* browser Selection object
// directly (no view.state write), and the native `selectionchange` it
// triggers gets observed and re-synced into a fresh CM6 selection (assoc
// back to 0, since raw DOM has no assoc concept) almost immediately after
// -- so the assoc value itself is too fleeting for a Playwright round trip
// to reliably observe, and this environment's headless Linux Chromium was
// never observed to reproduce the actual mis-rendered/off-screen-caret
// symptom in the first place (the native selection already resolved to
// the correct row by default in every repro attempt here, fix or no fix --
// this looks like a Chromium-version/platform-specific heuristic, not
// something obviously forceable from outside). So this script verifies the
// fix's own MECHANISM engages correctly (the follow-up dispatch actually
// fires, exactly once per qualifying keystroke, via a debug-only counter --
// see wrapBoundaryAssocFixDispatchCountRef in CM6Editor.tsx) rather than a
// pixel-level before/after of the originally reported symptom.
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

function assertTrue(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
  console.log(`  ok: ${msg}`)
}

async function main() {
  const port = 5193
  console.error(`[verify] starting dev server on port ${port}...`)
  const server = await startDevServer(port)
  const consoleErrors = []

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage()
    await page.setViewportSize({ width: 900, height: 700 })
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))

    await page.goto(`http://localhost:${port}/`)
    await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 30000 })
    await page.waitForTimeout(300)

    await page.evaluate(() => window.localStorage.setItem('thockdown:debug-cage-state', '1'))
    await page.evaluate(async () => {
      const note = await window.thockdownNotes.createNote({ initialText: '' })
      await window.thockdownSections.setActiveNote('default', note.id)
    })
    await page.reload()
    await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 30000 })
    await page.waitForTimeout(300)
    await page.click('.editor-text[contenteditable="true"]')
    await page.waitForTimeout(100)

    async function settle() {
      // Let this fix's own queued microtask (and any rAF-scheduled caret/
      // highlight updates) flush before the next read.
      await page.evaluate(() => new Promise((resolve) => {
        queueMicrotask(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }))
    }

    async function caretY() {
      return page.evaluate(() => {
        const caret = document.querySelector('.thockdown-block-caret')
        const m = caret && caret.style.transform.match(/translate3d\(([\d.]+)px,\s*([\d.]+)px/)
        return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null
      })
    }

    async function debugState() {
      return page.evaluate(() => window.__thockdownDebugCageState?.())
    }

    // Fill row 0 fully, then step into row 1 so we have real headroom
    // before the boundary we actually care about.
    for (let i = 0; i < 30; i += 1) await page.keyboard.type('ab ')
    await settle()
    let pos = await caretY()
    let guard = 0
    while (pos && pos.y < 20) { await page.keyboard.type('ab '); await settle(); pos = await caretY(); guard += 1; if (guard > 200) throw new Error('never reached row1') }

    // Type single chars until the next one wraps to row2, then back off by
    // one so we're sitting exactly at the last box of row1 (the position
    // right before the wrap-triggering keystroke). Each of these typed
    // chars is itself a qualifying (collapsed, assoc-0-producing) keystroke,
    // so the dispatch counter is already nonzero going in -- the real
    // assertion below is about the *delta* across the keystroke under test,
    // not the raw count.
    let lastY = pos.y
    let steps = 0
    while (true) {
      await page.keyboard.press('a')
      steps += 1
      await settle()
      const p2 = await caretY()
      if (p2.y > lastY + 1) { await page.keyboard.press('Backspace'); await settle(); break }
      lastY = p2.y
      if (steps > 300) throw new Error('never wrapped')
    }

    const beforeSpace = await debugState()
    console.log('debug state right before the wrap-triggering keystroke:', JSON.stringify(beforeSpace))

    // The actual keystroke under test: type the character that causes the
    // wrap (mirrors the user's own repro -- typing at the exact last box).
    await page.keyboard.press('Space')
    await settle()

    const afterTypingWrap = await debugState()
    console.log('debug state right after the wrap-triggering keystroke:', JSON.stringify(afterTypingWrap))

    assertTrue(
      afterTypingWrap.wrapBoundaryAssocFixDispatchCount === beforeSpace.wrapBoundaryAssocFixDispatchCount + 1,
      `the wrap-boundary caret-assoc fix's follow-up dispatch fired exactly once for the wrap-triggering keystroke (count ${beforeSpace.wrapBoundaryAssocFixDispatchCount} -> ${afterTypingWrap.wrapBoundaryAssocFixDispatchCount})`,
    )

    // Sanity: the fix must not have corrupted the document or left the
    // cursor somewhere unexpected (its own dispatch only sets assoc, never
    // moves `head`) -- the wrap-triggering space should have landed at the
    // exact position the debug state reports (docLength/selectionHead both
    // advanced by exactly 1 from the keystroke, cursor still collapsed).
    assertTrue(
      afterTypingWrap.docLength === beforeSpace.docLength + 1 && afterTypingWrap.selectionHead === beforeSpace.selectionHead + 1,
      `document text is intact after the fix ran -- doc grew by exactly 1 char and the cursor advanced with it (docLength ${beforeSpace.docLength} -> ${afterTypingWrap.docLength}, head ${beforeSpace.selectionHead} -> ${afterTypingWrap.selectionHead})`,
    )
    assertTrue(afterTypingWrap.selectionEmpty, 'selection is still collapsed after the fix ran')

    assertTrue(consoleErrors.length === 0, `no console errors (saw: ${JSON.stringify(consoleErrors)})`)

    console.log('\n[verify] ALL CHECKS PASSED')
  } finally {
    await browser?.close()
    server.stop()
  }
  process.exit(process.exitCode ?? 0)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
