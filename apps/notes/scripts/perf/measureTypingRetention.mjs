#!/usr/bin/env node
// How much memory does typing into a large note keep alive?
//
// Opens a 2MB note (dropped in as an external file, the one path the browser
// mock can hand a large document through) in edit mode and types in CYCLES:
// twenty characters 120ms apart, then a pause long enough for the save queue
// (350ms debounce) to save. So every cycle exercises both ways typing can
// retain the document -- per keystroke, and per save.
//
// The property is a FIXED POINT: once a couple of warm-up cycles have filled
// every bounded cache (the editor's previous text, the inline-state cache,
// the word-count baseline, the block-split cache...), further cycles must not
// grow the heap. Asserted as total growth over the measured cycles staying
// under one document copy -- i.e. nothing is retained per cycle.
//
// On a production build (`vite build --mode browser` + `vite preview`), so
// React's development-only fields (`_debugOwner` and friends) cannot hold
// anything. The heap is read through CDP after a forced GC:
// `performance.memory` is quantized unless Chromium runs with
// --enable-precise-memory-info, and read that way this script reported a
// flat heap through a 375MB leak.
//
// What it found: every keystroke kept about one full copy of the document
// alive for good (+267MB after 120 characters, linear). Every copy was held by
// a chain of stale render scopes -- memoized callbacks keep the scope they
// were created in, which holds the memoized callbacks current then, and so
// on -- and each scope held the text because the text was React state
// passed down as a string. See editorSection/useDisplayedNoteText.ts.
//
// Still FAILS as of this revision, at one document copy per cycle: a save
// hands back a note summary carrying the note's full text
// (`NoteSummary.contentText`), and the same chains keep the old summaries.
// See TODO.md.

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
const KEYS_PER_CYCLE = 20
const WARMUP_CYCLES = 2
const MEASURED_CYCLES = 8
const MAX_RETAINED_COPIES = 1

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
  const docMb = DOC_CHARS / 1e6
  const cycle = async () => {
    for (let k = 0; k < KEYS_PER_CYCLE; k += 1) { await page.keyboard.type('x'); await page.waitForTimeout(120) }
    await page.waitForTimeout(1500)
    return heapMb()
  }

  console.log(`      after open: ${(await heapMb()).toFixed(1)}MB`)
  for (let n = 1; n <= WARMUP_CYCLES; n += 1) console.log(`      warm-up ${n}: ${(await cycle()).toFixed(1)}MB`)
  const base = await heapMb()
  let end = base
  for (let n = 1; n <= MEASURED_CYCLES; n += 1) {
    end = await cycle()
    console.log(`      cycle ${n}: ${end.toFixed(1)}MB`)
  }

  // A pass is only evidence if the keystrokes reached the document.
  const expected = (WARMUP_CYCLES + MEASURED_CYCLES) * KEYS_PER_CYCLE
  const typedCount = await page.evaluate(() => (document.querySelector('.cm-content')?.textContent ?? '').match(/x+$/)?.[0].length ?? 0)
  if (typedCount < expected) {
    console.log(`FAIL  only ${typedCount} of ${expected} keystrokes reached the document; the measurement is void`)
    failed = true
  }
  const copies = (end - base) / docMb
  failed = failed || copies > MAX_RETAINED_COPIES
  console.log(`${failed ? 'FAIL' : 'PASS'}  ${MEASURED_CYCLES} cycles of ${KEYS_PER_CYCLE} keystrokes and a save retained ${(end - base).toFixed(1)}MB, ${copies.toFixed(1)} document copies (limit ${MAX_RETAINED_COPIES}); ${((end - base) / MEASURED_CYCLES).toFixed(2)}MB per cycle`)
} finally {
  await browser.close()
  await server.stop()
}
process.exit(failed ? 1 : 0)
