// Measures the chapter bar at the REFERENCE LAYOUT and writes the numbers
// src/escapeMenu/chapterBarWidth.ts estimates strip widths from.
//
//   npx vite-node scripts/adventure/calibrateChapterBar.ts
//
// The reference layout is the tightest one a reader is expected to play at:
// a 1920px-wide window in double-size mode (page zoom 2, so 960 CSS px), one
// editor slot, the sidebar out. It runs the app in `dev:browser` in Chromium,
// which is enough here: the bar's width is CSS and the mock's known gaps
// (persistence, note-size costs; see CLAUDE.md) are nowhere near it.
//
// WHAT IT MEASURES: the strip's client width; each pill's empty chrome; the
// gaps; the advance of every printable character in the four text styles a
// line can carry (by canvas `measureText` in the pill's computed font, so
// without kerning, which is also how the estimator adds them up); and every
// `fa-solid` icon the adventure's sources name.
//
// AND WHAT IT CHECKS: it then plays the game for a while through the ring and
// compares the estimate for every pill on screen against the pill's real
// width, printing the worst error. An estimate that has drifted from the DOM
// (a CSS change, a structural change in EscapeMenuStatus.tsx) shows up here
// rather than as a test that passes while the bar overflows.

import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { ChapterBarMetrics, TextStyle } from '../../src/escapeMenu/chapterBarWidth'
import { detailPillWidth, narrationPillWidth } from '../../src/escapeMenu/chapterBarWidth'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(APP_ROOT, 'src/escapeMenu/chapterBarMetrics.json')
const PORT = 5317
const REFERENCE = '1920px window, double size (960 CSS px at zoom 2), one slot, sidebar out'

/** Every `fa-solid fa-...` literal under a directory -- the icon vocabulary narration can use. */
function iconsUnder(dir: string, found = new Set<string>()): Set<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) iconsUnder(full, found)
    else if (/\.tsx?$/.test(name)) {
      for (const match of readFileSync(full, 'utf8').matchAll(/fa-solid fa-[a-z0-9-]+/g)) found.add(match[0])
    }
  }
  return found
}

async function waitForServer(url: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`dev server never answered at ${url}`)
}

