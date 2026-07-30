// Shared plumbing for the input-lag perf scripts under scripts/perf/. Not a
// test suite -- a measurement tool, meant to be run by a human/agent doing a
// performance pass, per docs/document-scale-performance-philosophy.md's rule
// that every fix in this space starts and ends with a live-browser
// measurement, not code-reading. See docs/large-document-performance-handover.md
// ("Environment notes for the next session") for the manual version of this
// setup this harness replaces -- kept here so it doesn't have to be
// reconstructed from scratch every session.
//
// Deliberately NOT using the embedded Claude Browser pane (confirmed
// unreliable for this project -- reports document.hidden === true
// permanently, which throttles rAF/timers and makes timing meaningless).
// This launches a real, non-backgrounded Chromium via Playwright instead.

import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..', '..')

/** Waits until a GET to `url` doesn't reject (dev server is up). */
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) return
    } catch (err) {
      lastError = err
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Dev server at ${url} did not become ready in ${timeoutMs}ms: ${lastError}`)
}

/**
 * Starts `npm run dev:browser` on `port` and resolves once it's serving.
 * Caller owns calling `stop()` when done (including on error paths --
 * leaving this running leaks a process across harness invocations).
 */
export async function startDevServer(port) {
  // detached so the child gets its own process group -- `npm run` spawns
  // vite as a grandchild, and a plain SIGTERM to the npm process alone
  // doesn't reliably reach it, leaving the dev server (and its open port)
  // running after this script exits. Killing the whole group (negative pid)
  // in stop() below takes both out together.
  const proc = spawn('npm', ['run', 'dev:browser', '--', '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  let output = ''
  proc.stdout.on('data', (chunk) => { output += chunk.toString() })
  proc.stderr.on('data', (chunk) => { output += chunk.toString() })

  const exitedEarly = new Promise((_resolve, reject) => {
    proc.once('exit', (code) => {
      if (code !== null && code !== 0) {
        reject(new Error(`dev:browser exited early (code ${code}). Output:\n${output}`))
      }
    })
  })

  await Promise.race([
    waitForServer(`http://localhost:${port}/`, 30000),
    exitedEarly,
  ])

  return {
    port,
    stop() {
      try {
        process.kill(-proc.pid, 'SIGTERM')
      } catch {
        proc.kill('SIGTERM')
      }
    },
  }
}

/** Generates synthetic markdown text of roughly `targetChars` characters, mixing plain paragraphs with occasional headings/lists so markdown-aware code paths (list detection, heading detection, inline emphasis) see realistic content instead of one giant plain block. */
export function generateSyntheticDocument(targetChars) {
  const lines = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    let line
    const mod = i % 37
    if (mod === 0) {
      line = `## Section heading ${i / 37 | 0}`
    } else if (mod === 1) {
      line = '- a short unordered list item with **bold** and *italic* text'
    } else if (mod === 2) {
      line = `1. an ordered list item, number ${i}`
    } else if (mod === 3) {
      line = '> a blockquote line with `inline code` in it'
    } else {
      line = `This is a fairly ordinary paragraph line number ${i}, written so the synthetic document has realistic prose density and mixed sentence lengths, some of which run a bit longer than others to vary paragraph weight across the document.`
    }
    lines.push(line)
    total += line.length + 1
    i += 1
  }
  return lines.join('\n')
}

/**
 * Seeds a note with `text` via the dev-mode mock IPC bridge
 * (src/dev/installBrowserMockBridges.ts), activates it in the default
 * editor section, then reloads -- the bridge only updates persisted
 * section state, it does not push a live update into the already-running
 * React app (confirmed in the handover doc). Resolves once the editor's
 * real contenteditable has mounted post-reload.
 */
export async function seedLargeNoteAndReload(page, text) {
  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText })
    await window.thockdownSections.setActiveNote('default', note.id)
  }, text)
  await page.reload()
  await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 30000 })
  // Let the initial mount/hydration settle (virtualizer measurement passes,
  // fixed-focus viewport boundary calculation) before any measurement starts.
  await page.waitForTimeout(500)
}

const EDITABLE_SELECTOR = '.editor-text[contenteditable="true"]'
// Both the edit-mode scroller and the read-only preview scroller carry
// .thockdown-custom-scrollbar -- scope to the one that actually contains the
// live contenteditable.
const SCROLLER_SELECTOR = `.thockdown-custom-scrollbar:has(${EDITABLE_SELECTOR})`

/**
 * Places the caret at an approximate document position by scrolling the
 * editor scroller and clicking near the resulting edge/center, then
 * confirms focus landed on the real contenteditable. Not pixel-exact --
 * good enough for "caret near start/middle/end of a huge document", which
 * is the granularity this doc's own prior profiling used (see handover
 * doc: "caret at document start *and* separately at document end").
 */
