// The curtain over a long journey through the Music Library's song list.
//
// A track click far down a list of thousands of songs plans a journey whose
// middle is cut (NonQuantizedSmoothScroll.ts); a pane without a curtain
// arrives instantly instead, so the list needs one. It is the editor's
// mechanism (scroll/scrollBridge.ts) with a different tile: rows drawn as the
// list's own CLOSED headings -- the folder or artist icon, a name of one or two
// words of the Universal Declaration of Human Rights (as the text bridge
// carries), and a song count -- so what sweeps past looks like the list it
// stands in for.
//
// Everything is MEASURED off a real closed heading on screen: the boxes it is
// painted with, the icon, name and count positions and fonts, and the pitch
// from one heading to the next. Nothing about the heading's look is restated
// here, so a change to its CSS reaches the curtain without anyone editing this.

import { BRIDGE_DECLARATION_TEXT } from '../scroll/scrollBridgeTexture'
import type { CurtainSource, CurtainTile } from '../scroll/scrollBridge'

/** Rows in one tile: enough that the repeat is not noticed in flight. */
const TILE_ROWS = 64

/** Words fit for a name: letters only, four or more of them (no "the", "and"). */
const NAME_WORDS = BRIDGE_DECLARATION_TEXT
  .split(/\s+/)
  .map((word) => word.replace(/[^\p{L}]/gu, ''))
  .filter((word) => word.length >= 4)

/** A small seeded generator, so a tile is the same tile every time it is drawn. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

interface PaintedBox {
  leftPx: number
  topPx: number
  widthPx: number
  heightPx: number
  background: string
  borderColor: string
  borderWidthPx: number
  radiusPx: number
}

interface PlacedText {
  leftPx: number
  rightPx: number
  centreYPx: number
  font: string
  color: string
}

interface HeadingGeometry {
  pitchPx: number
  boxes: PaintedBox[]
  icon: PlacedText & { glyph: string }
  name: PlacedText
  count: PlacedText & { pattern: string }
}

/**
 * Reads a closed heading's geometry: vertically from its section's top, the
 * tile's row; horizontally from the curtain host's left edge, the tile's.
 */
function measureHeading(list: HTMLElement, host: HTMLElement): HeadingGeometry | null {
  // Two closed headings one after the other: the pitch between them is a
  // closed row's, with no open body in between.
  const isClosed = (el: Element | null): el is HTMLElement => (
    el instanceof HTMLElement && el.matches('.sidebar-options-section') && !el.querySelector('details')?.open
  )
  const section = [...list.querySelectorAll<HTMLElement>('.sidebar-options-section')]
    .find((candidate) => isClosed(candidate) && isClosed(candidate.nextElementSibling))
  const next = section?.nextElementSibling as HTMLElement | undefined
  if (!section || !next) return null
  const sectionTop = section.getBoundingClientRect().top
  const origin = { top: sectionTop, left: host.getBoundingClientRect().left }
  const pitchPx = next.getBoundingClientRect().top - sectionTop
  if (!(pitchPx > 0)) return null

  const iconEl = section.querySelector<HTMLElement>('summary > .fa-solid')
  const nameEl = section.querySelector<HTMLElement>('.options-music-song-heading')
  const countEl = section.querySelector<HTMLElement>('summary > .options-divider-count')
  if (!iconEl || !nameEl || !countEl) return null

  const boxes: PaintedBox[] = []
  for (const el of [section, section.querySelector('details'), section.querySelector('summary')]) {
    if (!el) continue
    const style = getComputedStyle(el)
    const borderWidthPx = parseFloat(style.borderTopWidth) || 0
    const transparent = (color: string) => color === 'transparent' || /,\s*0\)$/.test(color)
    if (transparent(style.backgroundColor) && (borderWidthPx === 0 || transparent(style.borderTopColor))) continue
    const rect = el.getBoundingClientRect()
    boxes.push({
      leftPx: rect.left - origin.left,
      topPx: rect.top - origin.top,
      widthPx: rect.width,
      heightPx: rect.height,
      background: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderWidthPx,
      radiusPx: parseFloat(style.borderTopLeftRadius) || 0,
    })
  }

  const place = (el: HTMLElement): PlacedText => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      leftPx: rect.left - origin.left,
      rightPx: rect.right - origin.left,
      centreYPx: rect.top - origin.top + (rect.height / 2),
      font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      color: style.color,
    }
  }
  // The glyph is the first quoted string: Font Awesome's content may carry an
  // alternative text after it (`"\f07b" / ""`).
  const glyph = /^["']([^"']*)["']/.exec(getComputedStyle(iconEl, '::before').content)?.[1] ?? ''
  if (!glyph || glyph === 'none') return null
  return {
    pitchPx,
    boxes,
    icon: { ...place(iconEl), glyph },
    name: place(nameEl),
    // The count's own text with its figures marked, so "(12)" stays "(n)".
    count: { ...place(countEl), pattern: (countEl.textContent ?? '').replace(/\d+/, '#') },
  }
}

function roundedRect(context: CanvasRenderingContext2D, box: PaintedBox, insetPx: number): void {
  context.beginPath()
  context.roundRect(
    box.leftPx + insetPx, box.topPx + insetPx,
    box.widthPx - (2 * insetPx), box.heightPx - (2 * insetPx),
    Math.max(0, box.radiusPx - insetPx),
  )
}

function drawTile(geometry: HeadingGeometry, widthPx: number): CurtainTile | null {
  const scale = Math.max(1, window.devicePixelRatio || 1)
  const heightPx = geometry.pitchPx * TILE_ROWS
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(widthPx * scale))
  canvas.height = Math.max(1, Math.round(heightPx * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.scale(scale, scale)
  context.textBaseline = 'middle'
  const random = seededRandom(0x5eed)
  const pick = () => NAME_WORDS[Math.floor(random() * NAME_WORDS.length)] ?? 'Article'

  for (let row = 0; row < TILE_ROWS; row += 1) {
    context.save()
    context.translate(0, row * geometry.pitchPx)
    for (const box of geometry.boxes) {
      roundedRect(context, box, 0)
      context.fillStyle = box.background
      context.fill()
      if (box.borderWidthPx > 0) {
        roundedRect(context, box, box.borderWidthPx / 2)
        context.lineWidth = box.borderWidthPx
        context.strokeStyle = box.borderColor
        context.stroke()
      }
    }
    const { icon, name, count } = geometry
    context.font = icon.font
    context.fillStyle = icon.color
    context.textAlign = 'left'
    context.fillText(icon.glyph, icon.leftPx, icon.centreYPx)

    const label = capitalise(pick()) + (random() < 0.5 ? ` ${capitalise(pick())}` : '')
    context.font = name.font
    context.fillStyle = name.color
    context.fillText(label, name.leftPx, name.centreYPx, Math.max(1, count.leftPx - name.leftPx - 4))

    context.font = count.font
    context.fillStyle = count.color
    context.textAlign = 'right'
    context.fillText(count.pattern.replace('#', String(1 + Math.floor(random() * 99))), count.rightPx, count.centreYPx)
    context.restore()
  }
  return { dataUri: canvas.toDataURL('image/png'), heightPx }
}

/**
 * The song list's curtain source, or null when no closed heading and its
 * neighbour are on screen to measure (a list that short needs no curtain).
 */
export function readSongListCurtain(list: HTMLElement, host: HTMLElement, widthPx: number): CurtainSource | null {
  const geometry = measureHeading(list, host)
  if (!geometry) return null
  return {
    key: JSON.stringify(geometry),
    draw: () => drawTile(geometry, widthPx),
  }
}
