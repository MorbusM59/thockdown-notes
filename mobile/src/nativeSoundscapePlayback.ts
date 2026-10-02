/**
 * The soundscape's playback on Android (see SoundscapeEngine's
 * SoundscapePlayback): the native service renders and plays it
 * (BackgroundAudioPlugin.java, SoundscapeRenderer.java,
 * SoundscapeAudioOutput.java), so nothing on its audio path is in the
 * WebView, whose JavaScript is paused in the background. This side only
 * forwards settings and the volume, and passes statistics and failures back.
 */
import type { SoundscapePlaybackFactory } from '../../src/sound/SoundscapeEngine'
import type { NativeSoundscapePlugin } from './backgroundAudioHost'

export function nativeSoundscapePlayback(plugin: NativeSoundscapePlugin): SoundscapePlaybackFactory {
  return async (handlers) => {
    const handles = await Promise.all([
      plugin.addListener('outputStats', (stats) => handlers.onStats({
        playedSec: stats.playedFrames / stats.sampleRate,
        outputRestarts: stats.trackRestarts,
        lastOutputError: stats.trackRestarts > 0 ? stats.lastError : null,
        queuedSec: stats.queuedFrames / stats.sampleRate,
        outputDrySec: stats.dryFrames / stats.sampleRate,
        outputDryEvents: stats.dryEvents,
        deviceUnderruns: stats.deviceUnderruns,
      })),
      plugin.addListener('rendererFailure', ({ message }) => handlers.onFailure(message)),
    ])
    await plugin.openRenderer()
    return {
      configure(configuration) {
        void plugin.configure({ configuration: JSON.stringify(configuration) })
      },
      setVolume(volume, timeConstantSec) {
        void plugin.setVolume({ volume, timeConstantSec })
      },
      close() {
        for (const handle of handles) void handle.remove()
        void plugin.closeRenderer()
      },
    }
  }
}
