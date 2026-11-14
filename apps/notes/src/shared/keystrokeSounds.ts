import { emptyPresetList, sanitizePresetList, type Preset, type PresetKind, type PresetList } from '@thockdown/interaction/presetList'

/**
 * KEYSTROKE SOUNDS: named sets of how typing sounds (Options > Glitz >
 * Keystroke Sounds). Pure, and shared with the main process's state
 * sanitizer. App-wide, never part of a layout.
 *
 * They are a PRESET LIST (`packages/interaction/presetList.ts`), as
 * soundstages are: six FACTORY presets, then the reader's own. One is always active and the live
 * settings ARE its settings: an edit is written into it. Persisted as the
 * menu's `keystrokeSoundPresets`.
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

/** Every channel off, the mix neutral. Also what the dock's reset writes into the active preset. */
export const NEUTRAL_KEYSTROKE_SOUND: Readonly<KeystrokeSoundSettings> = preset({})

const VANILLA = preset({ creamy: { jitter: 0.05 }, bass: { volume: 0.2, jitter: 0.05 } }, { variance: 0.05 })

/** The factory presets, in the order the grid shows them. */
export const FACTORY_KEYSTROKE_SOUNDS: readonly Preset<KeystrokeSoundSettings>[] = [
  { id: 'vanilla', name: 'Vanilla', icon: 'fa-ice-cream', settings: VANILLA },
  { id: 'footsteps', name: 'Footsteps', icon: 'fa-shoe-prints', settings: preset({ bass: { volume: 0.2, jitter: 0.05, pitch: -100 }, treble: { volume: 0.2, jitter: 0.05, pitch: 100 } }, { variance: 0.2, pitch: 20, reverb: 0.1 }) },
  { id: 'vestiges', name: 'Vestiges', icon: 'fa-archway', settings: preset({ creamy: {}, bass: { volume: 0.07 } }, { reverb: 0.29 }) },
  { id: 'bubblegum', name: 'Bubblegum', icon: 'fa-burst', settings: preset({ pops: { volume: 0.15, jitter: 0.1 }, creamy: { volume: 0.15, jitter: 0.3, pitch: -100 }, bass: { volume: 0.3 }, treble: { volume: 0.05, jitter: 0.1, pitch: 100 } }, { reverb: 0.14 }) },
  { id: 'needles', name: 'Needles', icon: 'fa-map-pin', settings: preset({ pins: { volume: 0.52 }, bass: { volume: 0.17 }, treble: { volume: 0.29 } }, { reverb: 0.13 }) },
]

/** A fresh install plays Vanilla. */
export const DEFAULT_KEYSTROKE_SOUND: Readonly<KeystrokeSoundSettings> = VANILLA

export function cloneKeystrokeSound(settings: KeystrokeSoundSettings): KeystrokeSoundSettings {
  return { ...settings, channels: Object.fromEntries(KEYSTROKE_CHANNEL_IDS.map((id) => [id, { ...settings.channels[id] }])) as Record<KeystrokeChannelId, KeystrokeChannelSettings> }
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

export const KEYSTROKE_SOUND_KIND: PresetKind<KeystrokeSoundSettings> = {
  factory: FACTORY_KEYSTROKE_SOUNDS,
  defaultId: 'vanilla',
  noun: 'Keystroke Sound',
  maxCustom: 100,
  clone: cloneKeystrokeSound,
  sanitizeSettings: (value) => sanitizeKeystrokeSoundSettings(value),
}

export type KeystrokeSoundPreferences = PresetList<KeystrokeSoundSettings>

export const DEFAULT_KEYSTROKE_SOUND_PREFERENCES: KeystrokeSoundPreferences = emptyPresetList(KEYSTROKE_SOUND_KIND)

const close = (x: number, y: number) => Math.abs(x - y) < 0.0005

/** Equal to a thousandth: the sliders step by hundredths at the finest. */
export function sameKeystrokeSound(a: KeystrokeSoundSettings, b: KeystrokeSoundSettings): boolean {
  return KEYSTROKE_GLOBAL_KEYS.every((key) => close(a[key], b[key]))
    && KEYSTROKE_CHANNEL_IDS.every((id) => a.channels[id].on === b.channels[id].on && KEYSTROKE_CHANNEL_NUMBER_KEYS.every((key) => close(a.channels[id][key], b.channels[id][key])))
}

export function sanitizeKeystrokeSoundPreferences(value: unknown): KeystrokeSoundPreferences {
  return sanitizePresetList(KEYSTROKE_SOUND_KIND, value)
}
