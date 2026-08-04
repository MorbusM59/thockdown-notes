#!/usr/bin/env node
// Diagnostic (not yet a committed regression check) for a user-reported bug:
// on a very large note, pressing ArrowUp to walk the caret line-by-line
// occasionally scrolls the viewport down ~5 lines instead of up 1, right
// around the point where the caret crosses into a CM6-rendered region that
// wasn't previously drawn/measured. See docs/cm6-parity-hardening-plan.md's
// "Phase 4" lead #4 for the working hypothesis this script exists to
// confirm or refute -- per this project's own process discipline, this must
// be measured live before anything is called a diagnosis.
//
// Strategy: seed a huge synthetic note, place the caret near the end, then
// press ArrowUp a few thousand times while recording scroller.scrollTop and
// the caret's screen-relative row *before* and *after* each press. A normal
// press should move scrollTop by 0 or -lineHeightPx (caging keeps the caret
// in view once it nears a boundary); anything else is an anomaly, logged
// with enough surrounding context to reproduce by hand afterward.
//
// Run: node scripts/perf/verifyCM6ArrowUpChunkBoundary.mjs [--chars=N] [--presses=N] [--port=N] [--headed]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  seedLargeNoteAndReload,
  placeCaretAt,
} from './perfHarness.mjs'

/**
 * Plain, uniform, non-wrapping lines only -- deliberately not
 * generateSyntheticDocument's mixed headings/lists/blockquotes, whose
 * differently-styled lines (larger heading font, etc.) would give
 * neighboring .cm-lines different heights and make a single measured
 * lineHeightPx unreliable for detecting a real scroll anomaly. Uniformity
 * here is what makes "did scrollTop move by other than 0 or -1 line" a
 * clean signal.
 */
function generateUniformDocument(targetChars) {
  const lines = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    const line = `Line ${i}: plain uniform content, short enough not to wrap in an 1280px-wide editor.`
    lines.push(line)
    total += line.length + 1
    i += 1
  }
  return lines.join('\n')
}

function parseArgs(argv) {
  const args = { chars: 1_200_000, presses: 3000, port: 5187, headed: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key === 'chars') args.chars = Number(value)
    else if (key === 'presses') args.presses = Number(value)
    else if (key === 'port') args.port = Number(value)
  }
  return args
}

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidates = [
    path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome'),
    path.join(browsersRoot, chromiumDir, 'chrome-win', 'chrome.exe'),
  ]
  return candidates.find((c) => existsSync(c))
}

async function readState(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')
    const lines = Array.from(document.querySelectorAll('.cm-line'))
    const tops = lines.map((el) => el.getBoundingClientRect().top).sort((a, b) => a - b)
    // Median consecutive-line delta across every currently-mounted line,
    // not just the first two -- robust against any one pair straddling a
    // gap (e.g. a not-yet-measured/virtualized boundary, which is exactly
    // the phenomenon under test) skewing a two-sample measurement.
    const deltas = []
    for (let i = 1; i < tops.length; i += 1) deltas.push(tops[i] - tops[i - 1])
    deltas.sort((a, b) => a - b)
    const medianDelta = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : null
    const sel = document.getSelection()
    let caretTop = null
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0).cloneRange()
      range.collapse(true)
      const rects = range.getClientRects()
      if (rects.length > 0) caretTop = rects[0].top
      else {
        // Collapsed range at a line boundary sometimes yields no rects --
        // fall back to the containing element's rect.
        const node = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
        caretTop = node?.getBoundingClientRect().top ?? null
      }
    }
    return {
      scrollTop: scroller ? scroller.scrollTop : null,
      scrollHeight: scroller ? scroller.scrollHeight : null,
      clientHeight: scroller ? scroller.clientHeight : null,
      visibleLineCount: lines.length,
      medianLineDelta: medianDelta,
      caretTop,
    }
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.error(`[verify] starting dev server on port ${args.port}...`)
  const server = await startDevServer(args.port)

  let browser
  try {
    browser = await chromium.launch({
      headless: !args.headed,
      executablePath: resolveChromiumExecutablePath(),
    })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`http://localhost:${args.port}/`)

    console.error(`[verify] generating uniform document (~${args.chars} chars)...`)
    const text = generateUniformDocument(args.chars)

    console.error('[verify] seeding note and reloading...')
    await seedLargeNoteAndReload(page, text)

    console.error('[verify] placing caret at "end"...')
    await placeCaretAt(page, 'end')

    const initial = await readState(page)
    const lineHeightPx = initial.medianLineDelta
    console.error('[verify] initial state:', initial, 'lineHeightPx (measured):', lineHeightPx)

    const anomalies = []
    let prev = initial
    for (let i = 0; i < args.presses; i += 1) {
      await page.keyboard.press('ArrowUp')
      // No artificial wait -- pressing at native repeat cadence is exactly
      // when this bug was reported ("pressing Up... to move the caret").
      // A short settle wait would mask a transient mid-reconcile jump.
      const next = await readState(page)

      if (prev.scrollTop !== null && next.scrollTop !== null && lineHeightPx) {
        const scrollDeltaPx = next.scrollTop - prev.scrollTop
        const scrollDeltaLines = scrollDeltaPx / lineHeightPx
        // Expected per ArrowUp: scrollTop unchanged (caret still caged) or
        // decreases by ~1 line (caret pinned at a cage boundary while
        // scrolling up). Anything that *increases* scrollTop, or changes by
        // more than ~1.5 lines in either direction, is the reported anomaly.
        if (scrollDeltaLines > 0.5 || scrollDeltaLines < -1.5) {
          anomalies.push({
            pressIndex: i,
            scrollDeltaPx,
            scrollDeltaLines: Number(scrollDeltaLines.toFixed(2)),
            prev,
            next,
          })
        }
      }
      prev = next
    }

    console.error(`[verify] done. ${anomalies.length} anomalies out of ${args.presses} ArrowUp presses.`)
    console.log(JSON.stringify({ chars: args.chars, presses: args.presses, lineHeightPx, anomalies }, null, 2))
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
