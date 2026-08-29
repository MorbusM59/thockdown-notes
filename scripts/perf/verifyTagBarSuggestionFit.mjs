#!/usr/bin/env node
// Live-browser regression check for the tag bar's suggested-tag row.
//
// Three rules, all of them geometry the DOM can be asked about directly:
//   1. A suggestion is shown WHOLE or not at all, and clears the note's own
//      tags by --suggested-tag-gutter -- no pill is ever painted half-clipped
//      at the row's left edge, nor close enough to look like it collided.
//   2. Suggestions give way to the note's own tags: once those overflow, no
//      suggestion is shown at all.
//   3. The correction is never a frame late. The row's width changes for far
//      more reasons than a window resize (sidebar, section split, typography
//      sliders, a sibling flex item growing), and a `window.resize` listener
//      both misses those AND fires against the pre-React-update layout, which
//      is what left a sliced pill on screen until the next resize event.
//      useSectionTabs.ts's useBoxResizeEffect uses a ResizeObserver instead.
//
// Rule 3 is why this script exists rather than a check in the Claude Code
// Browser pane: that pane never composites, so it delivers no ResizeObserver
// callbacks at all (same reason requestAnimationFrame never fires there) and
// a measurement of this taken in it is meaningless rather than imprecise.
// Real Chromium is the only instrument that can exercise it.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, waitForAppReady } from './perfHarness.mjs'

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome')
  return existsSync(candidate) ? candidate : undefined
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
  console.log(`  ok: ${msg}`)
}

// Everything the three rules need, read straight off the live layout.
const READ_ROW = () => {
  const row = document.querySelector('.tabbar-suggested-tags')
  const strip = document.querySelector('.tabbar-tags-display')
  if (!row || !strip) return null
  const rowBox = row.getBoundingClientRect()
  const pills = [...row.querySelectorAll('.tag-pill.suggested')].map((pill) => ({
    text: pill.textContent,
    hidden: pill.classList.contains('is-out-of-bounds'),
    left: pill.getBoundingClientRect().left,
  }))
  const shown = pills.filter((pill) => !pill.hidden)
  const gutter = Number.parseFloat(getComputedStyle(row).getPropertyValue('--suggested-tag-gutter'))
  return {
    rowWidth: rowBox.width,
    rowLeft: rowBox.left,
    gutter,
    shown: shown.map((pill) => pill.text),
    // How far the leftmost shown pill sits inside the row. Negative means it
    // is being painted sliced; anything under `gutter` means it has eaten
    // into the buffer that keeps it clear of the note's own tags. Rule 1 is
    // this number being >= gutter.
    clearancePx: shown.length === 0 ? Infinity : Math.min(...shown.map((pill) => pill.left - rowBox.left)),
    ownTagCount: strip.querySelectorAll('.tag-pill').length,
    ownTagOverflowPx: strip.scrollWidth - strip.clientWidth,
    wellHeight: row.closest('.tab-mode-shell').getBoundingClientRect().height,
  }
}

