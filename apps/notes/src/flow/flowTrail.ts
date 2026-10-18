/**
 * The typing flow trail's alpha and saturation.
 *
 * A box's alpha is the product of three factors, applied in this order:
 *
 * 1. The flow colour's own alpha (the `flowTrail` highlight colour, the
 *    reader's flowBaseColor), which the box's border is drawn in.
 * 2. The flow level f at the box's creation times the trail strength (the
 *    flow options' trail slider), scaled to 0 at no flow and
 *    `TRAIL_ALPHA_AT_FULL_FLOW` at full flow, and on a new row by
 *    `lineRampShare` so the trail fades back in after a wrap.
 * 3. The fade since creation, `fadeCurve(t, fadeMaxTime, fadeShape)`.
 *
 * Factors 2 and 3 belong to each box (its own opacity, set once and
 * animated); `TRAIL_ALPHA_AT_FULL_FLOW` applies to every box at once, so it
 * is the opacity of the layer holding the boxes.
 *
 * A fourth factor, the IDLE decay (`flowModel.ts`'s `idleFactor`), applies
 * to every box on screen once typing has stopped for the grace period. Boxes
 * sit in GROUPS inside the layer (`trailGroup`): the current group's opacity
 * follows the idle factor (`setTrailIdle`), and a keystroke that arrives
 * while that factor is below 1 leaves the group frozen at the value it had
 * reached and starts a new one. Without the freeze, resuming typing would
 * restore every half-faded box to full strength.
 *
 * A box's saturation is the flow level at its creation (0..1, without the
 * trail strength), as a share of the flow colour's HSL saturation
 * (`--flow-trail-saturation`, set on the box, index.css): grey at no flow,
 * the full colour at full flow, and kept as the box fades.
 */

export const TRAIL_ALPHA_AT_FULL_FLOW = 0.7

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

