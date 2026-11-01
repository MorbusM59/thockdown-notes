/**
 * The hits the visualizer's centre pulse answers: those of the EDGE block's
 * band (`useBeatFeedback`, `subscribeMusicBand`'s `onHit`), so the pulse and
 * the edge follow one detection and the reader tunes it in one place.
 * A plain event bus between the two, since neither owns the other.
 */

type HitListener = (strength: number) => void

const listeners = new Set<HitListener>()

export function emitPulseHit(strength: number): void {
  for (const listener of listeners) listener(strength)
}

export function subscribePulseHits(listener: HitListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * How much of its full size a centre pulse is drawn at (the ring's opacity,
 * the solid's thump) for a hit of `strength` (0..1, the edge's response at
 * the hit) at the layout's signal `boost` (`VisualizerImmersive.pulseBoost`):
 * in full at a boost of 1, the hit's own strength at 0, and between them in
 * proportion.
 */
export function pulseAmount(strength: number, boost: number): number {
  const s = Math.max(0, Math.min(1, strength))
  return boost + (1 - boost) * s
}
