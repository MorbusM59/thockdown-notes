#!/usr/bin/env node
// Phase-0 spike measurement: real keystroke-latency numbers for the
// standalone CodeMirror 6 prototype (scripts/perf/cm6-spike/), using the
// exact same measurement primitives (measureKeystrokeBurstMs,
// startCdpJsProfile, withCdpCategoryTrace, generateSyntheticDocument) as
// every other number in docs/large-document-performance-handover.md, for a
// genuinely apples-to-apples comparison against the current Lexical-backed
// app -- not a different methodology that could quietly favor either side.
//
//   node scripts/perf/measureCM6Spike.mjs [flags]
//
// Flags: --mode=burst|profile|trace (default profile), --chars=N (default
// 1500000), --keystrokes=N (default 20), --position=start|end (default
// end), --port=N (default 5211), --headed, --json

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REPO_ROOT,
  generateSyntheticDocument,
  measureKeystrokeBurstMs,
  summarizeMs,
  startCdpJsProfile,
  withCdpCategoryTrace,
} from './perfHarness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SPIKE_DIR = path.join(__dirname, 'cm6-spike')

function parseArgs(argv) {
  const args = { mode: 'profile', chars: 1_500_000, keystrokes: 20, position: 'end', port: 5211, headed: false, json: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key === 'json') args.json = true
    else if (key === 'mode') args.mode = value
    else if (key === 'position') args.position = value
    else if (key === 'chars') args.chars = Number(value)
    else if (key === 'keystrokes') args.keystrokes = Number(value)
    else if (key === 'port') args.port = Number(value)
  }
  return args
}

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome')
  return existsSync(candidate) ? candidate : undefined
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) return
    } catch (err) {
      lastError = err
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Dev server at ${url} did not become ready in ${timeoutMs}ms: ${lastError}`)
}

async function startSpikeServer(port) {
  const proc = spawn('npx', ['vite', '--config', path.join(SPIKE_DIR, 'vite.config.js'), '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let output = ''
  proc.stdout.on('data', (chunk) => { output += chunk.toString() })
  proc.stderr.on('data', (chunk) => { output += chunk.toString() })
  const exitedEarly = new Promise((_resolve, reject) => {
    proc.once('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`vite exited early (code ${code}). Output:\n${output}`))
    })
  })
  await Promise.race([waitForServer(`http://localhost:${port}/`, 30000), exitedEarly])
  return {
    stop() {
      try { process.kill(-proc.pid, 'SIGTERM') } catch { proc.kill('SIGTERM') }
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!['start', 'end'].includes(args.position)) throw new Error(`--position must be start|end, got "${args.position}"`)
  if (!['burst', 'profile', 'trace'].includes(args.mode)) throw new Error(`--mode must be burst|profile|trace, got "${args.mode}"`)

  console.error(`[cm6-spike] starting spike dev server on port ${args.port}...`)
  const server = await startSpikeServer(args.port)

  let browser
  try {
    browser = await chromium.launch({ headless: !args.headed, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage()
    await page.goto(`http://localhost:${args.port}/`)
    await page.waitForFunction(() => Boolean(window.__cm6Spike), { timeout: 10000 })

    console.error(`[cm6-spike] generating synthetic document (~${args.chars} chars)...`)
    const text = generateSyntheticDocument(args.chars)

    console.error('[cm6-spike] seeding document...')
    await page.evaluate((t) => window.__cm6Spike.seed(t), text)
    const docLength = await page.evaluate(() => window.__cm6Spike.docLength())
    console.error(`[cm6-spike] doc length after seed: ${docLength}`)

    console.error(`[cm6-spike] placing caret at "${args.position}"...`)
    if (args.position === 'start') {
      await page.evaluate(() => window.__cm6Spike.placeCaretAtStart())
    } else {
      await page.evaluate(() => window.__cm6Spike.placeCaretAtEnd())
    }
    await page.waitForTimeout(300)

    let result
    if (args.mode === 'burst') {
      const deltas = await measureKeystrokeBurstMs(page, args.keystrokes)
      result = { mode: 'burst', target: 'cm6-spike', chars: args.chars, keystrokes: args.keystrokes, position: args.position, deltas, summary: summarizeMs(deltas) }
    } else if (args.mode === 'profile') {
      const profile = await startCdpJsProfile(page)
      await measureKeystrokeBurstMs(page, args.keystrokes)
      const aggregated = await profile.stop()
      result = { mode: 'profile', target: 'cm6-spike', chars: args.chars, keystrokes: args.keystrokes, position: args.position, ...aggregated }
    } else {
      const entries = await withCdpCategoryTrace(page, async () => {
        await measureKeystrokeBurstMs(page, args.keystrokes)
      })
      result = { mode: 'trace', target: 'cm6-spike', chars: args.chars, keystrokes: args.keystrokes, position: args.position, entries }
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
  process.exit(0)
}

function printSummary(result) {
  console.log(`\ntarget=cm6-spike mode=${result.mode} chars=${result.chars} keystrokes=${result.keystrokes} position=${result.position}\n`)
  if (result.mode === 'burst') {
    const s = result.summary
    console.log(`mean=${s.mean.toFixed(2)}ms  median=${s.median.toFixed(2)}ms  min=${s.min.toFixed(2)}ms  max=${s.max.toFixed(2)}ms  total=${s.sum.toFixed(1)}ms`)
    console.log(`per-keystroke: ${result.deltas.map((d) => d.toFixed(1)).join(', ')}`)
    return
  }
  if (result.mode === 'profile') {
    console.log(`total sampled JS time: ${result.totalMs.toFixed(1)}ms\n`)
    console.log('top functions by self-time:')
    for (const entry of result.entries.slice(0, 20)) {
      console.log(`  ${entry.ms.toFixed(1).padStart(8)}ms  ${entry.name}`)
    }
    return
  }
  console.log('category/event durations:')
  for (const entry of result.entries.slice(0, 20)) {
    console.log(`  ${entry.ms.toFixed(1).padStart(8)}ms  ${entry.name}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
