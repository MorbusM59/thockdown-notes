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
const STAGE = { eqGainsDb: new Array(31).fill(0), reverbAmount: 0, size: 0.3, foliage: 0, width: 1 };

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
    musicCatalog(json: string): string;
    musicRotation(json: string): string;
    musicRotationJson(): string;
    musicNext(previousId: number): string;
    musicJump(currentId: number, direction: number): string;
    musicChoose(songId: number, currentId: number): string;
    musicQueueJson(limit: number): string;
    musicEditCatalog(json: string): string;
    musicPoolHolds(songId: number): string;
  };
  api.musicInit(JSON.stringify({ sampleRate: OUTPUT_RATE, spliceMarginSec: 0.15}));
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

  it('walks the queue: next, previous through what played, and a chosen song', () => {
    const music = sandbox();
    const songs = [1, 2, 3, 4].map((id) => ({ id, filePath: `content://music/${id}`, setIds: [1], title: '', artist: '', album: '', durationSec: 0, likes: 0 }));
    music.musicCatalog(JSON.stringify({ songs, sets: [{ slot: 1, name: 'One', icon: null }], folders: [], activeSetIds: [1], filter: { query: '', enabled: true }, playMode: 'mix' }));
    // A rotation written by the priority rotation this replaced: its songs are placed afresh.
    music.musicRotation(JSON.stringify([{ id: 1, priority: 4, favorability: 1 }]));
    const id = (json: string) => (JSON.parse(json) as { id: number } | null)?.id ?? null;
    const first = id(music.musicNext(-1))!;
    const order = (JSON.parse(music.musicRotationJson()) as Array<{ id: number; due: number }>).sort((a, b) => a.due - b.due).map((entry) => entry.id);
    expect(order).toHaveLength(4);
    expect(first).toBe(order[0]);
    const second = id(music.musicNext(first))!;
    expect(second).toBe(order[1]);
    // Previous goes back to what played, and next returns to the song interrupted.
    expect(id(music.musicJump(second, -1))).toBe(first);
    expect(id(music.musicJump(first, 1))).toBe(second);
    // A chosen song plays at once; nothing before the first song played is behind it.
    expect(id(music.musicChoose(order[3], second))).toBe(order[3]);
    expect(id(music.musicNext(order[3]))).toBe(order[2]);
    // Decoded ahead: the next song is picked while this one is still heard;
    // back from the song heard is the one before it, not the song heard.
    const heard = order[2];
    music.musicNext(heard);
    expect(id(music.musicJump(heard, -1))).toBe(order[3]);
  });
});

describe('the car\'s view of the library', () => {
  const songs = [1, 2, 3].map((id) => ({ id, filePath: `content://music/${id}`, setIds: [id === 3 ? 2 : 1], title: `Song ${id}`, artist: '', album: '', durationSec: 0, likes: 0 }));
  const sets = [{ slot: 1, name: 'One', icon: null }, { slot: 2, name: 'Two', icon: null }];

  it('queues the pool and edits the sets and the filter by the page\'s rules', () => {
    const music = sandbox();
    music.musicCatalog(JSON.stringify({ songs, sets, folders: [], activeSetIds: [1], filter: { query: '', enabled: false }, playMode: 'mix' }));
    const queued = () => (JSON.parse(music.musicQueueJson(30)) as Array<{ id: number }>).map((song) => song.id).sort();
    expect(queued()).toEqual([1, 2]);
    expect(JSON.parse(music.musicEditCatalog(JSON.stringify({ set: 2 }))).activeSetIds).toEqual([1, 2]);
    expect(queued()).toEqual([1, 2, 3]);
    const filtered = JSON.parse(music.musicEditCatalog(JSON.stringify({ filter: 'Song 3' })));
    expect(filtered.filter).toEqual({ query: 'Song 3', enabled: true });
    expect(filtered.recentFilters).toEqual(['Song 3']);
    expect(queued()).toEqual([3]);
    expect([music.musicPoolHolds(3), music.musicPoolHolds(1), music.musicPoolHolds(-1)]).toEqual(['true', 'false', 'true']);
    expect(JSON.parse(music.musicEditCatalog(JSON.stringify({ filter: '' }))).filter.enabled).toBe(false);
    // Every set can be switched off: the pool is then empty and nothing plays.
    music.musicEditCatalog(JSON.stringify({ set: 2 }));
    expect(JSON.parse(music.musicEditCatalog(JSON.stringify({ set: 1 }))).activeSetIds).toEqual([]);
    expect(music.musicPoolHolds(-1)).toBe('false');
  });
});
