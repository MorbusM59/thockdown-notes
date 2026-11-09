import { DARK_PRESET_ICONS, DARK_PRESET_THEMES, LIGHT_PRESET_ICONS, LIGHT_PRESET_THEMES } from '@thockdown/look/presets'

/**
 * KEYSTROKE SOUNDS: named sets of how typing sounds (Options > Modules >
 * Keystroke Sounds). Pure, and shared with the main process's state
 * sanitizer. App-wide, never part of a layout.
 *
 * They work the way soundstages do (one flat Presets list, see
 * `soundstages.ts`): ten FACTORY presets, one per factory layout and named
 * after it (the sounds those layouts carried while sounds were part of a
 * layout); SAVED presets, copies of the live settings kept under a number;
 * and the UNSAVED preset, the reader's last edit, shown as the plus exactly
 * while it equals no other preset. Which preset is active is never stored:
 * it is derived from the live settings (`matchingKeystrokeSound`). The live
 * settings themselves are persisted as the menu's own fields
 * (`audioKeyVolume`, `typingSoundSet`, ...).
 */

export type KeystrokeSoundSetId = 'A' | 'B' | 'C' | 'D'
export const KEYSTROKE_SOUND_SET_IDS: readonly KeystrokeSoundSetId[] = ['A', 'B', 'C', 'D']

export interface KeystrokeSoundSettings {
  /** Off is the "No Key Sounds" button; the set is kept so turning back on restores it. */
  enabled: boolean
  set: KeystrokeSoundSetId
  volume: number
  variance: number
  pitch: number
  jitter: number
  bass: number
  treble: number
  reverb: number
  room: number
  spatial: number
}

export const KEYSTROKE_SOUND_NUMBER_KEYS = ['volume', 'variance', 'pitch', 'jitter', 'bass', 'treble', 'reverb', 'room', 'spatial'] as const satisfies readonly (keyof KeystrokeSoundSettings)[]

/** The sliders' ranges in Options. */
export const KEYSTROKE_SOUND_RANGES: Record<(typeof KEYSTROKE_SOUND_NUMBER_KEYS)[number], readonly [number, number]> = {
  volume: [0, 1],
  variance: [0, 0.5],
  pitch: [-100, 100],
  jitter: [0, 0.5],
  bass: [0, 1],
  treble: [0, 1],
  reverb: [0, 1],
  room: [0, 1],
  spatial: [-100, 100],
}

const BASE: KeystrokeSoundSettings = { enabled: true, set: 'A', volume: 0.5, variance: 0, pitch: 0, jitter: 0, bass: 0, treble: 0, reverb: 0, room: 0, spatial: -50 }
const preset = (overrides: Partial<KeystrokeSoundSettings>): KeystrokeSoundSettings => ({ ...BASE, ...overrides })

export interface FactoryKeystrokeSound {
  id: string
  name: string
  icon: string
  settings: Readonly<KeystrokeSoundSettings>
}

/** In the factory layouts' order, light then dark, under their names and icons. */
const FACTORY_SETTINGS: readonly KeystrokeSoundSettings[] = [
  preset({ set: 'C', variance: 0.05, jitter: 0.05, bass: 0.2 }),
  preset({ volume: 0, variance: 0.3, pitch: -50, jitter: 0.05, bass: 0.33, treble: 0.13, reverb: 0.25, room: 0.8 }),
  preset({ volume: 0.2, treble: 0.22, reverb: 0.13, room: 0.85 }),
  preset({ bass: 0.07, treble: 0.09 }),
  preset({ set: 'C', bass: 0.2, reverb: 0.11, room: 1 }),
  preset({ set: 'C', volume: 0, variance: 0.05, pitch: 20, jitter: 0.05, bass: 0.2, treble: 0.2, reverb: 0.1 }),
  preset({ set: 'B', volume: 0.5 }),
  preset({ set: 'C', volume: 0.5, bass: 0.07, reverb: 0.29 }),
  preset({ volume: 0.15, bass: 0.32, treble: 0.03, reverb: 0.14 }),
  preset({ set: 'B', volume: 0.52, bass: 0.17, treble: 0.29, reverb: 0.13 }),
]
const FACTORY_NAMES = [...LIGHT_PRESET_THEMES, ...DARK_PRESET_THEMES].map((name) => name.replace(/ \(Default\)$/, ''))
const FACTORY_ICONS = [...LIGHT_PRESET_ICONS, ...DARK_PRESET_ICONS]

