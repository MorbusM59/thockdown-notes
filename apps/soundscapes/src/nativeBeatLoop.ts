/**
 * The phone's player for the beat delay calibration's loops
 * (`@thockdown/visualizer/beat/beatLoops.ts`): the loop is decoded here at
 * the output's rate and handed to the native output (CalibrationLoop.java),
 * which plays it the way it plays the music, so the delay set against it is
 * the music's. Where in the loop the listener is comes from a frame the
 * native side reports with the moment it is heard (nativeClock.ts), run on by
 * this page's clock, exactly as the music's position is (nativeMusicListening.ts).
 */
import type { BeatLoopPlayer } from '@thockdown/visualizer/beat/beatLoops'
import { encodeHalfScaleStereo } from '@thockdown/soundscape/halfScalePcm'
import type { NativeMusicPlugin } from './nativeMusic'
import { heardAtSec } from './nativeClock'

export function createNativeBeatLoopPlayer(plugin: NativeMusicPlugin): BeatLoopPlayer {
  return (loop, onFailed) => {
    let over = false
    // The latest report: a frame, its rate, and when it is heard (performance clock, seconds; nativeClock.ts).
    let heard: { frame: number; sampleRate: number; at: number } | null = null
    const listener = plugin.addListener('loopHeard', (data) => {
      heard = { frame: data.frame, sampleRate: data.sampleRate, at: heardAtSec(data) }
    })
    void (async () => {
      try {
        const [{ sampleRate }, bytes] = await Promise.all([
          plugin.getOutputRate(),
          fetch(loop.url).then((response) => response.arrayBuffer()),
        ])
        // Decoded at the output's rate, so the native side plays it as it is.
        const audio = await new OfflineAudioContext(2, 1, sampleRate).decodeAudioData(bytes)
        if (over) return
        const left = audio.getChannelData(0)
        const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left
        await plugin.playLoop({ pcm: encodeHalfScaleStereo(left, right) })
        // Stopped while it was being handed over.
        if (over) void plugin.stopLoop()
      } catch {
        if (!over) onFailed()
      }
    })()
    return {
      heardBarSec(frameTimeMs, delaySec) {
        if (!heard) return NaN
        const sec = (heard.frame / heard.sampleRate) + (frameTimeMs / 1000 - heard.at) - delaySec
        return sec - (Math.floor(sec / loop.barSec) * loop.barSec)
      },
      stop() {
        over = true
        void listener.then((handle) => handle.remove())
        void plugin.stopLoop()
      },
    }
  }
}
