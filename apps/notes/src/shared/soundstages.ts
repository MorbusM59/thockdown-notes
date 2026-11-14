import { FLAT_EQ_CURVE, sameEqCurve, sanitizeEqCurve, type EqPoint } from './musicEqCurve'
import {
  activePreset,
  emptyPresetList,
  isFactoryPreset,
  sanitizePresetList,
  type Preset,
  type PresetKind,
  type PresetList,
} from '@thockdown/interaction/presetList'

/**
 * SOUNDSTAGES: named sets of the music's sound (everything in Options >
 * Soundstages but the volume, which is global). Pure, and shared with the
 * main process's state sanitizer.
 *
 * A PRESET LIST (`@thockdown/interaction/presetList`): five FACTORY stages,
 * one per Platonic solid in the visualizer's cutout (tetrahedron, cube,
 * octahedron, dodecahedron, icosahedron), stepped through by pressing the
 * solid, then the reader's own. One is always ACTIVE and the live settings
 * are its settings: an edit is written into it (a factory stage keeps its
 * edits until restored), and a new stage is a copy of the active one.
 *
 * The visualizer's solid and the music bar call any stage of the reader's
 * own "custom"; their custom button plays the last one chosen
 * (`lastCustom`). The solid shown for it is the stella octangula, and its
 * steps back count from the last factory stage chosen (`factory`).
 */

/** `stereoWidth.ts`'s range, restated here because the main process cannot import the audio package's Web Audio module. */
const WIDTH_MIN = 0
const WIDTH_MAX = 1.5

/** One stage: every music setting but the volume. */
export interface SoundstageSettings {
  /** The EQ curve's points (`musicEqCurve.ts`). */
  eq: EqPoint[]
  /** 0 mono, 1 as recorded, 1.5 widest (`stereoWidth.ts`). */
  width: number
  /** The reverb's wet amount, 0..1. */
  reverb: number
  /** The room's SIZE (`room.ts`), 0..1. */
  size: number
  /** The room's FOLIAGE (`room.ts`): 0 bare and bright to 1 dense and dark. */
  room: number
}

/** The settings that are one number each; the EQ curve is compared and sanitized on its own. */
export const SOUNDSTAGE_KEYS = ['width', 'reverb', 'size', 'room'] as const satisfies readonly (keyof SoundstageSettings)[]

const RANGES: Record<(typeof SOUNDSTAGE_KEYS)[number], readonly [number, number]> = {
  width: [WIDTH_MIN, WIDTH_MAX],
  reverb: [0, 1],
  size: [0, 1],
  room: [0, 1],
}

/** The music player's defaults (`DEFAULT_MUSIC_PLAYER_CONFIG`): the neutral stage. */
export const NEUTRAL_SOUNDSTAGE: Readonly<SoundstageSettings> = { eq: FLAT_EQ_CURVE.map((point) => ({ ...point })), width: 1, reverb: 0, size: 0.3, room: 0 }

export const FACTORY_SOUNDSTAGE_IDS = ['muted', 'neutral', 'wide', 'amped', 'thocky'] as const
export type FactorySoundstageId = (typeof FACTORY_SOUNDSTAGE_IDS)[number]
export const DEFAULT_FACTORY_SOUNDSTAGE: FactorySoundstageId = 'neutral'

/** The music bar's button for the custom stage (the last of the reader's own chosen). */
export const CUSTOM_SOUNDSTAGE_ICON = 'fa-solid fa-marker'

export type FactorySoundstage = Preset<SoundstageSettings> & { id: FactorySoundstageId }

/** In the solids' order: index 0 is the tetrahedron, 4 the icosahedron. Icons without their style class. */
export const FACTORY_SOUNDSTAGES: readonly FactorySoundstage[] = [
  { id: 'muted', name: 'Muted', icon: 'fa-cube', settings: { eq: [{ hz: 20, db: 5, handle: 2 }, { hz: 71, db: 8, handle: 2 }, { hz: 905, db: -6, handle: 2 }, { hz: 20000, db: -7, handle: 0 }], width: 1, reverb: 1, size: 0.3, room: 0.8 } },
  { id: 'neutral', name: 'Neutral', icon: 'fa-box-open', settings: NEUTRAL_SOUNDSTAGE },
  { id: 'wide', name: 'Wide', icon: 'fa-wifi', settings: { eq: [{ hz: 20, db: 0, handle: 0 }, { hz: 167, db: -3, handle: 1 }, { hz: 5000, db: 3, handle: 2 }, { hz: 20000, db: 1, handle: 2 }], width: 1.5, reverb: 0.1, size: 1, room: 0 } },
  { id: 'amped', name: 'Amped', icon: 'fa-plug', settings: { eq: [{ hz: 20, db: 1.5, handle: 0 }, { hz: 60, db: 4, handle: 1.6 }, { hz: 700, db: -4, handle: 1 }, { hz: 5120, db: 3, handle: 1 }, { hz: 20000, db: 1.5, handle: 2 }], width: 1.2, reverb: 0.1, size: 0.8, room: 0.2 } },
  { id: 'thocky', name: 'Thocky', icon: 'fa-burst', settings: { eq: [{ hz: 20, db: 7, handle: 2 }, { hz: 63, db: 10, handle: 1.7 }, { hz: 320, db: -6, handle: 1.35 }, { hz: 5120, db: 4, handle: 1 }, { hz: 20000, db: 1, handle: 0 }], width: 1.4, reverb: 0.15, size: 0.3, room: 0.4 } },
]

