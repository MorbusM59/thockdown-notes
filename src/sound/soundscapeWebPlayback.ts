/**
 * The desktop's soundscape playback (see SoundscapeEngine): the renderer in
 * a worker (soundscapeRender.worker.ts), the player worklet
 * (public/soundscape-player.js), a gain for the listener's volume, and the
 * shared output limiter the music also plays through (audioOutputBus.ts).
 *
 *   render worker --chunks--> player --> volume gain --> shared limiter
 *                 <--played--
 *
 * The worker's chunks go to the player over their own MessageChannel, so
 * the main thread is not on the audio's path.
 */
import { buildNoiseLoops, noiseLoopGains, type NoiseLoops } from '../shared/soundscapeNoiseLoops';
import type { SoundscapePlayback, SoundscapePlaybackHandlers } from './SoundscapeEngine';
import { connectToOutput, resumedOutputContext } from './audioOutputBus';

/**
 * The player reports its position every 2048 frames and the context's own
 * output buffer is under 200 ms (audioOutputBus.ts), so a splice this far
 * past its last report is never already committed.
 */
const SPLICE_MARGIN_SEC = 0.1;

const WORKLET_MODULES = new WeakMap<AudioContext, Promise<void>>();

/**
 * The noise loops and their level-matching gains, per sample rate. Built
 * once on the main thread (tens of milliseconds) and copied into each
 * render worker at creation, rather than again by every worker a start
 * opens.
 */
const NOISE_LOOPS = new Map<number, { loops: NoiseLoops; gains: ReturnType<typeof noiseLoopGains> }>();

function noiseLoopsFor(sampleRate: number) {
  let entry = NOISE_LOOPS.get(sampleRate);
  if (!entry) {
    const loops = buildNoiseLoops(sampleRate);
    entry = { loops, gains: noiseLoopGains(loops, sampleRate) };
    NOISE_LOOPS.set(sampleRate, entry);
  }
  return entry;
}

function deviceUnderruns(context: AudioContext): number | null {
  const stats = (context as AudioContext & { playbackStats?: { underrunEvents?: number } }).playbackStats;
  return stats && typeof stats.underrunEvents === 'number' ? stats.underrunEvents : null;
}

export async function createWebPlayback(handlers: SoundscapePlaybackHandlers): Promise<SoundscapePlayback> {
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
      deviceUnderruns: deviceUnderruns(context),
    });
  };
  player.onprocessorerror = () => handlers.onFailure('Soundscape player stopped unexpectedly');

  const noise = noiseLoopsFor(context.sampleRate);
  const renderWorker = new Worker(new URL('./soundscapeRender.worker.ts', import.meta.url), { type: 'module' });
  renderWorker.postMessage({
    type: 'init',
    sampleRate: context.sampleRate,
    options: {
      seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
      noiseLoops: noise.loops,
      noiseGains: noise.gains,
    },
    spliceMarginSec: SPLICE_MARGIN_SEC,
    output: link.port2,
  }, [link.port2]);
  renderWorker.onerror = (event) => handlers.onFailure(`Soundscape render worker stopped: ${event.message}`);

  return {
    configure(configuration) {
      renderWorker.postMessage(configuration);
    },
    setVolume(target, timeConstantSec) {
      const now = context.currentTime;
      volume.gain.cancelAndHoldAtTime(now);
      volume.gain.setTargetAtTime(target, now, timeConstantSec);
    },
    close() {
      renderWorker.terminate();
      // `stop` is what lets the audio thread drop the processor (see
      // soundscape-player.js); disconnecting the node alone leaves it running.
      player.port.postMessage({ type: 'stop' });
      player.disconnect();
      volume.disconnect();
    },
  };
}
