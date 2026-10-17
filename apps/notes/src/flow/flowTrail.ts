/**
 * The typing flow trail's alpha. A box's alpha is the product of four
 * factors, applied in this order:
 *
 * 1. The flow colour's own alpha (the `flowTrail` highlight colour, the
 *    reader's flowBaseColor), which the box's border is drawn in.
 * 2. The flow level f at the box's creation, scaled to 0 at no flow and
 *    `TRAIL_ALPHA_AT_FULL_FLOW` at full flow, and on a new row by
 *    `lineRampShare` so the trail fades back in after a wrap.
 * 3. The fade since creation, `fadeCurve(t, fadeMaxTime, fadeShape)`.
 * 4. The flash after reaching full flow, from `FLASH_PEAK` back to 1 on the
 *    same curve over `FLASH_MAX_TIME_SEC` with shape `FLASH_SHAPE`.
 *
 * Factors 2 and 3 belong to each box (its own opacity, set once and
 * animated); the 0.8 of factor 2 and the whole of factor 4 apply to every box
 * at once, so they sit on the layer holding the boxes (`TRAIL_ALPHA_AT_FULL_FLOW`
 * is its resting opacity). That split is what lets the flash lift every box
 * on screen, old and new alike, without touching any of them: 0.8 x 1.25 is
 * exactly 1, so the layer's opacity never has to exceed one.
 */

export const TRAIL_ALPHA_AT_FULL_FLOW = 0.7
const FLASH_PEAK = 2
const FLASH_MAX_TIME_SEC = 5
const FLASH_SHAPE = -2

/** Samples per curve: the curve is not one CSS can name, so it becomes a linear keyframe list. */
const SAMPLES = 32

/** The k-th box of a row (1-based) draws at this share of its alpha: k / lineRamp, up to 1. */
export function lineRampShare(boxInRow: number, lineRamp: number): number {
  return Math.min(1, boxInRow / Math.max(1, lineRamp))
}

/** `((maxTime - t) / maxTime) ^ (2 ^ shape)`: 1 at t = 0, 0 at t = maxTime. */
export function fadeCurve(t: number, maxTime: number, shape: number): number {
  const left = Math.max(0, Math.min(1, (maxTime - t) / maxTime))
  return left ** (2 ** shape)
}

function curveKeyframes(maxTime: number, shape: number, map: (fade: number) => number): Keyframe[] {
  const keyframes: Keyframe[] = []
  for (let i = 0; i <= SAMPLES; i += 1) {
    keyframes.push({ opacity: map(fadeCurve((maxTime * i) / SAMPLES, maxTime, shape)), offset: i / SAMPLES })
  }
  return keyframes
}

/** Fades a box from the flow level it was created at (0..1) to nothing, then removes it. */
export function fadeTrailBox(el: HTMLElement, level: number, fadeMaxTime: number, fadeShape: number): void {
  const animation = el.animate(
    curveKeyframes(fadeMaxTime, fadeShape, (fade) => level * fade),
    { duration: fadeMaxTime * 1000, fill: 'forwards' },
  )
  animation.onfinish = () => el.remove()
}

/** The full-flow flash, on the layer holding every box. */
export function flashTrailLayer(layer: HTMLElement): void {
  layer.animate(
    curveKeyframes(FLASH_MAX_TIME_SEC, FLASH_SHAPE, (fade) => TRAIL_ALPHA_AT_FULL_FLOW * (1 + (FLASH_PEAK - 1) * fade)),
    { duration: FLASH_MAX_TIME_SEC * 1000 },
  )
}
