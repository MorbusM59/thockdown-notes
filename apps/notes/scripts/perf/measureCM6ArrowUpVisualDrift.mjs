#!/usr/bin/env node
// Corrected successor to measureCM6ArrowUpDrift.mjs's anomaly metric.
//
// Every anomaly-counting script in this investigation up to this point
// (measureCM6ArrowUpDrift.mjs, measureCM6WrapSensitivityDrift.mjs) flagged a
// press when raw scroller.scrollTop deviated from the naive expected
// per-press delta (-lineHeightPx while pinned at the cage's top boundary).
// Direct instrumentation (attempt 9, docs/cm6-parity-hardening-plan.md)
// found this conflates two very different things: CM6's height-map
// revision event moves scrollTop by a large amount (matching
// view.lineBlockAt(head).top's own equally large jump), but because BOTH
// move together, the caret's REAL on-screen pixel position -- what the user
// actually sees, read directly via the DOM selection Range's own
// getBoundingClientRect().top, not inferred from scrollTop or the
// analytical value -- only nets a small residual (12px in the case that
// prompted this script, well under half a row), not the 6-8 row jump the
// old metric reported.
//
// This script measures the same continuous-ArrowUp-from-end sessions using
// that real, ground-truth signal instead: while pinned at the cage's top
// boundary, the caret's on-screen top should stay constant press to press
// (the cage always re-clamps it to the same visual row). A press whose
// on-screen caret position moves by more than half a row with no boundary
// transition is a genuine, user-visible anomaly; the old metric's "just
// scrollTop churned internally" events are not, and are deliberately not
// flagged here.
//
// Run: node scripts/perf/measureCM6ArrowUpVisualDrift.mjs --chars=100000 --presses=800 [--docType=uniform-nowrap|diverse-with-uniform-run] [--port=N]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  seedLargeNoteAndReload,
  placeCaretAt,
  generateSyntheticDocument,
} from './perfHarness.mjs'

const UNIFORM_LINE = 'The quick brown fox jumps over a lazy dog while pondering rather deeply now.'

function generateUniformNoWrapDocument(targetChars) {
  const lines = []
  let total = 0
  while (total < targetChars) {
    lines.push(UNIFORM_LINE)
    total += UNIFORM_LINE.length + 1
  }
  return lines.join('\n')
}

function generateUniformWrapDocument(targetChars) {
  const wrappedLine = `${UNIFORM_LINE} ${UNIFORM_LINE} ${UNIFORM_LINE}`
  const lines = []
  let total = 0
  while (total < targetChars) {
    lines.push(wrappedLine)
    total += wrappedLine.length + 1
  }
  return lines.join('\n')
}

function generateDiverseWithUniformRunDocument(targetChars) {
  const padding = generateSyntheticDocument(Math.round(targetChars * 0.6))
  const runLines = []
  let runChars = 0
  const runTarget = targetChars - padding.length
  while (runChars < runTarget) {
    runLines.push(UNIFORM_LINE)
    runChars += UNIFORM_LINE.length + 1
  }
  return `${padding}\n${runLines.join('\n')}`
}

const DOC_GENERATORS = {
  'uniform-nowrap': generateUniformNoWrapDocument,
  'uniform-wrap': generateUniformWrapDocument,
  diverse: generateSyntheticDocument,
  'diverse-with-uniform-run': generateDiverseWithUniformRunDocument,
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

function parseArgs(argv) {
  const args = { chars: 100_000, presses: 800, port: 5250, delayMs: 35, docType: 'uniform-nowrap' }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'chars') args.chars = Number(value)
    else if (key === 'presses') args.presses = Number(value)
    else if (key === 'port') args.port = Number(value)
    else if (key === 'delayMs') args.delayMs = Number(value)
    else if (key === 'docType') args.docType = value
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const generator = DOC_GENERATORS[args.docType]
  if (!generator) throw new Error(`unknown --docType ${args.docType}`)

  console.error(`[visual-drift] starting dev server on port ${args.port}...`)
  const server = await startDevServer(args.port)

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`http://localhost:${args.port}/`)

    const text = generator(args.chars)
    console.error(`[visual-drift] seeding ${args.docType} note and reloading...`)
    await seedLargeNoteAndReload(page, text)
    await placeCaretAt(page, 'end')

    const readCaretScreenTop = () => page.evaluate(() => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      return sel.getRangeAt(0).getBoundingClientRect().top
    })

    const series = [await readCaretScreenTop()]
    for (let i = 0; i < args.presses; i += 1) {
      await page.keyboard.press('ArrowUp')
      await page.waitForTimeout(args.delayMs)
      series.push(await readCaretScreenTop())
    }

    // rAF-scheduled corrections (if the build under test has any) may still
    // be in flight when the press loop ends; let them settle before the
    // final read so a trailing correction isn't missed or double-counted.
    await page.waitForTimeout(100)
    series.push(await readCaretScreenTop())

    const settleWindow = 30
    // While pinned at the cage's top boundary, the caret's on-screen top is
    // expected to be exactly constant press to press (the cage re-clamps it
    // to the same visual row every time) -- not "within half a row," which
    // would silently pass exactly the kind of small-but-real residual this
    // script exists to catch (a 12px unprompted shift was the case that
    // prompted writing it). A few px of tolerance covers sub-pixel/rounding
    // noise, nothing structural.
    const anomalyThresholdPx = 3
    const anomalies = []
    for (let i = settleWindow; i < series.length; i += 1) {
      const delta = series[i] - series[i - 1]
      if (Math.abs(delta) > anomalyThresholdPx) {
        anomalies.push({ i, delta })
      }
    }

    console.log(JSON.stringify({
      docType: args.docType,
      chars: args.chars,
      presses: args.presses,
      sampleCount: series.length - settleWindow,
      anomalyCount: anomalies.length,
      anomalies,
    }, null, 2))
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
