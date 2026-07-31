#!/usr/bin/env node
// Live-browser regression check: a note that becomes active via persisted
// app state on cold boot (setActiveNote + reload, no sidebar click) loads
// focused with a visible caret, no manual click required.
//
// Written while investigating docs/cm6-parity-hardening-plan.md's Bug 2
// (caret not restored on section-switch) -- traced with debug logging to
// confirm which of useEditorSectionMount.ts's restore branches this
// scenario actually hits. Finding, recorded here so it isn't re-litigated:
// this specific scenario goes through the cachedSnapshot branch (already
// had focusAfterApply: true before any fix), NOT the restorePersistedEditState
// branch that was missing it -- setActiveNoteId's only real call site
// (EditorSection.tsx's activateNote) always pre-seeds
// pendingEditRestoreSnapshotRef, including on cold boot, so this test does
// NOT exercise that specific gap. Kept anyway as real, useful coverage of
// this invariant; the restorePersistedEditState fix itself is a
// consistency argument (matches its sibling branches) that could not be
// proven to guard a live-reachable path via any UI flow found so far --
// see the plan doc's session-handover section for what's still open there
// (multi-section split-view switching is the more likely real repro for
// the originally reported symptom, not yet tested).
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
  const port = 5187
  console.error(`[verify] starting dev server on port ${port}...`)
  const server = await startDevServer(port)
  const consoleErrors = []

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => { consoleErrors.push(String(err)) })

    await page.goto(`http://localhost:${port}/`)
    await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 30000 })
    await page.waitForTimeout(300)

    // Create a note and make it the active note via persisted app state
    // (not a sidebar click), then reload -- on the fresh page load this
    // note has no in-memory/pending-snapshot cache, so it must go through
    // restorePersistedEditState.
    await page.evaluate(async () => {
      const note = await window.thockdownNotes.createNote({ initialText: 'Cold boot focus check\nsecond line' })
      await window.thockdownSections.setActiveNote('default', note.id)
    })
    await page.reload()
    await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 30000 })

    // Give the restore path (RAF-scheduled per applyEditRestoreSnapshot) a
    // moment to run -- deliberately no click anywhere in this test.
    await page.waitForTimeout(600)

    const state = await page.evaluate(() => {
      const editorRoot = document.querySelector('.editor-text[contenteditable="true"]')
      const caret = document.querySelector('.thockdown-block-caret')
      return {
        focused: document.activeElement === editorRoot,
        caretPresent: !!caret,
        text: editorRoot?.textContent ?? '',
      }
    })
    console.log('  state after cold-boot reload, no click:', JSON.stringify(state))

    assertTrue(state.text.includes('Cold boot focus check'), 'the seeded note actually loaded')
    assertTrue(state.focused, 'editor is focused (document.activeElement) without any manual click')
    assertTrue(state.caretPresent, 'caret overlay is visible without any manual click')

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
