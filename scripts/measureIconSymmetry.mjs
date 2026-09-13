#!/usr/bin/env node
// Under what rotation does an icon glyph map onto itself?
//
// The work indicator turns the sidebar's cogwheel in fixed increments, and
// the whole illusion -- a mechanism that clicks round and comes to rest
// looking like itself -- depends on that increment being the icon's actual
// symmetry. Getting it wrong does not look like an error, it looks like a
// wobble, which is how it was reported.
//
// Assumed to be 45° (an eight-tooth cog) and measured at 60°: Font Awesome's
// gear has SIX teeth. 45° differed by 30.6% of inked pixels, 60° by 0.6%,
// which is antialiasing.
//
// Run this before changing the indicator's icon, and put the answer in
// WORK_INDICATOR_STEP_DEG:
//   node scripts/measureIconSymmetry.mjs [codepoint] [fontFamily]
// e.g. node scripts/measureIconSymmetry.mjs f013 "Font Awesome 7 Free"

import { chromium } from 'playwright'
import { startDevServer } from './perf/perfHarness.mjs'

const CODEPOINT = process.argv[2] ?? 'f013'
const FAMILY = process.argv[3] ?? 'Font Awesome 7 Free'
const PORT = 5279

const server = await startDevServer(PORT)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const result = await page.evaluate(async ({ codepoint, family }) => {
    await document.fonts.ready
    const SIZE = 320
    const character = String.fromCodePoint(parseInt(codepoint, 16))
    const canvas = document.createElement('canvas')
    canvas.width = SIZE; canvas.height = SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const render = (angleDeg) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.save()
      ctx.translate(SIZE / 2, SIZE / 2)
      ctx.rotate((angleDeg * Math.PI) / 180)
      ctx.font = `900 160px "${family}"`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#000'
      ctx.fillText(character, 0, 0)
      ctx.restore()
      const { data } = ctx.getImageData(0, 0, SIZE, SIZE)
      const out = new Uint8Array(SIZE * SIZE)
      for (let i = 0; i < out.length; i += 1) out[i] = data[i * 4 + 3] > 24 ? 1 : 0
      return out
    }
    const diffPercent = (a, b) => {
      let differing = 0, inked = 0
      for (let i = 0; i < a.length; i += 1) {
        if (a[i] || b[i]) inked += 1
        if (a[i] !== b[i]) differing += 1
      }
      return +((100 * differing) / Math.max(1, inked)).toFixed(1)
    }

    const base = render(0)
    const rows = []
    for (let angle = 5; angle <= 180; angle += 1) rows.push({ angle, diff: diffPercent(base, render(angle)) })
    const symmetries = rows.filter((row) => row.diff < 5)
    return { smallestSymmetry: symmetries[0] ?? null, symmetries: symmetries.slice(0, 6), worst: rows.reduce((a, b) => (b.diff > a.diff ? b : a)) }
  }, { codepoint: CODEPOINT, family: FAMILY })

  console.log(`glyph U+${CODEPOINT.toUpperCase()} in "${FAMILY}"`)
  console.log(result.smallestSymmetry
    ? `maps onto itself every ${result.smallestSymmetry.angle}° (${result.smallestSymmetry.diff}% differing pixels)`
    : 'has no rotational symmetry under 180°')
  console.log(`all symmetries under 180°: ${result.symmetries.map((s) => `${s.angle}°`).join(', ') || 'none'}`)
} finally {
  await browser.close()
  server.stop?.()
}
process.exit(0)
