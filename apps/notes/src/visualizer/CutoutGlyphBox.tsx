/**
 * A visualizer button box: a box of the accent with its character CUT OUT of
 * it, so the character is not a colour but the absence of the accent -- what
 * lies under the box shows through the glyph's shape (the progress track's
 * `<` `>`, the volume bar's `–` `+`, the exit box's xmark).
 *
 * CSS cannot use text as a mask, so the glyph is rasterized once into an
 * image (a canvas, the glyph opaque on transparent, in the document's own
 * loaded font) and the box is masked by "everything EXCLUDING the glyph": the
 * accent stays a CSS colour, so a layout's colour change needs no redraw, and
 * the mask is static, so nothing repaints per frame. One image per glyph, font
 * and size, cached for the session.
 *
 * A press shrinks the glyph by a tenth and nothing else: the glyph layer's
 * mask-size goes to 90% (visualizer.css, `[data-pressed]`), so the cut-out
 * shrinks and the box is unchanged.
 */

import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

const masks = new Map<string, string>()

function glyphKey(text: string, font: string, sizePx: number): string {
  return `${sizePx}|${font}|${text}`
}

/** The glyph, opaque on transparent, centred in a `sizePx` square at device resolution, as a data URL. */
function rasterizeGlyph(text: string, font: string, sizePx: number): string {
  const scale = Math.max(1, window.devicePixelRatio || 1)
  const side = Math.max(1, Math.round(sizePx * scale))
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.scale(scale, scale)
  context.font = font
  context.fillStyle = '#000'
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  // Centred on the glyph's own ink, not the font's line box, so every
  // character sits in the middle of its box whatever its ascent.
  const metrics = context.measureText(text)
  const inkCentre = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
  context.fillText(text, sizePx / 2, sizePx / 2 + inkCentre)
  return canvas.toDataURL()
}

/** The glyph's mask image once its font has loaded (null until then). */
function useGlyphMask(text: string, font: string, sizePx: number): string | null {
  const key = glyphKey(text, font, sizePx)
  const [, setLoaded] = useState(0)
  const cached = masks.get(key) ?? null
  useEffect(() => {
    if (masks.has(key)) return
    let cancelled = false
    // Waits for the font rather than drawing a fallback face and redrawing.
    void document.fonts.load(font, text).then(() => {
      if (!masks.has(key)) masks.set(key, rasterizeGlyph(text, font, sizePx))
      if (!cancelled) setLoaded((count) => count + 1)
    })
    return () => {
      cancelled = true
    }
  }, [key, text, font, sizePx])
  return cached
}

export function CutoutGlyphBox({
  left,
  top,
  sizePx,
  text,
  font,
  className,
  label,
  onPointerDown,
  onClick,
}: {
  left: number
  top: number
  sizePx: number
  text: string
  /** A canvas font shorthand, e.g. `"18px Kode Mono"`. */
  font: string
  className?: string
  label?: string
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onClick?: () => void
}) {
  const mask = useGlyphMask(text, font, sizePx)
  const style: CSSProperties = { left, top, width: sizePx, height: sizePx }
  if (mask) {
    const image = `linear-gradient(#000 0 0), url("${mask}")`
    style.maskImage = image
    style.WebkitMaskImage = image
  }
  return (
    <div
      role={label ? 'button' : undefined}
      aria-label={label}
      className={`visualizer-cutout-glyph${className ? ` ${className}` : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onClick={onClick}
    />
  )
}
