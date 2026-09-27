import { Facet, RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/**
 * The editor font a character is judged against. `ready` is false until the
 * font has finished loading: measured before then, every character would be
 * judged against the fallback font's widths.
 */
export interface GridCellFont {
  family: string
  sizePx: number
  ready: boolean
}

const gridCellFont = Facet.define<GridCellFont, GridCellFont | null>({
  combine: (values) => values[values.length - 1] ?? null,
})

/**
 * THE GRID IS ABOVE ALL: every character the edit view draws takes exactly one
 * cell of it.
 *
 * The text itself is already held to one cell per character by Unicode
 * (shared/singleCellText.ts). What that rule cannot see is the FONT: a
 * character that is one cell by Unicode but missing from the chosen editor
 * font is drawn by the browser from the next font in the stack, at that
 * font's width -- a box-drawing character in VT323, a symbol most of the
 * fonts lack -- and every character after it on the line shifts off the grid.
 *
 * So a non-ASCII character whose drawn advance is not the font's own glyph
 * width is not drawn at all. It is replaced, in the edit view only, by a blank
 * cell; the character stays in the text, so saving, search, copying and the
 * render view all keep it. ASCII is never checked: every editor font covers
 * it, and it is nearly all of any note.
 *
 * "Drawn advance" is measured the way the app measures the glyph width itself
 * (EditorTypography.ts's measureMonospaceGlyphWidthPx): a canvas, the same
 * font string, compared against '0'. The canvas falls back through the same
 * font stack the page does, so a character the font lacks measures at the
 * width it would actually be drawn at. Each character is measured once per
 * font and cached; only characters in the visible lines are looked at.
 */
export function gridCellGuard(font: GridCellFont): Extension {
  return [gridCellFont.of(font), gridCellGuardPlugin]
}

/**
 * The blank cell: an ASCII '0' drawn invisibly. A character the font has, so
 * it takes exactly the width every other character takes -- the glyph width
 * plus the letter-spacing that widens it to the cell (index.css's
 * .editor-text), which applies to text and not reliably to an element's box.
 * No width is computed here, so none can disagree with the grid.
 */
class BlankCellWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const cell = document.createElement('span')
    cell.className = 'cm-grid-blank-cell'
    cell.setAttribute('aria-hidden', 'true')
    cell.textContent = '0'
    return cell
  }

  ignoreEvent(): boolean {
    return false
  }
}

const blankCell = Decoration.replace({ widget: new BlankCellWidget() })
const NON_ASCII = /[\u0080-\u{10FFFF}]/gu

let measureContext: CanvasRenderingContext2D | null | undefined

function measureAdvancePx(fontString: string, text: string): number | null {
  if (measureContext === undefined) {
    measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  if (!measureContext) return null
  measureContext.font = fontString
  const width = measureContext.measureText(text).width
  return Number.isFinite(width) && width > 0 ? width : null
}

/** Below this the two widths are the same advance, differing only by float rounding. */
const SAME_ADVANCE_EPSILON_PX = 0.01

const gridCellGuardPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  private fitsByCharacter = new Map<string, boolean>()
  private font: GridCellFont | null

  constructor(view: EditorView) {
    this.font = view.state.facet(gridCellFont)
    this.decorations = this.build(view)
  }

  update(update: ViewUpdate) {
    const font = update.state.facet(gridCellFont)
    if (font !== this.font) {
      this.font = font
      this.fitsByCharacter.clear()
      this.decorations = this.build(update.view)
      return
    }
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.build(update.view)
    }
  }

  private fits(character: string, fontString: string, glyphWidthPx: number): boolean {
    const known = this.fitsByCharacter.get(character)
    if (known !== undefined) return known
    const advance = measureAdvancePx(fontString, character)
    const fits = advance !== null && Math.abs(advance - glyphWidthPx) < SAME_ADVANCE_EPSILON_PX
    this.fitsByCharacter.set(character, fits)
    return fits
  }

  private build(view: EditorView): DecorationSet {
    const font = this.font
    if (!font || !font.ready) return Decoration.none
    const fontString = `400 ${font.sizePx}px ${font.family}`
    const glyphWidthPx = measureAdvancePx(fontString, '0')
    if (glyphWidthPx === null) return Decoration.none

    const builder = new RangeSetBuilder<Decoration>()
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to)
      NON_ASCII.lastIndex = 0
      for (let match = NON_ASCII.exec(text); match; match = NON_ASCII.exec(text)) {
        if (this.fits(match[0], fontString, glyphWidthPx)) continue
        const start = from + match.index
        builder.add(start, start + match[0].length, blankCell)
      }
    }
    return builder.finish()
  }
}, {
  decorations: (plugin) => plugin.decorations,
})
