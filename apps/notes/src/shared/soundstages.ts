import {
  EQ_AMOUNT_MAX,
  EQ_AMOUNT_MIN,
  EQ_SHAPE_MAX,
  EQ_SHAPE_MIN,
  EQ_SKEW_MAX,
  EQ_SKEW_MIN,
  EQ_STRETCH_MAX,
  EQ_STRETCH_MIN,
  FLAT_EQ_CURVE,
  type EqCurveParams,
} from './musicEqCurve'

/**
 * SOUNDSTAGES: named sets of the music's sound (everything in Options > Music
 * but the volume, which is global). Pure, and shared with the main process's
 * state sanitizer.
 *
 * They work the way layouts do:
 * - five FACTORY stages, one per Platonic solid in the visualizer's cutout
 *   (tetrahedron, cube, octahedron, dodecahedron, icosahedron), stepped
 *   through by pressing the solid;
 * - the CUSTOM stage: whatever the reader last had that was not a factory
 *   stage. It is kept up to date from the live settings
 *   (`customAfterLiveChange`), so leaving it for a factory stage and coming
 *   back restores it exactly;
 * - SAVED stages: copies of the live settings kept under a number.
 *
 * Which stage is ACTIVE is never stored: it is derived from the live
 * settings (`matchingSoundstage`), so it cannot disagree with what is heard.
 * The one thing stored about the selection is the last factory stage, which
 * is the solid shown while a custom stage plays and the place the solid's
 * steps count from.
 */

/** `stereoWidth.ts`'s range, restated here because the main process cannot import the audio package's Web Audio module. */
const WIDTH_MIN = 0
const WIDTH_MAX = 1.5

/** One stage: every music setting but the volume. The first four are the EQ curve (`musicEqCurve.ts`). */
export interface SoundstageSettings extends EqCurveParams {
  /** 0 mono, 1 as recorded, 1.5 widest (`stereoWidth.ts`). */
  width: number
  /** The reverb's wet amount, 0..1. */
  reverb: number
  /** The room's SIZE (`room.ts`), 0..1. */
  size: number
  /** The room's FOLIAGE (`room.ts`): 0 bare and bright to 1 dense and dark. */
  room: number
}

export const SOUNDSTAGE_KEYS = ['skew', 'shape', 'stretch', 'amount', 'width', 'reverb', 'size', 'room'] as const satisfies readonly (keyof SoundstageSettings)[]

const RANGES: Record<keyof SoundstageSettings, readonly [number, number]> = {
  skew: [EQ_SKEW_MIN, EQ_SKEW_MAX],
  shape: [EQ_SHAPE_MIN, EQ_SHAPE_MAX],
  stretch: [EQ_STRETCH_MIN, EQ_STRETCH_MAX],
  amount: [EQ_AMOUNT_MIN, EQ_AMOUNT_MAX],
  width: [WIDTH_MIN, WIDTH_MAX],
  reverb: [0, 1],
  size: [0, 1],
  room: [0, 1],
}

/** The music player's defaults (`DEFAULT_MUSIC_PLAYER_CONFIG`): the neutral stage. */
export const NEUTRAL_SOUNDSTAGE: Readonly<SoundstageSettings> = { ...FLAT_EQ_CURVE, width: 1, reverb: 0, size: 0.3, room: 0 }

export const FACTORY_SOUNDSTAGE_IDS = ['muted', 'neutral', 'wide', 'amped', 'thocky'] as const
export type FactorySoundstageId = (typeof FACTORY_SOUNDSTAGE_IDS)[number]
export const DEFAULT_FACTORY_SOUNDSTAGE: FactorySoundstageId = 'neutral'

export interface FactorySoundstage {
  id: FactorySoundstageId
  name: string
  /** Font Awesome class of its button in Options > Music. */
  icon: string
  settings: Readonly<SoundstageSettings>
}

/** In the solids' order: index 0 is the tetrahedron, 4 the icosahedron. */
export const FACTORY_SOUNDSTAGES: readonly FactorySoundstage[] = [
  { id: 'muted', name: 'Muted', icon: 'fa-solid fa-cloud', settings: { skew: -1.5, shape: 1, stretch: 1.5, amount: 4, width: 1, reverb: 1, size: 0.1, room: 1 } },
  { id: 'neutral', name: 'Neutral', icon: 'fa-solid fa-scale-balanced', settings: NEUTRAL_SOUNDSTAGE },
  { id: 'wide', name: 'Wide', icon: 'fa-solid fa-arrows-left-right', settings: { skew: 2, shape: 1, stretch: 1.5, amount: 3, width: 1.5, reverb: 0.1, size: 1, room: 0 } },
  { id: 'amped', name: 'Amped', icon: 'fa-solid fa-bolt', settings: { skew: 0, shape: -1, stretch: 1, amount: 4, width: 1.2, reverb: 0.1, size: 0.8, room: 0.2 } },
  { id: 'thocky', name: 'Thocky', icon: 'fa-solid fa-keyboard', settings: { skew: 0, shape: -1.5, stretch: 1, amount: 6, width: 1.2, reverb: 0.2, size: 0, room: 1 } },
]

