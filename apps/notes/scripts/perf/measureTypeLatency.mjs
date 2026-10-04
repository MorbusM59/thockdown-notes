#!/usr/bin/env node
// Per-keystroke latency measured INSIDE the page, not across the CDP wire.
//
// ## Why this exists alongside measureInputLag.mjs
//
// `measureInputLag.mjs`'s burst mode times `await page.keyboard.press(...)`
// from Node. That wall-clock includes a full CDP round trip, and the round
// trip is the bigger number: measured on this machine, a 3,000-character note
// reports 13.8ms/keystroke and a 400,000-character note reports 16.0ms. The
// instrument's own floor is ~14ms, so it can resolve about 2ms of real app
// cost and everything below that is invisible. A regression that doubles the
// app's per-keystroke work does not move that number enough to see, which is
// exactly what happened when this session tried to A/B the scroll rework with
// it: three commits spanning the whole rework all reported ~16ms.
//
// This script measures the two things that actually decide whether typing
// feels instant, both from inside the page where there is no wire:
//
//   * `handler` -- keydown timestamp to the end of the synchronous task the
//     keydown ran on (a MessageChannel continuation, which the event loop
//     runs after the current task and all its microtasks are finished, and
//     unlike setTimeout(0) is not subject to clamping). This is the JS the
//     keystroke itself forced.
//   * `frame` -- keydown timestamp to the frame that presented the result.
//     The number the reader feels. One frame at 60Hz is 16.7ms.
//
// Plus a longtask observer: every task over 50ms, whether or not a keystroke
// was on it, which is what catches work a keystroke *scheduled* rather than
// *ran* (a rAF chain, a debounce that lands two frames later).
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  startPreviewServer,
  generateSyntheticDocument,
  seedLargeNoteAndReload,
  ensurePreviewMode,
  placeCaretAt,
  summarizeMs,
  startCdpJsProfile,
} from './perfHarness.mjs'

function parseArgs(argv) {
  const args = {
    chars: 400000, keystrokes: 25, position: 'middle', port: 5191,
    headed: false, json: false, key: 'x', throttle: 1, gap: 250, view: 'edit', profile: false, stacks: false, lagLog: false, external: false, defer: false, shape: 'prose', prod: false,
  }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key === 'prod') args.prod = true
    else if (key === 'profile') args.profile = true
    else if (key === 'stacks') args.stacks = true
    else if (key === 'lagLog') args.lagLog = true
    else if (key === 'external') args.external = true
    else if (key === 'defer') args.defer = true
    else if (key === 'shape') args.shape = value
    else if (key === 'json') args.json = true
    else if (key === 'key') args.key = value
    else if (key === 'view') args.view = value
    else if (key === 'position') args.position = value
    else if (key === 'chars') args.chars = Number(value)
    else if (key === 'keystrokes') args.keystrokes = Number(value)
    else if (key === 'port') args.port = Number(value)
    else if (key === 'throttle') args.throttle = Number(value)
    else if (key === 'gap') args.gap = Number(value)
  }
  return args
}

// Same resolution measureInputLag.mjs does -- this environment's pinned
// Playwright wants a chrome-headless-shell build that isn't the installed one.
function resolveChromiumExecutable() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).find((name) => name.startsWith('chromium-') && !name.includes('headless'))
  if (!dir) return undefined
  for (const rel of [
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ]) {
    const candidate = path.join(root, dir, ...rel)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const INSTRUMENT = () => {
  const state = { samples: [], longTasks: [] }
  window.__typeLatency = state

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      state.longTasks.push({ start: entry.startTime, duration: entry.duration })
    }
  }).observe({ type: 'longtask', buffered: true })

  // Capture phase on window: the earliest point in the page at which the
  // keystroke exists, so everything the app does is after it.
  window.addEventListener('keydown', () => {
    const t0 = performance.now()
    const sample = { handler: null, frame: null }

    // A MessageChannel message is a task, not a microtask: it runs after the
    // current task AND its microtask drain, so it lands exactly at "the
    // synchronous keystroke work is over".
    const channel = new MessageChannel()
    channel.port1.onmessage = () => { sample.handler = performance.now() - t0 }
    channel.port2.postMessage(null)

    // Two frames: the first callback runs before that frame's paint, the
    // second after it has been presented. The reader's number is the second.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sample.frame = performance.now() - t0
        state.samples.push(sample)
      })
    })
  }, true)
}

/**
 * Aggregates a raw CDP profile by "the nearest ancestor call frame whose URL
 * is one of this app's own source files", so third-party parser time lands on
 * the app code that invoked it rather than on the parser's internals.
 */
