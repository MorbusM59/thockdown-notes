// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
/**
 * Records why the window stopped responding, to a file that survives the
 * hang: `<data root>/logs/hang.log`.
 *
 * A renderer whose main thread is stuck cannot be inspected from DevTools
 * (DevTools runs on that same thread, so it attaches and shows nothing), and
 * a freeze that takes hours to appear cannot be caught live. The main process
 * is still running, so it watches the window and writes down:
 *
 * - `unresponsive`: Chromium's own judgement that the page has not answered
 *   for a few seconds, with the page's JAVASCRIPT CALL STACK at that moment
 *   (`collectJavaScriptCallStack`), taken again `RESAMPLE_MS` later while it
 *   is still stuck, so a loop shows the same frames twice where a slow step
 *   shows two different ones. The stack needs the page's opt-in, which the
 *   main process grants by answering the page's own load with a
 *   `Document-Policy: include-js-call-stacks-in-crash-reports` header.
 * - `responsive`: when it came back, and after how long.
 * - `render-process-gone` and `child-process-gone`: a crash or a killed
 *   process (the GPU process, the audio service), with Chromium's reason.
 *
 * Each line is one event, timestamped, appended. Nothing is written while the
 * app behaves, so the file stays empty for a healthy install.
 */

import fs from 'node:fs'
import path from 'node:path'
import { app, session, type BrowserWindow } from 'electron'

const RESAMPLE_MS = 10_000

export function installHangLog(win: BrowserWindow, dataRoot: string): void {
  const file = path.join(dataRoot, 'logs', 'hang.log')
  const write = (line: string) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // A log that cannot be written must not take the app down with it.
    }
  }

  // The opt-in collectJavaScriptCallStack needs, on every document the window loads.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Document-Policy': ['include-js-call-stacks-in-crash-reports'],
      },
    })
  })

  const stackOf = async (): Promise<string> => {
    try {
      const stack = await win.webContents.mainFrame.collectJavaScriptCallStack()
      return stack ? stack.trim().split('\n').map((frame) => `    ${frame.trim()}`).join('\n') : '    (no stack)'
    } catch (error) {
      return `    (no stack: ${String(error)})`
    }
  }

  let stuckSince: number | null = null
  let resample: NodeJS.Timeout | null = null
  win.on('unresponsive', async () => {
    stuckSince = Date.now()
    write(`unresponsive\n${await stackOf()}`)
    resample = setTimeout(async () => {
      if (stuckSince !== null) write(`still unresponsive after ${Math.round((Date.now() - stuckSince) / 1000)}s\n${await stackOf()}`)
    }, RESAMPLE_MS)
  })
  win.on('responsive', () => {
    if (resample) clearTimeout(resample)
    resample = null
    if (stuckSince !== null) write(`responsive again after ${Math.round((Date.now() - stuckSince) / 1000)}s`)
    stuckSince = null
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    write(`render process gone: ${details.reason} (exit code ${details.exitCode})`)
  })
  app.on('child-process-gone', (_event, details) => {
    write(`child process gone: ${details.type}${details.name ? ` (${details.name})` : ''}: ${details.reason} (exit code ${details.exitCode})`)
  })
}
