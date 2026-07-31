#!/usr/bin/env node
// Measures the real app's CM6Editor path (src/components/CM6Editor.tsx),
// not the standalone scripts/perf/cm6-spike/ prototype -- forces the
// dev-only `thockdown:cm6-editor-spike` localStorage flag on via
// page.addInitScript before every navigation, then reuses the exact same
// measurement primitives as `npm run perf:input-lag` for an apples-to-apples
// comparison against the Lexical numbers already in
// docs/large-document-performance-handover.md.
//
//   node scripts/perf/measureCM6RealApp.mjs [flags]
// Flags: same as measureInputLag.mjs (--mode, --chars, --keystrokes,
// --position, --port, --headed, --json)

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  generateSyntheticDocument,
  seedLargeNoteAndReload,
  measureKeystrokeBurstMs,
  summarizeMs,
  startCdpJsProfile,
  withCdpCategoryTrace,
} from './perfHarness.mjs'

// CM6Editor's real scroll element is CM6's own `.cm-scroller` (the outer
// `.cm6-editor-root` wrapper is deliberately non-scrolling -- see
// CM6Editor.tsx's own comment on why -- and it never gets the
// `thockdown-custom-scrollbar` class perfHarness.mjs's placeCaretAt()
// selector expects, since that class is Editor.tsx/Lexical-specific). Uses
// CM6's own Mod-Home/Mod-End default keybindings (cursorDocStart/
// cursorDocEnd) instead of manual scroll+click, so caret placement is exact
// regardless of document size.
async function placeCaretAtCM6(page, position) {
  const editable = page.locator('.cm-content[contenteditable="true"]')
  await editable.waitFor({ state: 'visible', timeout: 10000 })
  await editable.click()
  await page.waitForSelector('.cm-content[contenteditable="true"]:focus', { timeout: 5000 })
  if (position === 'start') {
    await page.keyboard.press('Control+Home')
  } else if (position === 'end') {
    await page.keyboard.press('Control+End')
  } else {
    await page.keyboard.press('Control+Home')
    const scroller = page.locator('.cm-scroller')
    const box = await scroller.boundingBox()
    if (box) await page.mouse.click(box.x + Math.min(60, box.width / 2), box.y + box.height / 2)
  }
  await page.waitForTimeout(200)
}

function parseArgs(argv) {
  const args = { mode: 'burst', chars: 1_500_000, keystrokes: 30, position: 'end', port: 5184, headed: false, json: false, char: 'x' }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key === 'json') args.json = true
    else if (key === 'mode') args.mode = value
    else if (key === 'position') args.position = value
    else if (key === 'chars') args.chars = Number(value)
    else if (key === 'keystrokes') args.keystrokes = Number(value)
    else if (key === 'port') args.port = Number(value)
    else if (key === 'char') args.char = value
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!['start', 'middle', 'end'].includes(args.position)) throw new Error(`--position must be start|middle|end, got "${args.position}"`)
  if (!['burst', 'profile', 'trace'].includes(args.mode)) throw new Error(`--mode must be burst|profile|trace, got "${args.mode}"`)

  console.error(`[cm6-real] starting dev server on port ${args.port}...`)
  const server = await startDevServer(args.port)

  let browser
  try {
    browser = await chromium.launch({ headless: !args.headed, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage()
    await page.addInitScript(() => { window.localStorage.setItem('thockdown:cm6-editor-spike', '1') })
    await page.goto(`http://localhost:${args.port}/`)

    console.error(`[cm6-real] generating synthetic document (~${args.chars} chars)...`)
    const text = generateSyntheticDocument(args.chars)

    console.error('[cm6-real] seeding note and reloading...')
    await seedLargeNoteAndReload(page, text)

    const isCM6 = await page.evaluate(() => Boolean(document.querySelector('.cm-editor')))
    console.error(`[cm6-real] CM6 editor mounted: ${isCM6}`)
    if (!isCM6) throw new Error('CM6 editor did not mount -- localStorage flag or DEV gating may not be working as expected')

    console.error(`[cm6-real] placing caret at "${args.position}"...`)
    await placeCaretAtCM6(page, args.position)

    let result
    if (args.mode === 'burst') {
      const deltas = await measureKeystrokeBurstMs(page, args.keystrokes, args.char)
      result = { mode: 'burst', target: 'cm6-real-app', chars: args.chars, keystrokes: args.keystrokes, position: args.position, deltas, summary: summarizeMs(deltas) }
    } else if (args.mode === 'profile') {
      const profile = await startCdpJsProfile(page)
      await measureKeystrokeBurstMs(page, args.keystrokes, args.char)
      const aggregated = await profile.stop()
      result = { mode: 'profile', target: 'cm6-real-app', chars: args.chars, keystrokes: args.keystrokes, position: args.position, ...aggregated }
    } else {
      const entries = await withCdpCategoryTrace(page, async () => {
        await measureKeystrokeBurstMs(page, args.keystrokes, args.char)
      })
      result = { mode: 'trace', target: 'cm6-real-app', chars: args.chars, keystrokes: args.keystrokes, position: args.position, entries }
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
  process.exit(process.exitCode ?? 0)
}

function printSummary(result) {
  console.log(`\ntarget=${result.target} mode=${result.mode} chars=${result.chars} keystrokes=${result.keystrokes} position=${result.position}\n`)
  if (result.mode === 'burst') {
    const s = result.summary
    console.log(`mean=${s.mean.toFixed(2)}ms  median=${s.median.toFixed(2)}ms  min=${s.min.toFixed(2)}ms  max=${s.max.toFixed(2)}ms  total=${s.sum.toFixed(1)}ms`)
    console.log(`per-keystroke: ${result.deltas.map((d) => d.toFixed(1)).join(', ')}`)
    return
  }
  if (result.mode === 'profile') {
    console.log(`total sampled JS time: ${result.totalMs.toFixed(1)}ms\n`)
    console.log('top functions by self-time:')
    for (const entry of result.entries.slice(0, 30)) {
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
  process.exitCode = 1
})
