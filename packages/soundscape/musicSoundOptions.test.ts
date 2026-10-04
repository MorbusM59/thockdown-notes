import { describe, expect, it } from 'vitest'
import {
  fromDisplayLevel,
  nudgeLevel,
  reverbIcon,
  roomIcon,
  SOUND_LEVEL_MAX_DISPLAY,
  toDisplayLevel,
  volumeIcon,
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

describe('sound-option glyphs', () => {
  it('shows the off bar when muted, not a quiet speaker', () => {
    // fa-volume-off is a real level tier (0-32), so it cannot double as the
    // muted mark without the two states becoming indistinguishable.
    expect(volumeIcon(0.8, true)).toBe('fa-solid fa-ban')
    expect(volumeIcon(0, true)).toBe('fa-solid fa-ban')
    expect(volumeIcon(0, false)).toBe('fa-solid fa-volume-off')
  })

  it('splits the volume tiers on the printed numbers 0-32 / 33-65 / 66-99', () => {
    const at = (display: number) => volumeIcon(fromDisplayLevel(display), false)
    // Boundaries, from both sides.
    expect(at(0)).toBe('fa-solid fa-volume-off')
    expect(at(32)).toBe('fa-solid fa-volume-off')
    expect(at(33)).toBe('fa-solid fa-volume-low')
    expect(at(65)).toBe('fa-solid fa-volume-low')
    expect(at(66)).toBe('fa-solid fa-volume-high')
    expect(at(99)).toBe('fa-solid fa-volume-high')
  })

  it('walks the room glyph through all four tiers', () => {
    const at = (display: number) => roomIcon(fromDisplayLevel(display), false)
    expect(at(0)).toBe('fa-solid fa-cube')
    expect(at(24)).toBe('fa-solid fa-cube')
    expect(at(25)).toBe('fa-solid fa-house')
    expect(at(49)).toBe('fa-solid fa-house')
    expect(at(50)).toBe('fa-solid fa-church')
    expect(at(74)).toBe('fa-solid fa-church')
    expect(at(75)).toBe('fa-solid fa-mountain')
    expect(at(99)).toBe('fa-solid fa-mountain')
  })

  it('puts the same bar on every switch that is turned off', () => {
    expect(reverbIcon(true)).toBe('fa-solid fa-ban')
    expect(roomIcon(0.5, true)).toBe('fa-solid fa-ban')
    expect(volumeIcon(0.5, true)).toBe('fa-solid fa-ban')
  })
})
