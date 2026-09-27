#!/usr/bin/env node
// How much memory does typing into a large note keep alive?
//
// Opens a 2MB note (dropped in as an external file, the one path the browser
// mock can hand a large document through), types 120 characters in edit
// mode, and reads the JS heap after a forced GC every 20 characters. On a
// production build (`vite build --mode browser` + `vite preview`), so React's
// development-only fields (`_debugOwner` and friends) cannot hold anything.
//
// What it found, and what it guards: every keystroke kept about one full copy
// of the document alive for good -- ~3.1MB per character on a 2MB note, +375MB
// after 120, linear with no plateau; ~50KB per character on a 20KB note. A
// heap snapshot attributed every copy to chains of stale closure contexts:
// memoized callbacks that close over the document text (or over objects that
// carry it: the section handle, the formatting toolbar's actions, the
// snapshot timeline) keep an older render's scope alive, whose captured
// callbacks keep an older one alive, and so on. See TODO.md.
//
// Asserts that retention stays under MAX_RETAINED_COPIES document copies over
// the whole run. That FAILS on main as of this script's commit; it is the gate
// for the fix, not a description of today.

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startPreviewServer, generateSyntheticDocument, waitForAppReady } from './perfHarness.mjs'

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

const port = Number(process.env.PORT || 5195)
const DOC_CHARS = Number(process.env.DOC_CHARS || 2_000_000)
const KEYSTROKES = 120
const MAX_RETAINED_COPIES = 3

const doc = generateSyntheticDocument(DOC_CHARS)
const server = await startPreviewServer(port)
const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), args: ['--js-flags=--expose-gc'] })
let failed = false
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.addInitScript((big) => {
    window.thockdownExternalFiles = {
      getFileBasename: async () => 'big.md',
      readFileSnapshot: async () => ({ content: big, modifiedAtMs: 1_700_000_000_000 }),
      readFileContent: async () => big,
      writeFileContent: async () => true,
      getPendingFilePaths: async () => [],
      onOpenFile: () => () => {},
    }
  }, doc)
  await page.goto(`http://localhost:${port}/`)
  await waitForAppReady(page)
  const cdp = await page.context().newCDPSession(page)
  const heapMb = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    // CDP rather than performance.memory, which Chromium quantizes into
    // coarse buckets unless launched with --enable-precise-memory-info --
    // read that way, this script reported a flat heap through a 375MB leak.
    return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6
  }
  // Edit mode BEFORE the drop, so the note opens straight into the editor --
  // switching afterwards measured a flat heap and missed the retention.
  const isRender = () => page.evaluate(() => !document.querySelector('.section-render-mode-toggle')?.classList.contains('is-active'))
  if (await isRender()) { await page.locator('.section-render-mode-toggle').first().click(); await page.waitForTimeout(800) }
  await page.evaluate(() => {
    const target = document.querySelector('.editor-section-slot[data-section-id]') ?? document.body
    const transfer = new DataTransfer()
    const file = new File(['x'], 'big.md', { type: 'text/markdown' })
    Object.defineProperty(file, 'path', { value: '/tmp/big.md' })
    transfer.items.add(file)
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await page.waitForSelector('.note-list-item .note-list-column-close button', { timeout: 60_000, state: 'attached' })
  await page.waitForTimeout(3000)
  await page.click('.cm-content')
  await page.keyboard.press('Control+End')
  const start = await heapMb()
  console.log(`      after open: ${start.toFixed(1)}MB`)
  let end = start
  for (let typed = 20; typed <= KEYSTROKES; typed += 20) {
    for (let k = 0; k < 20; k += 1) { await page.keyboard.type('x'); await page.waitForTimeout(120) }
    await page.waitForTimeout(1500)
    end = await heapMb()
    console.log(`      after ${typed} keystrokes: ${end.toFixed(1)}MB`)
  }
  // A pass is only evidence if the keystrokes reached the document.
  const typedCount = await page.evaluate(() => (document.querySelector('.cm-content')?.textContent ?? '').match(/x+$/)?.[0].length ?? 0)
  if (typedCount < KEYSTROKES) {
    console.log(`FAIL  only ${typedCount} of ${KEYSTROKES} keystrokes reached the document; the measurement is void`)
    failed = true
  }
  const docMb = DOC_CHARS / 1e6
  const retainedCopies = (end - start) / docMb
  failed = failed || retainedCopies > MAX_RETAINED_COPIES
  console.log(`${failed ? 'FAIL' : 'PASS'}  typing ${KEYSTROKES} characters retained ${(end - start).toFixed(1)}MB, ${retainedCopies.toFixed(1)} document copies (limit ${MAX_RETAINED_COPIES})`)
} finally {
  await browser.close()
  await server.stop()
}
process.exit(failed ? 1 : 0)
