import { _electron } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const shot = process.argv[2]
const dataDir = mkdtempSync(path.join(tmpdir(), 'mode-'))
const app = await _electron.launch({ args: ['--no-sandbox', 'dist-electron/main.js'], cwd: process.cwd(), env: { ...process.env, THOCKDOWN_DATA_ROOT: dataDir } })
const page = await app.firstWindow()
await page.waitForFunction(() => !!window.thockdownImages, null, { timeout: 30000 })
const ids = await page.evaluate(async () => {
  const mk = async (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0,0,w,h)
    const b = await new Promise((r) => c.toBlob(r, 'image/png')); return (await window.thockdownImages.importImage({ bytes: new Uint8Array(await b.arrayBuffer()), origin: null })).id }
  const a = await mk(200, 100), b = await mk(100, 200), c = await mk(50, 50)
  await window.thockdownNotes.createNote({ initialText: `# Picnote\n\n![first cat](${a})\n\n## Garden\n\n![tall](${b})\n\n### Pond\n\n![again](${a})\n\nend\n` })
  return [a, b, c]
})
console.log('ids', ids)
await page.reload(); await page.waitForTimeout(2500)
await page.click('.note-list-item >> text=Picnote'); await page.waitForTimeout(800)
const out = (label, v) => console.log(label, JSON.stringify(v))
await page.click('.btn-options', { button: 'right' }); await page.waitForTimeout(600)
out('labels', await page.$$eval('.notes-mode-button', (bs) => bs.map((b) => b.getAttribute('aria-label'))))
out('optionsIcon', await page.$eval('.btn-options', (b) => b.innerHTML.includes('fa-image')))
out('inOrder', await page.$$eval('.image-library-view .image-list-item', (cs) => cs.map((c) => [c.dataset.imageId, c.querySelector('.note-list-meta-left')?.textContent])))
// Toolbar image button: put caret at end, press button
await page.click('.cm-content'); await page.keyboard.press('Control+End'); await page.keyboard.type('\n')
await page.click('button[aria-label="Image"]'); await page.waitForTimeout(400)
const text = () => page.evaluate(() => document.querySelector('.cm-content').innerText)
out('afterButton', (await text()).slice(-20))
await page.click(`.image-library-view .image-list-item >> nth=1`); await page.waitForTimeout(400)
out('afterPlace', (await text()).slice(-30))
out('activeCard', await page.$$eval('.image-library-view .image-list-item.is-active', (cs) => cs.map((c) => c.dataset.imageId)))
// right tap expands
const card0 = page.locator('.image-library-view .image-list-item').first()
const h0 = (await card0.boundingBox()).height
await card0.click({ button: 'right' }); await page.waitForTimeout(500)
out('expand', [h0, (await card0.boundingBox()).height, (await card0.boundingBox()).width])
await page.screenshot({ path: shot.replace('.png', '-expanded.png') })
// section view
await page.click('.btn-category'); await page.waitForTimeout(600)
out('sections', await page.$$eval('.category-primary', (ps) => ps.map((p) => [p.querySelector('summary').textContent, [...p.querySelectorAll('.category-secondary')].map((s) => [s.querySelector('summary').textContent, [...s.querySelectorAll('.image-list-item')].map((i) => i.dataset.imageId)])])))
// archive
await page.click('.btn-archived'); await page.waitForTimeout(600)
out('archive', await page.$$eval('.image-library-view .image-list-item', (cs) => cs.map((c) => c.dataset.imageId)))
// right hold opens
const box = await page.locator('.image-library-view .image-list-item').first().boundingBox()
await page.mouse.move(box.x + 20, box.y + box.height / 2); await page.mouse.down({ button: 'right' }); await page.waitForTimeout(500); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(600)
out('opened', await page.$$eval('.image-slot-view img', (i) => i.map((x) => x.getAttribute('src')?.slice(0, 20))))
out('activeArchive', await page.$$eval('.image-library-view .image-list-item.is-active', (cs) => cs.map((c) => c.dataset.imageId)))
await page.screenshot({ path: shot })
await page.click('.btn-options', { button: 'right' }); await page.waitForTimeout(400)
out('labelsAfter', await page.$$eval('.notes-mode-button', (bs) => bs.map((b) => b.getAttribute('aria-label'))))
await app.close()