export async function placeCaretAt(page, position) {
  const scroller = page.locator(SCROLLER_SELECTOR)
  await scroller.waitFor({ state: 'visible' })

  await page.evaluate(({ selector, position }) => {
    const el = document.querySelector(selector)
    if (!el) return
    if (position === 'start') el.scrollTop = 0
    else if (position === 'end') el.scrollTop = el.scrollHeight
    else el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2)
  }, { selector: SCROLLER_SELECTOR, position })
  await page.waitForTimeout(100)

  const box = await scroller.boundingBox()
  if (!box) throw new Error('placeCaretAt: scroller has no bounding box')

  const x = box.x + Math.min(60, box.width / 2)
  const y = position === 'start'
    ? box.y + 20
    : position === 'end'
      ? box.y + box.height - 20
      : box.y + box.height / 2

  await page.mouse.click(x, y)
  await page.waitForSelector(`${EDITABLE_SELECTOR}:focus`, { timeout: 5000 })
}

/**
 * Types `count` printable characters one at a time via real dispatched key
 * events (page.keyboard.press, not page.keyboard.type -- press resolves
 * each key's full native event round trip individually, which is what lets
 * us time each keystroke separately), returning per-keystroke wall-clock
 * deltas in milliseconds. Mirrors the handover doc's "held-key burst"
 * wall-clock methodology.
 */
export async function measureKeystrokeBurstMs(page, count, char = 'x') {
  const deltas = []
  for (let i = 0; i < count; i += 1) {
    const start = performance.now()
    await page.keyboard.press(char)
    deltas.push(performance.now() - start)
  }
  // One more frame so the last keystroke's paint/commit is included in
  // whatever the caller inspects next, not left pending.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return deltas
}

export function summarizeMs(deltas) {
  const sorted = [...deltas].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  const mean = sum / sorted.length
  const median = sorted[Math.floor(sorted.length / 2)]
  const max = sorted[sorted.length - 1]
  const min = sorted[0]
  return { count: sorted.length, sum, mean, median, min, max }
}

/** Starts a CDP JS call-stack sampling profile. Returns a stop() that resolves the aggregated self-time-by-function-name map, sorted descending. */
export async function startCdpJsProfile(page) {
  const client = await page.context().newCDPSession(page)
  await client.send('Profiler.enable')
  await client.send('Profiler.setSamplingInterval', { interval: 100 })
  await client.send('Profiler.start')

  return {
    async stop() {
      const { profile } = await client.send('Profiler.stop')
      await client.detach().catch(() => {})
      return aggregateCdpProfile(profile)
    },
  }
}

function aggregateCdpProfile(profile) {
  const nodeById = new Map(profile.nodes.map((n) => [n.id, n]))
  const selfTimeByName = new Map()
  let totalMs = 0

  // profile.samples[i] is the node id active during timeDeltas[i] (delta
  // *before* sample i, per the Chrome DevTools Protocol spec -- the very
  // first delta precedes the first sample and is discarded here since
  // there's no attributable node for it yet).
  const { samples, timeDeltas } = profile
  for (let i = 0; i < samples.length; i += 1) {
    const deltaUs = timeDeltas[i + 1] ?? 0
    const deltaMs = deltaUs / 1000
    totalMs += deltaMs
    const node = nodeById.get(samples[i])
    const name = node?.callFrame?.functionName || '(anonymous)'
    const url = node?.callFrame?.url ? ` @ ${node.callFrame.url.split('/').pop()}:${node.callFrame.lineNumber + 1}` : ''
    const key = `${name || '(anonymous)'}${url}`
    selfTimeByName.set(key, (selfTimeByName.get(key) ?? 0) + deltaMs)
  }

  const entries = [...selfTimeByName.entries()]
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms)

  return { totalMs, entries }
}

/** Full devtools.timeline category trace, for Layout/Paint/Raster/Commit vs. JS attribution -- the complement to the JS sampling profile, per the handover doc's two-technique methodology. */
export async function withCdpCategoryTrace(page, driveInteraction) {
  const client = await page.context().newCDPSession(page)
  const events = []
  client.on('Tracing.dataCollected', (params) => {
    events.push(...(params.value ?? []))
  })

  await client.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8',
    options: 'sampling-frequency=10000',
    transferMode: 'ReportEvents',
  })

  await driveInteraction()

  await new Promise((resolve) => {
    client.once('Tracing.tracingComplete', resolve)
    client.send('Tracing.end')
  })
  await client.detach().catch(() => {})

  const durByName = new Map()
  const beginStack = new Map()
  for (const ev of events) {
    if (ev.ph === 'X' && typeof ev.dur === 'number') {
      durByName.set(ev.name, (durByName.get(ev.name) ?? 0) + ev.dur / 1000)
    } else if (ev.ph === 'B') {
      const stack = beginStack.get(ev.name) ?? []
      stack.push(ev.ts)
      beginStack.set(ev.name, stack)
    } else if (ev.ph === 'E') {
      const stack = beginStack.get(ev.name)
      const startTs = stack?.pop()
      if (startTs !== undefined) {
        durByName.set(ev.name, (durByName.get(ev.name) ?? 0) + (ev.ts - startTs) / 1000)
      }
    }
  }

  return [...durByName.entries()]
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms)
}
