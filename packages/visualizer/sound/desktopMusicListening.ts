/**
 * The desktop's `MusicListening` (`musicListening.ts`): the Web Audio music
 * player (`MusicPlayerService`), its `<audio>` element's clock and its
 * processed output read by analysers (`visualizer/spectrumTap.ts`).
 */
import { outputContext } from '@thockdown/soundscape/audioOutputBus'
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
  subscribePlaying: (listener) => musicPlayerService.subscribePlaying(listener),
  get trackUrl() { return musicPlayerService.trackUrl },
  get currentTime() { return musicPlayerService.currentTime },
  get currentDurationSec() { return musicPlayerService.currentDurationSec },
  setCurrentTimeFraction: (fraction) => { void musicPlayerService.setCurrentTimeFraction(fraction) },
  outputLatencySec,
  createSpectrum: (edges) => new SpectrumTap(musicPlayerService, edges),
}
