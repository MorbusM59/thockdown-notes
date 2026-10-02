/**
 * The desktop's soundscape output (see SoundscapeEngine): the player
 * worklet (public/soundscape-player.js), a gain for the listener's volume,
 * and the shared output limiter the music also plays through
 * (audioOutputBus.ts).
 *
 *   render worker --chunks--> player --> volume gain --> shared limiter
 */
import type { SoundscapeOutput, SoundscapeOutputHandlers } from './SoundscapeEngine';
import { connectToOutput, resumedOutputContext } from './audioOutputBus';

/**
 * The player reports its position every 2048 frames and the context's own
 * output buffer is under 200 ms (audioOutputBus.ts), so a splice this far
 * past its last report is never already committed.
 */
const SPLICE_MARGIN_SEC = 0.1;

const WORKLET_MODULES = new WeakMap<AudioContext, Promise<void>>();

function outputUnderruns(context: AudioContext): number | null {
  const stats = (context as AudioContext & { playbackStats?: { underrunEvents?: number } }).playbackStats;
  return stats && typeof stats.underrunEvents === 'number' ? stats.underrunEvents : null;
}

export async function createWebAudioOutput(handlers: SoundscapeOutputHandlers): Promise<SoundscapeOutput> {
  const context = await resumedOutputContext();
  let modulePromise = WORKLET_MODULES.get(context);
  if (!modulePromise) {
    modulePromise = context.audioWorklet.addModule(new URL('soundscape-player.js', window.location.href).toString());
    WORKLET_MODULES.set(context, modulePromise);
  }
  try {
    await modulePromise;
  } catch (error) {
    WORKLET_MODULES.delete(context);
    throw error;
  }

  const player = new AudioWorkletNode(context, 'soundscape-player', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const volume = context.createGain();
  volume.gain.value = 0;
  player.connect(volume);
  connectToOutput(volume);

  // The worker's chunks go to the player directly, and its reports back.
  const link = new MessageChannel();
  player.port.postMessage({ type: 'connect', port: link.port1 }, [link.port1]);
  player.port.onmessage = (event: MessageEvent<{ type: string; queuedFrames: number; dryFrames: number; dryEvents: number }>) => {
    if (event.data?.type !== 'stats') return;
    handlers.onStats({
      playedSec: null,
      outputRestarts: null,
      lastOutputError: null,
      queuedSec: event.data.queuedFrames / context.sampleRate,
      outputDrySec: event.data.dryFrames / context.sampleRate,
      outputDryEvents: event.data.dryEvents,
      deviceUnderruns: outputUnderruns(context),
    });
  };
  player.onprocessorerror = () => handlers.onFailure();

  return {
    sampleRate: context.sampleRate,
    spliceMarginSec: SPLICE_MARGIN_SEC,
    port: link.port2,
    setVolume(target, timeConstantSec) {
      const now = context.currentTime;
      volume.gain.cancelAndHoldAtTime(now);
      volume.gain.setTargetAtTime(target, now, timeConstantSec);
    },
    close() {
      // `stop` is what lets the audio thread drop the processor (see
      // soundscape-player.js); disconnecting the node alone leaves it running.
      player.port.postMessage({ type: 'stop' });
      player.disconnect();
      volume.disconnect();
    },
  };
}
