// Baseline measurement for the preview virtualizer's measurement cache.
//
// The preview pane virtualizes blocks with @tanstack/react-virtual and a FLAT
// per-block size estimate (PREVIEW_BLOCK_ESTIMATED_HEIGHT_PX, 56px). Any block
// the user has not scrolled past is still that estimate, which produces two
// user-visible defects on a large document:
//
//   A. Scrollbar navigation is unreliable -- dragging/clicking to the bottom
//      lands at the true end only if the document has already been scrolled
//      through (or is short enough that everything is measured).
//   B. A long auto-scroll flickers, because every newly-mounted block replaces
//      its estimate with a real height and the total size jumps under the thumb.
//
// This script quantifies both, so a fix has a number to beat rather than a
// vibe. It measures nothing about the fix itself -- run it before and after.
//
// Usage: node scripts/perf/measurePreviewMeasurementCache.mjs [--chars=300000]
//
// Per docs/document-scale-performance-philosophy.md: live-browser measurement,
// not code-reading. Uses the shared harness (real Chromium via Playwright, not
// the embedded browser pane -- see perfHarness.mjs for why).

import { chromium } from 'playwright'
import { startDevServer, generateSyntheticDocument } from './perfHarness.mjs'

const PORT = 5199
// Lets a sandbox whose bundled Chromium doesn't match this repo's pinned
// Playwright point at the one it does have. Unset on a normal machine, where
// Playwright resolves its own browser.
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const chars = Number((process.argv.find((a) => a.startsWith('--chars=')) ?? '--chars=300000').split('=')[1])

/** The virtualizer's total size is the height of the spacer div it renders. */
const READ_GEOMETRY = () => {
  const scroller = document.querySelector('.markdown-preview')
  if (!scroller) return null
  const spacer = scroller.querySelector(':scope > div[style*="height"]')
  return {
    totalSizePx: spacer ? Math.round(parseFloat(spacer.style.height) || 0) : 0,
    scrollHeightPx: Math.round(scroller.scrollHeight),
    clientHeightPx: Math.round(scroller.clientHeight),
    scrollTopPx: Math.round(scroller.scrollTop),
    mountedBlocks: scroller.querySelectorAll('[data-index]').length,
  }
}

