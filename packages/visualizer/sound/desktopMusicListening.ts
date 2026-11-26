/**
 * The desktop's `MusicListening` (`musicListening.ts`): the Web Audio music
 * player (`MusicPlayerService`), its `<audio>` element's clock and its
 * processed output read by analysers (`visualizer/spectrumTap.ts`).
 */
import { outputContext } from '@thockdown/soundscape/audioOutputBus'
import { setSoundscapeSignalSink, soundscapeHeardGain } from '@thockdown/soundscape/soundscapeTap'
import { heardLagSec } from './musicBeat'
import { receiveSoundscapeSignals, setSoundscapeHeardGain, type SoundscapeSignal } from './soundscapeSignals'
import { SpectrumTap } from '../visualizer/spectrumTap'
import { musicPlayerService } from './MusicPlayerService'
import type { MusicListening } from './musicListening'

/**
 * How far behind the media time the listener hears it. Chromium's
 * `outputLatency` is the whole way from the graph to the speaker, the output
 * buffer `baseLatency` names included (measured on Windows: base 170 ms,
 * output 202 ms at a 8192-frame buffer), so the two are not added: their sum
 * counted the buffer twice and drew everything 170 ms late. The larger is
 * taken so a platform that reports only the hardware's part still has the
 * buffer as its floor.
 */
export function outputLatencySec(): number {
  const context = outputContext()
  return Math.max(context.baseLatency || 0, context.outputLatency || 0)
}

export const desktopMusicListening: MusicListening = {
  get isPlaying() { return musicPlayerService.isPlaying },
  heardGain: () => musicPlayerService.heardGain(),
  subscribePlaying: (listener) => musicPlayerService.subscribePlaying(listener),
  get trackUrl() { return musicPlayerService.trackUrl },
  get currentTime() { return musicPlayerService.currentTime },
  get currentDurationSec() { return musicPlayerService.currentDurationSec },
  setCurrentTimeFraction: (fraction) => { void musicPlayerService.setCurrentTimeFraction(fraction) },
  outputLatencySec,
  createSpectrum: (edges) => new SpectrumTap(musicPlayerService, edges),
}

/**
 * The desktop's half of `soundscapeSignals.ts`: the live soundscape's
 * signals as its worklet posts them (`soundscapeTap.ts`), each frame of the
 * output context's clock turned into the moment it is HEARD on the page's
 * clock -- the graph is handling `context.currentTime` now, and the listener
 * hears it `heardLagSec()` later, as with the music -- and the gains both
 * are heard at.
 */
export function installDesktopSoundscapeSignals(): void {
  setSoundscapeHeardGain(soundscapeHeardGain)
  setSoundscapeSignalSink((list, context) => {
    const now = performance.now() / 1000
    const offset = now - context.currentTime + heardLagSec()
    const signals: SoundscapeSignal[] = []
    for (const signal of list) {
      const at = (signal.frame / context.sampleRate) + offset
      if (signal.kind === 'gust') signals.push({ at, kind: 'gust', value: signal.value as number })
      else if (signal.kind === 'drip' || signal.kind === 'drop' || signal.kind === 'chime') {
        signals.push({ at, kind: signal.kind, amplitude: signal.amplitude as number, salience: signal.salience as number })
      }
    }
    receiveSoundscapeSignals(signals, now)
  })
}
