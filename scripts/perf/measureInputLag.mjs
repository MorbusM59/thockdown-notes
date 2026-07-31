#!/usr/bin/env node
// CLI entry point: measure real per-keystroke input lag on a large synthetic
// document. Run via `npm run perf:input-lag -- [flags]`.
//
// Modes:
//   burst   (default) real-dispatched-keystroke wall-clock timing, like the
//           handover doc's "N-keystroke held-key burst" measurements.
//   profile CDP JS call-stack sampling during a keystroke burst, aggregated
//           by function name -- what found getOffsetWithinRoot and the
//           diffuse handler-chain cost in prior rounds.
//   trace   CDP devtools.timeline category trace during a keystroke burst --
//           Layout/Paint/Raster/Commit vs. JS attribution. --categories
//           overrides the default category set (e.g. to add
//           disabled-by-default-v8.gc/disabled-by-default-v8.compile).
//   heap    CDP heap allocation sampling during a keystroke burst, aggregated
//           by allocating call site -- the complement to profile mode for
//           attributing the "(program)"/"(garbage collector)" self-time
//           buckets profile mode can't explain by call stack alone.
//
// Flags:
//   --chars=N        synthetic document size in characters (default 1500000,
//                     matching the handover doc's Ulysses-sized repro)
//   --keystrokes=N   how many characters to type in the burst (default 30)
//   --position=start|middle|end   caret placement before typing (default end)
//   --port=N         dev server port (default 5183)
//   --headed         show the browser window (default headless)
//   --json           print raw JSON instead of a formatted summary
//
// Example:
//   npm run perf:input-lag -- --mode=profile --chars=1500000 --keystrokes=30 --position=end

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  generateSyntheticDocument,
  seedLargeNoteAndReload,
  placeCaretAt,
  measureKeystrokeBurstMs,
  summarizeMs,
  startCdpJsProfile,
  withCdpCategoryTrace,
  startHeapSamplingProfile,
} from './perfHarness.mjs'

function parseArgs(argv) {
  const args = { mode: 'burst', chars: 1_500_000, keystrokes: 30, position: 'end', port: 5183, headed: false, json: false, categories: undefined, warmup: 0 }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key === 'json') args.json = true
    else if (key === 'mode') args.mode = value
    else if (key === 'position') args.position = value
    else if (key === 'chars') args.chars = Number(value)
    else if (key === 'keystrokes') args.keystrokes = Number(value)
    else if (key === 'port') args.port = Number(value)
    // trace mode only -- overrides withCdpCategoryTrace's default category
    // set, e.g. --categories=devtools.timeline,disabled-by-default-v8.gc to
    // attribute the profile-mode "(program)" bucket to GC specifically.
    else if (key === 'categories') args.categories = value
    // Types --warmup characters (untimed, unprofiled) after placing the
    // caret and before the measured burst starts -- for testing whether a
    // cost is a one-time JIT-tier-up/cold-start artifact rather than a
    // steady-state per-keystroke cost (compare --warmup=0 vs a nonzero value
    // at the same --position/--keystrokes).
    else if (key === 'warmup') args.warmup = Number(value)
  }
  return args
}

/**
 * Playwright's own version can drift from whatever browser build this
 * environment pre-installed (seen here: playwright expecting
 * chrome-headless-shell-1234, environment shipping chromium-1194), and
 * `playwright install` is explicitly off-limits per this environment's
 * setup. Resolve the pre-installed chromium binary directly under
 * PLAYWRIGHT_BROWSERS_PATH if present; otherwise fall back to Playwright's
 * own default resolution (a plain machine/CI with a matched install).
 */
