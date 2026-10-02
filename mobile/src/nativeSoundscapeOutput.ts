/**
 * The soundscape's output on Android (see SoundscapeEngine's
 * SoundscapeOutput): the render worker's chunks, handed to the native output
 * (SoundscapeAudioOutput.java), which queues and plays them in the app's own
 * process, outside the WebView.
 *
 * The worker's port ends here on the main thread: each chunk is encoded as
 * 16-bit stereo and written to the plugin, and the native side's `played`
 * reports are passed back. The main thread is therefore on the audio's path
 * -- but only to keep the native queue topped up, seconds ahead, so a pause
 * of it (as on an app switch) is covered by what is already queued natively.
 */
import type { SoundscapeOutputFactory } from '../../src/sound/SoundscapeEngine'
import type { NativeOutputPlugin } from './backgroundAudioHost'

/**
 * The native side reports what it has handed to the device, every 2048
 * frames, through the plugin bridge and the main thread to the worker; its
 * device buffer is small (SoundscapeAudioOutput). A splice this far past a
 * report is never already committed.
 */
const SPLICE_MARGIN_SEC = 0.4;
/** Samples go over at half scale, so the mix may exceed full scale before the native volume. */
const HEADROOM = 2;

function encode(left: Float32Array, right: Float32Array): string {
  const samples = new Int16Array(left.length * 2);
  for (let index = 0; index < left.length; index += 1) {
    samples[index * 2] = Math.max(-32768, Math.min(32767, Math.round((left[index] / HEADROOM) * 32767)));
    samples[(index * 2) + 1] = Math.max(-32768, Math.min(32767, Math.round((right[index] / HEADROOM) * 32767)));
  }
  // Int16Array is little-endian on every platform this runs on.
  const bytes = new Uint8Array(samples.buffer);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

export function nativeSoundscapeOutput(plugin: NativeOutputPlugin): SoundscapeOutputFactory {
  return async (handlers) => {
    const { sampleRate } = await plugin.openOutput();
    const link = new MessageChannel();
    const port = link.port1;
    port.onmessage = (event: MessageEvent<{ type: string; startFrame: number; left: Float32Array; right: Float32Array }>) => {
      if (event.data?.type !== 'chunk') return;
      void plugin.write({ startFrame: event.data.startFrame, data: encode(event.data.left, event.data.right) });
    };
    const handles = await Promise.all([
      plugin.addListener('played', ({ frame }) => port.postMessage({ type: 'played', frame })),
      plugin.addListener('outputStats', (stats) => handlers.onStats({
        playedSec: stats.playedFrames / sampleRate,
        outputRestarts: stats.trackRestarts,
        lastOutputError: stats.trackRestarts > 0 ? stats.lastError : null,
        queuedSec: stats.queuedFrames / sampleRate,
        outputDrySec: stats.dryFrames / sampleRate,
        outputDryEvents: stats.dryEvents,
        deviceUnderruns: stats.deviceUnderruns,
      })),
    ]);
    return {
      sampleRate,
      spliceMarginSec: SPLICE_MARGIN_SEC,
      port: link.port2,
      setVolume(volume, timeConstantSec) {
        void plugin.setVolume({ volume, timeConstantSec });
      },
      close() {
        port.close();
        for (const handle of handles) void handle.remove();
        void plugin.closeOutput();
      },
    };
  };
}
