#!/usr/bin/env node
// Isolates whether the lead #4 scroll-anomaly's cadence/magnitude tracks
// VISUAL rows (pixel/height-map-driven) or LOGICAL lines/document structure
// (chunk-count-driven) -- Task #10 from docs/cm6-parity-hardening-plan.md,
// deferred since the very first round of this investigation (every drift
// test up to this point deliberately used non-wrapping uniform lines to
// keep wrapping out of the picture entirely).
//
// Same continuous-ArrowUp-from-end methodology as measureCM6ArrowUpDrift.mjs
// (same debug accessor, same steady-state-at-cage-top-boundary assumption,
// same 1.5-row anomaly threshold), run across three ~100,000-char documents
// that isolate wrapping and content diversity as separate variables:
//
//   - uniform-nowrap: one fixed line repeated verbatim, well under this
//     editor's empirically-probed ~85-char wrap width (kept to 1 visual
//     row per logical line) -- the control, structurally identical to every
//     prior drift measurement in this investigation.
//   - uniform-wrap: the *same* fixed line repeated, but long enough to wrap
//     into a deterministic, constant number of visual rows per logical line
//     (3) -- isolates wrapping itself, with zero content diversity.
//   - diverse: scripts/perf/perfHarness.mjs's own generateSyntheticDocument
//     (headings/lists/blockquotes/variable-length prose, already used
//     elsewhere in this repo's perf tooling) -- adds content/line-length
//     diversity on top of variable wrapping.
//
// If the anomaly cadence (presses between anomalies) and magnitude stay
// essentially the same across all three, the mechanism tracks visual rows
// (consistent with a height-map/rendering-side amortized recompute,
// independent of document markup). If cadence changes with visual-rows-per-
// logical-line (denser logical-line traversal per press under wrapping),
// the mechanism tracks logical lines/document structure instead.
//
// Run: node scripts/perf/measureCM6WrapSensitivityDrift.mjs [--chars=100000] [--presses=800] [--port=N]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  seedLargeNoteAndReload,
  placeCaretAt,
  generateSyntheticDocument,
} from './perfHarness.mjs'

// Empirically probed live against this editor's default font/viewport
// (1280px-wide page): plain 'x' repeats stopped wrapping at 80 chars and
// were wrapped (52px = 2 rows) at 90 chars. 78 sits safely under that so a
// single copy never wraps; 3 copies (234 chars) reliably wraps to exactly 3
// rows (78 chars/row * 3) rather than landing awkwardly close to a 2-vs-3-row
// boundary.
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

// Real notes are essentially never perfectly byte-uniform end to end like
// the synthetic uniform-nowrap document above, but they plausibly contain
// long *runs* of similar-length lines (checklists, tables, repeated
// separators). This document is diverse overall (generateSyntheticDocument
// padding) but ends in a long (~600-line) run of the exact uniform line
// right before EOF, so placeCaretAt('end') + continuous ArrowUp walks
// straight into the run immediately -- isolates whether partial uniformity
// embedded in realistic content still reaches whatever threshold triggers
// the anomaly, or whether it truly requires whole-document uniformity.
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
  const args = { chars: 100_000, presses: 800, port: 5241, delayMs: 35 }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'chars') args.chars = Number(value)
    else if (key === 'presses') args.presses = Number(value)
    else if (key === 'port') args.port = Number(value)
    else if (key === 'delayMs') args.delayMs = Number(value)
  }
  return args
}

async function measureOne(page, docType, text, presses, delayMs) {
  console.error(`[wrap-sensitivity] seeding ${docType} note and reloading...`)
  await seedLargeNoteAndReload(page, text)
  await placeCaretAt(page, 'end')

  const readCageState = () => page.evaluate(() => window.__thockdownDebugCageState())
  const series = [await readCageState()]
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(delayMs)
    series.push(await readCageState())
  }
  return series
}

function analyze(series) {
  const settleWindow = 30
  const anomalies = []
  for (let i = settleWindow; i < series.length; i += 1) {
    const prev = series[i - 1]
    const cur = series[i]
    const lineHeightPx = cur.lineHeightPx
    const deltaScrollTop = cur.scrollTop - prev.scrollTop
    const expectedDelta = -lineHeightPx
    const thresholdPx = 1.5 * lineHeightPx
    if (Math.abs(deltaScrollTop - expectedDelta) > thresholdPx) {
      anomalies.push({ i, rows: deltaScrollTop / lineHeightPx })
    }
  }
  const gaps = anomalies.slice(1).map((a, idx) => a.i - anomalies[idx].i)
  const magnitudes = anomalies.map((a) => a.rows)
  return {
    sampleCount: series.length - settleWindow,
    anomalyCount: anomalies.length,
    anomalyIndices: anomalies.map((a) => a.i),
    anomalyMagnitudesRows: magnitudes,
    gapsBetweenAnomalies: gaps,
    meanGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    meanAbsMagnitudeRows: magnitudes.length
      ? magnitudes.reduce((a, b) => a + Math.abs(b), 0) / magnitudes.length
      : null,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.error(`[wrap-sensitivity] starting dev server on port ${args.port}...`)
  const server = await startDevServer(args.port)

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`http://localhost:${args.port}/`)
    await page.evaluate(() => window.localStorage.setItem('thockdown:debug-cage-state', '1'))

    const docs = {
      'uniform-nowrap': generateUniformNoWrapDocument(args.chars),
      'uniform-wrap': generateUniformWrapDocument(args.chars),
      diverse: generateSyntheticDocument(args.chars),
      'diverse-with-uniform-run': generateDiverseWithUniformRunDocument(args.chars),
    }

    const results = {}
    for (const [docType, text] of Object.entries(docs)) {
      const series = await measureOne(page, docType, text, args.presses, args.delayMs)
      results[docType] = { analysis: analyze(series), sampleFirst: series[0] }
      console.error(`[wrap-sensitivity] ${docType}: ${results[docType].analysis.anomalyCount}/${results[docType].analysis.sampleCount} anomalies`)
    }

    console.log(JSON.stringify({ chars: args.chars, presses: args.presses, results }, null, 2))
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
