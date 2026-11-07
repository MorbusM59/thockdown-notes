import { describe, expect, it } from 'vitest'
import {
  fromDisplayLevel,
  nudgeLevel,
  SOUND_LEVEL_MAX_DISPLAY,
  toDisplayLevel,
} from './musicSoundOptions'

describe('sound-option level scale', () => {
  it('prints the full 0-99 range at the ends', () => {
    expect(toDisplayLevel(0)).toBe(0)
    expect(toDisplayLevel(1)).toBe(SOUND_LEVEL_MAX_DISPLAY)
  })

  it('round-trips every display step, so scrolling up and back lands where it started', () => {
    for (let display = 0; display <= SOUND_LEVEL_MAX_DISPLAY; display++) {
      expect(toDisplayLevel(fromDisplayLevel(display))).toBe(display)
    }
  })

  it('clamps values arriving from outside the 0-1 contract', () => {
    expect(toDisplayLevel(-1)).toBe(0)
    expect(toDisplayLevel(4)).toBe(SOUND_LEVEL_MAX_DISPLAY)
    expect(toDisplayLevel(Number.NaN)).toBe(0)
    expect(fromDisplayLevel(1000)).toBe(1)
  })
})

describe('wheel nudging', () => {
  it('moves the printed number by exactly one step per notch', () => {
    const start = fromDisplayLevel(40)
    expect(toDisplayLevel(nudgeLevel(start, -1, false))).toBe(41)
    expect(toDisplayLevel(nudgeLevel(start, 1, false))).toBe(39)
  })

  it('takes ten steps at a time with Shift held', () => {
    const start = fromDisplayLevel(40)
    expect(toDisplayLevel(nudgeLevel(start, -1, true))).toBe(50)
    expect(toDisplayLevel(nudgeLevel(start, 1, true))).toBe(30)
  })

  it('stops at the ends rather than wrapping', () => {
    expect(toDisplayLevel(nudgeLevel(1, -1, true))).toBe(SOUND_LEVEL_MAX_DISPLAY)
    expect(toDisplayLevel(nudgeLevel(0, 1, true))).toBe(0)
  })
})
