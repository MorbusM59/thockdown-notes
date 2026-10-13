/**
 * Moving a look part of the way towards another look: `blendThemeLoadout(base,
 * target, t)` is `base` at 0 and `target` at 1. Used by the typing flow, which
 * blends the reader's layout towards a FLOW TARGET as their flow builds; the
 * target is `flowLookTarget` today (the reader's own layout, a little more
 * vivid) and is meant to become a layout the reader saves as their flow look,
 * at which point only the target changes and nothing here does.
 *
 * WHAT IS BLENDED is everything a frame can change without reflowing text or
 * re-deriving the palette: the scene's filters and the glaze. Two kinds are
 * held at `base` on purpose and are the open questions for a saved flow look:
 *   - geometry (radius, spacing): blending it reflows the document on every
 *     step, mid-sentence;
 *   - colours (highlight and text colours, invert): hex strings, which want a
 *     colour-space decision before they can be interpolated, and invert,
 *     which is a switch rather than a quantity.
 */

import type { ThemeLoadout } from './loadoutTheme'
import { GLAZE_RADIAL_OPACITY_MAX, GLAZE_SHEEN_OPACITY_MAX, type GlazeSettings } from './glaze'

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

const BLENDED_GLAZE_KEYS = [
  'linearOpacity', 'radialOpacity', 'gloomPosition', 'gloomShape', 'gloomOpacity',
  'sheenPosition', 'sheenShape', 'sheenOpacity',
] as const satisfies ReadonlyArray<keyof GlazeSettings>

export function blendThemeLoadout(base: ThemeLoadout, target: ThemeLoadout, t: number): ThemeLoadout {
  if (t <= 0) return base
  const amount = Math.min(1, t)
  const glaze: GlazeSettings = { ...base.glaze }
  for (const key of BLENDED_GLAZE_KEYS) glaze[key] = lerp(base.glaze[key], target.glaze[key], amount)
  return {
    ...base,
    glaze,
    filterSepia: lerp(base.filterSepia, target.filterSepia, amount),
    filterHueRotate: lerp(base.filterHueRotate, target.filterHueRotate, amount),
    filterBrightness: lerp(base.filterBrightness, target.filterBrightness, amount),
    filterContrast: lerp(base.filterContrast, target.filterContrast, amount),
    filterSaturate: lerp(base.filterSaturate, target.filterSaturate, amount),
    filterColorize: lerp(base.filterColorize, target.filterColorize, amount),
  }
}

/**
 * The derived flow look at a given strength (0..1): the reader's layout, more
 * saturated, with more contrast, a touch brighter, and with more glaze sheen
 * and radial light. Each push is relative to the reader's own value, so a
 * layout that is already vivid or dim stays recognisably itself.
 */
export function flowLookTarget(base: ThemeLoadout, strength: number): ThemeLoadout {
  const s = Math.max(0, Math.min(1, strength))
  return {
    ...base,
    // The saturate control is a POSITION (0.5 = neutral), not a factor; see loadoutTheme's saturatePosToValue.
    filterSaturate: Math.max(base.filterSaturate, Math.min(0.95, base.filterSaturate + 0.12 * s)),
    filterContrast: base.filterContrast * (1 + 0.15 * s),
    filterBrightness: base.filterBrightness * (1 + 0.03 * s),
    glaze: {
      ...base.glaze,
      sheenOpacity: Math.min(GLAZE_SHEEN_OPACITY_MAX, base.glaze.sheenOpacity + 0.15 * s),
      radialOpacity: Math.min(GLAZE_RADIAL_OPACITY_MAX, base.glaze.radialOpacity + 0.08 * s),
    },
  }
}
