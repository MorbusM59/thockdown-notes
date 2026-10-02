/**
 * The soundscape renderer as a self-contained script for a bare JavaScript
 * engine: Android's JavaScriptSandbox (androidx.javascriptengine), run by
 * the app's native service (SoundscapeRenderer.java), where nothing about a
 * web page's lifecycle can pause it. It is the same render-ahead the
 * desktop's worker runs (soundscapeRenderAhead.ts: the generator, the mix,
 * splicing), only driven by calls instead of messages.
 *
 * Built by mobile/vite.renderer.config.ts into one IIFE in the Android
 * app's assets. The engine it runs in has no DOM and no web APIs beyond the
 * language itself (no btoa, no MessageChannel), and its calls exchange
 * strings only, so audio is returned as base64.
 *
 * The functions it defines on globalThis:
 * - soundscapeInit(json): `{ sampleRate, seed, spliceMarginSec }`;
 * - soundscapeConfigure(json): a ConfigureMessage, spliced in a margin past
 *   the last position reported;
 * - soundscapeStep(playedFrame, maxChunks): report how far the output has
 *   played, render what the lead allows (at most `maxChunks`), and return
 *   them as JSON `[{ "s": startFrame, "d": base64 }]`, the samples 16-bit
 *   interleaved stereo at half scale (the output applies the volume and
 *   doubles them back). An empty array means the lead is full.
 */
import generatorSource from './soundscape-generator.js?raw';
import { buildNoiseLoops, noiseLoopGains } from '../shared/soundscapeNoiseLoops';
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
  const generator = hostGenerator(generatorSource, sampleRate, {
    seed,
    noiseLoops,
    noiseGains: noiseLoopGains(noiseLoops, sampleRate),
  });
  tasks.length = 0;
  rendered.length = 0;
  renderer = new RenderAhead(
    generator,
    new SoundscapeMix(sampleRate),
    sampleRate,
    spliceMarginSec,
    (chunk) => rendered.push(chunk),
    (work) => tasks.push(work),
  );
  return 'ok';
};

scope.soundscapeConfigure = (json: string): string => {
  renderer?.configure(JSON.parse(json) as ConfigureMessage);
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
