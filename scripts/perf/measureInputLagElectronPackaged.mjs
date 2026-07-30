#!/usr/bin/env node
// CLI entry point: measure real per-keystroke input lag on a TRUE
// electron-builder-packaged build (asar-packed, real file layout under
// release/<version>/linux-unpacked/), not the unpacked dev-style
// `electron dist-electron/main.js` launch measureInputLagElectron.mjs uses.
// Per the handover doc's own queued next step: this was "still never done,
// the most direct lever on the original unreconciled user report of
// multi-second-per-keystroke lag" -- an asar-packed build resolves modules
// through a virtual archive instead of a real filesystem tree, which the
// unpacked launch style never exercises.
//
//   xvfb-run -a node scripts/perf/measureInputLagElectronPackaged.mjs [flags]
// (the npm script wraps this automatically).
//
// Flags: same as measureInputLagElectron.mjs (--mode, --chars, --keystrokes,
// --position, --json), plus:
//   --skip-build   reuse the existing release/<version>/linux-unpacked build
//                   instead of repackaging first (electron-builder's own
//                   native-module rebuild + asar packing takes a while;
//                   omit this normally, since a stale package would
//                   silently measure old code)

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
  startCdpJsProfile,
  withCdpCategoryTrace,
} from './perfHarness.mjs'

const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'))

function parseArgs(argv) {
  const args = { mode: 'burst', chars: 1_500_000, keystrokes: 30, position: 'end', json: false, skipBuild: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'skip-build') args.skipBuild = true
    else if (key === 'json') args.json = true
    else if (key === 'mode') args.mode = value
    else if (key === 'position') args.position = value
    else if (key === 'chars') args.chars = Number(value)
    else if (key === 'keystrokes') args.keystrokes = Number(value)
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

  // electron-builder rebuilds native deps (better-sqlite3) against the
  // packaged Electron's own ABI as part of packaging -- no separate
  // `electron-rebuild` step needed first, confirmed by reading its own
  // logged output ("rebuilding native dependencies... better-sqlite3").
  console.error('[perf] packaging via electron-builder (--linux dir -- asar-packed, unpacked-directory output, no AppImage compression)...')
  result = spawnSync('npx', ['electron-builder', '--linux', 'dir'], { cwd: REPO_ROOT, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`electron-builder failed with exit code ${result.status}`)
}

/** Same DB-readiness race as measureInputLagElectron.mjs -- see that file's doc comment. */
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
  if (!['burst', 'profile', 'trace'].includes(args.mode)) {
    throw new Error(`--mode must be burst|profile|trace, got "${args.mode}"`)
  }
  if (!process.env.DISPLAY) {
    console.error('[perf] WARNING: $DISPLAY is unset -- this almost certainly needs to run under `xvfb-run -a` (the npm script does this automatically).')
  }

  const executablePath = resolvePackagedExecutablePath()
  if (!args.skipBuild) {
    buildPackagedApp()
  } else if (!existsSync(executablePath)) {
    throw new Error(`--skip-build was given but no existing package was found at ${executablePath} -- run once without --skip-build first.`)
  }
  if (!existsSync(executablePath)) {
    throw new Error(`packaged executable not found at ${executablePath} after build`)
  }

  // resolveDataRoot() in electron/main.ts uses app.getPath('userData')/data
  // for a real packaged (non-portable) build, unlike the unpacked dev-style
  // launch's <repo>/data -- confirmed by reading that function, not
  // assumed. userData itself is derived from --user-data-dir when passed,
  // so a fresh temp dir per run gets an isolated, guaranteed-empty DB
  // without needing to know Electron's own default userData path or clean
  // up any repo-tracked directory.
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

    let result
    if (args.mode === 'burst') {
      const deltas = await measureKeystrokeBurstMs(page, args.keystrokes)
      result = { mode: 'burst', target: 'electron-packaged', chars: args.chars, keystrokes: args.keystrokes, position: args.position, deltas, summary: summarizeMs(deltas) }
    } else if (args.mode === 'profile') {
      const profile = await startCdpJsProfile(page)
      await measureKeystrokeBurstMs(page, args.keystrokes)
      const aggregated = await profile.stop()
      result = { mode: 'profile', target: 'electron-packaged', chars: args.chars, keystrokes: args.keystrokes, position: args.position, ...aggregated }
    } else {
      const entries = await withCdpCategoryTrace(page, async () => {
        await measureKeystrokeBurstMs(page, args.keystrokes)
      })
      result = { mode: 'trace', target: 'electron-packaged', chars: args.chars, keystrokes: args.keystrokes, position: args.position, entries }
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      printSummary(result)
    }
  } finally {
    await app.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }

  process.exit(0)
}

function printSummary(result) {
  console.log(`\ntarget=electron-packaged mode=${result.mode} chars=${result.chars} keystrokes=${result.keystrokes} position=${result.position}\n`)

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

  console.log('category/event durations:')
  for (const entry of result.entries.slice(0, 25)) {
    console.log(`  ${entry.ms.toFixed(1).padStart(8)}ms  ${entry.name}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