function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome')
  return existsSync(candidate) ? candidate : undefined
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!['start', 'middle', 'end'].includes(args.position)) {
    throw new Error(`--position must be start|middle|end, got "${args.position}"`)
  }
  if (!['burst', 'profile', 'trace', 'heap'].includes(args.mode)) {
    throw new Error(`--mode must be burst|profile|trace|heap, got "${args.mode}"`)
  }

  console.error(`[perf] starting dev server on port ${args.port}...`)
  const server = await startDevServer(args.port)

  let browser
  try {
    browser = await chromium.launch({
      headless: !args.headed,
      executablePath: resolveChromiumExecutablePath(),
    })
    const page = await browser.newPage()
    await page.goto(`http://localhost:${args.port}/`)

    console.error(`[perf] generating synthetic document (~${args.chars} chars)...`)
    const text = generateSyntheticDocument(args.chars)

    console.error('[perf] seeding note and reloading...')
    await seedLargeNoteAndReload(page, text)

    console.error(`[perf] placing caret at "${args.position}"...`)
    await placeCaretAt(page, args.position)

    if (args.warmup > 0) {
      console.error(`[perf] typing ${args.warmup} warm-up characters (untimed)...`)
      await measureKeystrokeBurstMs(page, args.warmup)
    }

    let result
    if (args.mode === 'burst') {
      const deltas = await measureKeystrokeBurstMs(page, args.keystrokes)
      result = { mode: 'burst', chars: args.chars, keystrokes: args.keystrokes, position: args.position, deltas, summary: summarizeMs(deltas) }
    } else if (args.mode === 'profile') {
      const profile = await startCdpJsProfile(page)
      await measureKeystrokeBurstMs(page, args.keystrokes)
      const aggregated = await profile.stop()
      result = { mode: 'profile', chars: args.chars, keystrokes: args.keystrokes, position: args.position, ...aggregated }
    } else if (args.mode === 'trace') {
      const entries = await withCdpCategoryTrace(page, async () => {
        await measureKeystrokeBurstMs(page, args.keystrokes)
      }, args.categories)
      result = { mode: 'trace', chars: args.chars, keystrokes: args.keystrokes, position: args.position, entries }
    } else {
      const heapProfile = await startHeapSamplingProfile(page)
      await measureKeystrokeBurstMs(page, args.keystrokes)
      const aggregated = await heapProfile.stop()
      result = { mode: 'heap', chars: args.chars, keystrokes: args.keystrokes, position: args.position, ...aggregated }
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      printSummary(result)
    }
  } finally {
    await browser?.close()
    server.stop()
  }

  // The dev server's stdio pipes (and other lingering handles from
  // detached-but-still-referenced child processes) can otherwise keep the
  // event loop alive well past a clean logical exit.
  process.exit(process.exitCode ?? 0)
}

function printSummary(result) {
  console.log(`\nmode=${result.mode} chars=${result.chars} keystrokes=${result.keystrokes} position=${result.position}\n`)

  if (result.mode === 'burst') {
    const s = result.summary
    console.log(`mean=${s.mean.toFixed(2)}ms  median=${s.median.toFixed(2)}ms  min=${s.min.toFixed(2)}ms  max=${s.max.toFixed(2)}ms  total=${s.sum.toFixed(1)}ms`)
    console.log(`per-keystroke: ${result.deltas.map((d) => d.toFixed(1)).join(', ')}`)
    return
  }

  if (result.mode === 'profile') {
    console.log(`total sampled JS time: ${result.totalMs.toFixed(1)}ms\n`)
    console.log('top functions by self-time:')
    for (const entry of result.entries.slice(0, 25)) {
      console.log(`  ${entry.ms.toFixed(1).padStart(8)}ms  ${entry.name}`)
    }
    return
  }

  if (result.mode === 'trace') {
    console.log('category/event durations:')
    for (const entry of result.entries.slice(0, 25)) {
      console.log(`  ${entry.ms.toFixed(1).padStart(8)}ms  ${entry.name}`)
    }
    return
  }

  console.log(`total sampled allocation: ${(result.totalBytes / 1024).toFixed(1)}KB\n`)
  console.log('top allocating call sites by self size:')
  for (const entry of result.entries.slice(0, 25)) {
    console.log(`  ${(entry.bytes / 1024).toFixed(1).padStart(10)}KB  ${entry.name}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
