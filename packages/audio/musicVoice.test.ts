import { describe, expect, it } from 'vitest';
import { MusicVoice } from './musicVoice';
import { type MusicStage } from './musicMix';
import { CROSSFADE_SEC, RENDER_CHUNK_FRAMES, RenderAheadEngine, SPLICE_GRID_FRAMES, type RenderedChunk } from './renderAhead';

const RATE = 8000;
const BANDS = [{ frequencyHz: 100, q: 1.5 }, { frequencyHz: 1000, q: 1.5 }];
const STAGE: MusicStage = { eqGainsDb: [0, 0], reverbAmount: 0, size: 0.3, foliage: 0, width: 1 };

function tone(frequency: number, frames: number): Float32Array {
  return Float32Array.from({ length: frames }, (_, n) => 0.5 * Math.sin((2 * Math.PI * frequency * n) / RATE));
}

/** An engine over a music voice, its tasks run on demand and its output collected by frame. */
function rig() {
  const voice = new MusicVoice(RATE, BANDS);
  const tasks: Array<() => void> = [];
  const out = new Map<number, Float32Array>();
  const engine = new RenderAheadEngine(voice, RATE, 0.1, (chunk: RenderedChunk) => out.set(chunk.startFrame, chunk.left), (work) => tasks.push(work));
  const settle = () => { while (tasks.length > 0) tasks.shift()!(); };
  return { voice, engine, out, settle };
}

describe('MusicVoice', () => {
  it('waits for input rather than rendering silence, and resumes on poke', () => {
    const { voice, engine, out, settle } = rig();
    voice.input.cue(1);
    voice.input.append(tone(440, 3 * RENDER_CHUNK_FRAMES), tone(440, 3 * RENDER_CHUNK_FRAMES));
    engine.configure({ stage: STAGE });
    settle();
    expect(out.size).toBe(3);
    voice.input.append(tone(440, 2 * RENDER_CHUNK_FRAMES), tone(440, 2 * RENDER_CHUNK_FRAMES));
    engine.poke();
    settle();
    expect(out.size).toBe(5);
    // Ended: renders on in silence.
    voice.input.ended = true;
    engine.poke();
    settle();
    expect(out.size).toBeGreaterThan(5);
  });

  it('follows one song with the next with nothing at the join, and tells where it is', () => {
    const { voice } = rig();
    voice.input.cue(7);
    voice.input.append(tone(440, 1000), tone(440, 1000));
    voice.input.cue(8);
    voice.input.append(tone(440, 1000), tone(440, 1000));
    expect(voice.input.at(500)).toEqual({ songId: 7, offsetFrames: 500 });
    expect(voice.input.at(1200)).toEqual({ songId: 8, offsetFrames: 200 });
    voice.input.forget(1500);
    expect(voice.input.at(1600)).toEqual({ songId: 8, offsetFrames: 600 });
  });

  it('cuts to a new song at the splice: the old one up to it, a crossfade, then the new one exactly', () => {
    const lead = 40 * RENDER_CHUNK_FRAMES;
    const { voice, engine, out, settle } = rig();
    voice.input.cue(1);
    voice.input.append(tone(300, lead), tone(300, lead));
    engine.configure({ stage: STAGE });
    settle();
    engine.played(4 * RENDER_CHUNK_FRAMES);
    settle();
    // Skip: the splice frame is the first grid point a margin past the playhead.
    engine.configure({ stage: STAGE, cut: true });
    const splice = voice.position;
    expect(splice % SPLICE_GRID_FRAMES).toBe(0);
    expect(splice).toBeLessThan(lead);
    voice.input.cue(2);
    const next = tone(1200, lead);
    voice.input.append(next, next);
    engine.poke();
    settle();
    // The reference: a stream that was the old song up to the splice and the new one after it from the start.
    const reference = rig();
    reference.voice.input.cue(1);
    const old = tone(300, splice);
    reference.voice.input.append(old, old);
    reference.voice.input.cue(2);
    reference.voice.input.append(next, next);
    reference.engine.configure({ stage: STAGE });
    reference.settle();
    const fade = Math.round(CROSSFADE_SEC * RATE);
    const sample = (outputs: Map<number, Float32Array>, frame: number) => outputs.get(frame - (frame % RENDER_CHUNK_FRAMES))![frame % RENDER_CHUNK_FRAMES];
    for (let frame = 0; frame < splice + fade + 2000; frame += 1) {
      if (frame >= splice && frame < splice + fade) continue;
      expect(sample(out, frame)).toBe(sample(reference.out, frame));
    }
    expect(voice.input.at(splice)).toEqual({ songId: 2, offsetFrames: 0 });
  });
});
