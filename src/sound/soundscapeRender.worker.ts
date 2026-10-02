/**
 * The dedicated worker that renders the finished soundscape ahead of
 * playback (soundscapeRenderAhead.ts). Created by SoundscapeEngine, one per
 * running soundscape, and terminated with it.
 *
 * Messages from the engine:
 * - `init`: the sample rate, the generator's options, the output's splice
 *   margin, and a MessagePort to the output. Chunks go to the output over
 *   that port and its `played` reports come back over it. On desktop the
 *   port's other end is the player worklet, so the main thread is not on
 *   the audio's path at all; on Android it is the main thread, which hands
 *   the chunks to the native output.
 * - `configure`: new settings (a ConfigureMessage).
 */
import generatorSource from './soundscape-generator.js?raw';
import { hostGenerator, type GeneratorOptions } from './soundscapeGeneratorHost';
import { SoundscapeMix } from './soundscapeMix';
import { RenderAhead, type ConfigureMessage } from './soundscapeRenderAhead';

interface InitMessage {
  type: 'init';
  sampleRate: number;
  options: GeneratorOptions;
  spliceMarginSec: number;
  output: MessagePort;
}

let renderer: RenderAhead | null = null;
// A configure that arrived before init finished (both are posted at start).
let pendingConfigure: ConfigureMessage | null = null;

// Yields to waiting messages between chunks without a timer: a message
// posted to oneself is queued behind everything already waiting.
const yieldChannel = new MessageChannel();
const yieldQueue: Array<() => void> = [];
yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
const schedule = (work: () => void) => {
  yieldQueue.push(work);
  yieldChannel.port2.postMessage(null);
};

self.onmessage = (event: MessageEvent<InitMessage | ConfigureMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    const output = message.output;
    const generator = hostGenerator(generatorSource, message.sampleRate, message.options);
    renderer = new RenderAhead(
      generator,
      new SoundscapeMix(message.sampleRate),
      message.sampleRate,
      message.spliceMarginSec,
      (chunk, transfer) => output.postMessage(chunk, transfer),
      schedule,
    );
    output.onmessage = (reply: MessageEvent<{ type: 'played'; frame: number }>) => {
      if (reply.data?.type === 'played') renderer?.played(reply.data.frame);
    };
    if (pendingConfigure) renderer.configure(pendingConfigure);
    pendingConfigure = null;
    return;
  }
  if (message.type === 'configure') {
    if (renderer) renderer.configure(message);
    else pendingConfigure = message;
  }
};
