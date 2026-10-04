/**
 * The soundscape's playback on Android (see SoundscapeEngine's
 * SoundscapePlayback): the native session renders and plays it
 * (SoundscapeSession.java, SoundscapeRenderer.java,
 * SoundscapeAudioOutput.java), so nothing on its audio path is in the
 * WebView, whose JavaScript is paused in the background. This side only
 * forwards settings and the volume, and passes failures back.
 *
 * Opening is regular mode PLAYING and closing is regular mode PAUSED: the
 * engine plays exactly while regular mode does. A STOP is not the engine's
 * to express, so the page makes it as its own call, first; the session then
 * ignores the pause (and the fade-out to silence) the engine's closing sends
 * after it, which would otherwise silence the schedule taking over.
 */
import type { SoundscapePlaybackFactory } from '@thockdown/soundscape/SoundscapeEngine'
import type { NativeSoundscapePlugin } from './backgroundAudioHost'

export function nativeSoundscapePlayback(plugin: NativeSoundscapePlugin): SoundscapePlaybackFactory {
  return async (handlers) => {
    const failure = await plugin.addListener('rendererFailure', ({ message }) => handlers.onFailure(message))
    await plugin.play()
    return {
      configure(configuration, transitionSec) {
        void plugin.configure({ configuration: JSON.stringify(configuration), transitionSec })
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
