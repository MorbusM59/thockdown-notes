/**
 * The Android soundscape renderer's script (vite.renderer.config.ts): the
 * shared renderer (packages/soundscape/soundscapeSandbox.ts) plus what only
 * this app asks of it, the VISUALS: the soundscape's spectrum
 * (packages/visualizer/visualizer/spectrumMix.ts), computed from the chunks
 * it renders exactly as musicSandbox.ts computes the music's, and its
 * signals (soundscape-generator.js's SIGNALS: hits and gusts, for
 * packages/visualizer/sound/soundscapeSignals.ts).
 *
 * The functions it adds on globalThis:
 * - soundscapeVisuals(bands, signals, sampleRate): compute the spectrum in
 *   `bands` log bands (0 for none) and pass the signals on (`signals`
 *   1) or not (0). Turning either on hands out again what is queued from
 *   near the playhead (`rerenderSoundscape`), so both start there rather
 *   than a render lead later;
 * - soundscapeVisualsTake(): what was computed since the last call, as JSON
 *   `{ "spectrum": [{ "from", "first", "hop", "l" }], "signals": [{ "from",
 *   "list" }] }` (spectrumFrames.ts's SpectrumFrameBatch, `l` its levels in
 *   base64; a run of consecutive chunks' signals, each at its frame), in the
 *   soundscape output's frames. Each batch replaces everything held from its
 *   `from` on, since a chunk re-sent after a rewind supersedes the old one.
 */
import { observeRenderedChunks, rerenderSoundscape } from '@thockdown/soundscape/soundscapeSandbox';
import { toBase64 } from '@thockdown/soundscape/halfScalePcm';
import type { RenderSignal } from '@thockdown/audio/renderAhead';
import { SpectrumFrames } from '@thockdown/visualizer/visualizer/spectrumFrames';
import { logBandEdges } from '@thockdown/visualizer/visualizer/spectrumBands';

const scope = globalThis as unknown as Record<string, unknown>;
let spectrumBatches: Array<{ from: number; first: number; hop: number; l: string }> = [];
let signalBatches: Array<{ from: number; list: RenderSignal[] }> = [];
/**
 * The batch the next chunk joins when it starts where the last one ended
 * (`signalsNext`); null once taken, so the next chunk begins a batch of its
 * own. A chunk elsewhere (a rewind) begins a new batch too.
 */
let openSignals: { from: number; list: RenderSignal[] } | null = null;
let signalsNext = -1;

scope.soundscapeVisuals = (bands: number, signals: number, sampleRate: number): string => {
  spectrumBatches = [];
  signalBatches = [];
  openSignals = null;
  signalsNext = -1;
  if (bands <= 0 && !signals) {
    observeRenderedChunks(null);
    return 'ok';
  }
  const spectrum = bands > 0 ? new SpectrumFrames(sampleRate, logBandEdges(bands)) : null;
  observeRenderedChunks((chunk) => {
    if (spectrum) {
      const batch = spectrum.push(chunk.startFrame, chunk.left, chunk.right);
      if (batch) spectrumBatches.push({ from: batch.from, first: batch.first, hop: batch.hop, l: toBase64(batch.levels) });
    }
    if (signals) {
      // Every chunk counts, an empty one too: it replaces what was held for its frames.
      if (!openSignals || chunk.startFrame !== signalsNext) {
        openSignals = { from: chunk.startFrame, list: [] };
        signalBatches.push(openSignals);
      }
      if (chunk.signals) openSignals.list.push(...chunk.signals);
      signalsNext = chunk.startFrame + chunk.left.length;
    }
  });
  rerenderSoundscape();
  return 'ok';
};

scope.soundscapeVisualsTake = (): string => {
  const out = JSON.stringify({ spectrum: spectrumBatches, signals: signalBatches });
  spectrumBatches = [];
  signalBatches = [];
  openSignals = null;
  return out;
};
