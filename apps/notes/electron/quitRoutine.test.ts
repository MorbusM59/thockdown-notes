import { describe, expect, it, vi } from 'vitest'
import { createQuitRoutine, createRequestTracker, within } from './quitRoutine'

describe('createQuitRoutine', () => {
  it('settles, drains, shuts down and exits, in that order, once however often it is asked', async () => {
    const order: string[] = []
    const routine = createQuitRoutine({
      settleWindow: async () => { order.push('settle') },
      drainRequests: async () => { order.push('drain') },
      shutdown: async () => { order.push('shutdown') },
      exit: () => { order.push('exit') },
    })
    const first = routine.quit('window closed')
    const second = routine.quit('quit requested')
    expect(routine.isQuitting()).toBe(true)
    await Promise.all([first, second])
    expect(order).toEqual(['settle', 'drain', 'shutdown', 'exit'])
  })

  it('goes on to close and exit when an earlier step fails', async () => {
    const order: string[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const routine = createQuitRoutine({
      settleWindow: async () => { throw new Error('window gone') },
      drainRequests: async () => { order.push('drain') },
      shutdown: async () => { order.push('shutdown') },
      exit: () => { order.push('exit') },
    })
    await routine.quit('test')
    consoleError.mockRestore()
    expect(order).toEqual(['drain', 'shutdown', 'exit'])
  })
})

describe('within', () => {
  it('stops waiting at the timeout, and never rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await within(new Promise(() => {}), 10, 'hung')
    await within(Promise.reject(new Error('x')), 1000, 'failed')
    warn.mockRestore()
    error.mockRestore()
  })
})

describe('createRequestTracker', () => {
  it('is idle only once every tracked call has settled, rejected ones included', async () => {
    const tracker = createRequestTracker()
    let finish!: () => void
    let fail!: (error: Error) => void
    const slow = tracker.track(() => new Promise<void>((resolve) => { finish = resolve }))
    const failing = tracker.track(() => new Promise<void>((_resolve, reject) => { fail = reject }))
    const quick = tracker.track(() => 'answer')
    expect(quick()).toBe('answer')
    void slow()
    const failed = failing() as Promise<void>
    failed.catch(() => {})
    let idle = false
    void tracker.whenIdle().then(() => { idle = true })
    await Promise.resolve()
    expect(idle).toBe(false)
    fail(new Error('no'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(idle).toBe(false)
    finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(idle).toBe(true)
    expect(tracker.inFlight()).toBe(0)
  })

  it('refuses calls once told to, without counting them', async () => {
    const tracker = createRequestTracker()
    let ran = false
    const call = tracker.track(() => { ran = true })
    tracker.refuseNew()
    await expect(call() as Promise<unknown>).rejects.toThrow('quitting')
    expect(ran).toBe(false)
    expect(tracker.inFlight()).toBe(0)
  })

  it('counts a call that throws synchronously as finished', () => {
    const tracker = createRequestTracker()
    const throwing = tracker.track(() => { throw new Error('bad') })
    expect(() => throwing()).toThrow('bad')
    expect(tracker.inFlight()).toBe(0)
  })
})
