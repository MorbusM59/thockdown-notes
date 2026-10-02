/**
 * The soundscape's playback on Android (see SoundscapeEngine's
 * SoundscapePlayback): the native session renders and plays it
 * (SoundscapeSession.java, SoundscapeRenderer.java,
 * SoundscapeAudioOutput.java), so nothing on its audio path is in the
 * WebView, whose JavaScript is paused in the background. This side only
 * forwards settings and the volume, and passes failures back.
 *
 * Closing PAUSES the session rather than ending it: the session, and the
 * notification and lock-screen controls with it, stay up so a soundscape
 * turned off can be turned on again from there. Only those controls'
 * stop ends it.
 */
import type { SoundscapePlaybackFactory } from '../../src/sound/SoundscapeEngine'
import type { NativeSoundscapePlugin } from './backgroundAudioHost'

export function nativeSoundscapePlayback(plugin: NativeSoundscapePlugin): SoundscapePlaybackFactory {
  return async (handlers) => {
    const failure = await plugin.addListener('rendererFailure', ({ message }) => handlers.onFailure(message))
    await plugin.play()
    return {
      configure(configuration) {
        void plugin.configure({ configuration: JSON.stringify(configuration) })
      },
      setVolume(volume, timeConstantSec) {
        void plugin.setVolume({ volume, timeConstantSec })
      },
      close() {
        void failure.remove()
        void plugin.pause()
      },
    }
  }
}
