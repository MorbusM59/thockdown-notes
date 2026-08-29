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
  const cdp = await page.context().newCDPSession(page)
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

    // Put the typography back. These mutations are cumulative and were never
    // undone, so every check after this point used to run against a document
    // set in 24px on 2.2 line-height with 0.18em of letter spacing and 60px of
    // padding -- which made the totals they report describe a document nobody
    // was asking about. Harmless while those checks only compared a number
    // against itself; actively misleading to read.
    await page.evaluate(() => {
      const s = document.querySelector('.markdown-preview')
      s.style.fontSize = ''
      s.style.lineHeight = ''
      s.style.letterSpacing = ''
      s.style.removeProperty('--preview-edge-padding')
    })
    await page.waitForTimeout(4000)

    // --- the survey must be invisible on slow hardware ---
    // This is why the survey buffers and commits once. Measured at 6x CPU
    // throttle, parked mid-document with no input, when it applied each height
    // as it was measured: 115 total-size changes (the thumb crawling) and 96
    // scrollTop compensations totalling 25,280px (the text vibrating), over
    // twelve seconds. With the survey disabled entirely the same window shows
    // 1 change and 0 moves, so that churn was entirely self-inflicted -- and
    // invisible on fast hardware, where the whole survey is over in ~1.3s.
    await page.reload()
    await page.waitForSelector('.markdown-preview', { timeout: 90000 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    const quiet = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      const spacer = scroller.querySelector(':scope > div[style*="height"]')
      const size = () => Math.round(parseFloat(spacer.style.height) || 0)
      scroller.style.scrollBehavior = 'auto'
      scroller.scrollTop = 12000
      await new Promise((r) => setTimeout(r, 500))

      // Track a block the reader is looking at: what must not move is the
      // content on screen, not scrollTop, which legitimately shifts when the
      // survey commits (the coordinate system changes; the view does not).
      const anchor = [...scroller.querySelectorAll('[data-index]')][2]
      const anchorIndex = anchor?.dataset.index
      const firstTop = anchor ? Math.round(anchor.getBoundingClientRect().top) : 0

      let sizeChanges = 0
      let worstDrift = 0
      let lastSize = size()
      const startedAt = performance.now()
      while (performance.now() - startedAt < 10000) {
        await new Promise((r) => requestAnimationFrame(r))
        if (size() !== lastSize) { sizeChanges += 1; lastSize = size() }
        const el = scroller.querySelector(`[data-index="${anchorIndex}"]`)
        if (el) worstDrift = Math.max(worstDrift, Math.abs(Math.round(el.getBoundingClientRect().top) - firstTop))
      }
      return { sizeChanges, worstDrift }
    })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    check('the survey does not move the reader\'s content on slow hardware', quiet.worstDrift === 0, `content drifted ${quiet.worstDrift}px`)
    check('the survey does not churn the scrollbar while it runs', quiet.sizeChanges <= 4, `total size changed ${quiet.sizeChanges}x`)

    // --- a geometry already surveyed must not be surveyed again ---
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await page.reload()
    // 'attached', not 'visible': the earlier round-trip checks left this
    // section in edit mode, and a note restored in edit mode has a preview
    // pane that is mounted but legitimately hidden.
    await page.waitForSelector('.markdown-preview', { state: 'attached', timeout: 90000 })
    await page.waitForTimeout(500)
    if (!(await page.evaluate(() => !!document.querySelector('.editor-stage.is-preview-mode')))) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(1200)
    }
    const waitForSurveyEnd = async () => {
      // Debounced 300ms after the geometry settles, so give the restart a
      // chance to begin before concluding it never did.
      await page.waitForTimeout(1400)
      for (let i = 0; i < 400; i++) {
        if (!(await page.evaluate(() => !!document.querySelector('.preview-discovery-shell')))) return
        await page.waitForTimeout(100)
      }
    }
    const totalSize = () => page.evaluate(() => Math.round(parseFloat(document.querySelector('.markdown-preview > div[style*="height"]').style.height) || 0))
    const sawBarWhile = async (act) => {
      let saw = false
      const poll = setInterval(async () => {
        try { if (await page.evaluate(() => !!document.querySelector('.preview-discovery-shell'))) saw = true } catch { /* page busy */ }
      }, 60)
      await act()
      clearInterval(poll)
      return saw
    }

    await waitForSurveyEnd()
    const atWide = await totalSize()
    await page.setViewportSize({ width: 1100, height: 900 })
    await waitForSurveyEnd()
    const atNarrow = await totalSize()
    check('a new geometry produces a different measured height', atNarrow !== atWide, `${atWide}px -> ${atNarrow}px`)

    const barOnReturn = await sawBarWhile(async () => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.waitForTimeout(1600)
    })
    const backAtWide = await totalSize()
    // Not exact equality: the handful of blocks mounted while the pane was at
    // the other width get re-measured for real on the way back, and those land
    // sub-pixel differently -- measured at 2px across a 49,504px document,
    // 0.004%. A genuine cache miss is not a near miss; it would show the OTHER
    // geometry's height, ~11,000px out on this document.
    check('returning to a surveyed geometry re-uses it', Math.abs(backAtWide - atWide) < 100, `${backAtWide}px vs ${atWide}px`)
    check('returning to a surveyed geometry does not re-survey', !barOnReturn)

    // --- but an edit must throw those remembered surveys away ---
    // The heights are only valid for the text they were measured from; serving
    // them after an edit would be the "confidently wrong" failure this whole
    // feature has to avoid.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1200)
    await page.click('.editor-text')
    await page.keyboard.type('\n\n## An inserted heading\n\nAnd a fresh paragraph of text that did not exist when the survey ran.\n')
    await page.waitForTimeout(1200)
    await page.keyboard.press('Escape')
    await waitForSurveyEnd()
    const afterEdit = await totalSize()
    check('an edit invalidates the remembered surveys', afterEdit !== backAtWide, `${backAtWide}px -> ${afterEdit}px`)

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
