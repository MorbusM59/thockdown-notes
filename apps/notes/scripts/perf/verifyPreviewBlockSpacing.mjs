#!/usr/bin/env node
// Guards the defect where a whole completed survey was thrown away.
//
// On a CONTINUOUS document (under CONTINUOUS_DOCUMENT_MAX_CHARS) the survey
// measures every block and commits the real heights. Those heights live in
// react-virtual's SIZE cache, and `virtualizer.measure()` clears that cache
// wholesale -- so a caller that re-measures to refresh the ESTIMATES also
// destroys every measurement. The scroll-restore path did exactly that, one
// frame after the survey finished, on every note under 50,000 characters:
// blocks measured at 43px were laid out on a 76.8px line estimate, and every
// paragraph gap in the document was ~33.6px too wide.
//
// The check is the invariant the bug broke: consecutive blocks must be placed
// exactly their own measured height apart. Nothing about it depends on which
// heights are correct -- only that the layout uses the ones it measured.
//
// Run: node scripts/perf/verifyPreviewBlockSpacing.mjs [--chars=20000]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, seedLargeNoteAndReload, placeCaretAt } from './perfHarness.mjs'

function generateDocument(targetChars) {
  const out = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    const text = i % 12 === 0
      ? `## Section ${i}`
      : `Paragraph ${i}: plain uniform content for this preview block, short enough not to wrap awkwardly in a normal preview column width.`
    out.push(text)
    total += text.length + 2
    i += 1
  }
  return out.join('\n\n')
}

function resolveChromiumExecutablePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).find((n) => n.startsWith('chromium-'))
  if (!dir) return undefined
  return [
    path.join(root, dir, 'chrome-linux', 'chrome'),
    path.join(root, dir, 'chrome-win', 'chrome.exe'),
  ].find((c) => existsSync(c))
}

function parseArgs(argv) {
  // Under the continuous threshold on purpose: this is the path with a size
  // cache to lose. A chunked document is windowed and has no such cache.
  const args = { chars: 20_000, port: 5197, settleMs: 3000, headed: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key in args) args[key] = Number(value)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const server = await startDevServer(args.port)
  const failures = []
  const note = (ok, label, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
    if (!ok) failures.push(label)
  }

  let browser
  try {
    browser = await chromium.launch({ headless: !args.headed, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`http://localhost:${args.port}/`)
    await seedLargeNoteAndReload(page, generateDocument(args.chars))
    await placeCaretAt(page, 'start')
    await page.keyboard.press('Escape')
    await page.waitForSelector('.markdown-preview', { timeout: 15000 })
    // Long enough for the survey to finish AND for the scroll-restore retries
    // that used to wipe it to have run. The bug only appeared in that order.
    await page.waitForTimeout(args.settleMs)

    const blocks = await page.evaluate(() => Array.from(
      document.querySelectorAll('.markdown-preview [data-index]'),
    ).map((node) => ({
      index: Number(node.getAttribute('data-index')),
      top: Math.round(node.getBoundingClientRect().top * 100) / 100,
      height: Math.round(node.getBoundingClientRect().height * 100) / 100,
    })).sort((a, b) => a.index - b.index))

    note(blocks.length > 3, 'continuous preview renders blocks', `${blocks.length} mounted`)

    let worst = 0
    let worstAt = null
    for (let i = 1; i < blocks.length; i += 1) {
      const expected = blocks[i - 1].top + blocks[i - 1].height
      const drift = Math.abs(blocks[i].top - expected)
      if (drift > worst) { worst = drift; worstAt = blocks[i].index }
    }
    note(worst <= 1, 'blocks are laid out at their own measured heights',
      `worst drift ${Math.round(worst * 100) / 100}px${worstAt === null ? '' : ` at block ${worstAt}`}`)

    console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join(', ')}`}`)
    process.exitCode = failures.length === 0 ? 0 : 1
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
