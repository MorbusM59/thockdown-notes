import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const playerSource = readFileSync(fileURLToPath(new URL('../../public/soundscape-player.js', import.meta.url)), 'utf8');

const SAMPLE_RATE = 8000;
const BLOCK = 128;
const FADE_FRAMES = Math.round(0.05 * SAMPLE_RATE);

/** The player worklet, hosted with the four names an AudioWorkletGlobalScope gives it. */
function createPlayer() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Processor: any;
  const stats: Array<{ queuedFrames: number; dryFrames: number; dryEvents: number }> = [];
  class AudioWorkletProcessor {
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (message: { type: string; queuedFrames: number; dryFrames: number; dryEvents: number }) => {
        if (message.type === 'stats') stats.push(message);
      },
    };
  }
  runInNewContext(playerSource, {
    AudioWorkletProcessor,
    sampleRate: SAMPLE_RATE,
    Float32Array,
    Math,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerProcessor: (_name: string, processor: any) => { Processor = processor; },
  });
  const processor = new Processor();
  const reports: Array<{ generation: number; frames: number }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderer: any = { onmessage: null, postMessage: (message: { generation: number; frames: number }) => reports.push(message) };
  processor.port.onmessage({ data: { type: 'connect', port: renderer } });
  return {
    reports,
    stats,
    /** Deliver a chunk whose four channels all hold `samples`. */
    chunk(generation: number, samples: number[]) {
      const channels = [0, 1, 2, 3].map(() => Float32Array.from(samples));
      renderer.onmessage({ data: { type: 'chunk', generation, channels } });
    },
    /** Play `frames` and return the direct-left output (all four channels are checked equal). */
    play(frames: number): number[] {
      const out: number[] = [];
      for (let done = 0; done < frames; done += BLOCK) {
        const outputs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)], [new Float32Array(BLOCK), new Float32Array(BLOCK)]];
        expect(processor.process([], outputs)).toBe(true);
        for (const channel of [outputs[0][1], outputs[1][0], outputs[1][1]]) expect(Array.from(channel)).toEqual(Array.from(outputs[0][0]));
        out.push(...outputs[0][0]);
      }
      return out;
    },
    stop() {
      processor.port.onmessage({ data: { type: 'stop' } });
      return processor.process([], [[new Float32Array(BLOCK)], [new Float32Array(BLOCK)]]);
    },
  };
}

const ramp = (from: number, count: number) => Array.from({ length: count }, (_, index) => (from + index) / 100000);
const constant = (value: number, count: number) => Array.from({ length: count }, () => value);

describe('soundscape player', () => {
  it('plays chunks back to back with nothing lost or repeated, whatever their size', () => {
    // Chunk sizes that fall mid-block, at a block edge, and span several blocks.
    const sizes = [300, 128, 1, 2048, 77, 513, 4096];
    const player = createPlayer();
    const sent: number[] = [];
    for (const size of sizes) {
      const samples = ramp(sent.length, size);
      player.chunk(1, samples);
      sent.push(...samples);
    }
    const played = player.play(Math.floor(sent.length / BLOCK) * BLOCK);
    expect(played).toEqual(sent.slice(0, played.length).map((value) => Math.fround(value)));
  });

  it('plays silence while nothing is queued, then resumes where it stopped', () => {
    const player = createPlayer();
    player.chunk(1, ramp(0, 200));
    const first = player.play(256);
    expect(first.slice(200)).toEqual(constant(0, 56));
    player.chunk(1, ramp(200, 256));
    expect(player.play(128)).toEqual(ramp(200, 128).map((value) => Math.fround(value)));
  });

  it('crossfades to a new generation within the crossfade and never plays the old one again', () => {
    const player = createPlayer();
    player.chunk(1, constant(1, 8192));
    player.play(1024);
    player.chunk(2, constant(2, 8192));
    const fade = player.play(Math.ceil(FADE_FRAMES / BLOCK) * BLOCK);
    // Equal-power: old x cos + new x sin, the angle reaching a quarter turn
    // on the fade's last frame.
    fade.slice(0, FADE_FRAMES).forEach((value, index) => {
      const t = (index + 1) / FADE_FRAMES;
      expect(value).toBeCloseTo((1 * Math.cos(t * Math.PI / 2)) + (2 * Math.sin(t * Math.PI / 2)), 5);
    });
    expect(fade.slice(FADE_FRAMES)).toEqual(constant(2, fade.length - FADE_FRAMES));
    expect(player.play(2048)).toEqual(constant(2, 2048));
  });

  it('after a burst of changes plays only the newest, and the ones in between never', () => {
    const player = createPlayer();
    player.chunk(1, constant(1, 8192));
    player.play(512);
    // Generation 2 starts fading in; 3 arrives and is replaced by 4 before
    // it ever plays.
    player.chunk(2, constant(2, 8192));
    player.chunk(3, constant(3, 8192));
    player.chunk(4, constant(4, 8192));
    const heard = player.play(4096);
    expect(heard.some((value) => Math.abs(value - 3) < 1e-6)).toBe(false);
    expect(heard.slice(-1024)).toEqual(constant(4, 1024));
    // Within two crossfades of the burst.
    const settled = heard.findIndex((value) => value === 4);
    expect(settled).toBeLessThanOrEqual(2 * Math.ceil(FADE_FRAMES / BLOCK) * BLOCK);
  });

  it('discards a late chunk of a generation already replaced', () => {
    const player = createPlayer();
    player.chunk(1, constant(1, 4096));
    player.chunk(2, constant(2, 4096));
    player.play(2048);
    player.chunk(1, constant(9, 4096));
    expect(player.play(2048).includes(9)).toBe(false);
  });

  it('reports every frame it plays, against the generation it played it from', () => {
    const player = createPlayer();
    player.chunk(1, constant(1, 10000));
    player.play(8192);
    const total = player.reports.filter((report) => report.generation === 1).reduce((sum, report) => sum + report.frames, 0);
    // Reported in batches of at least REPORT_FRAMES; whatever is short of a
    // batch is still owed, never lost.
    expect(total).toBeLessThanOrEqual(8192);
    expect(8192 - total).toBeLessThan(2048);
    for (const report of player.reports) expect(report.frames).toBeGreaterThanOrEqual(2048);
  });

  it('counts the silence it plays for want of audio, and how many times it began', () => {
    const player = createPlayer();
    player.chunk(1, constant(1, 1000));
    player.play(2048);
    player.chunk(1, constant(1, 3000));
    // To 8192 frames in all: statistics are posted every 8192.
    player.play(8192 - 2048);
    const last = player.stats.at(-1)!;
    // Dry from frame 1000 to 2048, then from 5048 (2048 + 3000) to 8192.
    expect(last.dryEvents).toBe(2);
    expect(last.dryFrames).toBe((2048 - 1000) + (8192 - 5048));
    expect(last.queuedFrames).toBe(0);
  });

  it('reports what the playing generation has left', () => {
    const player = createPlayer();
    player.chunk(1, constant(1, 20000));
    player.play(8192);
    expect(player.stats.at(-1)).toEqual({ type: 'stats', queuedFrames: 20000 - 8192, dryFrames: 0, dryEvents: 0 });
  });

  it('ends when stopped', () => {
    expect(createPlayer().stop()).toBe(false);
  });
});
