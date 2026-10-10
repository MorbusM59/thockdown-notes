import { useEffect, useRef } from 'react'
import {
  EDITOR_FONT_SIZE_MAX_PX,
  EDITOR_FONT_SIZE_MIN_PX,
  EDITOR_FONT_SIZE_STEP_PX,
  EDITOR_GLYPH_PADDING_MAX_PX,
  EDITOR_GLYPH_PADDING_MIN_PX,
  EDITOR_GLYPH_PADDING_STEP_PX,
  EDITOR_LINE_HEIGHT_MULTIPLIER_MAX,
  EDITOR_LINE_HEIGHT_MULTIPLIER_MIN,
  EDITOR_LINE_HEIGHT_MULTIPLIER_STEP,
  VIEW_LETTER_SPACING_MAX_EM,
  VIEW_LETTER_SPACING_MIN_EM,
  VIEW_LETTER_SPACING_STEP_EM,
  roundEditorFontSizePx,
  roundEditorGlyphPaddingPx,
  roundLineHeightMultiplier,
  roundViewLetterSpacingEm,
} from '../editor/EditorTypography'
import { createWheelNotchState, resolveWheelEventUnits } from '../editor/wheelNotch'

/**
 * Ctrl+wheel over the TEXT of an editor adjusts that pane's typography by one
 * slider step per notch: Ctrl alone the font size, Ctrl+Alt the horizontal
 * spacing, Ctrl+Shift the line height.
 *
 * WHICH SETTINGS move is decided by the element under the pointer, never by
 * the active slot or by focus. Edit view and render view keep separate
 * typography, and each slot has its own mode, so two slots side by side can
 * be showing the two different panes; the wheel event's target is the element
 * the pointer is over, so reading the pane from the target is correct by
 * construction. A text surface declares itself with
 * `data-typography-surface="edit" | "render"` (the edit view's scroller, the
 * render view's scroller); anything else in the slot (bars, gutter strips,
 * the scrollbar) carries no declaration and the gesture does nothing there.
 *
 * Horizontal spacing is a different setting in each pane because the panes
 * lay text out differently: render view has CSS letter spacing, while edit
 * view's text sits on a fixed glyph grid whose horizontal spacing is the
 * glyph box padding (the options panel's "x-box" slider). Each step size,
 * range and rounding is the options panel slider's own, imported rather than
 * restated, so a notch is exactly one press of that slider.
 */

export type TypographySurface = 'edit' | 'render'
export type TypographyAxis = 'size' | 'spacing' | 'height'

export const TYPOGRAPHY_SURFACE_ATTRIBUTE = 'data-typography-surface'

interface AxisRule {
  step: number
  min: number
  max: number
  round: (value: number) => number
}

const SIZE: AxisRule = {
  step: EDITOR_FONT_SIZE_STEP_PX, min: EDITOR_FONT_SIZE_MIN_PX, max: EDITOR_FONT_SIZE_MAX_PX, round: roundEditorFontSizePx,
}
const HEIGHT: AxisRule = {
  step: EDITOR_LINE_HEIGHT_MULTIPLIER_STEP,
  min: EDITOR_LINE_HEIGHT_MULTIPLIER_MIN,
  max: EDITOR_LINE_HEIGHT_MULTIPLIER_MAX,
  round: roundLineHeightMultiplier,
}

const RULES: Record<TypographySurface, Record<TypographyAxis, AxisRule>> = {
  edit: {
    size: SIZE,
    spacing: {
      step: EDITOR_GLYPH_PADDING_STEP_PX,
      min: EDITOR_GLYPH_PADDING_MIN_PX,
      max: EDITOR_GLYPH_PADDING_MAX_PX,
      round: roundEditorGlyphPaddingPx,
    },
    height: HEIGHT,
  },
  render: {
    size: SIZE,
    spacing: {
      step: VIEW_LETTER_SPACING_STEP_EM,
      min: VIEW_LETTER_SPACING_MIN_EM,
      max: VIEW_LETTER_SPACING_MAX_EM,
      round: roundViewLetterSpacingEm,
    },
    height: HEIGHT,
  },
}

