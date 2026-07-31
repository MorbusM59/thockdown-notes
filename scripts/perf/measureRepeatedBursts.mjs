#!/usr/bin/env node
// Runs N keystroke bursts (default 10x100 keystrokes) against a single
// packaged-Electron app session, with a pause between each burst -- one app
// launch, one seeded note, repeated measurement -- instead of relaunching
// the app per burst. This mirrors "a user keeps typing across a session"
// more closely than a single burst does, and is ~10x cheaper than
// relaunching Electron per repetition.
//
//   xvfb-run -a node scripts/perf/measureRepeatedBursts.mjs [flags]
//
// Flags: --chars, --keystrokes, --position (same as measureInputLagElectronPackaged.mjs),
// plus --bursts (default 10), --pause (ms between bursts, default 10000), --skip-build.

import { _electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  REPO_ROOT,
  generateSyntheticDocument,
  placeCaretAt,
  measureKeystrokeBurstMs,
  summarizeMs,
} from './perfHarness.mjs'

const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'))

function parseArgs(argv) {
  const args = { chars: 1_500_000, keystrokes: 100, bursts: 10, pause: 10000, position: 'end', json: false, skipBuild: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'skip-build') args.skipBuild = true
    else if (key === 'json') args.json = true
    else if (key === 'position') args.position = value
    else if (key === 'chars') args.chars = Number(value)
    else if (key === 'keystrokes') args.keystrokes = Number(value)
    else if (key === 'bursts') args.bursts = Number(value)
    else if (key === 'pause') args.pause = Number(value)
  }
  return args
}

function resolvePackagedExecutablePath() {
  return path.join(REPO_ROOT, 'release', pkg.version, 'linux-unpacked', pkg.name)
}

function buildPackagedApp() {
  console.error('[perf] building renderer + electron main/preload (npx vite build)...')
  let result = spawnSync('npx', ['vite', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`vite build failed with exit code ${result.status}`)

  console.error('[perf] packaging via electron-builder...')
  result = spawnSync('npx', ['electron-builder', '--linux', 'dir'], { cwd: REPO_ROOT, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`electron-builder failed with exit code ${result.status}`)
}

async function waitForDatabaseReady(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      await page.evaluate(() => window.thockdownNotes.listNotes())
      return
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  throw new Error(`Electron app's database never became ready: ${lastError}`)
}

async function seedLargeNoteAndReload(page, text) {
  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText })
    await window.thockdownSections.setActiveNote('default', note.id)
  }, text)
  await page.reload()
  await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 30000 })
  await page.waitForTimeout(500)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!['start', 'middle', 'end'].includes(args.position)) {
    throw new Error(`--position must be start|middle|end, got "${args.position}"`)
  }

  const executablePath = resolvePackagedExecutablePath()
  if (!args.skipBuild) {
    buildPackagedApp()
  } else if (!existsSync(executablePath)) {
    throw new Error(`--skip-build was given but no existing package was found at ${executablePath}`)
  }
  if (!existsSync(executablePath)) {
    throw new Error(`packaged executable not found at ${executablePath} after build`)
  }

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'thockdown-packaged-perf-'))

  console.error(`[perf] launching the packaged app at ${executablePath}...`)
  const app = await _electron.launch({
    executablePath,
    args: ['--no-sandbox', `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    console.error('[perf] waiting for the database to finish initializing...')
    await waitForDatabaseReady(page, 20000)

    console.error(`[perf] generating synthetic document (~${args.chars} chars)...`)
    const text = generateSyntheticDocument(args.chars)

    console.error('[perf] seeding note and reloading...')
    await seedLargeNoteAndReload(page, text)

    console.error(`[perf] placing caret at "${args.position}"...`)
    await placeCaretAt(page, args.position)

    const burstResults = []
    for (let i = 0; i < args.bursts; i += 1) {
      console.error(`[perf] burst ${i + 1}/${args.bursts}...`)
      const deltas = await measureKeystrokeBurstMs(page, args.keystrokes)
      const summary = summarizeMs(deltas)
      burstResults.push({ burst: i + 1, deltas, summary })
      console.error(`[perf]   mean=${summary.mean.toFixed(2)}ms median=${summary.median.toFixed(2)}ms max=${summary.max.toFixed(2)}ms`)
      if (i < args.bursts - 1) {
        await new Promise((resolve) => setTimeout(resolve, args.pause))
      }
    }

    const allMeans = burstResults.map((b) => b.summary.mean)
    const allMedians = burstResults.map((b) => b.summary.median)
    const overall = {
      meanOfMeans: allMeans.reduce((a, b) => a + b, 0) / allMeans.length,
      meanOfMedians: allMedians.reduce((a, b) => a + b, 0) / allMedians.length,
      minMean: Math.min(...allMeans),
      maxMean: Math.max(...allMeans),
    }

    const result = {
      target: 'electron-packaged-repeated',
      chars: args.chars,
      keystrokes: args.keystrokes,
      bursts: args.bursts,
      pauseMs: args.pause,
      position: args.position,
      burstResults,
      overall,
    }

    if (args.json) {
      console.log(JSON.stringify(result))
    } else {
      console.log(`\nchars=${args.chars} bursts=${args.bursts} keystrokes=${args.keystrokes}`)
      console.log(`meanOfMeans=${overall.meanOfMeans.toFixed(2)}ms  meanOfMedians=${overall.meanOfMedians.toFixed(2)}ms  minMean=${overall.minMean.toFixed(2)}ms  maxMean=${overall.maxMean.toFixed(2)}ms`)
    }
  } finally {
    await app.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
