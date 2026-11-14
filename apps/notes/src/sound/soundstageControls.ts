/**
 * The soundstage controls the visualizer's solid reaches (`VisualizerScene.tsx`):
 * App publishes which solid names the stage playing (a factory stage, or
 * `custom` for anything else, shared/soundstages.ts), how to step through
 * the factory stages and how to play one directly (the music bar's stage
 * row, `AudioControls.tsx`), so neither needs props for them.
 */
import { FACTORY_SOUNDSTAGES, type FactorySoundstage, type FactorySoundstageId } from '../shared/soundstages'

export type SoundstageControls = {
  solid: FactorySoundstageId | 'custom'
  /** The factory stages as the reader left them (names and icons edited). */
  factory: readonly FactorySoundstage[]
  step: (direction: 1 | -1) => void
  /** Play a factory stage, or the custom stage. */
  select: (stage: FactorySoundstageId | 'custom') => void
}

let controls: SoundstageControls = { solid: 'neutral', factory: FACTORY_SOUNDSTAGES, step: () => {}, select: () => {} }
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
