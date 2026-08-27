// Regression check for the preview measurement prewarm's blast radius.
//
// The prewarm renders real markdown blocks into a hidden host inside the
// virtualizer's spacer (see src/editorSection/previewMeasurementPrewarm.ts).
// That host sits in the same scroller the reader is looking at, so the things
// that could go wrong are not about measurement accuracy -- that is what
// measurePreviewMeasurementCache.mjs covers -- but about it leaking:
//
//   1. it must never be visible;
//   2. it must never extend the scrollable area (a host that added its own
//      height would inflate the scrollbar it exists to make accurate);
//   3. it must disappear once the sweep finishes, leaving no permanent DOM;
//   4. it must not break the edit <-> render round trip;
//   5. it must not throw.
//
// Usage: node scripts/perf/verifyPreviewPrewarmSafety.mjs

import { chromium } from 'playwright'
import { startDevServer, generateSyntheticDocument } from './perfHarness.mjs'

const PORT = 5196
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

async function main() {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 200)))
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 200)) })

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await page.waitForTimeout(2000)

    await page.evaluate(async (initialText) => {
      const note = await window.thockdownNotes.createNote({ initialText })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, generateSyntheticDocument(300000))
    await page.reload()
    await page.waitForSelector('.markdown-preview', { timeout: 90000 })

    // --- while the sweep is running ---
    const live = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      const worst = { visible: false, overflowPx: 0, sawHost: false }
      for (let i = 0; i < 80; i++) {
        const host = scroller.querySelector('[data-prewarm-index]')?.parentElement
        if (host) {
          worst.sawHost = true
          const style = getComputedStyle(host)
          if (style.visibility !== 'hidden') worst.visible = true
          const spacer = scroller.querySelector(':scope > div[style*="height"]')
          const overflow = scroller.scrollHeight - (parseFloat(spacer.style.height) || 0)
          // A little slack for the scroller's own padding.
          if (overflow > 80) worst.overflowPx = Math.max(worst.overflowPx, Math.round(overflow))
        }
        await new Promise((r) => setTimeout(r, 25))
      }
      return worst
    })
    check('the prewarm host actually ran', live.sawHost)
    check('the prewarm host is never visible', !live.visible)
    check('the prewarm host never extends the scrollable area', live.overflowPx === 0, live.overflowPx ? `${live.overflowPx}px of overflow` : '')

    // --- after it settles ---
    await page.waitForTimeout(3000)
    const settled = await page.evaluate(() => ({
      leftoverNodes: document.querySelectorAll('[data-prewarm-index]').length,
      totalSizePx: Math.round(parseFloat(document.querySelector('.markdown-preview > div[style*="height"]').style.height) || 0),
    }))
    check('no prewarm DOM is left behind once the sweep finishes', settled.leftoverNodes === 0, `${settled.leftoverNodes} nodes`)
    check('the total size is a real measurement, not the flat estimate', settled.totalSizePx > 40000, `${settled.totalSizePx}px`)

    // --- the round trip is still stable ---
    // Deliberately measured AFTER a warm-up toggle. Restore is block-quantized
    // by design (see the scroll-sync rewrite in
    // docs/cm6-parity-hardening-plan.md): it lands on the persisted
    // anchorBlockIndex plus a fixed one-line offset, so the very first toggle
    // out of an arbitrary mid-block scroll position legitimately moves by up
    // to a block -- measured at ~1400-1500px on this document with and without
    // the prewarm alike. What must not regress is that a settled position then
    // stays put, which is what this asserts.
    const scrollAndRoundTrip = async (target) => {
      const before = await page.evaluate(async (top) => {
        const scroller = document.querySelector('.markdown-preview')
        scroller.scrollTop = top
        await new Promise((r) => setTimeout(r, 700))
        return Math.round(scroller.scrollTop)
      }, target)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(1200)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(1500)
      const after = await page.evaluate(() => Math.round(document.querySelector('.markdown-preview').scrollTop))
      return { before, after, drift: Math.abs(after - before) }
    }

    await scrollAndRoundTrip(20000)
    const settledTrip = await scrollAndRoundTrip(28000)
    check('a settled position survives render -> edit -> render', settledTrip.drift < 50,
      `drifted ${settledTrip.drift}px (${settledTrip.before} -> ${settledTrip.after})`)

    // --- typography changes must invalidate the cache ---
    // Preview font size, line height, letter spacing and edge padding arrive as
    // inline styles on the scroller. None of them changes the block list, and
    // none changes clientWidth (padding is inside clientWidth), so an
    // invalidation keyed on either misses all of them -- measured, before the
    // probe existed, at 2,590px / 2,014px / 396px of jump-to-bottom error.
    // These assert the property the reader actually feels.
    const sizingCases = [
      ['font size', "s.style.fontSize = '24px'"],
      ['line height', "s.style.lineHeight = '2.2'"],
      ['letter spacing', "s.style.letterSpacing = '0.18em'"],
      ['edge padding', "s.style.setProperty('--preview-edge-padding', '60px')"],
    ]
    for (const [label, mutation] of sizingCases) {
      await page.evaluate(`(() => { const s = document.querySelector('.markdown-preview'); ${mutation}; })()`)
      // Long enough for the probe's ResizeObserver to fire and the sweep to
      // re-run; the sweep itself settles in ~1.3s on this document.
      await page.waitForTimeout(4000)
      const missed = await page.evaluate(async () => {
        const scroller = document.querySelector('.markdown-preview')
        scroller.style.scrollBehavior = 'auto'
        scroller.scrollTop = scroller.scrollHeight
        await new Promise((r) => setTimeout(r, 1500))
        return Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop)
      })
      check(`a ${label} change re-measures the document`, Math.abs(missed) < 60, `jump-to-bottom missed the end by ${missed}px`)
    }

    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  } finally {
    await browser.close()
    await server.stop()
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed`)
    process.exit(1)
  }
  console.log('\nall checks passed')
}

main().catch((err) => { console.error(err); process.exit(1) })
