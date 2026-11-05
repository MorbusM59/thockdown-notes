/**
 * The music's EQ preset, one of five, shown in the visualizer as the
 * Platonic solid in the cutout (a left press steps up the list, a right
 * press down, `VisualizerScene.tsx`). Unlike the flow EQ, which follows the
 * typing flow meter, a preset is applied all the time
 * (`MusicPlayerService.setPresetEq`); the flow EQ still acts on top of it.
 * Persisted as `musicEqPreset`.
 */

import { musicPlayerService } from './MusicPlayerService'

import { DEFAULT_MUSIC_EQ_PRESET, MUSIC_EQ_PRESETS, type MusicEqPreset } from '../shared/musicEqPresets'

let preset: MusicEqPreset = DEFAULT_MUSIC_EQ_PRESET
const listeners = new Set<() => void>()

export function readMusicEqPreset(): MusicEqPreset {
  return preset
}

export function setMusicEqPreset(next: MusicEqPreset): void {
  if (next === preset) return
  preset = next
  musicPlayerService.setPresetEq(next)
  for (const listener of listeners) listener()
}

/** Step `direction` places along the list, stopping at either end. */
export function stepMusicEqPreset(direction: 1 | -1): void {
  const index = MUSIC_EQ_PRESETS.indexOf(preset) + direction
  if (index >= 0 && index < MUSIC_EQ_PRESETS.length) setMusicEqPreset(MUSIC_EQ_PRESETS[index])
}

export function subscribeMusicEqPreset(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
