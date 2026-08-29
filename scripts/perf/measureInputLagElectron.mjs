#!/usr/bin/env node
// CLI entry point: measure real per-keystroke input lag on the actual
// packaged Electron app (not `dev:browser`), per the handover doc's
// long-standing unreconciled gap between dev-mode-browser numbers and real
// user reports. Run via `npm run perf:input-lag:electron -- [flags]`.
//
// Must run under a virtual display (this environment has no real one) and
// with the Chromium sandbox disabled (Electron/Chromium refuse to run
// sandboxed as root, which this container runs as):
//   xvfb-run -a node scripts/perf/measureInputLagElectron.mjs [flags]
// (the npm script wraps this automatically).
//
// Flags: same as measureInputLag.mjs (--mode, --chars, --keystrokes,
// --position, --json), plus:
//   --skip-build   reuse the existing dist/dist-electron build instead of
//                   rebuilding first (faster iteration once you know the
//                   build is current; omit this normally, since a stale
//                   build would silently measure old code)

import { _electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  REPO_ROOT,
  generateSyntheticDocument,
  placeCaretAt,
  measureKeystrokeBurstMs,
  summarizeMs,
  startCdpJsProfile,
  withCdpCategoryTrace,
  startHeapSamplingProfile,
  ensureEditMode,
} from './perfHarness.mjs'

function parseArgs(argv) {
  const args = { mode: 'burst', chars: 1_500_000, keystrokes: 30, position: 'end', json: false, skipBuild: false, categories: undefined }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'skip-build') args.skipBuild = true
    else if (key === 'json') args.json = true
    else if (key === 'mode') args.mode = value
    else if (key === 'position') args.position = value
    else if (key === 'chars') args.chars = Number(value)
    else if (key === 'keystrokes') args.keystrokes = Number(value)
    else if (key === 'categories') args.categories = value
  }
  return args
}

function buildElectronApp() {
  console.error('[perf] building renderer + electron main/preload (npx vite build)...')
  const result = spawnSync('npx', ['vite', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`vite build failed with exit code ${result.status}`)
  }
}

/**
 * A fresh Electron launch starts with an uninitialized SQLite DB -- the
 * main process seeds a welcome note asynchronously before any IPC handler
 * is ready. Confirmed live: calling window.thockdownNotes too early throws
 * "DatabaseService is not initialized" from the main process. No dedicated
 * readiness signal exists, so poll the same API this script needs anyway
 * until it stops throwing, rather than a fixed sleep (which would be a
 * guess at how long DB init takes, not a real readiness check).
 */
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
  await ensureEditMode(page)
  await page.waitForTimeout(500)
}

/**
 * Clears everything databaseService.ts creates under the resolved data root
 * (the sqlite db file, the notes directory) WITHOUT touching `data/.gitkeep`
 * -- a full `rmSync(dataDir, {recursive: true})` would delete that
 * git-tracked placeholder too, which actually happened once while building
 * this script (caught by `git status` showing it as deleted; restored via
 * `git checkout -- data/.gitkeep`). Skip anything not obviously
 * databaseService's own output, so this only ever removes what this script
 * itself is responsible for cleaning up.
 */
function clearNoteDatabase(dataDir) {
  if (!existsSync(dataDir)) return
  for (const entry of readdirSync(dataDir)) {
    if (entry === '.gitkeep') continue
    rmSync(path.join(dataDir, entry), { recursive: true, force: true })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!['start', 'middle', 'end'].includes(args.position)) {
    throw new Error(`--position must be start|middle|end, got "${args.position}"`)
  }
  if (!['burst', 'profile', 'trace', 'heap'].includes(args.mode)) {
    throw new Error(`--mode must be burst|profile|trace|heap, got "${args.mode}"`)
  }
  if (!process.env.DISPLAY) {
    console.error('[perf] WARNING: $DISPLAY is unset -- this almost certainly needs to run under `xvfb-run -a` (the npm script does this automatically).')
  }

  if (!args.skipBuild) {
    buildElectronApp()
  } else if (!existsSync(path.join(REPO_ROOT, 'dist-electron', 'main.js'))) {
    throw new Error('--skip-build was given but no existing build was found at dist-electron/main.js -- run once without --skip-build first.')
  }

  // A fresh DB per run: resolveDataRoot() in electron/main.ts falls back to
  // `<repo>/data` whenever app.isPackaged is false (true for this unpackaged
  // dev-mode launch, `electron dist-electron/main.js` directly rather than
  // through electron-builder) -- confirmed by reading that function, not
  // assumed; --user-data-dir does NOT redirect it, only Electron's own
  // internal userData path. A leftover SQLite DB from a previous
  // measurement run would seed the note list with a real prior note (or
  // this script's own previously-seeded huge note), which changes both the
  // seeding call's behavior (existing notes) and, at real scale, the
  // sidebar's own render cost -- not what this script means to measure.
  const dataDir = path.join(REPO_ROOT, 'data')
  clearNoteDatabase(dataDir)

  console.error('[perf] launching the packaged Electron app...')
  const app = await _electron.launch({
    args: ['--no-sandbox', 'dist-electron/main.js'],
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

    let result
    if (args.mode === 'burst') {
      const deltas = await measureKeystrokeBurstMs(page, args.keystrokes)
      result = { mode: 'burst', target: 'electron', chars: args.chars, keystrokes: args.keystrokes, position: args.position, deltas, summary: summarizeMs(deltas) }
    } else if (args.mode === 'profile') {
      const profile = await startCdpJsProfile(page)
      await measureKeystrokeBurstMs(page, args.keystrokes)
      const aggregated = await profile.stop()
      result = { mode: 'profile', target: 'electron', chars: args.chars, keystrokes: args.keystrokes, position: args.position, ...aggregated }
    } else if (args.mode === 'trace') {
      const entries = await withCdpCategoryTrace(page, async () => {
        await measureKeystrokeBurstMs(page, args.keystrokes)
      }, args.categories)
      result = { mode: 'trace', target: 'electron', chars: args.chars, keystrokes: args.keystrokes, position: args.position, entries }
    } else {
      const heapProfile = await startHeapSamplingProfile(page)
      await measureKeystrokeBurstMs(page, args.keystrokes)
      const aggregated = await heapProfile.stop()
      result = { mode: 'heap', target: 'electron', chars: args.chars, keystrokes: args.keystrokes, position: args.position, ...aggregated }
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      printSummary(result)
    }
  } finally {
    await app.close()
    clearNoteDatabase(dataDir)
  }

  process.exit(0)
}

function printSummary(result) {
  console.log(`\ntarget=electron mode=${result.mode} chars=${result.chars} keystrokes=${result.keystrokes} position=${result.position}\n`)

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
  process.exit(1)
})