async function main() {
  const port = 5191
  console.error(`[verify] starting dev server on port ${port}...`)
  const server = await startDevServer(port)
  const consoleErrors = []

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => { consoleErrors.push(String(err)) })

    await page.goto(`http://localhost:${port}/`)
    await waitForAppReady(page)
    await page.waitForTimeout(300)

    // A well-tagged donor note supplies the suggestions; a second, untagged
    // note is the one we look at. Untagged is the case the bug was reported
    // against: with no tags of its own the strip claims nothing, so the
    // suggested row is at its widest and most likely to be over-full.
    const donorTags = ['alphabet', 'bookkeeping', 'cartography', 'dendrology', 'ephemera',
      'filigree', 'gossamer', 'hinterland', 'isthmus', 'jacaranda', 'kaleidoscope', 'lighthouse']
    await page.evaluate(async (tags) => {
      const donor = await window.thockdownNotes.createNote({ initialText: '# Donor' })
      for (const [index, tagName] of tags.entries()) {
        await window.thockdownNotes.addTagToNote({ id: donor.id, tagName, position: index })
      }
      const subject = await window.thockdownNotes.createNote({ initialText: '# Subject' })
      await window.thockdownSections.setActiveNote('default', subject.id)
    }, donorTags)
    await page.reload()
    await waitForAppReady(page)
    await page.waitForTimeout(500)

    const baseline = await page.evaluate(READ_ROW)
    console.log('  untagged note:', JSON.stringify(baseline))
    assertTrue(baseline !== null, 'tag bar is showing with a suggested-tag row')
    assertTrue(baseline.ownTagCount === 0, 'subject note has no tags of its own')
    assertTrue(baseline.shown.length > 0, 'suggestions are being offered')
    assertTrue(baseline.gutter > 0, `--suggested-tag-gutter resolves to a real buffer (${baseline.gutter}px)`)
    assertTrue(baseline.clearancePx >= baseline.gutter - 0.5, `rule 1: every suggestion clears the note's own tags by the full gutter (${baseline.clearancePx.toFixed(2)}px >= ${baseline.gutter}px)`)
    assertTrue(baseline.shown.length < donorTags.length, 'the row is genuinely over-full at this width, so rule 1 is actually under test')
    // `shown` is in DOM order, which useSectionTabs keeps in most-used-first
    // rank order (the row is painted right-to-left via row-reverse). So the
    // survivors must be a PREFIX of that rank order: the weakest suggestions
    // are the ones dropped, and never a hole in the middle.
    assertTrue(
      baseline.shown.every((text, index) => text === donorTags[index]),
      `the strongest suggestions are the survivors, weakest dropped first (${baseline.shown.join(', ')})`,
    )
    const baselineHeight = baseline.wellHeight

    // Rule 3, the whole point. Narrow the well from OUTSIDE React: no state
    // change, no re-render, and -- critically -- no window `resize` event.
    // Only a ResizeObserver on the row itself can notice this. Then wait
    // exactly two animation frames, which is where a ResizeObserver's
    // callback lands; a fix that were still a frame late would fail here.
    const afterSqueeze = await page.evaluate(async () => {
      // The tag WELL specifically -- the first .tab-mode-shell in the
      // document is the tab bar's, one row up.
      const row = document.querySelector('.tabbar-suggested-tags')
      row.closest('.tab-mode-shell').style.maxWidth = '420px'
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const rowBox = row.getBoundingClientRect()
      const shown = [...row.querySelectorAll('.tag-pill.suggested')].filter((p) => !p.classList.contains('is-out-of-bounds'))
      return {
        rowWidth: rowBox.width,
        gutter: Number.parseFloat(getComputedStyle(row).getPropertyValue('--suggested-tag-gutter')),
        shown: shown.map((p) => p.textContent),
        clearancePx: shown.length === 0 ? Infinity : Math.min(...shown.map((p) => p.getBoundingClientRect().left - rowBox.left)),
      }
    })
    console.log('  after out-of-band squeeze:', JSON.stringify(afterSqueeze))
    assertTrue(afterSqueeze.rowWidth < baseline.rowWidth, 'the squeeze actually narrowed the suggested row')
    assertTrue(afterSqueeze.shown.length < baseline.shown.length, 'suggestions were dropped to fit the narrower row')
    assertTrue(
      afterSqueeze.clearancePx >= afterSqueeze.gutter - 0.5,
      `rule 3: corrected within the ResizeObserver frame, with no window resize event (clearance ${afterSqueeze.clearancePx.toFixed(2)}px >= ${afterSqueeze.gutter}px)`,
    )

    await page.evaluate(() => { document.querySelector('.tabbar-suggested-tags').closest('.tab-mode-shell').style.maxWidth = '' })
    await page.waitForTimeout(200)

    // Rule 2: add the note's own tags one at a time. Suggestions must shrink
    // monotonically and be gone entirely by the time the note's own tags
    // stop fitting -- and the bar must stay exactly one pill tall throughout.
    const timeline = []
    for (const tag of ['zeta', 'yankee', 'xray', 'whiskey', 'victor', 'uniform', 'tango', 'sierra']) {
      await page.locator('.tabbar-tag-input-field').fill(tag)
      await page.locator('.tabbar-tag-input-field').press('Enter')
      await page.waitForTimeout(220)
      timeline.push(await page.evaluate(READ_ROW))
    }
    for (const step of timeline) {
      console.log('   ', JSON.stringify({ own: step.ownTagCount, overflow: step.ownTagOverflowPx, sugW: +step.rowWidth.toFixed(1), clearance: Number.isFinite(step.clearancePx) ? +step.clearancePx.toFixed(1) : null, shown: step.shown, h: step.wellHeight }))
    }
    assertTrue(
      timeline.every((step) => step.clearancePx >= step.gutter - 0.5),
      'rule 1 holds at every step of the fill: no sliced pill, and the gutter is never eaten into',
    )
    assertTrue(
      timeline.every((step, i) => i === 0 || step.shown.length <= timeline[i - 1].shown.length),
      'suggestions only ever shrink as the note gains tags -- they never pop back',
    )
    assertTrue(
      timeline.every((step) => step.ownTagOverflowPx <= 0 || step.shown.length === 0),
      'rule 2: no suggestion is shown once the note\'s own tags stop fitting',
    )
    assertTrue(
      timeline.some((step) => step.ownTagOverflowPx > 0),
      'the fill actually reached the overflow case (otherwise rule 2 was untested)',
    )
    assertTrue(
      timeline.every((step) => Math.abs(step.wellHeight - baselineHeight) < 0.5),
      `the tag bar stays exactly one pill tall throughout (${baselineHeight.toFixed(1)}px)`,
    )

    // Rule 4: removing one of the note's own tags hands its width back to the
    // suggested row AND puts the removed tag back into the suggestion list.
    // Both land in the same commit, so newly-inserted pills must never be
    // PAINTED in the un-measured state -- the user's report was the new list
    // appearing cut off for a frame and then flickering the overhanging pills
    // away. Sample every animation frame across several deletions and require
    // that no frame was ever left in that state.
    await page.evaluate(() => {
      const row = document.querySelector('.tabbar-suggested-tags')
      window.__frames = []
      window.__sampling = true
      const sample = () => {
        if (!window.__sampling) return
        const rowBox = row.getBoundingClientRect()
        const gutter = Number.parseFloat(getComputedStyle(row).getPropertyValue('--suggested-tag-gutter'))
        const shown = [...row.querySelectorAll('.tag-pill.suggested')]
          .filter((pill) => getComputedStyle(pill).visibility !== 'hidden')
        window.__frames.push({
          n: shown.length,
          clearance: shown.length === 0 ? Infinity : Math.min(...shown.map((p) => p.getBoundingClientRect().left - rowBox.left)),
          gutter,
        })
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })

    // The tag pill's own two-click delete gesture, driven for real: the first
    // click arms, the second confirms.
    for (let round = 0; round < 4; round += 1) {
      const victim = page.locator('.tabbar-tags-display .tag-pill').first()
      await victim.click()
      await page.waitForTimeout(80)
      await victim.click()
      await page.waitForTimeout(400)
    }

    const frames = await page.evaluate(() => { window.__sampling = false; return window.__frames })

    // The cause of the reported flicker: .tag-pill used to carry
    // `transition: all 0.2s`, so a pill that appeared or shifted animated
    // into place over 200ms. updateSuggestedTagFit reads geometry at commit
    // time and was handed positions still 200ms out of date, marking the
    // wrong set until the animation settled. A pill on a bar must be drawn
    // where it belongs from the first frame.
    const animatedGeometry = await page.evaluate(() => {
      const GEOMETRY = ['all', 'width', 'height', 'padding', 'margin', 'inset', 'left', 'top', 'transform', 'font-size', 'flex']
      return [...document.querySelectorAll('.tabbar-tags-display .tag-pill, .tabbar-suggested-tags .tag-pill')]
        .map((pill) => ({ cls: pill.className, props: getComputedStyle(pill).transitionProperty }))
        .filter((entry) => entry.props.split(',').map((p) => p.trim()).some((p) => GEOMETRY.includes(p)))
    })
    assertTrue(
      animatedGeometry.length === 0,
      `no tag pill animates its own geometry (${animatedGeometry.length} offenders${animatedGeometry.length ? ': ' + JSON.stringify(animatedGeometry.slice(0, 3)) : ''})`,
    )
    const badFrames = frames.filter((f) => f.clearance < f.gutter - 0.5)
    const counts = frames.map((f) => f.n).filter((n, i, arr) => i === 0 || n !== arr[i - 1])
    console.log(`  sampled ${frames.length} frames across 4 tag deletions; suggestion count went ${counts.join(' -> ')}`)
    if (badFrames.length > 0) console.log('  BAD FRAMES:', JSON.stringify(badFrames.slice(0, 6)))
    assertTrue(frames.length > 10, `the frame sampler actually ran (${frames.length} frames)`)
    assertTrue(counts.length > 1 && Math.max(...frames.map((f) => f.n)) > 0, 'the deletions actually grew the suggestion list (otherwise rule 4 was untested)')
    assertTrue(
      badFrames.length === 0,
      `rule 4: no frame during a tag deletion painted a suggestion inside the gutter (${badFrames.length} bad frames)`,
    )

    assertTrue(consoleErrors.length === 0, `no console errors (${consoleErrors.length})`)
    console.log('\nAll tag-bar suggestion-fit assertions passed.')
  } finally {
    if (browser) await browser.close()
    server.stop()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
