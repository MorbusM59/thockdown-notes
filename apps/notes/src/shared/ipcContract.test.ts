import { describe, expect, it } from 'vitest'
import { invokeBridge, registerInvokeHandlers, type InvokeChannels } from './ipcContract'

interface DemoApi {
  sum(a: number, b: number): Promise<number>
  name(): Promise<string>
  /** Not a request: excluded from the channel map by type. */
  onPing(callback: () => void): () => void
}

const CHANNELS = { sum: 'demo:sum', name: 'demo:name' } as const satisfies InvokeChannels<DemoApi>

describe('ipcContract', () => {
  it('round-trips a call through the bridge and the registered handler on its channel', async () => {
    const listeners = new Map<string, (event: string, ...args: unknown[]) => unknown>()
    registerInvokeHandlers<DemoApi, string>(
      CHANNELS,
      { sum: (event, a, b) => (event === 'evt' ? a + b : -1), name: async () => 'demo' },
      (channel, listener) => { listeners.set(channel, listener) },
    )
    expect([...listeners.keys()].sort()).toEqual(['demo:name', 'demo:sum'])

    const seen: Array<[string, unknown[]]> = []
    const bridge = invokeBridge<DemoApi>(CHANNELS, async (channel, ...args) => {
      seen.push([channel, args])
      return listeners.get(channel)!('evt', ...args)
    })
    expect(await bridge.sum(2, 3)).toBe(5)
    expect(await bridge.name()).toBe('demo')
    // Arguments are forwarded exactly as given, so an omitted optional stays omitted.
    expect(seen).toEqual([['demo:sum', [2, 3]], ['demo:name', []]])
  })
})
