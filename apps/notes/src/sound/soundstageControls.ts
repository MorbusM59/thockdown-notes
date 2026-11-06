/**
 * The soundstage controls the visualizer's solid reaches (`VisualizerScene.tsx`):
 * App publishes which solid names the stage playing (a factory stage, or
 * `custom` for anything else, shared/soundstages.ts) and how to step through
 * the factory stages, so the scene needs no props for them.
 */
import type { FactorySoundstageId } from '../shared/soundstages'

export type SoundstageControls = {
  solid: FactorySoundstageId | 'custom'
  step: (direction: 1 | -1) => void
}

let controls: SoundstageControls = { solid: 'neutral', step: () => {} }
const listeners = new Set<() => void>()

export function publishSoundstageControls(next: SoundstageControls): void {
  controls = next
  for (const listener of listeners) listener()
}

export function readSoundstageControls(): SoundstageControls {
  return controls
}

export function subscribeSoundstageControls(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
