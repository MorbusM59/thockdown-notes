/** The music's EQ presets (`sound/musicEqPreset.ts`), shared with the main process's state sanitizer. */

/** In the order the visualizer's solids step through: tetrahedron, cube, octahedron, dodecahedron, icosahedron. */
export const MUSIC_EQ_PRESETS = ['classical', 'voice', 'flat', 'amp50', 'amp100'] as const
export type MusicEqPreset = (typeof MUSIC_EQ_PRESETS)[number]
export const DEFAULT_MUSIC_EQ_PRESET: MusicEqPreset = 'flat'

export function sanitizeMusicEqPreset(value: unknown): MusicEqPreset {
  return (MUSIC_EQ_PRESETS as readonly unknown[]).includes(value) ? (value as MusicEqPreset) : DEFAULT_MUSIC_EQ_PRESET
}
