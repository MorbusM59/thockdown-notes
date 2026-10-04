/**
 * Exporting and importing soundscapes from the settings panel: the renderer
 * builds and reads the .tds text (soundscapeFile.ts); the main
 * process only asks where (window.thockdownSoundscapeFiles).
 */
import type { SoundscapePreferences, SoundscapePreset } from './soundscape'
import {
  SOUNDSCAPE_FILE_EXTENSION,
  buildSoundscapeFile,
  mergeImportedSoundscapes,
  newSoundscapeId,
  parseSoundscapeFile,
} from './soundscapeFile'

/** Save `presets` to a .tds file the reader picks; `defaultName` without extension. */
export async function exportSoundscapes(presets: readonly SoundscapePreset[], defaultName: string): Promise<void> {
  if (!window.thockdownSoundscapeFiles || presets.length === 0) return
  try {
    await window.thockdownSoundscapeFiles.save(buildSoundscapeFile(presets), `${defaultName}.${SOUNDSCAPE_FILE_EXTENSION}`)
  } catch (error) {
    console.error('Failed to export soundscapes', error)
  }
}

/**
 * Read a .tds file the reader picks and add its soundscapes as custom ones
 * (mergeImportedSoundscapes). Resolves to the new preferences, or null when
 * nothing was chosen or nothing could be read.
 */
export async function importSoundscapes(preferences: SoundscapePreferences): Promise<SoundscapePreferences | null> {
  if (!window.thockdownSoundscapeFiles) return null
  try {
    const content = await window.thockdownSoundscapeFiles.open()
    if (content === null) return null
    return mergeImportedSoundscapes(preferences, parseSoundscapeFile(content), newSoundscapeId)
  } catch (error) {
    console.error('Failed to import soundscapes', error)
    return null
  }
}
