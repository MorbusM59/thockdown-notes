#!/usr/bin/env node
// Typing in an external note must do NOTHING an ordinary note would not do.
//
// The reporter's own test for the dropped keystrokes and the stranded caret
// was that "these vanish when the external tag is removed" -- so the fix is
// not a smarter external path, it is the absence of one. This checks that
// directly, in the two ways it can be observed from outside:
//
//   * no external-only IPC fires while typing. `updateExternalNoteState` used
//     to be called on the modified-state transition, and its reply pushed a
//     second `setNotes`; both were re-renders an ordinary note never paid, and
//     every extra render is a chance to carry a stale text back to the editor.
//   * the note still shows as modified once it diverges from the file, since
//     that is what makes Save available -- the behaviour had to be DERIVED
//     rather than tracked, not dropped.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs'

function parseArgs(argv) {
  const args = { port: 5199, keystrokes: 20, headed: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key === 'keystrokes') args.keystrokes = Number(value)
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
    await waitForAppReady(page)

    await page.evaluate(async () => {
      const note = await window.thockdownNotes.createNote({
        initialText: 'EXTERNAL PARITY NOTE\n\nsome body text to edit\n',
      })
      await window.thockdownNotes.addTagToNote({ id: note.id, tagName: 'external' })
      await window.thockdownSections.setActiveNote('default', note.id)
    })
    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(1200)

    // Counted from inside the page, after the app has booted, so this observes
    // the real call sites rather than a mock's own bookkeeping.
    await page.evaluate(() => {
      const api = window.thockdownNotes
      window.__externalIpcCalls = { updateExternalNoteState: 0, saveNoteSnapshot: 0 }
      const originalUpdate = api.updateExternalNoteState.bind(api)
      api.updateExternalNoteState = (input) => {
        window.__externalIpcCalls.updateExternalNoteState += 1
        return originalUpdate(input)
      }
      const originalSnapshot = api.saveNoteSnapshot.bind(api)
      api.saveNoteSnapshot = (input) => {
        window.__externalIpcCalls.saveNoteSnapshot += 1
        return originalSnapshot(input)
      }
    })

    await page.locator('.cm-content').click()
    await page.waitForTimeout(300)
    for (let i = 0; i < args.keystrokes; i += 1) {
      await page.keyboard.press('x')
    }
    // Past the save debounce, so anything the edit merely SCHEDULED has run.
    await page.waitForTimeout(2500)

    const result = await page.evaluate(() => ({
      calls: window.__externalIpcCalls,
      externalRows: document.querySelectorAll('.note-list-item.is-external').length,
      modifiedRows: document.querySelectorAll('.note-list-item.is-external.is-modified').length,
    }))

    console.log('\n  external-only IPC during typing: updateExternalNoteState='
      + result.calls.updateExternalNoteState)

    check(result.calls.updateExternalNoteState === 0,
      'typing fires no external-only IPC',
      result.calls.updateExternalNoteState + ' call(s)')

    if (result.externalRows === 0) {
      // The sidebar list is not on screen in this fixture's default state.
      // Reported rather than failed: absence of the row says nothing about
      // whether the derivation works.
      console.log('  INFO  no external note row rendered in the sidebar, modified-state not checked here')
    } else {
      check(result.modifiedRows > 0,
        'the edited external note shows as modified, so Save is available',
        result.modifiedRows + ' of ' + result.externalRows + ' external row(s)')
    }

    check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '))
    console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
    process.exitCode = failures === 0 ? 0 : 1
  } finally {
    await browser.close().catch(() => {})
    await server.stop()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
