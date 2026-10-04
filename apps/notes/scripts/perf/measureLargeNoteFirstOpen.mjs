#!/usr/bin/env node
// Where the time goes when a LARGE, NEVER-OPENED note is first opened --
// the imported-2MB-file case.
//
// The parse is no longer on this path at all (block zero is line zero, and
// the map is built later on a worker -- see EditRestoreMath.ts and
// documentFactsClient.ts), so what remains is mounting the document. This
// attributes that remainder, because "chunk the mount" is only the right fix
// if the mount is where the time is.
//
// TWO TARGETS, ONE MEASUREMENT. The measurement body below runs against
// whichever page it is handed; only the launch differs. That is deliberate --
// the whole point of having both targets is that their numbers are
// comparable, which two separately-maintained scripts would not stay.
//
//   --target=electron  (default) a real electron-builder-packaged build.
//                      The trustworthy one. Needs xvfb:
//                        xvfb-run -a node scripts/perf/measureLargeNoteFirstOpen.mjs
//                      (or `npm run perf:first-open`, which wraps that).
//   --target=browser   `npm run dev:browser` under Chromium. Fast, and USEFUL
//                      ONLY FOR ORDERING.
//
// KNOW WHAT THE BROWSER TARGET CANNOT SEE. The browser mock
// (src/dev/installBrowserMockBridges.ts) serializes its ENTIRE store to
// localStorage on every write -- including the multi-megabyte note under
// test -- so `persistStore`/`setItem`/`clone` show up as a large, note-size-
// PROPORTIONAL cost that does not exist in the real app, where the same
// writes are SQLite over IPC. Measured at ~177ms of 1131ms on a 1953KB note,
// plus an unknown share of the unattributable `(program)` bucket. Because it
// scales with the note, it cannot be subtracted as a constant. So read that
// target's ORDERING of app-level frames, and take absolute numbers and
// native buckets from the packaged target only.
//
// Flags:
//   --target=electron|browser
//   --chars=2000000     size of the synthetic note
//   --view=edit|render  which view the note is opened INTO. `render` is the
//                       one progressive delivery is for -- it reports when
//                       the pane's first block appears and when it stops
//                       growing, which is the whole gap that feature exists
//                       to open up.
//   --mode=self|tree    `self` ranks frames by self time; `tree` prints the
//                       ANCESTOR CHAIN of each hottest frame. Self time alone
//                       says what is slow and is silent on who asked for it,
//                       which is the question that actually matters when the
//                       hot frame is inside a library -- three rounds of
//                       guessing went into learning that.
//   --skip-build        (electron only) reuse the existing
//                       release/<version>/linux-unpacked build instead of
//                       repackaging first. A stale package silently measures
//                       old code, so omit this unless you just built.

import { chromium, _electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  APP_ROOT,
  startDevServer,
  waitForAppReady,
  startCdpJsProfile,
  resolveCallFrameName,
  ensurePreviewMode,
} from './perfHarness.mjs'

const PORT = 5251

function parseArgs(argv) {
  const args = { target: 'electron', chars: 2_000_000, mode: 'self', view: 'edit', skipBuild: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'skip-build') args.skipBuild = true
    else if (key === 'target') args.target = value
    else if (key === 'mode') args.mode = value
    else if (key === 'view') args.view = value
    else if (key === 'chars') args.chars = Number(value)
    else throw new Error(`unknown flag "${raw}"`)
  }
  if (!['electron', 'browser'].includes(args.target)) {
    throw new Error(`--target must be electron|browser, got "${args.target}"`)
  }
  if (!['edit', 'render'].includes(args.view)) {
    throw new Error(`--view must be edit|render, got "${args.view}"`)
  }
  if (!['self', 'tree'].includes(args.mode)) {
    throw new Error(`--mode must be self|tree, got "${args.mode}"`)
  }
  if (!Number.isFinite(args.chars) || args.chars <= 0) {
    throw new Error(`--chars must be a positive number, got "${args.chars}"`)
  }
  return args
}

// ---------------------------------------------------------------- the measurement

