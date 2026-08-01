#!/usr/bin/env node
// Live-browser functional check for the fontReady/caretSuspended gating
// ported into CM6Editor.tsx for the 0.5.4 production flip (see the handover
// doc and CM6Editor.tsx's own doc comment). The specific regression risk this
// guards against: if any real mount/note-switch path ever stopped calling
// adapter.applySnapshot({ viewportLines }), hasViewportLines would stay false
// forever and the editor would render permanently blank (no grid, no caret) --
// this is the project's own "measure/verify, don't assume" discipline applied
// to a change that touches the highest-severity surface (caret rendering).
//
// Checks: CM6 is the default editor (no localStorage opt-in needed anymore),
// the grid/caret render on first mount, and switching notes doesn't leave
// either permanently blank or the caret permanently suspended.

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

async function gridAndCaretVisible(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.cm6-editor-root')
    const gridLines = document.querySelector('.thockdown-grid-lines')
    const caret = document.querySelector('.thockdown-block-caret')
    return {
      rootVisible: root ? getComputedStyle(root).visibility !== 'hidden' : false,
      gridPresent: !!gridLines,
      caretPresent: !!caret,
    }
  })
}

async function main() {
  const port = 5186
  console.error(`[verify] starting dev server on port ${port}...`)
  const server = await startDevServer(port)
  const consoleErrors = []

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => { consoleErrors.push(String(err)) })

    // Deliberately NOT setting the localStorage opt-in flag -- the whole
    // point of this check is that CM6 is now the default with no flag set.
    await page.goto(`http://localhost:${port}/`)
    await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 30000 })
    await page.waitForTimeout(400)

    assertTrue(await page.evaluate(() => !!document.querySelector('.cm6-editor-root')), 'CM6 mounted by default with no localStorage override set')

    const initial = await gridAndCaretVisible(page)
    console.log('  initial:', JSON.stringify(initial))
    assertTrue(initial.rootVisible, 'editor root visible on first mount')
    assertTrue(initial.gridPresent, 'grid lines rendered on first mount (hasViewportLines/fontReady gating did not get stuck)')
    assertTrue(initial.caretPresent, 'caret rendered on first mount')

    // Create a second note via the mock IPC bridge (content only -- the
    // bridge doesn't push a live update into the running app, see
    // perfHarness.mjs's own seedLargeNoteAndReload comment), then switch to
    // it through the real UI (clicking its sidebar entry), which is what
    // actually exercises the live in-app note-switch restore path
    // (applyEditRestoreSnapshot -> applySnapshot -> setIsCaretSuspended)
    // rather than requiring a reload.
    const secondNoteId = await page.evaluate(async () => {
      const note = await window.thockdownNotes.createNote({ initialText: 'Second note content\nline two\nline three' })
      return note.id
    })
    await page.reload()
    await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 30000 })
    await page.waitForTimeout(400)
    await page.click(`.note-list-item[data-note-id="${secondNoteId}"]`)
    await page.waitForTimeout(600)

    const afterSwitch = await gridAndCaretVisible(page)
    console.log('  after switch to second note:', JSON.stringify(afterSwitch))
    assertTrue(afterSwitch.rootVisible, 'editor root visible after switching notes (not stuck hidden)')
    assertTrue(afterSwitch.gridPresent, 'grid lines rendered after switching notes')
    assertTrue(afterSwitch.caretPresent, 'caret rendered after switching notes (not stuck suspended)')

    const bodyText = await page.evaluate(() => document.querySelector('.editor-text')?.textContent ?? '')
    assertTrue(bodyText.includes('Second note content'), 'second note text actually loaded into the editor')

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
