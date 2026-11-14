/**
 * The soundstage controls the visualizer's solid reaches (`VisualizerScene.tsx`):
 * App publishes which solid names the stage playing (a factory stage, or
 * `custom` for anything else, shared/soundstages.ts), how to step through
 * the stages and how to play one directly (the music bar's stage
 * row, `AudioControls.tsx`), so neither needs props for them.
 */
import type { Preset } from '@thockdown/interaction/presetList'
import { FACTORY_SOUNDSTAGES, type FactorySoundstageId, type SoundstageSettings } from '../shared/soundstages'

export type SoundstageControls = {
  solid: FactorySoundstageId | 'custom'
  /** Every stage in list order (the factory ones as the reader left them, then their own). */
  presets: readonly Preset<SoundstageSettings>[]
  activeId: string
  step: (direction: 1 | -1) => void
  /** Play a stage by its id. */
  select: (id: string) => void
}

let controls: SoundstageControls = { solid: 'neutral', presets: FACTORY_SOUNDSTAGES, activeId: 'neutral', step: () => {}, select: () => {} }
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
