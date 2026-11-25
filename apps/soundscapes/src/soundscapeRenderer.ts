/**
 * The Android soundscape renderer's script (vite.renderer.config.ts): the
 * shared renderer (packages/soundscape/soundscapeSandbox.ts) plus what only
 * this app asks of it, the visualizer's spectrum of the soundscape
 * (packages/visualizer/visualizer/spectrumMix.ts), computed from the chunks
 * it renders exactly as musicSandbox.ts computes the music's.
 *
 * The functions it adds on globalThis:
 * - soundscapeSpectrum(bands): compute the spectrum in `bands` log bands (0
 *   stops it). Turning it on hands out again what is queued from near the
 *   playhead (`rerenderSoundscape`), so the frames start there rather than
 *   a render lead later;
 * - soundscapeSpectrumTake(): the frames computed since the last call, as
 *   JSON `[{ "from", "first", "hop", "l" }]` (spectrumFrames.ts's
 *   SpectrumFrameBatch, `l` its levels in base64), stamped with the
 *   soundscape output's frame positions.
 */
import { observeRenderedChunks, rerenderSoundscape } from '@thockdown/soundscape/soundscapeSandbox';
import { toBase64 } from '@thockdown/soundscape/halfScalePcm';
import { SpectrumFrames } from '@thockdown/visualizer/visualizer/spectrumFrames';
import { logBandEdges } from '@thockdown/visualizer/visualizer/spectrumBands';

const scope = globalThis as unknown as Record<string, unknown>;
let pending: Array<{ from: number; first: number; hop: number; l: string }> = [];

scope.soundscapeSpectrum = (bands: number, sampleRate: number): string => {
  pending = [];
  if (bands <= 0) {
    observeRenderedChunks(null);
    return 'ok';
  }
  const spectrum = new SpectrumFrames(sampleRate, logBandEdges(bands));
  observeRenderedChunks((chunk) => {
    const batch = spectrum.push(chunk.startFrame, chunk.left, chunk.right);
    if (batch) pending.push({ from: batch.from, first: batch.first, hop: batch.hop, l: toBase64(batch.levels) });
  });
  rerenderSoundscape();
  return 'ok';
};

scope.soundscapeSpectrumTake = (): string => {
  const out = JSON.stringify(pending);
  pending = [];
  return out;
};
