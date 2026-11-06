/** The music's EQ presets (`sound/musicEqPreset.ts`), shared with the main process's state sanitizer. */

/**
 * In the order the visualizer's solids step through: tetrahedron, cube,
 * octahedron, dodecahedron, icosahedron. Each is a strength of the one EQ
 * curve (`MusicPlayerService`'s `AMP_EQ_BANDS`).
 */
export const MUSIC_EQ_PRESETS = ['minus50', 'flat', 'plus25', 'plus50', 'plus75'] as const
export type MusicEqPreset = (typeof MUSIC_EQ_PRESETS)[number]
export const MUSIC_EQ_STRENGTH: Record<MusicEqPreset, number> = { minus50: -0.5, flat: 0, plus25: 0.25, plus50: 0.5, plus75: 0.75 }
export const DEFAULT_MUSIC_EQ_PRESET: MusicEqPreset = 'flat'

export function sanitizeMusicEqPreset(value: unknown): MusicEqPreset {
  return (MUSIC_EQ_PRESETS as readonly unknown[]).includes(value) ? (value as MusicEqPreset) : DEFAULT_MUSIC_EQ_PRESET
}

/**
 * The AMP: the EQ's strength as one continuous number (the Options > Music
 * slider). A solid sets it to its preset's value; the slider moves it freely
 * between. Persisted as `musicEqStrength`.
 */
export const MUSIC_EQ_STRENGTH_MIN = -1
export const MUSIC_EQ_STRENGTH_MAX = 1

export function sanitizeMusicEqStrength(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MUSIC_EQ_STRENGTH_MIN, Math.min(MUSIC_EQ_STRENGTH_MAX, value))
    : undefined
}
