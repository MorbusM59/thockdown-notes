/**
 * Fades a typing flow trail box out by the meter's own per-tick decay
 * (`flowModel.ts`'s `decayed`), so a box starting at the flow level the key
 * was typed at leaves on exactly the curve the meter itself would follow.
 * That curve is not one CSS can name, so it is sampled into a Web Animations
 * keyframe list (linear between samples) and the box removes itself at the
 * end. The samples are evenly spaced in time over `secondsToEmpty`.
 */

import { decayed, secondsToEmpty } from './flowModel'

const SAMPLES = 12

export function flowTrailFade(el: HTMLElement, opacity: number, decayPercent: number): void {
  const durationSec = secondsToEmpty(opacity, decayPercent)
  const keyframes: Keyframe[] = []
  for (let i = 0; i <= SAMPLES; i += 1) {
    const t = (durationSec * i) / SAMPLES
    keyframes.push({ opacity: decayed(opacity, t, decayPercent), offset: i / SAMPLES })
  }
  const animation = el.animate(keyframes, { duration: durationSec * 1000, fill: 'forwards' })
  animation.onfinish = () => el.remove()
}
