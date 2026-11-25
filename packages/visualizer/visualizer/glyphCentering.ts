import { useEffect, useState } from 'react'

/**
 * Where a letter of the visualizer's grid has to move to sit in the MIDDLE of
 * its box. A letter is laid out as text: centred on its advance horizontally
 * and on the font's line box (ascent plus descent, as the font declares them)
 * vertically. Neither is where the glyph's ink is: fonts declare very
 * different ascents and descents, so with the line height equal to the box
 * one font's letters sit high and another's low, and a glyph's ink need not be
 * centred on its advance.
 *
 * The rule, the same shift for every letter so a row keeps one baseline:
 * vertically, the band from the baseline up to halfway between the x-height
 * and the cap height is centred in the box, so capitals sit as far above the
 * middle as lowercase letters sit below it; horizontally, the ink of `H`
 * (symmetric in every face) is centred in the box.
 *
 * Where the browser actually put the baseline and the advance is read from
 * the layout itself (a probe laid out exactly as a letter is), since it rounds
 * the font's metrics; only the ink, which layout cannot report, comes from the
 * canvas's text metrics. Once per font, size and box, after the font has
 * loaded.
 */
export type GlyphOffset = { dx: number; dy: number }

const NONE: GlyphOffset = { dx: 0, dy: 0 }
const offsets = new Map<string, GlyphOffset>()

function measure(fontFamily: string, sizePx: number, boxPx: number): GlyphOffset {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return NONE
  context.font = `${sizePx}px ${fontFamily}`
  const capital = context.measureText('H')
  const lower = context.measureText('x')
  // A letter's own box: the same font, size and line height, centred text.
  const probe = document.createElement('div')
  probe.style.cssText = `position:fixed;left:0;top:0;visibility:hidden;white-space:pre;text-align:center;font-family:${fontFamily};font-size:${sizePx}px;line-height:${boxPx}px;width:${boxPx}px;height:${boxPx}px`
  const text = document.createTextNode('H')
  // A zero-size box on the baseline: its top is where layout put the baseline.
  const baseline = document.createElement('span')
  baseline.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
  probe.append(text, baseline)
  document.body.append(probe)
  const range = document.createRange()
  range.selectNodeContents(text)
  const advance = range.getBoundingClientRect()
  const baselineY = baseline.getBoundingClientRect().top
  probe.remove()
  const values = [capital.actualBoundingBoxAscent, lower.actualBoundingBoxAscent, capital.actualBoundingBoxLeft, capital.actualBoundingBoxRight, advance.left, baselineY]
  if (!values.every(Number.isFinite)) return NONE
  const band = (capital.actualBoundingBoxAscent + lower.actualBoundingBoxAscent) / 2
  const inkCentre = advance.left + (capital.actualBoundingBoxRight - capital.actualBoundingBoxLeft) / 2
  // Drawn on whole device pixels, so a letter's edges stay as crisp as the grid's.
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  const snap = (value: number) => Math.round(value * ratio) / ratio
  return { dx: snap(boxPx / 2 - inkCentre), dy: snap(boxPx / 2 + band / 2 - baselineY) }
}

/** The offset for `fontFamily` at `sizePx` in a `boxPx` box: none until the font has loaded, then measured once. */
export function useGlyphOffset(fontFamily: string, sizePx: number, boxPx: number): GlyphOffset {
  const key = `${sizePx}|${boxPx}|${fontFamily}`
  const [, setLoaded] = useState(0)
  useEffect(() => {
    if (offsets.has(key)) return
    let cancelled = false
    void document.fonts.load(`${sizePx}px ${fontFamily}`, 'Hx').then(() => {
      if (!offsets.has(key)) offsets.set(key, measure(fontFamily, sizePx, boxPx))
      if (!cancelled) setLoaded((count) => count + 1)
    })
    return () => {
      cancelled = true
    }
  }, [key, fontFamily, sizePx, boxPx])
  return offsets.get(key) ?? NONE
}
