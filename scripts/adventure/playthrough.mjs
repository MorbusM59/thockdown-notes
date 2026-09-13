#!/usr/bin/env node
// Plays the adventure in the REAL Electron app, and reports what the chrome
// actually shows.
//
//   xvfb-run -a node scripts/adventure/playthrough.mjs [--turns=40] [--shots]
//
// WHAT THIS IS FOR, and what it is NOT for. The game is a pure function of a
// seed and a list of choices, so questions about BALANCE are answered by
// scripts/adventure/simulate.ts, which plays thousands of runs in a second
// with no browser in the way. This harness answers the other question: does
// what the model computed reach the screen intact -- the ring's cells, the
// narration pills, the icons inside them, the identity counter. Every defect
// it has caught has been one of rendering or wiring (an empty box where a Pro
// icon was named; narration spans collapsing into each other because
// `.tag-pill` is `inline-flex`), and none of them could have been seen from
// the model.
//
// TWO NATIVE BUILDS, and they are not the same one. `better-sqlite3` has to
// be compiled for ELECTRON's ABI to run this, and for NODE's to run vitest:
//
//   npx electron-rebuild -f -w better-sqlite3   # before this script
//   npm rebuild better-sqlite3                  # before `npm test`
//
// Getting it wrong does not say so clearly -- Electron simply never opens a
// window, and vitest segfaults. `npm run pretest` does the second for you.
//
// It clears `<repo>/data` first, the same way the perf harnesses do: a
// leftover database means a leftover save, and the run would start somewhere
// other than the beginning.

import { _electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function parseArgs(argv) {
  const args = { turns: 40, shots: false, skipBuild: false, out: path.join(REPO_ROOT, 'tmp-adventure-shots') }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'turns') args.turns = Number(value)
    else if (key === 'shots') args.shots = true
    else if (key === 'skip-build') args.skipBuild = true
    else if (key === 'out') args.out = value
  }
  return args
}

/** Everything databaseService.ts writes, without touching the tracked placeholder. */
function clearNoteDatabase() {
  const dataDir = path.join(REPO_ROOT, 'data')
  if (!existsSync(dataDir)) return
  for (const entry of readdirSync(dataDir)) {
    if (entry === '.gitkeep') continue
    rmSync(path.join(dataDir, entry), { recursive: true, force: true })
  }
}

/**
 * What the two bars and the ring are showing, read out of the DOM rather than
 * out of the save -- which is the whole point of running in the app at all.
 */
async function readChrome(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.chapter-bar-display')
    const pills = bar ? [...bar.querySelectorAll('.escape-menu-narration')] : []
    return {
      identity: document.querySelector('.escape-menu-identity-tab')?.textContent ?? null,
      pills: pills.map((pill) => ({
        label: pill.getAttribute('aria-label'),
        icons: [...pill.querySelectorAll('span[class*="fa-"]')]
          .map((glyph) => (glyph.className.match(/fa-[a-z0-9-]+(?!.*fa-)/) ? glyph.className.split(' ')[1] : null))
          .filter(Boolean),
      })),
      cells: [...document.querySelectorAll('.editor-escape-hold-panel-btn')].map((cell) => ({
        label: cell.getAttribute('aria-label') ?? '',
        // An empty box is what a Font Awesome PRO icon renders as, and it is
        // invisible to every check that reads the class name instead.
        glyphWidth: cell.querySelector('span[class*="fa-"]')?.getBoundingClientRect().width ?? 0,
      })),
      readouts: [...document.querySelectorAll('.escape-menu-readout')].map((readout) => readout.getAttribute('aria-label')),
    }
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!process.env.DISPLAY) {
    console.error('[adventure] WARNING: $DISPLAY is unset -- run this under `xvfb-run -a`.')
  }
  if (!args.skipBuild) {
    const built = spawnSync('npx', ['vite', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' })
    if (built.status !== 0) throw new Error(`vite build failed with exit code ${built.status}`)
  }
  if (args.shots) mkdirSync(args.out, { recursive: true })
  clearNoteDatabase()

  const app = await _electron.launch({ args: ['--no-sandbox', 'dist-electron/main.js'], cwd: REPO_ROOT })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // The main process seeds the database asynchronously and no readiness signal
  // exists, so poll the API this needs anyway rather than guessing at a delay.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await page.evaluate(() => window.thockdownNotes.listNotes())
      break
    } catch {
      await page.waitForTimeout(200)
    }
  }
  await page.waitForTimeout(1200)

  // RIGHT-CLICK on the User Guide window control is the only way in, by
  // design (src/shared/slotOverlay.ts). Matched on the icon rather than on
  // the label, which says three different things depending on what the slot
  // is already holding.
  const guide = page.locator('button.window-control-btn:has(.fa-graduation-cap), button.window-control-btn:has(.fa-fire)')
  await guide.first().waitFor({ timeout: 30_000 })
  await guide.first().click({ button: 'right' })
  await page.waitForTimeout(900)

  const complaints = []
  for (let turn = 0; turn < args.turns; turn += 1) {
    const chrome = await readChrome(page)
    if (chrome.cells.length === 0) {
      complaints.push(`turn ${turn}: the ring has no cells`)
      break
    }
    for (const cell of chrome.cells) {
      if (cell.glyphWidth === 0) complaints.push(`turn ${turn}: cell "${cell.label}" has no glyph`)
    }
    if ((chrome.identity ?? '').includes('Combat') && chrome.pills.length === 0) {
      complaints.push(`turn ${turn}: a fight with nothing on the chapter bar`)
    }
    console.log(`\n--- turn ${turn}  ${chrome.identity ?? ''}`)
    for (const pill of chrome.pills) console.log(`    ${pill.label}`)
    console.log(`    ring: ${chrome.cells.map((cell) => cell.label).join(' | ')}`)
    if (args.shots) {
      await page.screenshot({ path: path.join(args.out, `turn-${String(turn).padStart(3, '0')}.png`) })
    }
    await page.locator('.editor-escape-hold-panel-btn').first().click()
    await page.waitForTimeout(240)
  }

  await app.close()
  if (complaints.length > 0) {
    console.error(`\n[adventure] ${complaints.length} complaint(s):`)
    for (const complaint of complaints) console.error(`  - ${complaint}`)
    process.exitCode = 1
  } else {
    console.log(`\n[adventure] ${args.turns} turns, nothing amiss on the chrome.`)
  }
}

await main()
