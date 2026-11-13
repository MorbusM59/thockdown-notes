import { DARK_PRESET_ICONS, DARK_PRESET_THEMES, LIGHT_PRESET_ICONS, LIGHT_PRESET_THEMES } from '@thockdown/look/presets'

/**
 * KEYSTROKE SOUNDS: named sets of how typing sounds (Options > Glitz >
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
 * settings themselves are persisted as the menu's `keystrokeSound`.
 */

/**
 * The CHANNELS: every sound source a keystroke can be made of. The four
 * click sets each hold ten samples (one per key, fixed per key); bass and
 * treble are one sample each. A keystroke plays every channel that is on,
 * each at its own volume and with its own pitch jitter, and the sum goes
 * through the global settings below.
 */
export const KEYSTROKE_CHANNEL_IDS = ['pops', 'pins', 'creamy', 'forge', 'bass', 'treble'] as const
export type KeystrokeChannelId = (typeof KEYSTROKE_CHANNEL_IDS)[number]

export const KEYSTROKE_CHANNEL_LOOK: Record<KeystrokeChannelId, { name: string; icon: string }> = {
  pops: { name: 'Pops', icon: 'fa-solid fa-burst' },
  pins: { name: 'Pins', icon: 'fa-solid fa-map-pin' },
  creamy: { name: 'Creamy', icon: 'fa-solid fa-ice-cream' },
  forge: { name: 'Forge', icon: 'fa-solid fa-hammer' },
  bass: { name: 'Bass', icon: 'fa-solid fa-drum' },
  treble: { name: 'Treble', icon: 'fa-solid fa-bell' },
}

export interface KeystrokeChannelSettings {
  on: boolean
  /** 0..1. */
  volume: number
  /** 0..0.5: the largest share by which each press of this channel is pitched up or down at random. */
  jitter: number
  /** -100..100: this channel's own pitch, on the same scale as the mix's (100 is an octave up). */
  pitch: number
}

export interface KeystrokeSoundSettings {
  channels: Record<KeystrokeChannelId, KeystrokeChannelSettings>
  /** 0..1, the sum of the channels. */
  volume: number
  /** -100..100, every channel. */
  pitch: number
  /** 0..0.5: how far each key's pitch is set apart from the others, fixed per key. */
  variance: number
  reverb: number
  room: number
  /** -100..100: left of centre pans by the key's place on the keyboard, right of centre by the caret's place on the line. */
  spatial: number
}

export const KEYSTROKE_GLOBAL_KEYS = ['volume', 'pitch', 'variance', 'reverb', 'room', 'spatial'] as const satisfies readonly (keyof KeystrokeSoundSettings)[]
export const KEYSTROKE_CHANNEL_NUMBER_KEYS = ['volume', 'jitter', 'pitch'] as const satisfies readonly (keyof KeystrokeChannelSettings)[]

/** The sliders' ranges in Options. */
export const KEYSTROKE_SOUND_RANGES = {
  volume: [0, 1],
  pitch: [-100, 100],
  variance: [0, 0.5],
  reverb: [0, 1],
  room: [0, 1],
  spatial: [-100, 100],
} as const satisfies Record<(typeof KEYSTROKE_GLOBAL_KEYS)[number], readonly [number, number]>
export const KEYSTROKE_CHANNEL_RANGES = {
  volume: [0, 1],
  jitter: [0, 0.5],
  pitch: [-100, 100],
} as const satisfies Record<(typeof KEYSTROKE_CHANNEL_NUMBER_KEYS)[number], readonly [number, number]>

export const DEFAULT_KEYSTROKE_CHANNEL: Readonly<KeystrokeChannelSettings> = { on: false, volume: 0.5, jitter: 0, pitch: 0 }

type ChannelOverrides = Partial<Record<KeystrokeChannelId, Partial<KeystrokeChannelSettings>>>
const preset = (channels: ChannelOverrides, globals: Partial<Omit<KeystrokeSoundSettings, 'channels'>> = {}): KeystrokeSoundSettings => ({
  volume: 1,
  pitch: 0,
  variance: 0,
  reverb: 0,
  room: 0,
  spatial: -50,
  ...globals,
  channels: Object.fromEntries(KEYSTROKE_CHANNEL_IDS.map((id) => [id, { ...DEFAULT_KEYSTROKE_CHANNEL, ...(channels[id] ? { on: true, ...channels[id] } : {}) }])) as Record<KeystrokeChannelId, KeystrokeChannelSettings>,
})

