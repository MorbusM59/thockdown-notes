// verify: reads-repository (scripts/verify.mjs, "what a test reads from disk")
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { RENDER_CHUNK_FRAMES, RENDER_LEAD_SEC } from '@thockdown/audio/renderAhead';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const OUTPUT_RATE = 8000;
const SOURCE_RATE = 11025;
const BANDS = [{ frequencyHz: 100, q: 1.5 }, { frequencyHz: 1000, q: 1.5 }];
const STAGE = { eqGainsDb: [0, 0], reverbAmount: 0, size: 0.3, foliage: 0, width: 1 };

let bundle = '';

beforeAll(async () => {
  await build({ configFile: path.join(root, 'apps/soundscapes/vite.music-renderer.config.ts'), logLevel: 'silent' });
  bundle = readFileSync(path.join(root, 'apps/soundscapes/android/app/src/main/assets/music-renderer.js'), 'utf8');
}, 60000);

interface Step { chunks: Array<{ s: number; d: string }>; ahead: number; at: { songId: number; offsetFrames: number } | null }

/** The bundle in a bare context: the language's built-ins and nothing a browser adds. */
function sandbox() {
  const context: Record<string, unknown> = {};
  runInNewContext(bundle, context);
  const api = context as {
    musicInit(json: string): string;
    musicConfigure(json: string): string;
    musicSong(songId: number, sourceRate: number, offsetFrames: number): string;
    musicAppend(base64: string): string;
    musicEnd(): string;
    musicStep(playedFrame: number, maxChunks: number): string;
  };
  api.musicInit(JSON.stringify({ sampleRate: OUTPUT_RATE, spliceMarginSec: 0.15, bands: BANDS }));
  return { ...api, step: (played: number, max = 1000) => JSON.parse(api.musicStep(played, max)) as Step };
}

/** A tone as the decoder hands it over: 16-bit full scale, interleaved, base64. */
function decoded(frequency: number, frames: number): string {
  const bytes = Buffer.alloc(frames * 4);
  for (let n = 0; n < frames; n += 1) {
    const value = Math.round(16000 * Math.sin((2 * Math.PI * frequency * n) / SOURCE_RATE));
    bytes.writeInt16LE(value, n * 4);
    bytes.writeInt16LE(value, (n * 4) + 2);
  }
  return bytes.toString('base64');
}

describe('the music sandbox', () => {
  it('renders a song handed over at its own rate, as far as the input reaches, and says what plays', () => {
    const music = sandbox();
    music.musicSong(5, SOURCE_RATE, 0);
    music.musicAppend(decoded(440, SOURCE_RATE));
    music.musicConfigure(JSON.stringify({ stage: STAGE }));
    const first = music.step(0);
    // About a second of input at the output's rate: whole chunks of it, no more.
    const rendered = first.chunks.length * RENDER_CHUNK_FRAMES;
    expect(rendered).toBeGreaterThan(OUTPUT_RATE - (2 * RENDER_CHUNK_FRAMES));
    expect(rendered).toBeLessThanOrEqual(OUTPUT_RATE);
    expect(first.at).toEqual({ songId: 5, offsetFrames: 0 });
    // The end of the queue: it renders on to the full lead.
    music.musicEnd();
    const after = music.step(0);
    expect(rendered + (after.chunks.length * RENDER_CHUNK_FRAMES)).toBeGreaterThanOrEqual(RENDER_LEAD_SEC * OUTPUT_RATE);
  });

  it('cuts to another song near the playhead and reports it once it is heard', () => {
    const music = sandbox();
    music.musicSong(1, SOURCE_RATE, 0);
    music.musicAppend(decoded(440, SOURCE_RATE * 12));
    music.musicConfigure(JSON.stringify({ stage: STAGE }));
    music.step(0);
    // The playhead first, so the splice is measured from now (as MusicRenderer.java does).
    expect(music.step(OUTPUT_RATE, 0).at).toEqual({ songId: 1, offsetFrames: OUTPUT_RATE });
    music.musicConfigure(JSON.stringify({ stage: STAGE, cut: true }));
    music.musicSong(2, SOURCE_RATE, 3 * OUTPUT_RATE);
    music.musicAppend(decoded(880, SOURCE_RATE * 2));
    const after = music.step(OUTPUT_RATE);
    expect(after.chunks.length).toBeGreaterThan(0);
    const splice = after.chunks[0].s;
    expect(splice).toBeGreaterThan(OUTPUT_RATE);
    expect(splice).toBeLessThan(2 * OUTPUT_RATE);
    expect(music.step(splice + 100, 0).at).toEqual({ songId: 2, offsetFrames: (3 * OUTPUT_RATE) + 100 });
  });
});
