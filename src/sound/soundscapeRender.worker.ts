/**
 * The dedicated worker that renders a soundscape ahead of playback
 * (soundscapeRenderAhead.ts). Created by SoundscapeEngine, one per running
 * soundscape, and terminated with it.
 *
 * Messages from the engine:
 * - `init`: the sample rate, the generator's options, and a MessagePort to
 *   the player worklet. Chunks go to the player over that port directly, and
 *   the player's `consumed` reports come back over it, so the main thread is
 *   not on the audio's path (and its throttling in a background app cannot
 *   starve playback).
 * - `configure`: new settings, as built by toGeneratorConfiguration.
 */
import generatorSource from './soundscape-generator.js?raw';
import { hostGenerator, type GeneratorOptions } from './soundscapeGeneratorHost';
import { RenderAhead } from './soundscapeRenderAhead';

interface InitMessage {
  type: 'init';
  sampleRate: number;
  options: GeneratorOptions;
  player: MessagePort;
}

let renderer: RenderAhead | null = null;
// A configure that arrived before init finished (both are posted at start).
let pendingConfigure: unknown = null;

// Yields to waiting messages between chunks without a timer: a message
// posted to oneself is queued behind everything already waiting.
const yieldChannel = new MessageChannel();
const yieldQueue: Array<() => void> = [];
yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
const schedule = (work: () => void) => {
  yieldQueue.push(work);
  yieldChannel.port2.postMessage(null);
};

self.onmessage = (event: MessageEvent<InitMessage | { type: 'configure' }>) => {
  const message = event.data;
  if (message.type === 'init') {
    const player = message.player;
    const generator = hostGenerator(generatorSource, message.sampleRate, message.options);
    renderer = new RenderAhead(
      generator,
      message.sampleRate,
      (chunk, transfer) => player.postMessage(chunk, transfer),
      schedule,
    );
    player.onmessage = (reply: MessageEvent<{ type: 'consumed'; generation: number; frames: number }>) => {
      if (reply.data?.type === 'consumed') renderer?.consumed(reply.data.generation, reply.data.frames);
    };
    if (pendingConfigure !== null) renderer.configure(pendingConfigure);
    pendingConfigure = null;
    return;
  }
  if (message.type === 'configure') {
    if (renderer) renderer.configure(message);
    else pendingConfigure = message;
  }
};