export interface FactoryKeystrokeSound {
  id: string
  name: string
  icon: string
  settings: Readonly<KeystrokeSoundSettings>
}

/**
 * In the factory layouts' order, light then dark, under their names and
 * icons: the sounds those layouts carried while sounds were part of a layout,
 * the one sound set as its channel and the bass and treble layers as theirs,
 * each with what was then the one jitter.
 */
const FACTORY_SETTINGS: readonly KeystrokeSoundSettings[] = [
  preset({ creamy: { jitter: 0.05 }, bass: { volume: 0.2, jitter: 0.05 } }, { variance: 0.05 }),
  preset({ bass: { volume: 0.33, jitter: 0.05 }, treble: { volume: 0.13, jitter: 0.05 } }, { variance: 0.3, pitch: -50, reverb: 0.25, room: 0.8 }),
  preset({ pops: { volume: 0.2 }, treble: { volume: 0.22 } }, { reverb: 0.13, room: 0.85 }),
  preset({ pops: {}, bass: { volume: 0.07 }, treble: { volume: 0.09 } }),
  preset({ creamy: {}, bass: { volume: 0.2 } }, { reverb: 0.11, room: 1 }),
  preset({ bass: { volume: 0.2, jitter: 0.05 }, treble: { volume: 0.2, jitter: 0.05 } }, { variance: 0.05, pitch: 20, reverb: 0.1 }),
  preset({ pins: {} }),
  preset({ creamy: {}, bass: { volume: 0.07 } }, { reverb: 0.29 }),
  preset({ pops: { volume: 0.15 }, bass: { volume: 0.32 }, treble: { volume: 0.03 } }, { reverb: 0.14 }),
  preset({ pins: { volume: 0.52 }, bass: { volume: 0.17 }, treble: { volume: 0.29 } }, { reverb: 0.13 }),
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

export function cloneKeystrokeSound(settings: KeystrokeSoundSettings): KeystrokeSoundSettings {
  return { ...settings, channels: Object.fromEntries(KEYSTROKE_CHANNEL_IDS.map((id) => [id, { ...settings.channels[id] }])) as Record<KeystrokeChannelId, KeystrokeChannelSettings> }
}

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

export const DEFAULT_KEYSTROKE_SOUND_PREFERENCES: KeystrokeSoundPreferences = { unsaved: cloneKeystrokeSound(DEFAULT_KEYSTROKE_SOUND), saved: [] }

const close = (x: number, y: number) => Math.abs(x - y) < 0.0005

/** Equal to a thousandth: the sliders step by hundredths at the finest. */
export function sameKeystrokeSound(a: KeystrokeSoundSettings, b: KeystrokeSoundSettings): boolean {
  return KEYSTROKE_GLOBAL_KEYS.every((key) => close(a[key], b[key]))
    && KEYSTROKE_CHANNEL_IDS.every((id) => a.channels[id].on === b.channels[id].on && KEYSTROKE_CHANNEL_NUMBER_KEYS.every((key) => close(a.channels[id][key], b.channels[id][key])))
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
  return { ...preferences, unsaved: cloneKeystrokeSound(live) }
}

const clampTo = (raw: unknown, [low, high]: readonly [number, number], fallback: number) => (typeof raw === 'number' && Number.isFinite(raw) ? Math.max(low, Math.min(high, raw)) : fallback)

export function sanitizeKeystrokeSoundSettings(value: unknown, fallback: KeystrokeSoundSettings = DEFAULT_KEYSTROKE_SOUND): KeystrokeSoundSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const out = cloneKeystrokeSound(fallback)
  for (const key of KEYSTROKE_GLOBAL_KEYS) out[key] = clampTo(input[key], KEYSTROKE_SOUND_RANGES[key], out[key])
  const channels = (input.channels && typeof input.channels === 'object' ? input.channels : {}) as Record<string, unknown>
  for (const id of KEYSTROKE_CHANNEL_IDS) {
    const channel = (channels[id] && typeof channels[id] === 'object' ? channels[id] : {}) as Record<string, unknown>
    if (typeof channel.on === 'boolean') out.channels[id].on = channel.on
    for (const key of KEYSTROKE_CHANNEL_NUMBER_KEYS) out.channels[id][key] = clampTo(channel[key], KEYSTROKE_CHANNEL_RANGES[key], out.channels[id][key])
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
