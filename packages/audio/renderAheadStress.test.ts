import { describe, expect, it } from 'vitest';
import { MusicVoice } from './musicVoice';
import { type MusicStage } from './musicMix';
import { RENDER_CHUNK_FRAMES, RenderAheadEngine, SPLICE_GRID_FRAMES, type RenderedChunk } from './renderAhead';

/**
 * An adversarial pass over the music's render-ahead path, the part of
 * Android playback every transport action goes through (MusicRenderer.java
 * drives exactly these calls): random interleavings of the output playing
 * or holding, cuts to new songs (a choose, a skip, a seek) whose input
 * arrives late or never, input arriving in bursts, and the stream ending.
 *
 * THE PROPERTY, checked after every step: once the engine has been told
 * where the output is, it never renders for a frame already played, and
 * while it has input it keeps the output fed from no further than a splice
 * margin past the playhead. Its failure was the dead progress bar: chunks
 * rendered behind the playhead, dropped by the output, for minutes.
 */
const RATE = 8000;
const MARGIN_SEC = 0.1;
const MARGIN = Math.round(MARGIN_SEC * RATE);
const BANDS = [{ frequencyHz: 100, q: 1.5 }];
const STAGE: MusicStage = { eqGainsDb: [0], reverbAmount: 0, size: 0.3, foliage: 0, width: 1 };

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function run(seed: number): void {
  const rand = random(seed);
  const voice = new MusicVoice(RATE, BANDS);
  const tasks: Array<() => void> = [];
  // The output's queue: the end of the last chunk written at or past the playhead, as OutputLane keeps it.
  let played = 0;
  let laneEnd = 0;
  let behind = 0;
  const engine = new RenderAheadEngine(voice, RATE, MARGIN_SEC, (chunk: RenderedChunk) => {
    const end = chunk.startFrame + RENDER_CHUNK_FRAMES;
    if (end <= played) behind += 1;
    else laneEnd = end;
  }, (work) => tasks.push(work));
  const feed = (frames: number) => {
    const block = new Float32Array(frames).fill(0.1);
    voice.input.append(block, block);
    engine.poke();
  };
  voice.input.cue(1);
  feed(4 * RENDER_CHUNK_FRAMES);
  engine.configure({ stage: STAGE });
  let song = 1;
  for (let step = 0; step < 150; step += 1) {
    const roll = rand();
    if (roll < 0.35) {
      // The output plays on (a paused lane holds: no advance).
      if (rand() < 0.8) played += Math.floor(rand() * 3 * RATE);
      engine.played(played);
    } else if (roll < 0.5) {
      // A cut: choose, skip or seek. The new song's input may be slow to come.
      engine.configure({ stage: STAGE, cut: true });
      song += 1;
      voice.input.cue(song);
    } else if (roll < 0.8) {
      feed(Math.floor(rand() * 8 + 1) * RENDER_CHUNK_FRAMES);
    } else if (roll < 0.85) {
      voice.input.ended = true;
      engine.poke();
    } else if (roll < 0.92) {
      // The output's depth changes (AudioOutput: a deep background buffer, collapsed on a press):
      // a narrow margin after a wide one must still find its checkpoint.
      engine.setMargin(rand() < 0.5 ? MARGIN_SEC : 4);
    }
    // The renderer's step: render what the lead allows.
    for (let ran = 0; tasks.length > 0 && ran < 50; ran += 1) tasks.shift()!();
    expect(behind, `seed ${seed} step ${step}: chunks rendered for frames already played`).toBe(0);
    if (voice.ready && tasks.length === 0) {
      // Fed: the next audio lands no further than a margin (on the grid) past the playhead.
      expect(Math.max(laneEnd, engine.written) - played, `seed ${seed} step ${step}`).toBeGreaterThanOrEqual(0);
      expect(engine.written - played, `seed ${seed} step ${step}`).toBeLessThanOrEqual(RATE * 10 + MARGIN + SPLICE_GRID_FRAMES + RENDER_CHUNK_FRAMES);
    }
  }
}

describe('render ahead under random transport', () => {
  it('never renders behind the playhead and stays fed, over many random interleavings', () => {
    for (let seed = 1; seed <= 12; seed += 1) run(seed);
  }, 60_000);
});
