#!/usr/bin/env node
// Measures landing-position accuracy for CM6's PageDown/PageUp scroll --
// same methodology as measureCM6ArrowUpDrift.mjs, applied to the
// multi-row-per-press movement class instead of single-row ArrowUp. Per
// docs/cm6-parity-hardening-plan.md's Phase 4 lead #4: a multi-row jump
// landing a few rows short is easy to miss visually (the jump itself is
// large, so a small shortfall is a small fraction of it) but is the same
// underlying imprecision as the single-row case, just harder to see.
//
// A single (non-repeat) PageDown press computes a fully deterministic
// target before dispatch: currentAligned + visibleRows*lineHeightPx,
// quantized (CM6Editor.tsx's PageUp/PageDown keymap handler). So unlike
// ArrowUp (which needed CM6's own analytical lineBlockAt as ground truth),
// the expected per-press delta here is a known constant we can compute
// independently and compare against the observed delta after the
// quantized-smooth-scroll animation has had time to fully settle.
//
// Run: node scripts/perf/measureCM6PageScrollAccuracy.mjs --chars=1200000 --presses=200 [--port=N]

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
  const args = { chars: 1_200_000, presses: 200, port: 5187, settleMs: 900 }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'chars') args.chars = Number(value)
    else if (key === 'presses') args.presses = Number(value)
    else if (key === 'port') args.port = Number(value)
    else if (key === 'settleMs') args.settleMs = Number(value)
  }
  return args
}

async function readState(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller')
    const lines = Array.from(document.querySelectorAll('.cm-line'))
    const tops = lines.map((el) => el.getBoundingClientRect().top).sort((a, b) => a - b)
    const deltas = []
    for (let i = 1; i < tops.length; i += 1) deltas.push(tops[i] - tops[i - 1])
    deltas.sort((a, b) => a - b)
    const medianDelta = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : null
    return {
      scrollTop: scroller ? scroller.scrollTop : null,
      clientHeight: scroller ? scroller.clientHeight : null,
      scrollHeight: scroller ? scroller.scrollHeight : null,
      medianLineDelta: medianDelta,
    }
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.error(`[page-scroll] starting dev server on port ${args.port}...`)
  const server = await startDevServer(args.port)

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`http://localhost:${args.port}/`)

    console.error(`[page-scroll] generating uniform document (~${args.chars} chars)...`)
    const text = generateUniformDocument(args.chars)
    console.error('[page-scroll] seeding note and reloading...')
    await seedLargeNoteAndReload(page, text)

    console.error('[page-scroll] placing caret at end...')
    await placeCaretAt(page, 'end')

    const initial = await readState(page)
    const lineHeightPx = initial.medianLineDelta
    console.error('[page-scroll] initial state:', initial, 'lineHeightPx:', lineHeightPx)

    const results = []
    let prev = initial
    for (let i = 0; i < args.presses; i += 1) {
      await page.keyboard.press('PageUp')
      await page.waitForTimeout(args.settleMs)
      const next = await readState(page)
      const deltaPx = next.scrollTop - prev.scrollTop
      results.push({ pressIndex: i, deltaPx, scrollTop: next.scrollTop })
      prev = next
      if (next.scrollTop <= 0.5) break // hit document start
    }

    console.log(JSON.stringify({ chars: args.chars, lineHeightPx, clientHeight: initial.clientHeight, results }, null, 2))
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