/** The ancestor chain of each hottest sampled frame, innermost first. */
function printCallChains(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const parentOf = new Map()
  for (const node of profile.nodes) for (const child of node.children ?? []) parentOf.set(child, node.id)

  // Self time per NODE, from timeDeltas rather than sample counts, so these
  // numbers are the same currency as --mode=self's (see aggregateCdpProfile:
  // timeDeltas[i + 1] is the delta attributable to samples[i]).
  const selfMs = new Map()
  for (let i = 0; i < profile.samples.length; i += 1) {
    const id = profile.samples[i]
    selfMs.set(id, (selfMs.get(id) ?? 0) + (profile.timeDeltas[i + 1] ?? 0) / 1000)
  }

  const ranked = [...selfMs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  for (const [id, ms] of ranked) {
    console.log(`\n=== ${Math.round(ms)}ms self ===`)
    for (let cursor = id; cursor !== undefined; cursor = parentOf.get(cursor)) {
      const node = byId.get(cursor)
      if (!node) break
      const { name, location } = resolveCallFrameName(node.callFrame)
      console.log(`  ${name}${location}`)
    }
  }
}

/** Seeds a large note WITHOUT opening it, reloads, then profiles the first open. */
async function measureFirstOpen(page, targetChars, label, mode, view) {
  await page.waitForTimeout(1500)

  const { noteId, kb } = await page.evaluate(async (chars) => {
    let text = '# Imported Report\n\n'
    while (text.length < chars) {
      text += `## Section ${text.length}\n\nA paragraph of prose long enough to wrap in a real editor window.\n\n- alpha\n- beta\n\n`
    }
    const note = await window.thockdownNotes.createNote({ title: 'Imported Report' })
    await window.thockdownNotes.saveNote({ id: note.id, text })
    return { noteId: note.id, kb: Math.round(text.length / 1024) }
  }, targetChars)
  console.log(`note: ${kb} KB, never opened`)

  await page.reload()
  await waitForAppReady(page).catch(() => {})
  await page.waitForTimeout(2000)

  // By id, not .first() -- a real packaged run starts on a fresh database and
  // therefore seeds the User Guide family, so the first row is not ours.
  // Put the section in the target view BEFORE the click, so the open itself
  // happens in that view rather than being followed by a toggle.
  if (view === 'render') await ensurePreviewMode(page)

  const row = page.locator(`.note-list-item[data-note-id="${noteId}"]`)
  await row.waitFor({ timeout: 30000 })

  // Three moments, because they answer different questions and used to be
  // conflated into one: when the EDITOR has the document, when the render
  // pane has its FIRST block (the top of the note becomes readable), and when
  // the split is WHOLE (the pane stops growing). Progressive delivery is
  // precisely the gap between the second and the third.
  const profile = await startCdpJsProfile(page)
  const started = Date.now()
  await page.evaluate(() => {
    const w = window
    // The ARRIVAL TIMELINE, not a single settle moment. A quiet-window
    // heuristic answered "845ms, 74 blocks" for a document with 58,000 of
    // them and called it settled.
    //
    // Read the FIRST number, which is when the top of the note became
    // readable. The final count is NOT the document's block count and must
    // not be read as one: past noteSizeThresholdBlocks the render pane is
    // windowed, so it mounts a window and never more, however much of the
    // split has arrived. What the curve shows after the first step is the
    // window filling, not the document.
    w.__firstOpenMarks = { startedAt: performance.now(), steps: [], done: false }
    let lastCount = 0
    let lastChangeAt = performance.now()
    const tick = () => {
      const count = document.querySelectorAll('.markdown-preview div[data-index]').length
      if (count !== lastCount) {
        lastCount = count
        lastChangeAt = performance.now()
        w.__firstOpenMarks.steps.push([Math.round(lastChangeAt - w.__firstOpenMarks.startedAt), count])
      } else if (performance.now() - lastChangeAt > 3000) {
        w.__firstOpenMarks.done = true
        return
      }
      setTimeout(tick, 25)
    }
    tick()
  })
  await row.click()
  await page.waitForFunction(
    () => (document.querySelector('.cm-content')?.textContent ?? '').includes('Imported Report'),
    null,
    { timeout: 30000 },
  )
  const firstText = Date.now() - started
  await page.waitForTimeout(500)
  // Stop profiling BEFORE waiting out the arrival curve. The curve can take a
  // minute on a large note, and a minute of sampling is both a much slower
  // aggregation and a heavier perturbation of the thing being measured than
  // the open it is supposed to describe.
  const { totalMs, entries, raw } = await profile.stop()
  const marks = await page.evaluate(() => {
    const w = window
    const deadline = Date.now() + 60_000
    return new Promise((resolve) => {
      const check = () => {
        if (w.__firstOpenMarks?.done || Date.now() > deadline) resolve(w.__firstOpenMarks)
        else setTimeout(check, 100)
      }
      check()
    })
  })

  console.log(`\ntarget=${label} chars=${targetChars} view=${view} mode=${mode}`)
  console.log(`time to first text: ${firstText}ms   (profiled ${Math.round(totalMs)}ms total)`)
  const steps = marks.steps ?? []
  if (steps.length > 0) {
    console.log(`preview blocks arriving: ${steps.map(([ms, count]) => `${count}@${ms}ms`).join('  ')}`)
  } else {
    console.log('preview blocks arriving: none (the pane rendered no blocks)')
  }
  if (mode === 'tree') {
    printCallChains(raw)
    return
  }
  console.log('\nself time, hottest first:')
  for (const entry of entries.slice(0, 20)) {
    console.log(`  ${String(Math.round(entry.ms)).padStart(6)}ms  ${entry.name}`)
  }
}

// ---------------------------------------------------------------- the two launches

async function runBrowser(args) {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  try {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
    await waitForAppReady(page).catch(() => {})
    await measureFirstOpen(page, args.chars, 'browser-mock', args.mode, args.view)
  } finally {
    await browser.close()
    server.stop?.()
  }
}

function buildPackagedApp() {
  console.error('[perf] building renderer + electron main/preload (npx vite build)...')
  let result = spawnSync('npx', ['vite', 'build'], { cwd: APP_ROOT, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`vite build failed with exit code ${result.status}`)

  console.error('[perf] packaging via electron-builder (--linux dir)...')
  result = spawnSync('npx', ['electron-builder', '--linux', 'dir'], { cwd: APP_ROOT, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`electron-builder failed with exit code ${result.status}`)
}

/** Same DB-readiness race as measureInputLagElectronPackaged.mjs -- see that file. */
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

async function runElectron(args) {
  const pkg = JSON.parse(await readFile(path.join(APP_ROOT, 'package.json'), 'utf8'))
  const executablePath = path.join(APP_ROOT, 'release', pkg.version, 'linux-unpacked', pkg.name)

  if (!args.skipBuild) buildPackagedApp()
  else if (!existsSync(executablePath)) {
    throw new Error(`--skip-build was given but no existing package was found at ${executablePath} -- run once without --skip-build first.`)
  }
  if (!existsSync(executablePath)) {
    throw new Error(`packaged executable not found at ${executablePath} after build`)
  }
  if (!process.env.DISPLAY) {
    console.error('[perf] WARNING: $DISPLAY is unset -- this needs `xvfb-run -a` (the npm script does it).')
  }

  // A packaged build's data root is app.getPath('userData')/data, and userData
  // derives from --user-data-dir, so a fresh temp dir is an isolated, empty DB.
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'thockdown-first-open-perf-'))
  console.error(`[perf] launching the packaged app at ${executablePath}...`)
  const app = await _electron.launch({
    executablePath,
    args: ['--no-sandbox', `--user-data-dir=${userDataDir}`],
    cwd: APP_ROOT,
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await waitForDatabaseReady(page, 20000)
    await measureFirstOpen(page, args.chars, 'electron-packaged', args.mode, args.view)
  } finally {
    await app.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

const args = parseArgs(process.argv.slice(2))
if (args.target === 'browser') await runBrowser(args)
else await runElectron(args)
process.exit(0)
