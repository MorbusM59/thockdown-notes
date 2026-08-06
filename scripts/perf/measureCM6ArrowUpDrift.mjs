#!/usr/bin/env node
// Measures cumulative scrollTop drift against CM6's own analytical caret
// position (view.lineBlockAt(head).top -- a pure document-layout value,
// independent of scroll position) over a long ArrowUp session, reading the
// window.__thockdownDebugCageState() accessor CM6Editor.tsx exposes when
// localStorage['thockdown:debug-cage-state'] === '1' (pure read-only
// instrumentation, zero behavior change, no correction active). Part of the
// Phase 4 lead #4 investigation -- see docs/cm6-parity-hardening-plan.md.
//
// Methodology: starting at document end and pressing ArrowUp continuously
// (never reversing direction), the caret reaches the cage's top boundary
// within the first few dozen presses and stays pinned there for the rest of
// the run. Once pinned, a well-behaved system should show
// deltaScrollTop == deltaAnalyticalTop (== -lineHeightPx) on every press.
// Any press where they disagree, after the initial settling window, is a
// raw, uncorrected leak for that one step. Summing these gives the true
// cumulative drift, uncontaminated by any fix attempt. Confirmed live this
// session: in genuine steady state (far from either document boundary),
// this cumulative sum oscillates in a small bounded band with no net trend
// -- the concerning larger numbers come from two separate, localized,
// one-time effects (initial mount settle; proximity to an actual document
// boundary), not a per-keystroke leak. See the doc for full findings.
//
// Run: node scripts/perf/measureCM6ArrowUpDrift.mjs --chars=100000 --presses=1200 [--port=N] [--startPos=end|start|middle]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  seedLargeNoteAndReload,
  placeCaretAt,
} from './perfHarness.mjs'

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
  const args = { chars: 100_000, presses: 1200, port: 5187, delayMs: 35, startPos: 'end' }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'chars') args.chars = Number(value)
    else if (key === 'presses') args.presses = Number(value)
    else if (key === 'port') args.port = Number(value)
    else if (key === 'delayMs') args.delayMs = Number(value)
    else if (key === 'startPos') args.startPos = value
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.error(`[drift] starting dev server on port ${args.port}...`)
  const server = await startDevServer(args.port)

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`http://localhost:${args.port}/`)
    await page.evaluate(() => window.localStorage.setItem('thockdown:debug-cage-state', '1'))

    console.error(`[drift] generating uniform document (~${args.chars} chars)...`)
    const text = generateUniformDocument(args.chars)
    console.error('[drift] seeding note and reloading...')
    await seedLargeNoteAndReload(page, text)

    console.error('[drift] placing caret at ' + args.startPos + '...')
    await placeCaretAt(page, args.startPos)

    const readCageState = () => page.evaluate(() => window.__thockdownDebugCageState())

    let prev = await readCageState(page)
    const series = [prev]
    for (let i = 0; i < args.presses; i += 1) {
      await page.keyboard.press('ArrowUp')
      await page.waitForTimeout(args.delayMs)
      const next = await readCageState(page)
      series.push(next)
      prev = next
    }

    console.log(JSON.stringify({ chars: args.chars, presses: args.presses, series }))
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
