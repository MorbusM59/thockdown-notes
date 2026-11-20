import { afterEach, describe, expect, it, vi } from 'vitest'

type Posted = { kind: string; id: number; text: string }

class FakeWorker {
  static last: FakeWorker | null = null
  posted: Posted[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  constructor() { FakeWorker.last = this }
  postMessage(message: Posted) { this.posted.push(message) }
  finish(id: number) { this.onmessage?.({ data: { kind: 'split', id, ranges: [], done: true } }) }
}

async function loadClient() {
  vi.resetModules()
  vi.stubGlobal('Worker', FakeWorker)
  return import('./documentFactsClient')
}

afterEach(() => { vi.unstubAllGlobals() })

describe('requestFullBlockSplit queue', () => {
  it('keeps one split in the worker and never sends one every asker withdrew', async () => {
    const { requestFullBlockSplit } = await loadClient()
    const settled: string[] = []
    void requestFullBlockSplit('a').then(() => settled.push('a'))
    const stale = new AbortController()
    void requestFullBlockSplit('b', undefined, stale.signal).then(() => settled.push('b'))
    void requestFullBlockSplit('c').then(() => settled.push('c'))
    const worker = FakeWorker.last!
    expect(worker.posted.map((m) => m.text)).toEqual(['a'])

    stale.abort()
    worker.finish(worker.posted[0].id)
    expect(worker.posted.map((m) => m.text)).toEqual(['a', 'c'])
    worker.finish(worker.posted[1].id)
    await Promise.resolve()
    expect(settled).toEqual(['a', 'c'])
  })

  it('still sends a request that one of its askers kept', async () => {
    const { requestFullBlockSplit } = await loadClient()
    void requestFullBlockSplit('a')
    const first = new AbortController()
    void requestFullBlockSplit('b', undefined, first.signal)
    void requestFullBlockSplit('b')
    first.abort()
    const worker = FakeWorker.last!
    worker.finish(worker.posted[0].id)
    expect(worker.posted.map((m) => m.text)).toEqual(['a', 'b'])
  })
})
