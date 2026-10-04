/**
 * The phone's side of exporting and importing soundscapes: the same
 * SoundscapeFileApi the desktop's main process provides (preload.ts), so
 * the shared export and import (packages/soundscape/soundscapeFileActions.ts) run
 * unchanged.
 *
 * - save: the system's "Save as" dialog (the Storage Access Framework), so
 *   the reader chooses the folder and the name, as the desktop's save dialog
 *   lets them. Not the share sheet: it hands the file to another app, and
 *   whether any of those can put it in storage depends on what is installed.
 * - open: the system file picker, through a file input. Any file can be
 *   chosen, because a .tds file has no registered type to filter on; one
 *   that is not a soundscape file imports nothing.
 */
import type { SoundscapeFileApi } from '@thockdown/soundscape/soundscapeFile'
import { nativeSoundscape } from './backgroundAudioHost'

function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      file.text().then(resolve, () => resolve(null))
    }, { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

export function installSoundscapeFiles(): void {
  const native = nativeSoundscape
  if (!native) return
  const api: SoundscapeFileApi = {
    save: async (content, defaultName) => { await native.saveText({ content, name: defaultName }) },
    open: pickTextFile,
  }
  window.thockdownSoundscapeFiles = api
}
