#!/usr/bin/env node
// Takes the screenshots that go with a desktop release, in the REAL Electron
// app, from a committed set of placeholder notes.
//
//   npm run screenshots -- [--feature=find] [--out=<dir>] [--skip-build]
//
// (needs a display: on Linux without one it re-runs itself under `xvfb-run`,
// on a virtual screen larger than the largest shot.)
//
// Three shots, the same for every release so they can be compared:
//   1. `full-light-double.png`   1920x1080, double size, default light layout,
//      two slots -- the editor on the left, the reader on the right -- and the
//      note list in the sidebar.
//   2. `window-dark-regular.png` 1200x600, regular size, default dark layout,
//      the same arrangement.
//   3. `feature-<name>.png`      a crop of the release's new feature in use,
//      default light layout, regular size. Which feature is the one argument
//      a release picks (`--feature`); each is a scene in FEATURES below, which
//      sets the app up and returns the rectangle to keep.
//
// Every shot starts from its own copy of one seeded data root, so no shot can
// leave state (window size, layout, slots) behind for the next. The notes come
// from `fixture/*.md` (a front matter line of tags, then the note's markdown)
// and go in through the app's own note API, the way a reader's notes would, so
// the database is the app's own and nothing about its format is restated here.
// The shots are captured by the main process (`webContents.capturePage`), so
// they are in DEVICE pixels: Playwright's page screenshot is in CSS pixels and
// comes out at half size in double size mode.

import { _electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '../..')
const FIXTURE = path.join(HERE, 'fixture')
/** The welcome note an empty database is seeded with; the placeholder notes replace it. */
const WELCOME_NOTE_ID = '26-07-04_00-00_WELCOME00'
/** How long the app is given to settle after a step that re-lays it out (a mode, a size, a note). */
const SETTLE_MS = 1500

function parseArgs(argv) {
  const version = JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version
  const args = { feature: 'find', skipBuild: false, out: path.join(APP_ROOT, 'release-screenshots', version) }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'feature') args.feature = value
    else if (key === 'skip-build') args.skipBuild = true
    else if (key === 'out') args.out = path.resolve(value)
  }
  return args
}

function readFixtureNotes() {
  return readdirSync(FIXTURE)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const text = readFileSync(path.join(FIXTURE, name), 'utf8')
      const front = text.match(/^---\ntags: (.*)\n---\n/)
      if (!front) throw new Error(`fixture/${name}: expected a "tags:" front matter block`)
      return { tags: front[1].split(',').map((tag) => tag.trim()), text: text.slice(front[0].length) }
    })
}

async function launch(dataRoot) {
  const app = await _electron.launch({
    args: ['--no-sandbox', 'dist-electron/main.js'],
    cwd: APP_ROOT,
    env: { ...process.env, THOCKDOWN_DATA_ROOT: dataRoot },
  })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => {
    throw new Error(`page error: ${error.message}`)
  })
  // The main process seeds the database asynchronously and announces nothing,
  // so wait for the note API to answer (the same wait playthrough.mjs uses).
  await page.waitForFunction(async () => {
    try {
      await window.thockdownNotes.listNotes()
      return true
    } catch {
      return false
    }
  }, null, { timeout: 30_000, polling: 200 })
  return { app, page }
}

async function seed(dataRoot) {
  const { app, page } = await launch(dataRoot)
  await page.evaluate(async ({ notes, welcome }) => {
    const api = window.thockdownNotes
    await api.deleteNote({ id: welcome })
    for (const note of notes) await api.createNote({ initialText: note.text, initialTags: note.tags })
  }, { notes: readFixtureNotes(), welcome: WELCOME_NOTE_ID })
  await app.close()
}

async function setWindowSize(app, page, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, ...size })
  }, { width, height })
  await page.waitForTimeout(SETTLE_MS)
}

