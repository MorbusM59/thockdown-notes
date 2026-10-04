import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SOUNDSCAPE_SETTINGS, SOUNDSCAPE_FACTORY_PRESETS } from '@thockdown/soundscape/soundscape';
import { toGeneratorConfiguration } from '@thockdown/soundscape/soundscapeDsp';
import { HALF_SCALE_HEADROOM, toBase64 } from '@thockdown/soundscape/halfScalePcm';
import { RENDER_CHUNK_FRAMES, RENDER_LEAD_SEC } from '@thockdown/soundscape/soundscapeRenderAhead';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const SAMPLE_RATE = 8000;
const MARGIN_SEC = 0.15;

let bundle = '';

beforeAll(async () => {
  // The bundle as shipped, built by its own config.
  await build({ configFile: path.join(root, 'apps/soundscapes/vite.renderer.config.ts'), logLevel: 'silent' });
  bundle = readFileSync(path.join(root, 'apps/soundscapes/android/app/src/main/assets/soundscape-renderer.js'), 'utf8');
}, 60000);

/** The bundle in a bare context: the language's built-ins and nothing a browser adds. */
function sandbox() {
  const context: Record<string, unknown> = {};
  runInNewContext(bundle, context);
  return context as {
    soundscapeInit(json: string): string;
    soundscapeConfigure(json: string): string;
    soundscapeStep(playedFrame: number, maxChunks: number): string;
  };
}

function decode(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64');
  const out = new Float32Array(bytes.length / 4);
  for (let frame = 0; frame < out.length; frame += 1) out[frame] = (bytes.readInt16LE(frame * 4) / 32767) * HALF_SCALE_HEADROOM;
  return out;
}

const configure = (settings = DEFAULT_SOUNDSCAPE_SETTINGS) => JSON.stringify({
  type: 'configure',
  generator: { type: 'configure', ...toGeneratorConfiguration(settings) },
  space: settings.space,
});

describe('soundscape renderer bundle', () => {
  it('encodes base64 exactly as the platform does', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 3000]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37) & 0xff);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('runs with no web APIs, fills the lead in bounded steps, and renders one continuous stream', () => {
    const renderer = sandbox();
    expect(renderer.soundscapeInit(JSON.stringify({ sampleRate: SAMPLE_RATE, seed: 3, spliceMarginSec: MARGIN_SEC }))).toBe('ok');
    renderer.soundscapeConfigure(configure());
    let next = 0;
    let steps = 0;
    for (;;) {
      const chunks = JSON.parse(renderer.soundscapeStep(0, 8)) as Array<{ s: number; d: string }>;
      if (chunks.length === 0) break;
      expect(chunks.length).toBeLessThanOrEqual(8);
      for (const chunk of chunks) {
        expect(chunk.s).toBe(next);
        const samples = decode(chunk.d);
        expect(samples.length).toBe(RENDER_CHUNK_FRAMES);
        next += samples.length;
      }
      steps += 1;
    }
    expect(next).toBeGreaterThanOrEqual(RENDER_LEAD_SEC * SAMPLE_RATE);
    expect(steps).toBeGreaterThan(1);
  });

  it('splices a settings change a margin past the reported position', () => {
    const renderer = sandbox();
    renderer.soundscapeInit(JSON.stringify({ sampleRate: SAMPLE_RATE, seed: 3, spliceMarginSec: MARGIN_SEC }));
    renderer.soundscapeConfigure(configure());
    while (JSON.parse(renderer.soundscapeStep(0, 64)).length > 0) { /* fill */ }
    const played = 3 * SAMPLE_RATE;
    renderer.soundscapeStep(played, 64);
    renderer.soundscapeConfigure(configure(SOUNDSCAPE_FACTORY_PRESETS[3].settings));
    const [first] = JSON.parse(renderer.soundscapeStep(played, 1)) as Array<{ s: number; d: string }>;
    expect(first.s).toBe(played + Math.round(MARGIN_SEC * SAMPLE_RATE));
    const samples = decode(first.d);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(Math.max(...Array.from(samples, Math.abs))).toBeGreaterThan(1e-3);
  });
});
