#!/usr/bin/env node
// Reopening a large external file must not mount the whole document.
//
// Drags a 2MB "external file" into the editor, closes it, and does that again,
// in a slot in edit mode and in one in render view. Asserts that the render
// view's block window never mounts much more than it settles on.
//
// The defect this guards against: on every reopen in render view (never the
// first open, never in edit mode) the pane showed its scroller before it
// mounted the block window, and the window's adjustment passes ran against
// that scroller with no window to measure. Each read "no content" and grew
// the range by a screenful's worth of blocks, so ~110 passes later the range
// was the whole document and was rendered in one commit when the window
// mounted -- ~22,000 nodes laid out synchronously, a 3-4s main-thread freeze
// (the mouse cursor stalled with it). The first open escaped because the
// window was already mounted when its passes began. See usePreviewWindow.tsx's
// `containerEl`.
//
// Measured, for reference, in headless Chromium: before, peak 22,685 window
// nodes and ~3.5s of long tasks per render-view reopen; after, ~220 nodes and
// ~360ms. The long-task time is printed, not asserted: it is the machine's.
//
// The browser mock has no external-file bridge, so one is stubbed here
// (window.thockdownExternalFiles) and a drop event carrying a File with
// Electron's `path` property stands in for a real drag.

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, generateSyntheticDocument, waitForAppReady } from './perfHarness.mjs'

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

const port = Number(process.env.PORT || 5196)
const CYCLES = Number(process.env.CYCLES || 4)
/** How far above its settled size the window may go during an open. */
const PEAK_OVER_SETTLED = 4
let failures = 0
const check = (ok, label, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? ' -- ' + detail : ''))
}

const BIG = generateSyntheticDocument(2_000_000)
const server = await startDevServer(port)
const browser = await chromium.launch({ executablePath: resolveChromiumExecutable() })
try {
  for (const mode of ['edit', 'render']) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    page.on('pageerror', (error) => check(false, `${mode}: no page errors`, error.message.slice(0, 200)))
    await page.addInitScript((big) => {
      window.thockdownExternalFiles = {
        getFileBasename: async () => 'big.md',
        readFileSnapshot: async () => ({ content: big, modifiedAtMs: 1_700_000_000_000 }),
        readFileContent: async () => big,
        writeFileContent: async () => true,
        getPendingFilePaths: async () => [],
        onOpenFile: () => () => {},
      }
      window.__long = 0
      window.__peakWindow = 0
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long += e.duration })
        .observe({ type: 'longtask', buffered: true })
      new MutationObserver(() => {
        const w = document.querySelector('.preview-window')
        if (w) window.__peakWindow = Math.max(window.__peakWindow, w.getElementsByTagName('*').length)
      }).observe(document, { childList: true, subtree: true })
    }, BIG)
    await page.goto(`http://localhost:${port}/`)
    await waitForAppReady(page)
    const isRender = () => page.evaluate(() => !document.querySelector('.section-render-mode-toggle')?.classList.contains('is-active'))
    if ((mode === 'render') !== await isRender()) {
      await page.locator('.section-render-mode-toggle').first().click()
      await page.waitForTimeout(800)
    }

    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      await page.evaluate(() => { window.__long = 0; window.__peakWindow = 0 })
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
      const { longMs, peak, settled } = await page.evaluate(() => ({
        longMs: Math.round(window.__long),
        peak: window.__peakWindow,
        settled: document.querySelector('.preview-window')?.getElementsByTagName('*').length ?? 0,
      }))
      console.log(`      ${mode} open ${cycle}: long tasks ${longMs}ms, window nodes peak ${peak} / settled ${settled}`)
      if (mode === 'render') {
        check(settled > 0, `render open ${cycle}: the window mounted`)
        check(peak <= settled * PEAK_OVER_SETTLED, `render open ${cycle}: the window never mounted more than ${PEAK_OVER_SETTLED}x what it settled on`, `peak ${peak}, settled ${settled}`)
      }
      await page.locator('.note-list-item').first().hover()
      await page.locator('.note-list-item .note-list-column-close button').first().click()
      await page.waitForSelector('.note-list-item .note-list-column-close button', { state: 'detached', timeout: 30_000 })
      await page.waitForTimeout(1000)
    }
    await page.close()
  }
} finally {
  await browser.close()
  await server.stop()
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
