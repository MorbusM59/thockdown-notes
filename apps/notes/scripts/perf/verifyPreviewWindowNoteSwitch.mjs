#!/usr/bin/env node
// The windowed preview re-plans its window for a NEW DOCUMENT and keeps it
// across an EDIT. This checks both halves of that, since they are the two
// directions the same dependency list can be wrong in.
//
// It exists because the fix that stopped a keystroke from rebuilding the
// window (usePreviewWindow.tsx's re-plan effect) works by no longer watching
// the document's text -- and the failure mode of getting that wrong is not a
// crash but a window left pointing at the previous note's block indices, or
// one that never opens at all because it was planned before the text arrived.
// Neither is visible to a unit test of the pure range helpers.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  generateSyntheticDocument,
  waitForAppReady,
  ensurePreviewMode,
} from './perfHarness.mjs'

function resolveChromiumExecutable() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).find((n) => n.startsWith('chromium-') && !n.includes('headless'))
  if (!dir) return undefined
  for (const rel of [['chrome-win', 'chrome.exe'], ['chrome-linux', 'chrome'], ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']]) {
    const candidate = path.join(root, dir, ...rel)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const port = Number(process.env.PORT || 5197)
let failures = 0
const check = (ok, label, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? ' -- ' + detail : ''))
}

const readWindow = (page) => page.evaluate(() => {
  const preview = document.querySelector('.markdown-preview')
  const mounted = [...(preview?.querySelectorAll('.preview-window > [data-index]') ?? [])]
    .map((el) => Number(el.getAttribute('data-index')))
    .filter((n) => Number.isFinite(n))
  return {
    count: mounted.length,
    first: mounted.length ? Math.min(...mounted) : null,
    last: mounted.length ? Math.max(...mounted) : null,
    scrollTop: preview ? Math.round(preview.scrollTop) : null,
    // Block 0's own text, NOT the pane's textContent: the window's first
    // child is the typography probe (whose ruler sentence is the same in
    // every note), and the tail probe's hidden host renders the document's
    // LAST blocks ahead of the real ones in DOM order. Either would answer
    // the wrong question about which note is on screen.
    blockZeroText: (document.querySelector('.preview-window > [data-index="0"]')?.textContent || '').slice(0, 40),
  }
})

const server = await startDevServer(port)
const browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutable() })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto('http://localhost:' + port + '/', { waitUntil: 'domcontentloaded' })
  await waitForAppReady(page)

  // One chunked document, marked at its first block. The second document this
  // check needs is made through the app's own new-note button further down
  // rather than seeded here: a note created through the mock bridge never
  // joins the section's tab bar, so there would be no way to reach it the way
  // a reader does.
  await page.evaluate(async (text) => {
    const note = await window.thockdownNotes.createNote({ initialText: text })
    await window.thockdownSections.setActiveNote('default', note.id)
  }, 'ALPHA-NOTE-MARKER\n\n' + generateSyntheticDocument(500_000))

  await page.reload()
  await ensurePreviewMode(page)
  await page.waitForTimeout(1500)

  const opened = await readWindow(page)
  check(opened.count > 0, 'a freshly opened note mounts a window', opened.count + ' blocks at ' + opened.first + '..' + opened.last)
  check(opened.first === 0, 'the window opens at the start of the document', 'first block ' + opened.first)
  check(opened.blockZeroText.includes('ALPHA'), 'the first note is the one on screen', JSON.stringify(opened.blockZeroText.trim().slice(0, 20)))

  // Travel far from the start, so a stale window would be obvious. Driven by
  // the scroller rather than a key: the render view is not an editor and does
  // not answer to End.
  for (let i = 0; i < 12; i += 1) {
    await page.evaluate(() => {
      const preview = document.querySelector('.markdown-preview')
      if (preview) preview.scrollTop = preview.scrollHeight
    })
    await page.waitForTimeout(160)
  }
  await page.waitForTimeout(600)
  const travelled = await readWindow(page)
  check(travelled.first > 0, 'the window follows the reader away from the start', 'first block ' + travelled.first)

  // A DIFFERENT document must re-plan. The previous note's block indices mean
  // nothing in the new one, and a window left holding them is exactly the
  // failure this fix could have introduced by no longer watching the text.
  //
  // Switched through the app's own new-note button, NOT through
  // window.thockdownSections.setActiveNote -- the dev-mode mock bridge only
  // updates persisted section state and does not push a live update into the
  // running React app (see seedLargeNoteAndReload's note in perfHarness.mjs).
  // An earlier version of this script called the bridge and read "the window
  // never moved" as a failure of the fix, when no switch had happened at all.
  await page.locator('.note-tab-pill.create-pill').first().click()
  await page.waitForTimeout(2000)

  const fresh = await readWindow(page)
  check(
    fresh.last === null || fresh.last < travelled.first,
    'switching to a new document re-plans the window off the old one',
    'mounted ' + fresh.first + '..' + fresh.last + ' (was ' + travelled.first + '..' + travelled.last + ')',
  )

  // NOT CHECKED HERE: switching BACK to the original note. There is no way
  // to do it from this fixture -- after the new-note click the section's tab
  // bar holds exactly one tab (the new note), so the seeded note has no tab
  // to return through, and clicking the only one available lands on an empty
  // note whose window is legitimately empty. An earlier version of this
  // script read that empty window as a failure; it reproduced identically
  // against the unfixed code, which is what identified it as a fact about
  // the fixture rather than about the window.

  check(errors.length === 0, 'no page errors throughout', errors.slice(0, 2).join(' | '))

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
  process.exitCode = failures === 0 ? 0 : 1
} finally {
  await browser.close().catch(() => {})
  await server.stop()
}