async function capture(app, file, rect) {
  const png = await app.evaluate(async ({ BrowserWindow }, area) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(area ?? undefined)
    return image.toPNG().toString('base64')
  }, rect ?? null)
  writeFileSync(file, Buffer.from(png, 'base64'))
  console.log(`[screenshots] ${path.relative(process.cwd(), file)}`)
}

/** Opens a note in the active slot by clicking its row in the note list. */
async function openNote(page, title) {
  await page.locator('.notes-sidebar, body').getByText(title, { exact: true }).first().click()
  await page.waitForTimeout(SETTLE_MS)
}

/** Parks the pointer where it hovers nothing that reacts (no row icons, no tooltip). */
async function parkPointer(page) {
  const { width, height } = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  await page.mouse.move(Math.round(width * 0.75), height - 2)
  await page.waitForTimeout(400)
}

/**
 * Two slots: the editor on the left, the reader on the right. A fresh slot
 * opens in the editor, and Escape switches the active one -- the right, the
 * slot just added -- to the reader.
 */
async function twoSlots(page) {
  await openNote(page, 'Weekend Sourdough')
  await page.locator('button:has(.fa-plus)').last().click()
  await page.waitForTimeout(SETTLE_MS)
  await openNote(page, 'Ridge Trail, Day Two')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(SETTLE_MS)
}

/**
 * A release's new feature in use. Each scene starts on a fresh app at its
 * window size, regular size, default light layout, and returns the rectangle
 * (in CSS pixels) to keep.
 */
const FEATURES = {
  // 0.9.0: the rebuilt Find & Replace dock, matches marked in the reader.
  find: {
    window: { width: 1200, height: 640 },
    async stage(page) {
      await openNote(page, 'Weekend Sourdough')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(SETTLE_MS)
      await page.locator('button[aria-label="Find"]').click()
      await page.waitForTimeout(SETTLE_MS)
      await page.keyboard.type('flour')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(SETTLE_MS)
      // The sidebar whole (the dock with its count sits at its foot) and the
      // start of the slot, where the reader marks the matches.
      return { x: 0, y: 0, width: 820, height: 640 }
    },
  },
}

async function shoot(template, args, { name, width, height, steps }) {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-shot-'))
  try {
    cpSync(template, dataRoot, { recursive: true })
    const { app, page } = await launch(dataRoot)
    await setWindowSize(app, page, width, height)
    const rect = await steps(app, page)
    await parkPointer(page)
    await capture(app, path.join(args.out, name), rect)
    await app.close()
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const feature = FEATURES[args.feature]
  if (!feature) throw new Error(`unknown --feature=${args.feature}; known: ${Object.keys(FEATURES).join(', ')}`)
  if (!args.skipBuild) {
    const built = spawnSync('npx', ['vite', 'build'], { cwd: APP_ROOT, stdio: 'inherit' })
    if (built.status !== 0) throw new Error(`vite build failed with exit code ${built.status}`)
  }
  mkdirSync(args.out, { recursive: true })
  const template = mkdtempSync(path.join(tmpdir(), 'thockdown-shots-seed-'))
  try {
    await seed(template)
    await shoot(template, args, {
      name: 'full-light-double.png', width: 1920, height: 1080,
      async steps(_app, page) {
        await twoSlots(page)
        await page.keyboard.press('F2')
        await page.waitForTimeout(SETTLE_MS)
      },
    })
    await shoot(template, args, {
      name: 'window-dark-regular.png', width: 1200, height: 600,
      async steps(_app, page) {
        await twoSlots(page)
        await page.keyboard.press('F3')
        await page.waitForTimeout(SETTLE_MS)
      },
    })
    await shoot(template, args, {
      name: `feature-${args.feature}.png`, ...feature.window,
      steps: (_app, page) => feature.stage(page),
    })
  } finally {
    rmSync(template, { recursive: true, force: true })
  }
}

if (process.platform === 'linux' && !process.env.DISPLAY) {
  const rerun = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 2560x1440x24', process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' })
  process.exit(rerun.status ?? 1)
}
await main()
