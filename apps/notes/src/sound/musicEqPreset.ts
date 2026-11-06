/**
 * The music's EQ preset, one of five, shown in the visualizer as the
 * Platonic solid in the cutout (a left press steps up the list, a right
 * press down, `VisualizerScene.tsx`): a strength of the one EQ curve, from
 * -50% (less bass and air) to +75%, applied all the time
 * (`MusicPlayerService.setEqStrength`). Persisted as `musicEqPreset`.
 *
 * The STRENGTH is its own value (the AMP slider in Options > Music,
 * persisted as `musicEqStrength`): choosing a solid sets it to that solid's
 * level, and the slider then moves it freely without changing which solid
 * is shown. Both are one store, so the solid and the slider cannot disagree
 * about what is playing.
 */

import { musicPlayerService } from './MusicPlayerService'

import { DEFAULT_MUSIC_EQ_PRESET, MUSIC_EQ_PRESETS, MUSIC_EQ_STRENGTH, type MusicEqPreset } from '../shared/musicEqPresets'

let preset: MusicEqPreset = DEFAULT_MUSIC_EQ_PRESET
let strength = MUSIC_EQ_STRENGTH[DEFAULT_MUSIC_EQ_PRESET]
const listeners = new Set<() => void>()

export function readMusicEqPreset(): MusicEqPreset {
  return preset
}

export function readMusicEqStrength(): number {
  return strength
}

/** Choose a solid: it is shown, and the strength is set to its level. */
export function setMusicEqPreset(next: MusicEqPreset): void {
  if (next === preset && strength === MUSIC_EQ_STRENGTH[next]) return
  preset = next
  applyStrength(MUSIC_EQ_STRENGTH[next])
}

/** Move the strength alone (the amp slider, or a restored session); the solid shown stays. */
export function setMusicEqStrength(next: number): void {
  if (next === strength) return
  applyStrength(next)
}

function applyStrength(next: number): void {
  strength = next
  musicPlayerService.setEqStrength(next)
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
