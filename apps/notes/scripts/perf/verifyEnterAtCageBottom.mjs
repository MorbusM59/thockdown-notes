#!/usr/bin/env node
// Enter pressed on the LAST line the caret is allowed to travel to -- the
// cage's bottom edge -- must add a line and leave the text below where it is.
//
// Reported symptom: the text below jumps UP by a row with the caret at the
// start of it, and a few hundred milliseconds later usually drops back down.
// Sometimes it stays up, and the new empty line is "consumed or lost".
//
// Those are two different failures wearing the same face, and only one of
// them is cosmetic, so this samples both truths every frame for a second
// after the keystroke:
//
//   * GEOMETRY -- where the line that was below the caret actually sits,
//     measured off its own `.cm-line` box. A transient jump and a correction
//     are both visible here; a still frame is not enough to tell them apart.
//   * THE DOCUMENT -- `docLines` and `docLength` from the app's own
//     `__thockdownDebugCageState()` hook. If the newline is genuinely lost,
//     it is lost HERE, and no amount of geometry can prove or disprove it.
//
// Run: node scripts/perf/verifyEnterAtCageBottom.mjs [--repeats=N] [--headed]
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs'

function parseArgs(argv) {
  const args = { port: 5194, repeats: 6, headed: false, lines: 400, settleMs: 1200, startAt: 0, dump: false, restMs: 250, shape: 'uniform', typeFirst: 0, external: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key === 'port') args.port = Number(value)
    else if (key === 'repeats') args.repeats = Number(value)
    else if (key === 'lines') args.lines = Number(value)
    else if (key === 'settleMs') args.settleMs = Number(value)
    else if (key === 'startAt') args.startAt = Number(value)
    else if (key === 'dump') args.dump = true
    else if (key === 'restMs') args.restMs = Number(value)
    else if (key === 'shape') args.shape = value
    else if (key === 'typeFirst') args.typeFirst = Number(value)
    else if (key === 'external') args.external = true
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

/** The caret's current top in viewport pixels, read off the caret overlay. */
const readCaretTop = (page) => page.evaluate(() => {
  const caret = document.querySelector('.thockdown-block-caret')
  return caret ? Math.round(caret.getBoundingClientRect().top) : null
})

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const server = await startDevServer(args.port)
  const browser = await chromium.launch({ headless: !args.headed, executablePath: resolveChromiumExecutable() })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto('http://localhost:' + args.port + '/', { waitUntil: 'domcontentloaded' })
    // The cage-state hook this check reads is only installed when the flag is
    // on at mount, so it has to be set before the seed's own reload.
    await page.evaluate(() => window.localStorage.setItem('thockdown:debug-cage-state', '1'))
    await waitForAppReady(page)

    // Numbered lines: every row is identifiable in the DOM and in the text,
    // which is what makes "the line below moved" and "a line went missing"
    // both answerable without guessing.
    // `uniform` gives every row the same height, which is the one shape CM6's
    // height ESTIMATES are never wrong about -- so it cannot produce the late
    // revision the reported symptom looks like. `mixed` is the realistic one:
    // headings, long wrapping paragraphs and short lines, so the estimate for
    // territory not yet laid out is wrong and gets corrected as the reader
    // arrives.
    const tail = ' the quick brown fox jumps over the lazy dog'
    const text = Array.from({ length: args.lines }, (_, i) => {
      const name = 'LINE-' + String(i).padStart(6, '0')
      if (args.shape !== 'mixed') return name + tail
      const kind = i % 7
      if (kind === 0) return '## ' + name + ' a heading row'
      if (kind === 3) return name + tail.repeat(6)
      if (kind === 5) return name
      return name + tail
    }).join('\n')
    // `--external` tags the note `external`, which is the whole of what makes
    // a note external as far as the renderer is concerned
    // (shared/noteLifecycle.ts's isExternalNote). That matters because the
    // per-keystroke path takes a completely different branch for those notes
    // (useEditorSectionMount.ts's isExternal block), and the reporter narrowed
    // this symptom to external notes specifically -- removing the tag makes it
    // go away.
    await page.evaluate(async ({ initialText, external }) => {
      const note = await window.thockdownNotes.createNote({ initialText })
      if (external) await window.thockdownNotes.addTagToNote({ id: note.id, tagName: 'external' })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, { initialText: text, external: args.external })
    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(800)

    const hasHook = await page.evaluate(() => typeof window.__thockdownDebugCageState === 'function')
    if (!hasHook) throw new Error('__thockdownDebugCageState missing -- the debug flag did not take effect')

    // Put the caret in the document, then walk it down until it stops moving
    // on screen. That is the cage's bottom edge by definition -- past it the
    // text scrolls instead of the caret advancing -- and finding it by
    // observation rather than by recomputing the boundary means this check
    // cannot agree with a bug in the very arithmetic it is testing.
    await page.locator('.cm-content').click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(300)

    // Optionally travel into the document first. CM6 ESTIMATES the height of
    // everything it has not laid out, and revises those estimates as the
    // reader arrives -- a revision landing a few hundred milliseconds after a
    // keystroke is the documented shape of "it corrects itself later", and it
    // cannot happen in territory that was measured at mount. Starting deep is
    // what puts the check in that regime.
    if (args.startAt > 0) {
      await page.evaluate((fraction) => {
        const scroller = document.querySelector('.cm-scroller')
        if (scroller) scroller.scrollTop = scroller.scrollHeight * fraction
      }, args.startAt)
      await page.waitForTimeout(700)
      await page.locator('.cm-content').click()
      await page.waitForTimeout(400)
    }

    let previousTop = await readCaretTop(page)
    let stationary = 0
    for (let i = 0; i < args.lines && stationary < 3; i += 1) {
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(45)
      const top = await readCaretTop(page)
      if (top !== null && previousTop !== null && top <= previousTop) stationary += 1
      else stationary = 0
      previousTop = top
    }
    await page.waitForTimeout(400)

    const edge = await page.evaluate(() => window.__thockdownDebugCageState())
    console.log('\ncage bottom edge reached: caretTop=' + (await readCaretTop(page)) + 'px'
      + '  bottomBoundaryPx=' + Math.round(edge.bottomBoundaryPx)
      + '  lineHeightPx=' + Math.round(edge.lineHeightPx)
      + '  docLines=' + edge.docLines)

    // Enter goes at the END of the line, so the row below is a real
    // following line rather than the tail of a split one -- that is the
    // reported shape ("text sitting on the next line").
    await page.keyboard.press('End')
    await page.waitForTimeout(200)

    for (let repeat = 0; repeat < args.repeats; repeat += 1) {
      const before = await page.evaluate(() => {
        const state = window.__thockdownDebugCageState()
        const head = state.selectionHead
        // The line the caret is on, and the one below it -- named by their
        // own text so they can be found again after the DOM has rebuilt.
        const lines = [...document.querySelectorAll('.cm-line')]
          .map((el) => ({ text: el.textContent || '', top: Math.round(el.getBoundingClientRect().top) }))
          .filter((l) => l.text.startsWith('LINE-'))
        const caretEl = document.querySelector('.thockdown-block-caret')
        const caretTop = caretEl ? Math.round(caretEl.getBoundingClientRect().top) : null
        const below = lines.find((l) => caretTop !== null && l.top > caretTop + 2)
        return {
          docLines: state.docLines,
          docLength: state.docLength,
          head,
          scrollTop: Math.round(state.scrollTop),
          caretTop,
          // The whole first token, never a prefix of it. With 20,000 lines
          // "LINE-1012" also prefix-matches "LINE-10120", and a marker that
          // silently resolves to a different line reads as the very symptom
          // this check is looking for -- it did, for a whole run, until the
          // per-frame dump showed the "line below the caret" sitting above it.
          belowText: below ? below.text.split(' ')[0] : null,
          belowTop: below ? below.top : null,
        }
      })

      if (!before.belowText) {
        check(false, 'repeat ' + repeat + ': found a line below the caret to watch', 'none found')
        break
      }

      // Optionally type into the line first, so Enter lands mid-edit rather
      // than on a pane that has been still for seconds. The reported symptom
      // happens while editing, and a settled pane is a different state from a
      // busy one.
      for (let i = 0; i < args.typeFirst; i += 1) {
        await page.keyboard.press('z')
        await page.waitForTimeout(40)
      }

      await page.keyboard.press('Enter')

      // Sample every frame: a transient that corrects itself in a few hundred
      // milliseconds is invisible to a single reading taken after it.
      const samples = await page.evaluate(async ({ marker, settleMs }) => {
        const out = []
        const start = performance.now()
        return await new Promise((resolve) => {
          const tick = () => {
            const state = window.__thockdownDebugCageState()
            const line = [...document.querySelectorAll('.cm-line')]
              .find((el) => (el.textContent || '').split(' ')[0] === marker)
            const caretEl = document.querySelector('.thockdown-block-caret')
            out.push({
              t: Math.round(performance.now() - start),
              markerTop: line ? Math.round(line.getBoundingClientRect().top) : null,
              caretTop: caretEl ? Math.round(caretEl.getBoundingClientRect().top) : null,
              scrollTop: Math.round(state.scrollTop),
              docLines: state.docLines,
              docLength: state.docLength,
            })
            if (performance.now() - start >= settleMs) resolve(out)
            else requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
      }, { marker: before.belowText, settleMs: args.settleMs })

      const withMarker = samples.filter((s) => s.markerTop !== null)
      const finalSample = samples[samples.length - 1]
      const lineHeight = Math.round(edge.lineHeightPx)

      // The marker's position relative to where it sat before the keystroke,
      // in rows. Enter above it must push it DOWN by one row on screen, or
      // leave it put if the pane scrolled to compensate -- what it must never
      // do is move UP.
      const rowsMoved = withMarker.map((s) => (s.markerTop - before.belowTop) / lineHeight)
      const worstUp = rowsMoved.length ? Math.min(...rowsMoved) : 0
      const settledRows = rowsMoved.length ? rowsMoved[rowsMoved.length - 1] : 0

      const lineAdded = finalSample.docLines === before.docLines + 1
      // One character per `typeFirst` keystroke, plus the newline Enter adds.
      const expectedGrowth = args.typeFirst + 1
      const lengthAdded = finalSample.docLength === before.docLength + expectedGrowth

      console.log('\n  repeat ' + repeat + ' (watching ' + before.belowText + ')')
      console.log('    docLines ' + before.docLines + ' -> ' + finalSample.docLines
        + ', docLength ' + before.docLength + ' -> ' + finalSample.docLength)
      console.log('    marker rows moved: worst ' + worstUp.toFixed(2)
        + ', settled ' + settledRows.toFixed(2)
        + ' (negative = moved UP, the reported symptom)')
      const transient = rowsMoved.filter((r) => r < -0.5).length
      if (transient > 0) {
        const firstBad = withMarker[rowsMoved.findIndex((r) => r < -0.5)]
        const lastBad = withMarker[rowsMoved.length - 1 - [...rowsMoved].reverse().findIndex((r) => r < -0.5)]
        console.log('    moved up for ' + transient + ' of ' + withMarker.length + ' frames, t='
          + firstBad.t + 'ms..' + lastBad.t + 'ms')
      }

      if (args.dump) {
        console.log('    frames: ' + withMarker.map((s) =>
          s.t + 'ms markerTop=' + s.markerTop + ' caretTop=' + s.caretTop
          + ' scrollTop=' + s.scrollTop + ' lines=' + s.docLines).join('\n            '))
      }

      check(lineAdded && lengthAdded, 'repeat ' + repeat + ': Enter added exactly one line to the document',
        'docLines +' + (finalSample.docLines - before.docLines)
        + ', docLength +' + (finalSample.docLength - before.docLength) + ' (expected +' + expectedGrowth + ')')
      check(worstUp > -0.5, 'repeat ' + repeat + ': the text below never travels upward',
        'worst ' + worstUp.toFixed(2) + ' rows')
      check(settledRows > -0.5, 'repeat ' + repeat + ': the text below settles at or under where it was',
        'settled ' + settledRows.toFixed(2) + ' rows')

      await page.waitForTimeout(args.restMs)
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
