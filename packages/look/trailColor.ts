import { parseCssColorToRgba } from './colorMath'
import { hslToRgb, screenColorOf, type SceneDescription } from './scene'

/**
 * The typing trail's colour, fitted to a theme.
 *
 * The trail is drawn INSIDE the scene (the filter wrapper), so its stored
 * colour is a content colour that the theme's invert, sepia, hue-rotate,
 * saturate and colorize then transform; the fit is answered from `scene.ts`'s
 * one description of the scene. (The colour is stored under the highlight
 * key `flowTrail`, its name from before the typing trail had one of its own.)
 */

/** The trail colour of a loadout saved before the trail existed. */
export const FALLBACK_TRAIL_COLOR = 'rgba(255, 170, 60, 0.9)'

/**
 * Where the hue comes from, first answer that has one:
 * 1. The box itself on screen, when it is clearly tinted (chroma at least
 *    `BOX_CHROMA`).
 * 2. The theme's TINT: the box colour taken down to mid lightness (its
 *    channel ratios kept) and seen through the scene. A dark theme's box is
 *    near black on screen and carries no readable hue, but its sepia,
 *    hue-rotate and colorize still colour everything in between -- this is
 *    the hue a reader would name the theme by (Ocean's teal, Bubblegum's
 *    magenta). Taken when its chroma is at least `TINT_CHROMA`.
 * 3. Amber, through the scene's colour effects but not its invert (which
 *    flips lightness and would make amber blue): a neutral theme keeps the
 *    trail's own warm colour, rotated with the theme's hue.
 */
const BOX_CHROMA = 0.1
const TINT_CHROMA = 0.04
const TINT_LIGHTNESS = 0.6
/** What the trail colour aims for on screen: the box's hue, fully saturated, brighter than mid grey. */
const TARGET_SATURATION = 1
const TARGET_LIGHTNESS = 0.65
const TRAIL_ALPHA = 0.9

function hueOf([r, g, b]: readonly number[]): { hueDeg: number; chroma: number } {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma === 0) return { hueDeg: 0, chroma }
  let h: number
  if (max === r) h = ((g - b) / chroma) % 6
  else if (max === g) h = (b - r) / chroma + 2
  else h = (r - g) / chroma + 4
  return { hueDeg: (h * 60 + 360) % 360, chroma }
}

function rgbOf(css: string): number[] | null {
  const c = parseCssColorToRgba(css)
  return c ? [c.r / 255, c.g / 255, c.b / 255] : null
}

function withoutInvert(scene: SceneDescription): SceneDescription {
  return {
    ...scene,
    invertViaBlendMode: false,
    filterEffects: scene.filterEffects.filter((effect) => effect.kind !== 'invert'),
  }
}

const toByte = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255)

/**
 * A brighter, glowier version of the theme's box colour (`grid`), as the
 * content colour to store as `flowTrail`.
 *
 * Judged ON SCREEN, because "brighter" in an inverted theme is darker in
 * content and a hue rotation moves what the reader calls the box's hue: the
 * box's on-screen hue is taken, the target is that hue at full saturation
 * and above-mid lightness, and the content colour whose on-screen value lands
 * nearest the target is chosen (`contentColorReaching`).
 */
export function deriveTrailColor(boxCss: string, scene: SceneDescription): string {
  const box = rgbOf(boxCss)
  if (!box) return FALLBACK_TRAIL_COLOR
  const boxHue = hueOf(screenColorOf(scene, box))
  const tintHue = hueOf(screenColorOf(scene, box.map((v) => v * TINT_LIGHTNESS)))
  const { hueDeg } = boxHue.chroma >= BOX_CHROMA
    ? boxHue
    : tintHue.chroma >= TINT_CHROMA
      ? tintHue
      : hueOf(screenColorOf(withoutInvert(scene), rgbOf(FALLBACK_TRAIL_COLOR)!))
  const target = hslToRgb(hueDeg, TARGET_SATURATION, TARGET_LIGHTNESS)
  const best = contentColorReaching(target, scene)
  return `rgba(${best.map(toByte).join(', ')}, ${TRAIL_ALPHA})`
}

/** How far a light theme's trail colour turns toward amber, and how dark it is. */
const LIGHT_WARM_HUE_DEG = 30
const LIGHT_WARM_SHIFT = 0.25
const LIGHT_SATURATION_ADD = 0.12
const LIGHT_VALUE_SCALE = 0.55
const LIGHT_ALPHA = 0.8

/**
 * A light theme's trail colour: its box colour (`grid`) a little warmer and a
 * good deal darker, as a content colour. Taken in content space rather than
 * on screen because a light theme does not invert, so darker in content is
 * darker on screen; warmer is a turn of the hue toward amber plus a little
 * saturation (a near-grey box has no hue of its own and takes amber's).
 */
export function deriveLightTrailColor(boxCss: string): string {
  const box = rgbOf(boxCss)
  if (!box) return FALLBACK_TRAIL_COLOR
  const max = Math.max(...box)
  const min = Math.min(...box)
  const { hueDeg, chroma } = hueOf(box)
  const baseHue = chroma > 0 ? hueDeg : LIGHT_WARM_HUE_DEG
  const delta = ((LIGHT_WARM_HUE_DEG - baseHue + 540) % 360) - 180
  const h = (baseHue + delta * LIGHT_WARM_SHIFT + 360) % 360
  const s = Math.min(1, (max > 0 ? (max - min) / max : 0) + LIGHT_SATURATION_ADD)
  const v = max * LIGHT_VALUE_SCALE
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return `rgba(${[r, g, b].map((ch) => toByte(ch + v - c)).join(', ')}, ${LIGHT_ALPHA})`
}

/**
 * The content colour whose on-screen value lands nearest `target`. Searched
 * rather than solved, because the scene is not always invertible (saturate
 * at zero, colorize near one), and a search lands on the best reachable
 * colour where an inverse has none.
 */
function contentColorReaching(target: readonly number[], scene: SceneDescription): number[] {
  let best = [1, 1, 1]
  let bestDistance = Infinity
  for (let h = 0; h < 360; h += 5) {
    for (const s of [0.6, 0.8, 1]) {
      for (const l of [0.05, 0.1, 0.2, 0.35, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
        const candidate = hslToRgb(h, s, l)
        const seen = screenColorOf(scene, candidate)
        const distance = seen.reduce((sum, v, i) => sum + (v - target[i]) ** 2, 0)
        if (distance < bestDistance) {
          bestDistance = distance
          best = candidate
        }
      }
    }
  }
  return best
}
