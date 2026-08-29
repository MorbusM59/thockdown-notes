#!/usr/bin/env node
// Live-browser regression check for the chapter/TOC-toolbar-button bug found
// during the chapter/heading-ID cohesion audit (see CLAUDE.md's living-doc
// pointers): useHeadlineLevelGuard.ts forces a chapter's own first line to
// level 2 and every OTHER heading to level 3+ (CHAPTER_HEADLINE_LEVEL_RULE),
// but the single-note Table of Contents toolbar button
// (useMarkdownFormattingToolbar.ts) used to hardcode its generated block at
// level 2 -- colliding with the guard, which silently demoted it to level 3
// on the very next render. Because recognition also hardcoded level 2, the
// button could never recognize its own (demoted) output as active on a
// chapter note: every click inserted an unrecognized block instead of
// toggling one off, so repeated clicks piled up orphaned, un-removable
// blocks. Fixed by making both title detection and TOC-block level track
// the active note's own HeadlineLevelRule (see EditorSection.tsx's
// activeHeadlineRule / useMarkdownFormattingToolbar.ts's headlineRule
// option). This script drives the actual toolbar button in a live browser
// against a real chapter note to prove the fix holds end-to-end, not just
// at the unit-test level.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs'

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
  const port = 5188
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
    await waitForAppReady(page)
    await page.waitForTimeout(300)

    // Parent note with two real headings, then one real chapter with its
    // own headings -- same shape as the unit test's "inserts a level-3 TOC
    // block right after the chapter's own level-2 title" case, but driven
    // through the actual UI/IPC bridges and the actual toolbar button.
    const setup = await page.evaluate(async () => {
      const parent = await window.thockdownNotes.createNote({ initialText: '# Travel Notes\n\n## Planning\nNeed flights.' })
      const { created: chapter } = await window.thockdownChapters.createChapter(parent.id)
      await window.thockdownNotes.saveNote({
        id: chapter.id,
        text: '## Arrival\n\n### Setting\nWorld-building.\n\n### Logistics\nHotel and train.',
      })
      const sections = await window.thockdownSections.setActiveNote('default', chapter.id)
      return { parentId: parent.id, chapterId: chapter.id, sections }
    })
    // A running session doesn't pick up a backend-only setActiveNote call
    // on its own -- reload (same as a fresh app launch reading persisted
    // active-note state) so the UI actually switches to the chapter.
    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(400)

    const editorText = async () => page.locator('.editor-text[contenteditable="true"]').innerText()
    const tocButton = page.locator('button.btn-icon[aria-label*="table of contents" i]')

    assertTrue((await editorText()).includes('Arrival'), 'chapter note is active and loaded in the editor')

    // First click: insert. Must land as a LEVEL-3 heading (not the
    // hardcoded level-2 the bug used to produce), since the chapter's own
    // title already occupies level 2.
    await tocButton.click()
    await page.waitForTimeout(200)
    let text = await editorText()
    console.log('  after first click:\n' + text.split('\n').map((l) => `    ${l}`).join('\n'))
    assertTrue(text.includes('### Table of Contents'), 'inserted TOC heading is level 3, matching the chapter\'s own CHAPTER_HEADLINE_LEVEL_RULE')
    assertTrue(!/(^|\n)## Table of Contents/.test(text), 'TOC heading was NOT left/reverted at the colliding level 2 (exactly "##", not "###")')

    let ariaLabel = await tocButton.getAttribute('aria-label')
    assertTrue(ariaLabel === 'Remove table of contents', `button recognizes its own output as active (aria-label: "${ariaLabel}")`)

    // Second click: must REMOVE the block (proves recognition works), not
    // insert a second, unrecognized one on top of it -- the core bug.
    await tocButton.click()
    await page.waitForTimeout(200)
    text = await editorText()
    console.log('  after second click (should be removed):\n' + text.split('\n').map((l) => `    ${l}`).join('\n'))
    assertTrue(!text.includes('Table of Contents'), 'second click removed the block entirely (not a second orphaned insert)')
    ariaLabel = await tocButton.getAttribute('aria-label')
    assertTrue(ariaLabel === 'Insert table of contents', `button state reverted correctly (aria-label: "${ariaLabel}")`)

    // Third + fourth click: insert again, then reload the page (forces a
    // fresh read of persisted note text, same as reopening the note) and
    // confirm the button still recognizes it as active post-reload.
    await tocButton.click()
    await page.waitForTimeout(200)
    text = await editorText()
    assertTrue(text.includes('### Table of Contents'), 'third click (re-insert) is level 3 again')
    assertTrue((text.match(/Table of Contents/g) ?? []).length === 1, 'exactly one TOC block present -- no accumulation across insert/remove/insert cycle')

    // Give the debounced save queue time to actually flush the toolbar
    // edit to persisted storage before reloading -- a page reload only
    // proves persistence if the edit was actually written first.
    await page.waitForTimeout(1200)
    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(600)
    text = await editorText()
    assertTrue(text.includes('### Table of Contents'), 'TOC block survives reload/reopen, still level 3')
    ariaLabel = await tocButton.getAttribute('aria-label')
    assertTrue(ariaLabel === 'Remove table of contents', `button still recognizes it as active after reopening the note (aria-label: "${ariaLabel}")`)

    // The chapter's own title heading must never have been touched/renamed.
    assertTrue(text.includes('## Arrival'), 'chapter\'s own level-2 title is untouched')

    // Sanity check: a REGULAR (non-chapter) note must still get the
    // original, unchanged level-2 behavior -- this fix must not regress it.
    await page.evaluate(async () => {
      const note = await window.thockdownNotes.createNote({ initialText: '# Plain Note\n\n## Section One\nBody.' })
      await window.thockdownSections.setActiveNote('default', note.id)
    })
    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(400)
    assertTrue((await editorText()).includes('Plain Note'), 'plain note is active and loaded in the editor')
    await tocButton.click()
    await page.waitForTimeout(200)
    text = await editorText()
    console.log('  regular note after click:\n' + text.split('\n').map((l) => `    ${l}`).join('\n'))
    assertTrue(text.includes('## Table of Contents'), 'regular (non-chapter) note still gets the original level-2 TOC block')
    ariaLabel = await tocButton.getAttribute('aria-label')
    assertTrue(ariaLabel === 'Remove table of contents', 'regular note button still recognizes its own level-2 output as active')

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
