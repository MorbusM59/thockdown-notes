import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearHealthLog, createRecovery, HEALTH_LOG_LINES, readHealthLog, reportFailure } from './healthLog'

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  clearHealthLog()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('health log', () => {
  it('keeps the newest lines only, and folds a repeat into a count', () => {
    for (let i = 0; i < HEALTH_LOG_LINES + 20; i++) reportFailure('music', `fault ${i}`)
    reportFailure('music', `fault ${HEALTH_LOG_LINES + 19}`)
    const log = readHealthLog()
    expect(log.length).toBe(HEALTH_LOG_LINES)
    expect(log[0].message).toBe('fault 20')
    expect(log[log.length - 1].count).toBe(2)
  })

  it('restarts once, then gives up until a quiet minute has passed', () => {
    const restart = vi.fn()
    const recovery = createRecovery('soundscape', restart)
    recovery.fail('died')
    vi.advanceTimersByTime(1000)
    expect(restart).toHaveBeenCalledTimes(1)
    recovery.fail('died')
    recovery.fail('died')
    vi.advanceTimersByTime(10_000)
    expect(restart).toHaveBeenCalledTimes(1)
    expect(readHealthLog().map((entry) => entry.message)).toContain('gave up after 1 restarts')
    vi.advanceTimersByTime(60_000)
    recovery.fail('died')
    vi.advanceTimersByTime(1000)
    expect(restart).toHaveBeenCalledTimes(2)
  })

  it('a cancelled restart does not run', () => {
    const restart = vi.fn()
    const recovery = createRecovery('beat', restart)
    recovery.fail('x')
    recovery.cancel()
    vi.advanceTimersByTime(5000)
    expect(restart).not.toHaveBeenCalled()
  })
})
