/**
 * The hits the visualizer's centre pulse answers: those of the layout's
 * pulse mix (`GridWave.tsx`, `subscribeMusicMix`'s `onHit`), heard by the
 * ring (`GridWave.tsx`) and the centre solid's thump (`VisualizerScene.tsx`).
 * A plain event bus between them, since neither owns the other.
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
 * the solid's thump) for a hit of `strength` (0..1, the pulse mix's response
 * at the hit) at the layout's signal `boost` (`VisualizerImmersive.pulseBoost`):
 * in full at a boost of 1, the hit's own strength at 0, and between them in
 * proportion.
 */
export function pulseAmount(strength: number, boost: number): number {
  const s = Math.max(0, Math.min(1, strength))
  return boost + (1 - boost) * s
}