export function cloneSoundstage(settings: SoundstageSettings): SoundstageSettings {
  return { ...settings, eq: settings.eq.map((point) => ({ ...point })) }
}

export const SOUNDSTAGE_KIND: PresetKind<SoundstageSettings> = {
  factory: FACTORY_SOUNDSTAGES,
  defaultId: DEFAULT_FACTORY_SOUNDSTAGE,
  noun: 'Soundstage',
  maxCustom: 100,
  clone: cloneSoundstage,
  sanitizeSettings: (value) => sanitizeSettings(value, NEUTRAL_SOUNDSTAGE),
}

export function isFactorySoundstageId(id: string): id is FactorySoundstageId {
  return isFactoryPreset(SOUNDSTAGE_KIND, id)
}

/** What is persisted (`musicSoundstages`); the live settings themselves are persisted as the music's own fields. */
export interface SoundstagePreferences extends PresetList<SoundstageSettings> {
  /** The last factory stage chosen: where the solid's steps back from custom go. */
  factory: FactorySoundstageId
  /** The last of the reader's own stages chosen: what the custom button plays. */
  lastCustom: string | null
}

export const DEFAULT_SOUNDSTAGE_PREFERENCES: SoundstagePreferences = {
  ...emptyPresetList(SOUNDSTAGE_KIND),
  factory: DEFAULT_FACTORY_SOUNDSTAGE,
  lastCustom: null,
}

export function activeSoundstage(preferences: SoundstagePreferences): Preset<SoundstageSettings> {
  return activePreset(SOUNDSTAGE_KIND, preferences)
}

/** The preferences with `activeId` changed, `factory` and `lastCustom` following it. */
export function withActiveSoundstage(preferences: SoundstagePreferences, list: PresetList<SoundstageSettings>): SoundstagePreferences {
  const next = { ...preferences, ...list }
  if (isFactorySoundstageId(next.activeId)) next.factory = next.activeId
  else next.lastCustom = next.activeId
  if (next.lastCustom !== null && !next.custom.some((stage) => stage.id === next.lastCustom)) next.lastCustom = null
  return next
}

/**
 * Two settings are one stage when every value agrees to a thousandth: the
 * sliders step by hundredths, so this is equality without trusting float
 * arithmetic on a value that went through a slider and back.
 */
export function sameSoundstage(a: SoundstageSettings, b: SoundstageSettings): boolean {
  return sameEqCurve(a.eq, b.eq) && SOUNDSTAGE_KEYS.every((key) => Math.abs(a[key] - b[key]) < 0.0005)
}

/** The factory stage `direction` places from the last one chosen, stopping at either end. */
export function steppedFactorySoundstage(from: FactorySoundstageId, direction: 1 | -1): FactorySoundstageId {
  const index = FACTORY_SOUNDSTAGE_IDS.indexOf(from) + direction
  return FACTORY_SOUNDSTAGE_IDS[Math.max(0, Math.min(FACTORY_SOUNDSTAGE_IDS.length - 1, index))]
}

function sanitizeSettings(value: unknown, fallback: SoundstageSettings): SoundstageSettings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const out = { ...fallback, eq: input.eq === undefined ? fallback.eq.map((point) => ({ ...point })) : sanitizeEqCurve(input.eq) }
  for (const key of SOUNDSTAGE_KEYS) {
    const raw = input[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = Math.max(RANGES[key][0], Math.min(RANGES[key][1], raw))
  }
  return out
}

export function sanitizeSoundstagePreferences(value: unknown): SoundstagePreferences {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const list = sanitizePresetList(SOUNDSTAGE_KIND, input)
  const factory = isFactorySoundstageId(String(input.factory)) ? input.factory as FactorySoundstageId : DEFAULT_FACTORY_SOUNDSTAGE
  const lastCustom = typeof input.lastCustom === 'string' && list.custom.some((stage) => stage.id === input.lastCustom) ? input.lastCustom : null
  return withActiveSoundstage({ ...list, factory, lastCustom }, list)
}
