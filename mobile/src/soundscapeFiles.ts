/**
 * The phone's side of exporting and importing soundscapes: the same
 * SoundscapeFileApi the desktop's main process provides (preload.ts), so
 * the shared export and import (src/sidebar/soundscapeFileActions.ts) run
 * unchanged.
 *
 * - save: the file is written by the native side and offered through the
 *   share sheet, which is where a phone saves a file (to Files, Drive, a
 *   message): there is no save dialog to ask where.
 * - open: the system file picker, through a file input. Any file can be
 *   chosen, because a .tds file has no registered type to filter on; one
 *   that is not a soundscape file imports nothing.
 */
import type { SoundscapeFileApi } from '../../src/shared/soundscapeFile'
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
    save: (content, defaultName) => native.shareText({ content, name: defaultName }),
    open: pickTextFile,
  }
  window.thockdownSoundscapeFiles = api
}
