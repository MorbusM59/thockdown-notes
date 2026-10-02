import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const playerSource = readFileSync(fileURLToPath(new URL('../../public/soundscape-player.js', import.meta.url)), 'utf8');

const BLOCK = 128;

/** The player worklet, hosted with the names an AudioWorkletGlobalScope gives it. */
function createPlayer() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Processor: any;
  class AudioWorkletProcessor {
    port = { onmessage: null as ((event: { data: unknown }) => void) | null };
  }
  runInNewContext(playerSource, {
    AudioWorkletProcessor,
    Math,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerProcessor: (_name: string, processor: any) => { Processor = processor; },
  });
  const processor = new Processor();
  const played: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderer: any = { onmessage: null, postMessage: (message: { frame: number }) => played.push(message.frame) };
  processor.port.onmessage({ data: { type: 'connect', port: renderer } });
  return {
    played,
    /** Deliver a chunk at `startFrame` whose samples are `samples` (right is the negative of left). */
    chunk(startFrame: number, samples: number[]) {
      const left = Float32Array.from(samples);
      const right = Float32Array.from(samples, (value) => -value);
      renderer.onmessage({ data: { type: 'chunk', startFrame, left, right } });
    },
    /** Play `frames` (whole blocks) and return the left channel. */
    play(frames: number): number[] {
      const out: number[] = [];
      for (let done = 0; done < frames; done += BLOCK) {
        const outputs = [[new Float32Array(BLOCK), new Float32Array(BLOCK)]];
        expect(processor.process([], outputs)).toBe(true);
        expect(Array.from(outputs[0][1])).toEqual(Array.from(outputs[0][0], (value) => (value === 0 ? 0 : -value)));
        out.push(...outputs[0][0]);
      }
      return out;
    },
    stop() {
      processor.port.onmessage({ data: { type: 'stop' } });
      return processor.process([], [[new Float32Array(BLOCK), new Float32Array(BLOCK)]]);
    },
  };
}

const counting = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index + 1);
const fround = (values: number[]) => values.map(Math.fround);

describe('soundscape player', () => {
  it('plays chunks back to back with nothing lost or repeated, whatever their size', () => {
    const player = createPlayer();
    let at = 0;
    for (const size of [300, 128, 1, 2048, 77, 513, 4096]) {
      player.chunk(at, counting(at, size));
      at += size;
    }
    const length = Math.floor(at / BLOCK) * BLOCK;
    expect(player.play(length)).toEqual(fround(counting(0, length)));
  });

  it('replaces everything queued from a chunk that starts inside the queue', () => {
    const player = createPlayer();
    player.chunk(0, counting(0, 4096));
    player.play(1024);
    player.chunk(2000, Array.from({ length: 2048 }, () => -1));
    const heard = player.play(3072);
    expect(heard.slice(0, 976)).toEqual(fround(counting(1024, 976)));
    expect(heard.slice(976)).toEqual(Array.from({ length: 2048 }, () => -1).concat(Array(48).fill(0)));
  });

  it('drops the part of a chunk already due, keeping positions as time', () => {
    const player = createPlayer();
    player.chunk(0, counting(0, 256));
    player.play(512);
    // Frames 256..511 played as silence; a chunk from 384 is half late.
    player.chunk(384, counting(384, 256));
    expect(player.play(128)).toEqual(fround(counting(512, 128)));
  });

  it('reports where it has played to', () => {
    const player = createPlayer();
    player.chunk(0, counting(0, 10000));
    player.play(8192);
    expect(player.played.at(-1)).toBe(8192);
    expect(player.played.every((frame, index) => index === 0 || frame > player.played[index - 1])).toBe(true);
  });

  it('ends when stopped', () => {
    expect(createPlayer().stop()).toBe(false);
  });
});