async function main() {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await page.waitForTimeout(2000)

    const text = generateSyntheticDocument(chars)
    // Deliberately NOT perfHarness's seedLargeNoteAndReload: that one waits for
    // the edit-mode contenteditable to become *visible*, and a restored note
    // comes back in preview mode, where the edit pane is legitimately hidden --
    // so it times out here for a reason that has nothing to do with this
    // measurement. Seeding the same way and waiting for the preview instead.
    await page.evaluate(async (initialText) => {
      const note = await window.thockdownNotes.createNote({ initialText })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, text)
    await page.reload()
    await page.waitForSelector('.markdown-preview', { timeout: 90000 })
    await page.waitForTimeout(300)

    // If the section came back in edit mode, Escape flips it to render.
    const inPreview = await page.evaluate(() => !!document.querySelector('.editor-stage.is-preview-mode'))
    if (!inPreview) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(1500)
    }

    // How long the background prewarm takes to converge, and what it costs the
    // main thread while it runs. "Doesn't eat performance" is the constraint
    // this feature lives or dies by, so it is measured, not assumed.
    const settle = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      const spacer = scroller.querySelector(':scope > div[style*="height"]')
      const readSize = () => Math.round(parseFloat(spacer.style.height) || 0)

      const frames = []
      let last = performance.now()
      let running = true
      const tick = () => {
        const now = performance.now()
        frames.push(now - last)
        last = now
        if (running) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)

      // Completion is "the sweep stopped rendering batches", NOT "the total
      // size stopped changing". The survey buffers its measurements and commits
      // them in one go at the end precisely so the total size does NOT move
      // while it runs, so watching the size for stability reports success
      // immediately and measures a document that has not been surveyed yet.
      const startedAt = performance.now()
      let idleSince = performance.now()
      while (performance.now() - startedAt < 30000) {
        await new Promise((r) => setTimeout(r, 50))
        if (document.querySelector('[data-prewarm-index]')) idleSince = performance.now()
        else if (performance.now() - idleSince > 700 && readSize() > 0) break
      }
      const stableSince = idleSince
      running = false

      const sorted = [...frames].sort((a, b) => a - b)
      return {
        settleMs: Math.round(stableSince - startedAt),
        frames: frames.length,
        medianFrameMs: Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 10) / 10,
        worstFrameMs: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
        framesOver50ms: frames.filter((f) => f > 50).length,
        framesOver100ms: frames.filter((f) => f > 100).length,
      }
    })
    console.log(`prewarm settle:`, JSON.stringify(settle))

    const cold = await page.evaluate(READ_GEOMETRY)
    console.log(`document: ${text.length} chars, ${text.split('\n').length} lines`)
    console.log(`cold (nothing measured yet):`, JSON.stringify(cold))

    // --- Defect A: does "jump to the bottom" actually land at the end? ---
    const jump = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      const before = Math.round(scroller.scrollHeight)
      scroller.style.scrollBehavior = 'auto'
      scroller.scrollTop = scroller.scrollHeight
      await new Promise((r) => setTimeout(r, 1200))
      const after = Math.round(scroller.scrollHeight)
      const distanceFromEnd = Math.round(after - scroller.clientHeight - scroller.scrollTop)
      return { assumedHeight: before, heightAfterLanding: after, distanceFromEndPx: distanceFromEnd }
    })
    console.log(`jump-to-bottom:`, JSON.stringify(jump))

    // --- Defect B: how much does the total size churn during a long scroll? ---
    await page.evaluate(() => {
      const scroller = document.querySelector('.markdown-preview')
      scroller.scrollTop = 0
      window.__sizeSamples = []
    })
    await page.waitForTimeout(600)
    const churn = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      const spacer = scroller.querySelector(':scope > div[style*="height"]')
      const samples = []
      const step = Math.round(scroller.clientHeight * 0.9)
      // Walk the document a viewport at a time, sampling the total size after
      // each hop -- every change is a jump the scroll thumb would have shown.
      for (let i = 0; i < 60; i++) {
        scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        samples.push(Math.round(parseFloat(spacer.style.height) || 0))
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) break
      }
      let changes = 0
      let biggestJump = 0
      for (let i = 1; i < samples.length; i++) {
        const delta = Math.abs(samples[i] - samples[i - 1])
        if (delta > 0) changes += 1
        if (delta > biggestJump) biggestJump = delta
      }
      return { hops: samples.length, totalSizeChanges: changes, biggestJumpPx: biggestJump, first: samples[0], last: samples[samples.length - 1] }
    })
    console.log(`scroll churn:`, JSON.stringify(churn))

    // --- Ground truth: everything measured after a full walk ---
    const warm = await page.evaluate(READ_GEOMETRY)
    console.log(`warm (fully walked):`, JSON.stringify(warm))

    const estimateErrorPct = cold.totalSizePx > 0
      ? Math.round(((warm.totalSizePx - cold.totalSizePx) / warm.totalSizePx) * 1000) / 10
      : 0
    console.log('')
    console.log(`SUMMARY`)
    console.log(`  cold total size:      ${cold.totalSizePx}px (all blocks estimated)`)
    console.log(`  true total size:      ${warm.totalSizePx}px`)
    console.log(`  cold estimate is off by ${estimateErrorPct}% of the real document height`)
    console.log(`  jump-to-bottom missed the end by ${jump.distanceFromEndPx}px`)
    console.log(`  total size changed ${churn.totalSizeChanges}x over ${churn.hops} viewport hops, biggest single jump ${churn.biggestJumpPx}px`)
  } finally {
    await browser.close()
    await server.stop()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