export function factorySoundstage(id: FactorySoundstageId): FactorySoundstage {
  return FACTORY_SOUNDSTAGES.find((stage) => stage.id === id) ?? FACTORY_SOUNDSTAGES[1]
}

export interface SavedSoundstage {
  id: string
  settings: SoundstageSettings
}

/** A stage row holds at most this many saved stages: two rows of the six-wide grid, less the save and reset buttons. */
export const MAX_SAVED_SOUNDSTAGES = 10

/** What is persisted (`musicSoundstages`); the live settings themselves are persisted as the music's own fields. */
export interface SoundstagePreferences {
  /** The last factory stage chosen: the solid shown, and where its steps count from. */
  factory: FactorySoundstageId
  /** The custom stage: the last live settings that were not a factory stage. */
  custom: SoundstageSettings
  saved: SavedSoundstage[]
}

export const DEFAULT_SOUNDSTAGE_PREFERENCES: SoundstagePreferences = {
  factory: DEFAULT_FACTORY_SOUNDSTAGE,
  custom: { ...NEUTRAL_SOUNDSTAGE },
  saved: [],
}

/**
 * Two settings are one stage when every value agrees to a thousandth: the
 * sliders step by hundredths, so this is equality without trusting float
 * arithmetic on a value that went through a slider and back.
 */
export function sameSoundstage(a: SoundstageSettings, b: SoundstageSettings): boolean {
  return SOUNDSTAGE_KEYS.every((key) => Math.abs(a[key] - b[key]) < 0.0005)
}

/** What the live settings are: a factory stage, else a saved one, else the custom stage. */
export type ActiveSoundstage =
  | { kind: 'factory'; id: FactorySoundstageId }
  | { kind: 'saved'; id: string }
  | { kind: 'custom' }

export function matchingSoundstage(live: SoundstageSettings, preferences: SoundstagePreferences): ActiveSoundstage {
  const factory = FACTORY_SOUNDSTAGES.find((stage) => sameSoundstage(stage.settings, live))
  if (factory) return { kind: 'factory', id: factory.id }
  const saved = preferences.saved.find((stage) => sameSoundstage(stage.settings, live))
  if (saved) return { kind: 'saved', id: saved.id }
  return { kind: 'custom' }
}

/**
 * The preferences after the live settings changed: anything that is not a
 * factory stage becomes the custom stage, so the custom button brings back
 * exactly what was last played outside the factory stages. Returns the same
 * object when nothing changes, so a caller can skip a state update.
 */
export function customAfterLiveChange(live: SoundstageSettings, preferences: SoundstagePreferences): SoundstagePreferences {
  if (FACTORY_SOUNDSTAGES.some((stage) => sameSoundstage(stage.settings, live))) return preferences
  if (sameSoundstage(preferences.custom, live)) return preferences
  return { ...preferences, custom: { ...live } }
}

/** The factory stage `direction` places from the last one chosen, stopping at either end. */
export function steppedFactorySoundstage(from: FactorySoundstageId, direction: 1 | -1): FactorySoundstageId {
  const index = FACTORY_SOUNDSTAGE_IDS.indexOf(from) + direction
  return FACTORY_SOUNDSTAGE_IDS[Math.max(0, Math.min(FACTORY_SOUNDSTAGE_IDS.length - 1, index))]
}

function sanitizeSettings(value: unknown, fallback: SoundstageSettings): SoundstageSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const out = { ...fallback }
  for (const key of SOUNDSTAGE_KEYS) {
    const raw = input[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = Math.max(RANGES[key][0], Math.min(RANGES[key][1], raw))
  }
  return out
}

export function sanitizeSoundstagePreferences(value: unknown): SoundstagePreferences {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const factory = (FACTORY_SOUNDSTAGE_IDS as readonly unknown[]).includes(input.factory)
    ? input.factory as FactorySoundstageId
    : DEFAULT_FACTORY_SOUNDSTAGE
  const saved: SavedSoundstage[] = []
  if (Array.isArray(input.saved)) {
    for (const entry of input.saved) {
      if (saved.length >= MAX_SAVED_SOUNDSTAGES) break
      const record = (entry && typeof entry === 'object' ? entry : null) as Record<string, unknown> | null
      if (!record || typeof record.id !== 'string' || record.id === '' || saved.some((stage) => stage.id === record.id)) continue
      saved.push({ id: record.id, settings: sanitizeSettings(record.settings, NEUTRAL_SOUNDSTAGE) })
    }
  }
  return { factory, custom: sanitizeSettings(input.custom, NEUTRAL_SOUNDSTAGE), saved }
}
