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
import { readFileSync, existsSync } from 'node:fs'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'

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
  const isWindows = process.platform === 'win32'
  // detached so the child gets its own process group -- `npm run` spawns
  // vite as a grandchild, and a plain SIGTERM to the npm process alone
  // doesn't reliably reach it, leaving the dev server (and its open port)
  // running after this script exits. Killing the whole group (negative pid)
  // in stop() below takes both out together. Windows has no such thing as a
  // POSIX process group/negative-pid kill, and plain `spawn('npm', ...)`
  // fails outright there (`ENOENT` -- Windows' npm is `npm.cmd`, not on the
  // executable search path the same way `npm` is on POSIX); `shell: true`
  // resolves that the same way a real shell invocation would, and cleanup
  // uses `taskkill /T` (kills the whole process tree) instead of a signal.
  const proc = spawn(isWindows ? 'npm.cmd' : 'npm', ['run', 'dev:browser', '--', '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !isWindows,
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
      if (isWindows) {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
        return
      }
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
// The edit-mode scroller and the read-only preview scroller both carry
// .thockdown-custom-scrollbar under the Lexical editor (Editor.tsx); CM6
// (CM6Editor.tsx, the production editor as of 0.5.4) uses CodeMirror's own
// .cm-scroller instead and never gets the thockdown-custom-scrollbar class
// (found live: this harness's placeCaretAt started timing out immediately
// after the CM6 production flip, since the old Lexical-only selector never
// matches CM6's DOM). :has() with either scopes to whichever one actually
// contains the live contenteditable, so this works against either editor
// without the caller needing to know which is active.
const SCROLLER_SELECTOR = `:is(.thockdown-custom-scrollbar, .cm-scroller):has(${EDITABLE_SELECTOR})`

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

/**
 * Starts a CDP heap allocation sampling profile (HeapProfiler.startSampling)
 * -- the complement to the JS call-stack sampling profile above, for
 * attributing self-time buckets a call-stack sampler by construction can't
 * explain (V8's own "(program)"/"(garbage collector)" native-time buckets)
 * to the actual JS call site whose allocations are driving them. Reuses
 * resolveCallFrameName (below) since HeapProfiler's SamplingHeapProfileNode
 * .callFrame has the same shape as the CPU profiler's Profiler.CallFrame --
 * this gets source-map resolution (real function names/lines against a
 * packaged build's emitted .map, see the module doc comment) for free.
 * `samplingIntervalBytes` defaults to CDP's own suggested 32768 (~32KB) --
 * denser sampling than that mostly adds noise without changing which sites
 * dominate at this doc's own established scale (a 1.5M-character note).
 */
export async function startHeapSamplingProfile(page, samplingIntervalBytes = 32768) {
  const client = await page.context().newCDPSession(page)
  await client.send('HeapProfiler.enable')
  await client.send('HeapProfiler.startSampling', { samplingInterval: samplingIntervalBytes })

  return {
    async stop() {
      const { profile } = await client.send('HeapProfiler.stopSampling')
      await client.detach().catch(() => {})
      return aggregateHeapSamplingProfile(profile)
    },
  }
}

function aggregateHeapSamplingProfile(profile) {
  const selfBytesByName = new Map()
  let totalBytes = 0

  const walk = (node) => {
    if (node.selfSize) {
      const { name, location } = resolveCallFrameName(node.callFrame)
      const key = `${name}${location}`
      selfBytesByName.set(key, (selfBytesByName.get(key) ?? 0) + node.selfSize)
      totalBytes += node.selfSize
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(profile.head)

  const entries = [...selfBytesByName.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes)

  return { totalBytes, entries }
}

// url -> TraceMap | null (null once confirmed unavailable/unparseable, so a
// miss is only ever paid once per URL, not once per sample).
const traceMapCache = new Map()

/**
 * Loads the source map for a profiled script's `file://` URL, if one exists
 * alongside it on disk -- vite's `build.sourcemap: true` (vite.config.ts)
 * emits an external `<file>.map` next to each built asset. Only handles
 * `file://` URLs (the packaged Electron app, loading dist/ directly);
 * `dev:browser`'s http:// dev server already serves unminified source with
 * real function names, so there's nothing to resolve there.
 *
 * A genuinely electron-builder-packaged (asar) build's URL points *inside*
 * app.asar (e.g. `.../resources/app.asar/dist/assets/index-X.js`) --
 * app.asar is a single archive file on disk, not a real directory, so a
 * plain fs read for that path (or `<path>.map`) fails silently even though
 * the map really is in there (confirmed via `npx asar list app.asar`).
 * Electron's own main/renderer processes get transparent asar reads via a
 * patched `fs`, but this script runs as a *separate* plain Node process
 * outside Electron, which doesn't have that patch. Rather than pull in the
 * `asar` package just to extract one file, exploit that electron-builder's
 * `files` config (electron-builder.json5) copies `dist/` into the asar root
 * preserving its repo-relative structure -- so
 * `.../app.asar/dist/assets/index-X.js.map` is byte-identical to
 * `<repo>/dist/assets/index-X.js.map`, which is a real, never-deleted file
 * (the asar-packing step copies from there, it doesn't move it). Rewriting
 * any `.../app.asar/<rest>` path to `REPO_ROOT/<rest>` resolves it directly
 * without ever touching the archive itself.
 */
function loadTraceMapForUrl(url) {
  if (traceMapCache.has(url)) return traceMapCache.get(url)

  let map = null
  if (url && url.startsWith('file://')) {
    try {
      let scriptPath = fileURLToPath(url)
      const asarMarker = `${path.sep}app.asar${path.sep}`
      const asarIndex = scriptPath.indexOf(asarMarker)
      if (asarIndex !== -1) {
        scriptPath = path.join(REPO_ROOT, scriptPath.slice(asarIndex + asarMarker.length))
      }
      const mapPath = `${scriptPath}.map`
      if (existsSync(mapPath)) {
        map = new TraceMap(JSON.parse(readFileSync(mapPath, 'utf8')))
      }
    } catch {
      map = null
    }
  }

  traceMapCache.set(url, map)
  return map
}

/**
 * Resolves a CDP callFrame to a name, preferring the original (pre-
 * minification) function name via source map when one's available for its
 * URL -- otherwise falls back to the raw (possibly minified) name, same as
 * before this existed.
 */
function resolveCallFrameName(callFrame) {
  const rawName = callFrame?.functionName || '(anonymous)'
  const url = callFrame?.url
  if (!url) return { name: rawName, location: '' }

  const map = loadTraceMapForUrl(url)
  if (map) {
    const pos = originalPositionFor(map, {
      line: callFrame.lineNumber + 1,
      column: callFrame.columnNumber,
    })
    if (pos && (pos.name || pos.source)) {
      const file = pos.source ? pos.source.split('/').pop() : url.split('/').pop()
      return { name: pos.name || rawName, location: pos.line ? ` @ ${file}:${pos.line}` : ` @ ${file}` }
    }
  }

  return { name: rawName, location: ` @ ${url.split('/').pop()}:${callFrame.lineNumber + 1}` }
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
    const { name, location } = resolveCallFrameName(node?.callFrame)
    const key = `${name}${location}`
    selfTimeByName.set(key, (selfTimeByName.get(key) ?? 0) + deltaMs)
  }

  const entries = [...selfTimeByName.entries()]
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms)

  return { totalMs, entries }
}

/**
 * Full devtools.timeline category trace, for Layout/Paint/Raster/Commit vs.
 * JS attribution -- the complement to the JS sampling profile, per the
 * handover doc's two-technique methodology. `categories` overrides the
 * default set (e.g. to add `disabled-by-default-v8.gc`/
 * `disabled-by-default-v8.compile` when attributing the CDP JS-sampling
 * profile's `(program)` bucket, which by construction can't be resolved by
 * JS-frame sampling alone).
 */
export async function withCdpCategoryTrace(page, driveInteraction, categories = 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8') {
  const client = await page.context().newCDPSession(page)
  const events = []
  client.on('Tracing.dataCollected', (params) => {
    events.push(...(params.value ?? []))
  })

  await client.send('Tracing.start', {
    categories,
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
