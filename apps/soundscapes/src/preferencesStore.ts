/**
 * The phone's soundscape preferences, kept in the WebView's localStorage.
 * Everything read back goes through the same sanitizer the desktop app uses
 * on its own saved state, so a value from an older build cannot reach the
 * engine out of range.
 */
import {
  DEFAULT_SOUNDSCAPE_PREFERENCES,
  sanitizeSoundscapePreferences,
  sanitizeSoundscapeSettings,
  type SoundscapePreferences,
  type SoundscapePreset,
  type SoundscapeSettings,
} from '@thockdown/soundscape/soundscape'
import { sanitizeSchedule, type Schedule } from './schedule'

const STORAGE_KEY = 'thockdown:soundscape-preferences'

export function loadPreferences(): SoundscapePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_SOUNDSCAPE_PREFERENCES
    return sanitizeSoundscapePreferences(JSON.parse(raw))
  } catch {
    return DEFAULT_SOUNDSCAPE_PREFERENCES
  }
}

export function savePreferences(preferences: SoundscapePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch (error) {
    console.error('Failed to save soundscape preferences', error)
  }
}

const SCHEDULE_STORAGE_KEY = 'thockdown:soundscape-schedule'

/** The daily schedule (schedule.ts), checked against the soundscapes that exist. */
export function loadSchedule(customPresets: readonly SoundscapePreset[]): Schedule {
  try {
    const raw = localStorage.getItem(SCHEDULE_STORAGE_KEY)
    return sanitizeSchedule(raw === null ? null : JSON.parse(raw), customPresets)
  } catch {
    return sanitizeSchedule(null, customPresets)
  }
}

export function saveSchedule(schedule: Schedule): void {
  try {
    localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(schedule))
  } catch (error) {
    console.error('Failed to save the schedule', error)
  }
}

const SCRATCH_STORAGE_KEY = 'thockdown:soundscape-scratch'

/** The unsaved changes the media controls can step back to (sessionEntries.ts), or null. */
export function loadScratch(): SoundscapeSettings | null {
  try {
    const raw = localStorage.getItem(SCRATCH_STORAGE_KEY)
    return raw === null ? null : sanitizeSoundscapeSettings(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveScratch(scratch: SoundscapeSettings | null): void {
  try {
    if (scratch === null) localStorage.removeItem(SCRATCH_STORAGE_KEY)
    else localStorage.setItem(SCRATCH_STORAGE_KEY, JSON.stringify(scratch))
  } catch (error) {
    console.error('Failed to save unsaved soundscape changes', error)
  }
}

/**
 * Which of the desktop's factory visual presets the phone shows: light or
 * dark, and the chosen preset in each, so switching modes returns to the
 * preset last used in that mode, as the desktop does.
 */
export interface MobileLook {
  mode: 'light' | 'dark'
  /** Index into LIGHT_FACTORY_PRESETS / DARK_FACTORY_PRESETS. */
  preset: { light: number; dark: number }
}

const LOOK_STORAGE_KEY = 'thockdown:look'
const PRESET_COUNT = 5
/** Paper in light mode, Ancient in dark mode, starting light. */
export const DEFAULT_LOOK: MobileLook = { mode: 'light', preset: { light: 3, dark: 1 } }

function presetIndex(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < PRESET_COUNT ? value : fallback
}

export function loadLook(): MobileLook {
  try {
    const raw = localStorage.getItem(LOOK_STORAGE_KEY)
    if (raw === null) return DEFAULT_LOOK
    const parsed = JSON.parse(raw) as Partial<MobileLook> | null
    return {
      mode: parsed?.mode === 'dark' ? 'dark' : 'light',
      preset: {
        light: presetIndex(parsed?.preset?.light, DEFAULT_LOOK.preset.light),
        dark: presetIndex(parsed?.preset?.dark, DEFAULT_LOOK.preset.dark),
      },
    }
  } catch {
    return DEFAULT_LOOK
  }
}

export function saveLook(look: MobileLook): void {
  try {
    localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify(look))
  } catch (error) {
    console.error('Failed to save the look', error)
  }
}

/** The lengths a clip may be, in minutes, in the order the clip button's drag steps through them. */
export const CLIP_MINUTES = [2, 5, 15, 30, 60] as const
const CLIP_STORAGE_KEY = 'thockdown:clip-minutes'
const DEFAULT_CLIP_MINUTES = 5

export function loadClipMinutes(): number {
  try {
    const value = Number(localStorage.getItem(CLIP_STORAGE_KEY))
    return (CLIP_MINUTES as readonly number[]).includes(value) ? value : DEFAULT_CLIP_MINUTES
  } catch {
    return DEFAULT_CLIP_MINUTES
  }
}

export function saveClipMinutes(minutes: number): void {
  try {
    localStorage.setItem(CLIP_STORAGE_KEY, String(minutes))
  } catch (error) {
    console.error('Failed to save the clip length', error)
  }
}
