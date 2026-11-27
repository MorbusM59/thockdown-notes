import { beforeEach, describe, expect, it, vi } from 'vitest'

const music = vi.hoisted(() => ({ pauseMusic: vi.fn(), startMusic: vi.fn(async () => {}) }))
vi.mock('./mobileMusicPlayer', () => music)

import { mixHeard, switchSoundscapeChannel, toggleMix } from './mixTransport'

describe('the mix transport', () => {
  beforeEach(() => {
    music.pauseMusic.mockClear()
    music.startMusic.mockClear()
  })

  it('has something to pause while the music or a soundscape is heard, the schedule\'s included', () => {
    expect(mixHeard(false, false)).toBe(false)
    expect(mixHeard(true, false)).toBe(true)
    expect(mixHeard(false, true)).toBe(true)
  })

  it('pauses both while anything is heard, and never asks for play', () => {
    const setSoundscape = vi.fn()
    const pause = vi.fn()
    toggleMix(true, setSoundscape, pause)
    expect(music.pauseMusic).toHaveBeenCalledOnce()
    expect(pause).toHaveBeenCalledOnce()
    expect(setSoundscape).not.toHaveBeenCalled()
    expect(music.startMusic).not.toHaveBeenCalled()
  })

  it('plays both while nothing is heard', () => {
    const setSoundscape = vi.fn()
    const pause = vi.fn()
    toggleMix(false, setSoundscape, pause)
    expect(music.startMusic).toHaveBeenCalledOnce()
    expect(setSoundscape).toHaveBeenCalledWith('playing')
    expect(pause).not.toHaveBeenCalled()
  })

  it('lets a soundscape switched in join a mix that is heard, and only then', () => {
    const setSoundscape = vi.fn()
    const setChannel = vi.fn()
    switchSoundscapeChannel(true, true, 'paused', setSoundscape, setChannel)
    expect(setSoundscape).toHaveBeenCalledWith('playing')
    setSoundscape.mockClear()
    switchSoundscapeChannel(true, false, 'paused', setSoundscape, setChannel)
    expect(setSoundscape).not.toHaveBeenCalled()
    expect(setChannel).toHaveBeenCalledWith(true)
  })
})
