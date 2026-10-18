/**
 * The typing flow trail's alpha and saturation.
 *
 * A box's alpha is the product of four factors, applied in this order:
 *
 * 1. The flow colour's own alpha (the `flowTrail` highlight colour, the
 *    reader's flowBaseColor), which the box's border is drawn in.
 * 2. The flow level f at the box's creation times the trail strength (the
 *    flow options' trail slider), scaled to 0 at no flow and
 *    `TRAIL_ALPHA_AT_FULL_FLOW` at full flow, and on a new row by
 *    `lineRampShare` so the trail fades back in after a wrap.
 * 3. The fade since creation, `fadeCurve(t, fadeMaxTime, fadeShape)`.
 * 4. The PEAK on reaching full flow (`flowPeak.ts`): from
 *    `1 + (TRAIL_PEAK_ALPHA - 1) x peak` back to 1 on the peak curve.
 *
 * Factors 2 and 3 belong to each box (its own opacity, set once and
 * animated); `TRAIL_ALPHA_AT_FULL_FLOW` and factor 4 apply to every box at
 * once, so they are the opacity of the layer holding the boxes. That split is
 * what lets the peak lift every box on screen, old and new alike, without
 * touching any of them.
 *
 * A fifth factor, the IDLE decay (`flowModel.ts`'s `idleFactor`), applies
 * to every box on screen once typing has stopped for the grace period. Boxes
 * sit in GROUPS inside the layer (`trailGroup`): the current group's opacity
 * follows the idle factor (`setTrailIdle`), and a keystroke that arrives
 * while that factor is below 1 leaves the group frozen at the value it had
 * reached and starts a new one. Without the freeze, resuming typing would
 * restore every half-faded box to full strength.
 *
 * Saturation applies to the whole trail, leading edge included, as a share of
 * the flow colour's HSL saturation (`--flow-trail-saturation`, index.css):
 * `TRAIL_SATURATION_BEFORE_FULL` until full flow, 1 in full flow, and at the
 * peak it drops to `1 - peak` and returns to 1 on the peak curve. At the same
 * time its HSV value (the strongest RGB channel) is multiplied by down to
 * `TRAIL_PEAK_VALUE` (`--flow-trail-value`). The trail is drawn inside the
 * scene, which a dark theme inverts, so darkening it here reads as a darker
 * grey in a light theme and a brighter one in a dark theme.
 */

export const TRAIL_ALPHA_AT_FULL_FLOW = 0.7
const TRAIL_PEAK_ALPHA = 2
export const TRAIL_SATURATION_BEFORE_FULL = 0.5
const TRAIL_PEAK_VALUE = 0.8

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

/** The curve sampled into a linear keyframe list; `map` turns each sample (1 falling to 0) into a keyframe's properties. */
export function curveKeyframes(maxTime: number, shape: number, map: (fade: number) => Keyframe): Keyframe[] {
  const keyframes: Keyframe[] = []
  for (let i = 0; i <= SAMPLES; i += 1) {
    keyframes.push({ ...map(fadeCurve((maxTime * i) / SAMPLES, maxTime, shape)), offset: i / SAMPLES })
  }
  return keyframes
}

/** Fades a box from the flow level it was created at (0..1) to nothing, then removes it. */
export function fadeTrailBox(el: HTMLElement, level: number, fadeMaxTime: number, fadeShape: number): void {
  const animation = el.animate(
    curveKeyframes(fadeMaxTime, fadeShape, (fade) => ({ opacity: level * fade })),
    { duration: fadeMaxTime * 1000, fill: 'forwards' },
  )
  animation.onfinish = () => el.remove()
}

const CURRENT_GROUP = 'flowTrailCurrent'

/** The group a new box goes into: the current one, or a new one if the current one is part-way through the idle decay. */
export function trailGroup(boxes: HTMLElement): HTMLElement {
  const current = boxes.lastElementChild as HTMLElement | null
  if (current && current.dataset[CURRENT_GROUP] !== undefined) {
    if (current.style.opacity === '' || Number(current.style.opacity) >= 1) return current
    delete current.dataset[CURRENT_GROUP]
  }
  // Frozen groups whose boxes have all faded and removed themselves.
  for (const child of Array.from(boxes.children)) if (child.childElementCount === 0) child.remove()
  const group = document.createElement('div')
  group.dataset[CURRENT_GROUP] = ''
  boxes.appendChild(group)
  return group
}

/** The idle factor on every box on screen: the current group follows it, and at 0 every group is cleared. */
export function setTrailIdle(boxes: HTMLElement, factor: number): void {
  if (factor <= 0) {
    boxes.replaceChildren()
    return
  }
  const current = boxes.lastElementChild as HTMLElement | null
  if (current && current.dataset[CURRENT_GROUP] !== undefined) current.style.opacity = factor >= 1 ? '' : factor.toFixed(4)
}

/** In or out of full flow: the trail's resting saturation, on the layer holding the whole trail. */
export function setTrailFull(trail: HTMLElement, full: boolean): void {
  trail.style.setProperty('--flow-trail-saturation', String(full ? 1 : TRAIL_SATURATION_BEFORE_FULL))
}

/**
 * The peak on the trail, at `peak` strength 0..1: the boxes' layer lifts its
 * alpha and the whole trail drains of colour, both returning on the peak
 * curve. Neither animation fills, so each ends on the resting value.
 */
export function peakTrail(boxes: HTMLElement, trail: HTMLElement, peak: number, durationSec: number, shape: number): void {
  if (peak <= 0) return
  boxes.animate(
    curveKeyframes(durationSec, shape, (fade) => ({ opacity: TRAIL_ALPHA_AT_FULL_FLOW * (1 + (TRAIL_PEAK_ALPHA - 1) * peak * fade) })),
    { duration: durationSec * 1000 },
  )
  trail.animate(
    curveKeyframes(durationSec, shape, (fade) => ({
      '--flow-trail-saturation': 1 - peak * fade,
      '--flow-trail-value': 1 + (TRAIL_PEAK_VALUE - 1) * peak * fade,
    })),
    { duration: durationSec * 1000 },
  )
}
