import { describe, expect, it } from 'vitest'
import { musicListening, setMusicListening, subscribeMusicPlaying, type MusicListening } from './musicListening'

function fakeListening(): MusicListening & { set(playing: boolean): void } {
  const listeners = new Set<(playing: boolean) => void>()
  let playing = false
  return {
    get isPlaying() { return playing },
    subscribePlaying(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    trackUrl: null,
    currentTime: 0,
    currentDurationSec: 0,
    setCurrentTimeFraction: () => {},
    outputLatencySec: () => 0,
    createSpectrum: () => ({ start: () => {}, stop: () => {}, sample: () => {} }),
    set(next) {
      playing = next
      for (const listener of listeners) listener(next)
    },
  }
}

describe('subscribeMusicPlaying', () => {
  it('follows a listening installed after it subscribed, and lets go of the one before', () => {
    const previous = musicListening()
    const first = fakeListening()
    const second = fakeListening()
    setMusicListening(first)
    const heard: boolean[] = []
    const unsubscribe = subscribeMusicPlaying((playing) => heard.push(playing))
    setMusicListening(second)
    first.set(true)
    second.set(true)
    second.set(false)
    unsubscribe()
    second.set(true)
    expect(heard).toEqual([true, false])
    setMusicListening(previous)
  })

  it('reports a change of play state that the installation itself makes', () => {
    const previous = musicListening()
    setMusicListening(fakeListening())
    const playing = fakeListening()
    playing.set(true)
    const heard: boolean[] = []
    const unsubscribe = subscribeMusicPlaying((next) => heard.push(next))
    setMusicListening(playing)
    expect(heard).toEqual([true])
    unsubscribe()
    setMusicListening(previous)
  })
})
