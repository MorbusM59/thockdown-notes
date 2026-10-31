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