function attributeToAppCaller(profile) {
  const nodeById = new Map(profile.nodes.map((n) => [n.id, n]))
  const parentById = new Map()
  for (const node of profile.nodes) {
    for (const childId of node.children ?? []) parentById.set(childId, node.id)
  }

  const isAppFrame = (frame) => {
    const url = frame?.url ?? ''
    return /\/src\/[^?]*\.(ts|tsx)/.test(url)
  }

  const byName = new Map()
  const { samples, timeDeltas } = profile
  for (let i = 0; i < samples.length; i += 1) {
    const deltaMs = (timeDeltas[i + 1] ?? 0) / 1000
    let id = samples[i]
    let owner = null
    // Walk toward the root until an app frame appears. A sample with no app
    // frame anywhere in its stack is genuinely not this app's doing.
    while (id !== undefined) {
      const node = nodeById.get(id)
      if (node && isAppFrame(node.callFrame)) { owner = node.callFrame; break }
      id = parentById.get(id)
    }
    if (!owner) continue
    const file = (owner.url ?? '').split('/').pop()?.split('?')[0] ?? '?'
    const key = (owner.functionName || '(anonymous)') + ' @ ' + file + ':' + (owner.lineNumber + 1)
    byName.set(key, (byName.get(key) ?? 0) + deltaMs)
  }

  return [...byName.entries()].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  // --prod serves a production renderer build instead of the dev server.
  // Use it for ABSOLUTE numbers (the small-note floor above all); the dev
  // server's React development build inflates those. A/B comparisons are
  // valid either way, as long as both sides use the same one.
  const server = args.prod ? await startPreviewServer(args.port) : await startDevServer(args.port)
  const browser = await chromium.launch({ headless: !args.headed, executablePath: resolveChromiumExecutable() })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    const consoleLines = []
    page.on('console', (message) => {
      const text = message.text()
      if (text.includes('preview-block-cache') || text.includes('[input-lag]')) consoleLines.push(text)
    })
    await page.goto('http://localhost:' + args.port + '/', { waitUntil: 'domcontentloaded' })
    // Set before the seed's own reload, so the flag is already in place when
    // the app boots into the note rather than a reload later.
    if (args.lagLog) await page.evaluate(() => window.localStorage.setItem('thockdown:debug-input-lag', '1'))
    // deferPreviewOnRapidInput is a persisted menu setting that defaults to
    // false, so by default EVERY keystroke commits setActiveNoteText
    // synchronously and re-renders the whole app + preview pipeline. Seeded
    // through the persisted state before the boot that matters, because the
    // app reads it once on load.
    if (args.defer) {
      await page.evaluate(async () => {
        const state = await window.thockdownState.loadAppState()
        await window.thockdownState.saveAppState({
          ...state,
          menu: { ...state.menu, deferPreviewOnRapidInput: true },
        })
      })
    }
    // `indented` is a document of list items, which is what makes Enter and
    // Backspace take the markdown TRANSFORM path (auto-indent continuation)
    // rather than CM6's native insert -- the difference the reporter can hear
    // as an irregular gap in the typing sound at every line break.
    // `indented-spaced` is the same list items with a blank line between them,
    // which makes each one its OWN markdown block instead of all of them being
    // a single list node. Same characters, same indentation -- the only thing
    // that changes is block granularity, which is exactly the variable under
    // test.
    // `realistic` is what a real note looks like: headings, prose paragraphs,
    // and SHORT lists of a handful of items -- not thousands of list rows with
    // nothing else. The two `indented*` shapes below are deliberate extremes
    // and should be read as such.
    const buildRealistic = (targetChars) => {
      const parts = []
      let i = 0
      // Length tracked incrementally: joining the whole array every iteration
      // makes seeding itself quadratic, which is a silly way to spend a minute.
      let length = 0
      while (length < targetChars) {
        parts.push('## Section ' + i)
        parts.push('The quick brown fox jumps over the lazy dog, and keeps going for a sentence or two so that this paragraph wraps the way real prose does.')
        parts.push('Another paragraph of ordinary text, because notes are mostly prose and only occasionally something else.')
        for (let item = 0; item < 6; item += 1) {
          parts.push('  - item ' + item + ' in section ' + i)
        }
        i += 1
        length = parts.reduce((sum, part) => sum + part.length + 2, 0)
      }
      return parts.join('\n\n')
    }

    // `realistic-toc` is `realistic` with a table of contents at the top.
    // It exists because a whole class of per-keystroke cost is invisible
    // without one: useMarkdownFormattingToolbar's regeneration layout effect
    // only runs when the note HAS a table of contents, so every fixture here
    // returned at its guard and no profile from this effort ever saw it,
    // while every user who has pressed the toolbar button pays it.
    const buildRealisticWithToc = (targetChars) => {
      const body = buildRealistic(targetChars)
      return `## Table of Contents\n\n${body}`
    }

    const seedText = args.shape === 'realistic-toc'
      ? buildRealisticWithToc(args.chars)
      : args.shape === 'realistic'
      ? buildRealistic(args.chars)
      : args.shape === 'indented-spaced'
      ? Array.from(
          { length: Math.max(1, Math.round(args.chars / 62)) },
          (_, i) => '  - item ' + i + ' the quick brown fox jumps over the lazy dog',
        ).join('\n\n')
      : args.shape === 'indented'
      ? Array.from(
          { length: Math.max(1, Math.round(args.chars / 60)) },
          (_, i) => '  - item ' + i + ' the quick brown fox jumps over the lazy dog',
        ).join('\n')
      : generateSyntheticDocument(args.chars)
    await seedLargeNoteAndReload(page, seedText)
    // Tagging the note `external` is the whole of what makes it external to
    // the renderer, and it is the only way to ask whether the external
    // per-keystroke wiring costs anything measurable against an identical
    // internal note.
    if (args.external) {
      await page.evaluate(async () => {
        const sections = await window.thockdownSections.listSections()
        const noteId = sections.find((section) => section.activeNoteId)?.activeNoteId
        if (noteId) await window.thockdownNotes.addTagToNote({ id: noteId, tagName: 'external' })
      })
      await page.reload()
      await page.waitForTimeout(2500)
    }
    if (args.view === 'preview') await ensurePreviewMode(page)
    await placeCaretAt(page, args.position)

    const client = await page.context().newCDPSession(page)
    if (args.throttle > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: args.throttle })

    await page.evaluate(INSTRUMENT)

    // Profiling covers only the typing loop, never the mount -- the mount's
    // own 300-400ms tasks would otherwise dominate every aggregate here and
    // hide the per-keystroke cost this script exists to attribute.
    const profiler = args.profile ? await startCdpJsProfile(page) : null

    // Self-time by function name answers "what ran"; when the answer is a
    // third-party parser it does not answer "who asked", which is the only
    // question a fix can act on. This second profile attributes every sample
    // to the nearest ancestor frame that belongs to this app's own source.
    let stackClient = null
    if (args.stacks) {
      stackClient = await page.context().newCDPSession(page)
      await stackClient.send('Profiler.enable')
      await stackClient.send('Profiler.setSamplingInterval', { interval: 100 })
      await stackClient.send('Profiler.start')
    }

    for (let i = 0; i < args.keystrokes; i += 1) {
      await page.keyboard.press(args.key)
      // A real gap between keystrokes: this measures ONE keystroke's cost,
      // not how a burst coalesces. Coalescing is a separate question and the
      // app deliberately does it.
      await page.waitForTimeout(args.gap)
    }
    await page.waitForTimeout(500)

    const profileEntries = profiler ? await profiler.stop() : null

    let ownerEntries = null
    if (stackClient) {
      const { profile } = await stackClient.send('Profiler.stop')
      await stackClient.detach().catch(() => {})
      ownerEntries = attributeToAppCaller(profile)
    }

    const result = await page.evaluate(() => ({
      samples: window.__typeLatency.samples,
      longTasks: window.__typeLatency.longTasks,
    }))

    const handler = result.samples.map((s) => s.handler).filter((v) => v !== null)
    const frame = result.samples.map((s) => s.frame).filter((v) => v !== null)

    if (args.json) {
      console.log(JSON.stringify({ args, handler, frame, longTasks: result.longTasks }, null, 2))
      return
    }

    const fmt = (label, values) => {
      if (!values.length) return label + ': no samples'
      const s = summarizeMs(values)
      return label + '  mean=' + s.mean.toFixed(1) + 'ms  median=' + s.median.toFixed(1)
        + 'ms  min=' + s.min.toFixed(1) + 'ms  max=' + s.max.toFixed(1) + 'ms'
    }
    console.log('\nview=' + args.view + ' key=' + args.key + ' chars=' + args.chars
      + ' keystrokes=' + args.keystrokes + ' position=' + args.position + ' throttle=' + args.throttle + 'x\n')
    console.log(fmt('handler (keydown -> end of sync task)', handler))
    console.log(fmt('frame   (keydown -> presented frame) ', frame))
    console.log('\nper-keystroke frame: ' + frame.map((v) => v.toFixed(1)).join(', '))
    const long = result.longTasks
    console.log('\nlong tasks (>50ms): ' + long.length
      + (long.length ? '  durations: ' + long.map((t) => t.duration.toFixed(0)).join(', ') : ''))

    if (args.lagLog) {
      console.log('\ndebug-input-lag console lines (last 40):')
      for (const line of consoleLines.slice(-40)) console.log('  ' + line)
      console.log('  total lines: ' + consoleLines.length)
    }

    if (ownerEntries) {
      console.log('\nthird-party time attributed to the app frame that asked for it:')
      for (const entry of ownerEntries.slice(0, 20)) {
        console.log('  ' + entry.ms.toFixed(1).padStart(8) + 'ms  ' + entry.name)
      }
    }

    if (profileEntries) {
      console.log('\ntop self-time by function (typing loop only, total sampled '
        + profileEntries.totalMs.toFixed(0) + 'ms):')
      for (const entry of profileEntries.entries.slice(0, 25)) {
        console.log('  ' + entry.ms.toFixed(1).padStart(8) + 'ms  ' + entry.name)
      }
    }
  } finally {
    await browser.close().catch(() => {})
    await server.stop()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