export const FACTORY_KEYSTROKE_SOUNDS: readonly FactoryKeystrokeSound[] = FACTORY_SETTINGS.map((settings, index) => ({
  id: FACTORY_NAMES[index].toLowerCase(),
  name: FACTORY_NAMES[index],
  icon: FACTORY_ICONS[index],
  settings,
}))

/** A fresh install sounds like the default light layout did. */
export const DEFAULT_KEYSTROKE_SOUND: Readonly<KeystrokeSoundSettings> = FACTORY_SETTINGS[0]

export interface SavedKeystrokeSound {
  id: string
  settings: KeystrokeSoundSettings
}

/** Not a design limit, only a bound on a list nobody should reach. */
export const MAX_SAVED_KEYSTROKE_SOUNDS = 100

/** What is persisted (`keystrokeSoundPresets`). */
export interface KeystrokeSoundPreferences {
  unsaved: KeystrokeSoundSettings
  saved: SavedKeystrokeSound[]
}

export const DEFAULT_KEYSTROKE_SOUND_PREFERENCES: KeystrokeSoundPreferences = { unsaved: { ...DEFAULT_KEYSTROKE_SOUND }, saved: [] }

/** Equal to a thousandth: the sliders step by hundredths at the finest. */
export function sameKeystrokeSound(a: KeystrokeSoundSettings, b: KeystrokeSoundSettings): boolean {
  return a.enabled === b.enabled && a.set === b.set && KEYSTROKE_SOUND_NUMBER_KEYS.every((key) => Math.abs(a[key] - b[key]) < 0.0005)
}

export type ActiveKeystrokeSound =
  | { kind: 'factory'; id: string }
  | { kind: 'saved'; id: string }
  | { kind: 'unsaved' }

export function matchingKeystrokeSound(live: KeystrokeSoundSettings, preferences: KeystrokeSoundPreferences): ActiveKeystrokeSound {
  const factory = FACTORY_KEYSTROKE_SOUNDS.find((entry) => sameKeystrokeSound(entry.settings, live))
  if (factory) return { kind: 'factory', id: factory.id }
  const saved = preferences.saved.find((entry) => sameKeystrokeSound(entry.settings, live))
  if (saved) return { kind: 'saved', id: saved.id }
  return { kind: 'unsaved' }
}

export function isUnsavedKeystrokeSoundShown(preferences: KeystrokeSoundPreferences): boolean {
  return matchingKeystrokeSound(preferences.unsaved, preferences).kind === 'unsaved'
}

/** After an EDIT of the live settings (never a selection), the edit is the unsaved preset. Same object when nothing changes. */
export function unsavedKeystrokeSoundAfterEdit(live: KeystrokeSoundSettings, preferences: KeystrokeSoundPreferences): KeystrokeSoundPreferences {
  if (sameKeystrokeSound(preferences.unsaved, live)) return preferences
  return { ...preferences, unsaved: { ...live } }
}

export function sanitizeKeystrokeSoundSettings(value: unknown, fallback: KeystrokeSoundSettings = DEFAULT_KEYSTROKE_SOUND): KeystrokeSoundSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const out: KeystrokeSoundSettings = { ...fallback }
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled
  if ((KEYSTROKE_SOUND_SET_IDS as readonly unknown[]).includes(input.set)) out.set = input.set as KeystrokeSoundSetId
  for (const key of KEYSTROKE_SOUND_NUMBER_KEYS) {
    const raw = input[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = Math.max(KEYSTROKE_SOUND_RANGES[key][0], Math.min(KEYSTROKE_SOUND_RANGES[key][1], raw))
  }
  return out
}

export function sanitizeKeystrokeSoundPreferences(value: unknown): KeystrokeSoundPreferences {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const saved: SavedKeystrokeSound[] = []
  if (Array.isArray(input.saved)) {
    for (const entry of input.saved) {
      if (saved.length >= MAX_SAVED_KEYSTROKE_SOUNDS) break
      const record = (entry && typeof entry === 'object' ? entry : null) as Record<string, unknown> | null
      if (!record || typeof record.id !== 'string' || record.id === '' || saved.some((item) => item.id === record.id)) continue
      saved.push({ id: record.id, settings: sanitizeKeystrokeSoundSettings(record.settings) })
    }
  }
  return { unsaved: sanitizeKeystrokeSoundSettings(input.unsaved), saved }
}
