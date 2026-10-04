/**
 * Records what every factory visual preset (5 light, 5 dark) puts on screen:
 * the inline style of <html>, .app-root, .app-saturate-wrapper and .app-shell,
 * the shell's classes, which glaze layers are mounted, and the blend overlays.
 *
 * For refactors of the theme pipeline (packages/look/loadoutTheme.ts): take a
 * snapshot before, one after, and compare them parsed (property order in a
 * style attribute is not meaningful). Texture image URLs are blob URLs minted
 * per load and always differ; everything else must match.
 *
 * Needs `npm run dev:browser -- --port 5180` running.
 *   node scripts/snapshotThemes.mjs out.json
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
const errs = []; p.on('pageerror', e => errs.push(String(e)))
await p.goto('http://localhost:5180/'); await p.waitForTimeout(3000)
await p.click('.btn-options'); await p.waitForTimeout(800)
const out = {}
const snap = () => p.evaluate(() => {
  const s = (sel) => document.querySelector(sel)?.getAttribute('style') ?? null
  const overlays = [...document.querySelectorAll('.app-root > div > div[aria-hidden="true"], .app-saturate-wrapper ~ div')].map(e => e.getAttribute('style'))
  return {
    html: document.documentElement.getAttribute('style'),
    root: s('.app-root'), wrapper: s('.app-saturate-wrapper'), shell: s('.app-shell'),
    shellClass: document.querySelector('.app-shell')?.className,
    glaze: [...document.querySelectorAll('.glaze-overlay-layer')].map(e => e.className),
    fixedOverlays: [...document.querySelectorAll('div')].filter(e => e.style.position === 'fixed' && e.style.mixBlendMode).map(e => e.getAttribute('style')),
  }
})
for (const mode of ['light', 'dark']) {
  if (mode === 'dark') { await p.click('button[aria-label="Toggle dark mode"]'); await p.waitForTimeout(800) }
  const n = await p.locator('[aria-label="UI mode presets"] button').count()
  for (let i = 0; i < Math.min(n, 5); i++) {
    await p.locator('[aria-label="UI mode presets"] button').nth(i).click(); await p.waitForTimeout(600)
    out[`${mode}-${i}`] = await snap()
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1))
console.log(Object.keys(out).length, 'snapshots; errors', errs.length, errs.slice(0,2))
await b.close()
