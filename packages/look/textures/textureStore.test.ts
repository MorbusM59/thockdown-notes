import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTexturePorts, startTextureJob } from './textureStore';

// A terminated Worker fires neither `message` nor `error`, which is what
// leaked a background-work entry per cancelled generation. The fake does the
// same: terminate() silences it for good.
class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  terminated = false;
  constructor() { FakeWorker.last = this; }
  postMessage() {}
  terminate() { this.terminated = true; }
  answer(data: unknown) { if (!this.terminated) this.onmessage?.({ data }); }
}

const request = { width: 1, height: 1, seed: 1, textureStrength: 1, granularity: 1, vSteps: 1 };

describe('startTextureJob', () => {
  // The observer port counts like the desktop's background-work register:
  // one begin, one done.
  const state = { pending: 0 };
  beforeEach(() => {
    state.pending = 0;
    vi.stubGlobal('Worker', FakeWorker);
    installTexturePorts({ beginWork: () => { state.pending += 1; return { done: () => { state.pending -= 1; } }; } });
  });
  afterEach(() => {
    installTexturePorts({});
    vi.unstubAllGlobals();
  });

  it('ends its background work when retired before the worker answers', async () => {
    const job = startTextureJob(request);
    expect(state.pending).toBe(1);
    job.retire();
    await expect(job.answer).rejects.toThrow();
    expect(state.pending).toBe(0);
    expect(FakeWorker.last?.terminated).toBe(true);
  });

  it('ends its background work exactly once, whether answered, retired, or both', async () => {
    const job = startTextureJob(request);
    const worker = FakeWorker.last!;
    startTextureJob(request); // a second job, still running underneath
    expect(state.pending).toBe(2);
    worker.answer({ buffer: new ArrayBuffer(0), mimeType: 'image/webp' });
    await job.answer;
    job.retire();
    job.retire();
    expect(state.pending).toBe(1);
  });
});
