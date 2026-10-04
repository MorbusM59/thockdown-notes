#!/usr/bin/env node
// Typing fast on a large note must never lose characters to the editor's own
// React->CM6 hydration path.
//
// The defect this guards: `initialText` reaches CM6Editor through React state,
// whose commit is coalesced onto a frame and whose render, on a large note,
// takes long enough that more keystrokes land before the hydration effect
// runs. That effect force-matches the live document to `initialText`, so a
// late render "corrects" the document by deleting what was typed during it.
// Observed in the wild on a 1.5M-character note as runs of newlines vanishing
// after holding Enter -- 53 and 75 characters in the worst two cases.
//
// Two independent assertions, because either alone can be satisfied by a bug:
//
//   * the overwrite buffer (`window.__thockdownHydrationOverwrites`, which
//     CM6Editor records every same-note hydration DELETION into) must stay
//     empty -- this is the mechanism itself, caught in the act;
//   * the document must actually contain every character typed -- this is the
//     outcome, and it holds even if the mechanism ever moves elsewhere.
//
// Types with NO delay between keystrokes on purpose. The race needs the
// editor to outrun React, and a polite fixture never does.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  generateSyntheticDocument,
  seedLargeNoteAndReload,
  placeCaretAt,
} from './perfHarness.mjs'

function parseArgs(argv) {
  const args = { port: 5196, chars: 1_500_000, presses: 40, headed: false, key: 'Enter', external: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key === 'external') args.external = true
    else if (key === 'key') args.key = value
    else if (key === 'chars') args.chars = Number(value)
    else if (key === 'presses') args.presses = Number(value)
    else if (key === 'port') args.port = Number(value)
  }
  return args
}

function resolveChromiumExecutable() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).find((n) => n.startsWith('chromium-') && !n.includes('headless'))
  if (!dir) return undefined
  for (const rel of [['chrome-win', 'chrome.exe'], ['chrome-linux', 'chrome'], ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']]) {
    const candidate = path.join(root, dir, ...rel)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

let failures = 0
const check = (ok, label, detail) => {
  if (!ok) failures += 1
  console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? ' -- ' + detail : ''))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const server = await startDevServer(args.port)
  const browser = await chromium.launch({ headless: !args.headed, executablePath: resolveChromiumExecutable() })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto('http://localhost:' + args.port + '/', { waitUntil: 'domcontentloaded' })
    // The cage-state hook carries docLines/docLength, which is how this reads
    // the document's own truth rather than inferring it from the DOM.
    await page.evaluate(() => window.localStorage.setItem('thockdown:debug-cage-state', '1'))
    await seedLargeNoteAndReload(page, generateSyntheticDocument(args.chars))
    // An external note takes a different per-keystroke path (an IPC round trip
    // and a debounced full-document hash, each ending in a setNotes), so it
    // produces strictly MORE re-renders than an internal one -- and every
    // extra render is another chance for one to carry a text the editor has
    // already moved past. That is why the reporter only ever saw this on
    // external notes.
    if (args.external) {
      await page.evaluate(async () => {
        const sections = await window.thockdownSections.listSections()
        const noteId = sections.find((section) => section.activeNoteId)?.activeNoteId
        if (noteId) await window.thockdownNotes.addTagToNote({ id: noteId, tagName: 'external' })
      })
      await page.reload()
      await page.waitForTimeout(2500)
    }
    await placeCaretAt(page, 'middle')
    await page.waitForTimeout(1500)

    const hasHook = await page.evaluate(() => typeof window.__thockdownDebugCageState === 'function')
    if (!hasHook) throw new Error('__thockdownDebugCageState missing -- the debug flag did not take effect')

    const before = await page.evaluate(() => {
      const state = window.__thockdownDebugCageState()
      return { docLines: state.docLines, docLength: state.docLength }
    })
    await page.evaluate(() => { window.__thockdownHydrationOverwrites = [] })

    console.log('\nchars=' + args.chars + ' key=' + args.key + ' presses=' + args.presses
      + '  starting at docLines=' + before.docLines)

    // Raw CDP dispatch, NOT page.keyboard.press: press awaits a full protocol
    // round trip per key (~14ms on this machine), which is a polite typist and
    // never outruns React. Holding a key does. These are fired without
    // awaiting each one, so they queue on the wire the way autorepeat queues
    // on the input pipeline -- which is the only way this fixture can create
    // the race it exists to detect.
    const client = await page.context().newCDPSession(page)
    const pending = []
    for (let i = 0; i < args.presses; i += 1) {
      if (args.key === 'Enter') {
        pending.push(client.send('Input.dispatchKeyEvent', {
          type: 'rawKeyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
          key: 'Enter', code: 'Enter', autoRepeat: i > 0,
        }))
        pending.push(client.send('Input.dispatchKeyEvent', {
          type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
          key: 'Enter', code: 'Enter',
        }))
      } else {
        pending.push(client.send('Input.dispatchKeyEvent', { type: 'char', text: args.key, key: args.key }))
      }
    }
    await Promise.all(pending)

    // Long enough for every coalesced commit, IPC round trip and debounced
    // effect to land. A loss that is going to happen has happened by now.
    await page.waitForTimeout(6000)

    const after = await page.evaluate(() => {
      const state = window.__thockdownDebugCageState()
      return {
        docLines: state.docLines,
        docLength: state.docLength,
        overwrites: window.__thockdownHydrationOverwrites ?? [],
      }
    })

    const linesGained = after.docLines - before.docLines
    const charsGained = after.docLength - before.docLength
    const deletedTotal = after.overwrites.reduce((sum, entry) => sum + (entry.deletedChars ?? 0), 0)

    console.log('  docLines +' + linesGained + ', docLength +' + charsGained
      + ', hydration deletions: ' + after.overwrites.length + ' (' + deletedTotal + ' chars)')
    if (after.overwrites.length > 0) {
      for (const entry of after.overwrites.slice(0, 5)) {
        console.log('    deleted ' + entry.deletedChars + ' chars: ' + entry.deleted)
      }
    }

    check(after.overwrites.length === 0,
      'the hydration path never overwrote the live document',
      after.overwrites.length + ' overwrite(s), ' + deletedTotal + ' characters deleted')
    // One character per press holds only for a printable key. Enter continues
    // the line it breaks -- a list marker, a quote, the indentation -- so it
    // adds more than one; for Enter, the line count below and the overwrite
    // check above are what say nothing was lost. Run with --key=a for the
    // character-exact version of this check.
    check(args.key === 'Enter' || charsGained === args.presses,
      'every typed character survived',
      args.key === 'Enter'
        ? 'not a printable key -- see the line count instead (document gained ' + charsGained + ')'
        : 'typed ' + args.presses + ', document gained ' + charsGained)
    check(args.key !== 'Enter' || linesGained === args.presses,
      'every Enter produced exactly one line',
      'pressed ' + args.presses + ', gained ' + linesGained + ' lines')
    check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '))

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
    process.exitCode = failures === 0 ? 0 : 1
  } finally {
    await browser.close().catch(() => {})
    await server.stop()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