/** `steps` signed, positive is larger. Rounds onto the slider's grid and clamps to its range. */
export function stepTypographyValue(
  surface: TypographySurface,
  axis: TypographyAxis,
  value: number,
  steps: number,
): number {
  const rule = RULES[surface][axis]
  return Math.min(rule.max, Math.max(rule.min, rule.round(value + steps * rule.step)))
}

/** Which axis a modifier combination names, or null when it names none of them. */
export function typographyAxisOf(
  event: Pick<WheelEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'getModifierState'>,
): TypographyAxis | null {
  if (!event.ctrlKey || event.metaKey) return null
  // Windows reports AltGr as Ctrl+Alt; a reader holding AltGr on a European
  // layout is typing a character, not asking for wider letters.
  if (event.getModifierState('AltGraph')) return null
  if (event.altKey && event.shiftKey) return null
  if (event.altKey) return 'spacing'
  if (event.shiftKey) return 'height'
  return 'size'
}

export function typographySurfaceOf(target: EventTarget | null): TypographySurface | null {
  if (!(target instanceof Element)) return null
  const value = target.closest(`[${TYPOGRAPHY_SURFACE_ATTRIBUTE}]`)?.getAttribute(TYPOGRAPHY_SURFACE_ATTRIBUTE)
  return value === 'edit' || value === 'render' ? value : null
}

export type TypographyValues = Record<TypographySurface, Record<TypographyAxis, number>>
export type TypographySetters = Record<TypographySurface, Record<TypographyAxis, (value: number) => void>>

/**
 * Installs the gesture on the window in the CAPTURE phase, so it is decided
 * before either pane's own wheel listener scrolls: a Ctrl+wheel over a text
 * surface is consumed here and never reaches them. Values and setters are
 * read through a ref, so the listener is installed once.
 */
export function useTypographyWheel(values: TypographyValues, setters: TypographySetters): void {
  const latestRef = useRef({ values, setters })
  latestRef.current = { values, setters }
  // What this listener has written but React has not rendered yet. Several
  // wheel events can arrive within one frame, before the setter's value comes
  // back through `values`; stepping from `values` alone would compute the
  // same next value each time and lose every notch but one. Cleared on each
  // render, at which point `values` holds everything written.
  const pendingRef = useRef(new Map<string, number>())
  pendingRef.current.clear()
  useEffect(() => {
    // One notch accumulator per pane: a sub-notch remainder left over one
    // pane must not count towards a notch over the other.
    const notchStates = { edit: createWheelNotchState(), render: createWheelNotchState() }
    const handleWheel = (event: WheelEvent) => {
      const axis = typographyAxisOf(event)
      if (axis === null) return
      const surface = typographySurfaceOf(event.target)
      if (surface === null) return
      // Consumed whether or not it amounts to a notch yet: a trackpad's
      // sub-notch deltas must not scroll the text (nor zoom the page).
      event.preventDefault()
      event.stopPropagation()
      // Chromium turns Shift+wheel into a horizontal scroll on some
      // platforms, moving the delta from deltaY to deltaX. Either axis is the
      // same wheel here.
      const deltaY = event.deltaY !== 0 ? event.deltaY : event.deltaX
      const units = resolveWheelEventUnits({ deltaY, deltaMode: event.deltaMode }, notchStates[surface], performance.now())
      if (units === 0) return
      // Pixel mode resolves to whole notches; line and page mode report
      // lines or pages, which say nothing about how many notches turned, so
      // those count as one. Wheel away from the reader (negative delta) makes
      // the text larger, the same direction as zooming a page with Ctrl+wheel.
      const notches = event.deltaMode === 0 ? units : Math.sign(units)
      const { values: current, setters: set } = latestRef.current
      const key = `${surface}:${axis}`
      const base = pendingRef.current.get(key) ?? current[surface][axis]
      const next = stepTypographyValue(surface, axis, base, -notches)
      if (next === base) return
      pendingRef.current.set(key, next)
      set[surface][axis](next)
    }
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', handleWheel, { capture: true })
  }, [])
}
