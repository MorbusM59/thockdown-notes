import { describe, expect, it, vi } from 'vitest'
import { registerQuitParticipant, settleForQuit } from './quitParticipants'

describe('settleForQuit', () => {
  it('waits for every participant, and a failing one does not stop the others', async () => {
    const done: string[] = []
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const offA = registerQuitParticipant('a', async () => { await new Promise((r) => setTimeout(r, 5)); done.push('a') })
    const offB = registerQuitParticipant('b', async () => { throw new Error('b broke') })
    const offC = registerQuitParticipant('c', () => { done.push('c') })
    await settleForQuit()
    error.mockRestore()
    expect(done.sort()).toEqual(['a', 'c'])
    offA(); offB(); offC()
  })

  it('an unregistered participant is not run, and a replaced one is not removed by its old unregister', async () => {
    const run: string[] = []
    const offOld = registerQuitParticipant('x', () => { run.push('old') })
    const offNew = registerQuitParticipant('x', () => { run.push('new') })
    offOld()
    await settleForQuit()
    offNew()
    await settleForQuit()
    expect(run).toEqual(['new'])
  })
})
