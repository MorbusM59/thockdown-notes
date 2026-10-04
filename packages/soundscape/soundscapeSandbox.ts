/**
 * The soundscape renderer as a self-contained script for a bare JavaScript
 * engine: Android's JavaScriptSandbox (androidx.javascriptengine), run by
 * the app's native service (SoundscapeRenderer.java), where nothing about a
 * web page's lifecycle can pause it. It is the same render-ahead the
 * desktop's worker runs (soundscapeRenderAhead.ts: the generator, the mix,
 * splicing), only driven by calls instead of messages.
 *
 * Built by apps/soundscapes/vite.renderer.config.ts into one IIFE in the Android
 * app's assets. The engine it runs in has no DOM and no web APIs beyond the
 * language itself (no btoa, no MessageChannel), and its calls exchange
 * strings only, so audio is returned as base64.
 *
 * The functions it defines on globalThis:
 * - soundscapeInit(json): `{ sampleRate, seed, spliceMarginSec }`;
 * - soundscapeConfigure(json): a ConfigureMessage, spliced in a margin past
 *   the last position reported;
 * - soundscapeTransition(json, seconds): a ConfigureMessage reached by a
 *   crossfade of `seconds` from what is playing (RenderAhead's transition);
 * - soundscapeStep(playedFrame, maxChunks): report how far the output has
 *   played, render what the lead allows (at most `maxChunks`), and return
 *   them as JSON `[{ "s": startFrame, "d": base64 }]`, the samples 16-bit
 *   interleaved stereo at half scale (the output applies the volume and
 *   doubles them back). An empty array means the lead is full.
 */
import generatorSource from './soundscape-generator?raw';
import { buildNoiseLoops, noiseLoopGains } from './soundscapeNoiseLoops';
import { encodeHalfScaleStereo } from './halfScalePcm';
import { hostGenerator } from './soundscapeGeneratorHost';
import { SoundscapeMix } from './soundscapeMix';
import { RenderAhead, type ConfigureMessage, type RenderedChunk } from './soundscapeRenderAhead';

let renderer: RenderAhead | null = null;
const tasks: Array<() => void> = [];
const rendered: RenderedChunk[] = [];

const scope = globalThis as unknown as Record<string, unknown>;

scope.soundscapeInit = (json: string): string => {
  const { sampleRate, seed, spliceMarginSec } = JSON.parse(json) as { sampleRate: number; seed: number; spliceMarginSec: number };
  const noiseLoops = buildNoiseLoops(sampleRate);
  const noiseGains = noiseLoopGains(noiseLoops, sampleRate);
  let voices = 0;
  // Each voice its own seed, so two voices of one soundscape are not one take.
  const createVoice = () => {
    voices += 1;
    return {
      generator: hostGenerator(generatorSource, sampleRate, { seed: (seed + (voices * 0x9e3779b1)) >>> 0, noiseLoops, noiseGains }),
      mix: new SoundscapeMix(sampleRate),
    };
  };
  const first = createVoice();
  tasks.length = 0;
  rendered.length = 0;
  renderer = new RenderAhead(
    first.generator,
    first.mix,
    sampleRate,
    spliceMarginSec,
    (chunk) => rendered.push(chunk),
    (work) => tasks.push(work),
    createVoice,
  );
  return 'ok';
};

scope.soundscapeConfigure = (json: string): string => {
  renderer?.configure(JSON.parse(json) as ConfigureMessage);
  return 'ok';
};

scope.soundscapeTransition = (json: string, seconds: number): string => {
  renderer?.transition(JSON.parse(json) as ConfigureMessage, seconds);
  return 'ok';
};

scope.soundscapeStep = (playedFrame: number, maxChunks: number): string => {
  if (!renderer) return '[]';
  renderer.played(playedFrame);
  // Each task renders at most one chunk and schedules the next while the
  // lead allows; what is left waits for the next step.
  while (tasks.length > 0 && rendered.length < maxChunks) tasks.shift()!();
  const out = rendered.splice(0).map((chunk) => ({ s: chunk.startFrame, d: encodeHalfScaleStereo(chunk.left, chunk.right) }));
  return JSON.stringify(out);
};
