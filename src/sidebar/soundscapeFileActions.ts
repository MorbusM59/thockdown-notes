/**
 * Exporting and importing soundscapes from the settings panel: the renderer
 * builds and reads the .tds text (ambientSoundscapeFile.ts); the main
 * process only asks where (window.thockdownSoundscapeFiles).
 */
import type { AmbientPreferences, AmbientPreset } from '../shared/ambientSound'
import {
  SOUNDSCAPE_FILE_EXTENSION,
  buildSoundscapeFile,
  mergeImportedSoundscapes,
  newSoundscapeId,
  parseSoundscapeFile,
} from '../shared/ambientSoundscapeFile'

/** Save `presets` to a .tds file the reader picks; `defaultName` without extension. */
export async function exportSoundscapes(presets: readonly AmbientPreset[], defaultName: string): Promise<void> {
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
export async function importSoundscapes(preferences: AmbientPreferences): Promise<AmbientPreferences | null> {
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
