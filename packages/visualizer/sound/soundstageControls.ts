/**
 * The soundstage controls the visualizer's solid reaches (`VisualizerScene.tsx`):
 * App publishes which solid names the stage playing (a factory stage, or
 * `custom` for anything else, shared/soundstages.ts), how to step through
 * the stages and how to play one directly (the music bar's stage
 * row, `AudioControls.tsx`), so neither needs props for them.
 */
import { createPreset, newPresetId, presetsOf, selectPreset, type Preset } from '@thockdown/interaction/presetList'
import {
  FACTORY_SOUNDSTAGE_IDS,
  FACTORY_SOUNDSTAGES,
  isFactorySoundstageId,
  SOUNDSTAGE_KIND,
  steppedFactorySoundstage,
  withActiveSoundstage,
  type FactorySoundstageId,
  type SoundstagePreferences,
  type SoundstageSettings,
} from '../shared/soundstages'

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

/** `previous` with the stage `id` playing. */
function selected(previous: SoundstagePreferences, id: string): SoundstagePreferences {
  return withActiveSoundstage(previous, selectPreset(SOUNDSTAGE_KIND, previous, id))
}

/**
 * What a press on the visualizer's solid leaves the stages as: a left press
 * (`1`) steps to the next factory stage, a right press (`-1`) back, stopping
 * at either end. The custom stage sits after the last factory stage: forward
 * from that stage goes to it (the reader's own stage chosen last, else their
 * first, else a new copy of the one playing), and back from it returns to the
 * last factory stage chosen. Both apps step through this one rule.
 */
export function steppedSoundstagePreferences(previous: SoundstagePreferences, direction: 1 | -1): SoundstagePreferences {
  const active = previous.activeId
  if (!isFactorySoundstageId(active)) return direction === -1 ? selected(previous, previous.factory) : previous
  if (direction === 1 && active === FACTORY_SOUNDSTAGE_IDS[FACTORY_SOUNDSTAGE_IDS.length - 1]) {
    const id = previous.lastCustom ?? previous.custom[0]?.id
    if (id) return selected(previous, id)
    const created = createPreset(SOUNDSTAGE_KIND, previous, newPresetId('stage'))
    return created ? withActiveSoundstage(previous, created) : previous
  }
  return selected(previous, steppedFactorySoundstage(active, direction))
}

/**
 * The controls an app publishes for `preferences`; `change` applies an
 * update to the app's current stages (the desktop's `changeSoundstages`, the
 * phone's state setter), so a press never acts on a stale copy.
 */
export function soundstageControlsFor(
  preferences: SoundstagePreferences,
  change: (update: (previous: SoundstagePreferences) => SoundstagePreferences) => void,
): SoundstageControls {
  return {
    solid: isFactorySoundstageId(preferences.activeId) ? preferences.activeId : 'custom',
    presets: presetsOf(SOUNDSTAGE_KIND, { custom: preferences.custom, factoryEdits: preferences.factoryEdits }),
    activeId: preferences.activeId,
    step: (direction) => change((previous) => steppedSoundstagePreferences(previous, direction)),
    select: (id) => change((previous) => selected(previous, id)),
  }
}
