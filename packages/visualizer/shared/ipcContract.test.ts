import { describe, expect, it } from 'vitest'
import {
  eventEmitter,
  eventSubscriber,
  invokeBridge,
  registerInvokeHandlers,
  registerSendHandlers,
  sendBridge,
  type EventChannels,
  type InvokeChannels,
  type SendChannels,
} from './ipcContract'

interface DemoApi {
  sum(a: number, b: number): Promise<number>
  name(): Promise<string>
  /** Fire-and-forget. */
  nudge(amount: number): void
  /** An event subscription: in no channel map. */
  onPing(callback: (count: number) => void): () => void
}

const CHANNELS = { sum: 'demo:sum', name: 'demo:name' } as const satisfies InvokeChannels<DemoApi>
const SEND_CHANNELS = { nudge: 'demo:nudge' } as const satisfies SendChannels<DemoApi>
interface DemoEvents { ping: number }
const EVENT_CHANNELS = { ping: 'demo:ping' } as const satisfies EventChannels<DemoEvents>

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

  it('delivers a fire-and-forget message to its handler with its arguments', () => {
    const listeners = new Map<string, (event: string, ...args: unknown[]) => void>()
    const received: number[] = []
    registerSendHandlers<DemoApi, string>(SEND_CHANNELS, { nudge: (_event, amount) => { received.push(amount) } }, (channel, listener) => {
      listeners.set(channel, listener)
    })
    const bridge = sendBridge<DemoApi>(SEND_CHANNELS, (channel, ...args) => listeners.get(channel)!('evt', ...args))
    bridge.nudge(4)
    expect(received).toEqual([4])
  })

  it('carries an event from the emitter to a subscriber until it unsubscribes', () => {
    const listeners = new Map<string, Set<(event: null, ...args: unknown[]) => void>>()
    const subscribe = eventSubscriber<DemoEvents, null>(
      EVENT_CHANNELS,
      (channel, listener) => { listeners.set(channel, (listeners.get(channel) ?? new Set()).add(listener)) },
      (channel, listener) => { listeners.get(channel)?.delete(listener) },
    )
    const target = { send: (channel: string, ...args: unknown[]) => listeners.get(channel)?.forEach((l) => l(null, ...args)) }
    const emit = eventEmitter<DemoEvents>(EVENT_CHANNELS)
    const seen: number[] = []
    const off = subscribe('ping', (count) => { seen.push(count) })
    emit(target, 'ping', 1)
    off()
    emit(target, 'ping', 2)
    expect(seen).toEqual([1])
  })
})