const server = spawn('npx', ['vite', '--mode', 'browser', '--port', String(PORT), '--strictPort'], { cwd: APP_ROOT, stdio: 'ignore' })
try {
  await waitForServer(`http://localhost:${PORT}/`)
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  const page = await (await browser.newContext({ viewport: { width: 960, height: 520 }, deviceScaleFactor: 2 })).newPage()
  page.on('pageerror', (error) => console.error('page error:', error.message))
  // The mock has no window controls; double size reads the zoom from them.
  await page.addInitScript(() => {
    (window as unknown as { windowControls: unknown }).windowControls = new Proxy(
      { getPageZoomFactor: () => 2 },
      { get: (target, key) => (key in target ? target[key as 'getPageZoomFactor'] : () => undefined) },
    )
  })
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('[aria-label="Enable double size mode"]')
  await page.click('[aria-label="Enable double size mode"]')
  if (await page.$('[aria-label="Show sidebar"]')) await page.click('[aria-label="Show sidebar"]')
  await page.click('[aria-label="Open the User Guide"]', { button: 'right' })
  await page.waitForSelector('.chapter-bar-display .escape-menu-choice-detail, .chapter-bar-display .escape-menu-narration')
  await page.waitForTimeout(500)

  const icons = [...iconsUnder(path.join(APP_ROOT, 'src/adventure'))].sort()
  const measured = await page.evaluate(({ icons }) => {
    const strip = document.querySelector('.chapter-bar-display') as HTMLElement
    const probe = (html: string) => {
      const holder = document.createElement('div')
      holder.innerHTML = html
      const element = holder.firstElementChild as HTMLElement
      strip.appendChild(element)
      return element
    }
    const narration = probe('<span class="tag-pill escape-menu-narration is-inert"><span class="escape-menu-narration-text"></span></span>')
    const detail = probe('<span class="tag-pill escape-menu-choice-detail is-inert"><span class="escape-menu-choice-detail-line"><span>a</span><span>b</span></span></span>')
    const text = narration.firstElementChild as HTMLElement
    const fontOf = (className: string) => {
      const span = document.createElement('span')
      span.className = className
      text.appendChild(span)
      const font = getComputedStyle(span).font
      span.remove()
      return font
    }
    const fonts = {
      regular: fontOf(''),
      strong: fontOf('escape-menu-narration-strong'),
      em: fontOf('escape-menu-narration-em'),
      strongEm: fontOf('escape-menu-narration-strong escape-menu-narration-em'),
    }
    const context = document.createElement('canvas').getContext('2d')!
    const chars = [...Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)), ...'×÷–—…·•’‘“”%½¼¾→←↑↓≥≤±']
    const advances: Record<string, Record<string, number>> = {}
    for (const [style, font] of Object.entries(fonts)) {
      context.font = font
      advances[style] = Object.fromEntries(chars.map((char) => [char, Number(context.measureText(char).width.toFixed(3))]))
    }
    const iconWidths: Record<string, number> = {}
    for (const icon of icons) {
      const glyph = document.createElement('span')
      glyph.className = `${icon} escape-menu-narration-icon`
      text.appendChild(glyph)
      iconWidths[icon] = Number(glyph.getBoundingClientRect().width.toFixed(3))
      glyph.remove()
    }
    const narrationPillPx = narration.getBoundingClientRect().width
    const [first, second] = [...detail.querySelectorAll('.escape-menu-choice-detail-line > span')] as HTMLElement[]
    const detailGapPx = second.getBoundingClientRect().left - first.getBoundingClientRect().right
    const detailPillPx = detail.getBoundingClientRect().width
      - (second.getBoundingClientRect().right - first.getBoundingClientRect().left)
    const font = getComputedStyle(text).fontFamily
    narration.remove()
    detail.remove()
    return {
      font,
      stripPx: strip.clientWidth,
      stripGapPx: parseFloat(getComputedStyle(strip).columnGap),
      narrationPillPx,
      detailPillPx,
      detailGapPx,
      advances,
      iconWidths,
    }
  }, { icons })

  const iconValues = Object.values(measured.iconWidths)
  const metrics: ChapterBarMetrics = {
    reference: REFERENCE,
    font: measured.font,
    stripPx: measured.stripPx,
    stripGapPx: measured.stripGapPx,
    narrationPillPx: Number(measured.narrationPillPx.toFixed(3)),
    detailPillPx: Number(measured.detailPillPx.toFixed(3)),
    detailGapPx: Number(measured.detailGapPx.toFixed(3)),
    advances: measured.advances as Record<TextStyle, Record<string, number>>,
    // The widest measured, so a character or icon nobody measured errs on the side of not fitting.
    fallbackAdvancePx: Math.max(...Object.values(measured.advances.strong)),
    icons: measured.iconWidths,
    fallbackIconPx: Math.max(...iconValues),
  }
  writeFileSync(OUT, `${JSON.stringify(metrics, null, 2)}\n`)
  console.log(`strip ${metrics.stripPx}px in ${metrics.font}; wrote ${path.relative(APP_ROOT, OUT)}`)

  // THE CHECK: play, and hold the estimate up against every pill on screen.
  // The pill's markup is not in the DOM, so it is rebuilt from the spans the
  // renderer made -- which tests the metrics and the structural model, the
  // two things this script is answerable for.
  let worst = 0
  let pills = 0
  for (let turn = 0; turn < 160; turn += 1) {
    const rows = await page.evaluate(() => {
      const toMarkup = (node: Element): string => [...node.children].map((child) => {
        const className = child.className
        if (className.includes('escape-menu-narration-icon')) {
          return `[${className.replace(' escape-menu-narration-icon', '')}|x]`
        }
        const text = child.textContent ?? ''
        const bold = className.includes('escape-menu-narration-strong')
        const italic = className.includes('escape-menu-narration-em')
        return `${bold ? '**' : ''}${italic ? '*' : ''}${text}${italic ? '*' : ''}${bold ? '**' : ''}`
      }).join('')
      return [...document.querySelectorAll('.chapter-bar-display > .tag-pill')].map((pill) => ({
        detail: pill.classList.contains('escape-menu-choice-detail'),
        width: pill.getBoundingClientRect().width,
        lines: pill.classList.contains('escape-menu-choice-detail')
          ? [...pill.querySelectorAll('.escape-menu-choice-detail-line > .escape-menu-narration-text')].map(toMarkup)
          : [toMarkup(pill.querySelector('.escape-menu-narration-text')!)],
      }))
    })
    for (const row of rows) {
      const estimate = row.detail ? detailPillWidth(row.lines, metrics) : narrationPillWidth(row.lines[0], metrics)
      const error = (estimate - row.width) / row.width
      if (Math.abs(error) > Math.abs(worst)) worst = error
      if (Math.abs(error) > 0.02) console.log(`${(error * 100).toFixed(1)}% est ${estimate.toFixed(1)} dom ${row.width.toFixed(1)}`, JSON.stringify(row.lines))
      pills += 1
    }
    // Wander the dial, then take what it lands on.
    for (let spin = 0; spin < turn % 3; spin += 1) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
  }
  console.log(`estimate vs DOM over ${pills} pills: worst error ${(worst * 100).toFixed(2)}%`)
  await browser.close()
} finally {
  server.kill()
}
