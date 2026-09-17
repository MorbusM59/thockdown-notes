import { describe, expect, it } from 'vitest'

import {
  BURST_GAP_MS,
  burstNoteVoice,
  cellActivationVoice,
  dialStepVoice,
  hoverStepVoice,
  planScreenBurst,
} from './menuSounds'
import {
  ARROW_KEY_VOICES,
  BACKSPACE_KEY_VOICE,
  ENTER_KEY_VOICE,
} from '../sound/keyVoices'

/** A deterministic stand-in for the shuffle, so a test asserts shape, not luck. */
const alwaysFirst = () => 0
const alwaysLast = (upper: number) => upper - 1

describe('turning the dial', () => {
  it('sounds like the arrow key that would have turned it', () => {
    // Not "an arrow-ish sound": the SAME voice the editor plays, out of the
    // one table (src/sound/keyVoices.ts). A second set of numbers here is
    // how the ring and the editor come to sound different.
    expect(dialStepVoice(-1)).toBe(ARROW_KEY_VOICES.ArrowUp)
    expect(dialStepVoice(1)).toBe(ARROW_KEY_VOICES.ArrowDown)
  })
})

describe('sweeping the pointer across the ring', () => {
  it('sounds like the dial turning the way it would have had to turn', () => {
    expect(hoverStepVoice(0, 1, 8)).toBe(dialStepVoice(1))
    expect(hoverStepVoice(1, 0, 8)).toBe(dialStepVoice(-1))
  })

  it('takes the short way round, because the ring is a ring', () => {
    // From the last cell to the first is one step FORWARD. Read as plain
    // subtraction it is seven steps back, and a mouse moved one cell
    // clockwise would sound like it went the other way.
    expect(hoverStepVoice(7, 0, 8)).toBe(dialStepVoice(1))
    expect(hoverStepVoice(0, 7, 8)).toBe(dialStepVoice(-1))
  })

  it('survives an empty ring rather than dividing by it', () => {
    expect(hoverStepVoice(0, 0, 0)).toBe(dialStepVoice(1))
  })
})

describe('taking a choice', () => {
  it('is an Enter, and a backspace where the cell says it is a way back', () => {
    expect(cellActivationVoice(undefined)).toBe(ENTER_KEY_VOICE)
    expect(cellActivationVoice(false)).toBe(ENTER_KEY_VOICE)
    expect(cellActivationVoice(true)).toBe(BACKSPACE_KEY_VOICE)
  })
})

/**
 * The burst is the one sound here that carries a NUMBER -- the player hears
 * how many options arrived. Two things have to hold for that to be legible:
 * one note per choice, and no note sounding like a repeat of another.
 */
describe('announcing a new screen', () => {
  it('plays one note per choice, fifty milliseconds apart', () => {
    const notes = planScreenBurst(4, 10, alwaysFirst)
    expect(notes).toHaveLength(4)
    expect(notes.map((note) => note.delayMs)).toEqual([0, BURST_GAP_MS, BURST_GAP_MS * 2, BURST_GAP_MS * 3])
  })

  it('never repeats a sample inside one burst', () => {
    // A repeat does not read as a coincidence, it reads as one key pressed
    // twice -- which is exactly the count the burst exists to convey. Held
    // against BOTH extremes of the pick function, so this asserts the
    // draw-without-replacement and not one lucky shuffle.
    for (const pick of [alwaysFirst, alwaysLast]) {
      const notes = planScreenBurst(10, 10, pick)
      expect(new Set(notes.map((note) => note.assetIndex)).size).toBe(10)
    }
  })

  it('refills the pool rather than running out, when a screen has more choices than there are samples', () => {
    const notes = planScreenBurst(13, 10, alwaysFirst)
    expect(notes).toHaveLength(13)
    // Every index is a real one -- the failure this guards is an undefined
    // assetIndex reaching the sound manager, which plays silence.
    for (const note of notes) {
      expect(note.assetIndex).toBeGreaterThanOrEqual(0)
      expect(note.assetIndex).toBeLessThan(10)
    }
    // And the first ten are still all different: the repeat is arithmetic,
    // not carelessness.
    expect(new Set(notes.slice(0, 10).map((note) => note.assetIndex)).size).toBe(10)
  })

  it('is silent for a screen with nothing on it', () => {
    expect(planScreenBurst(0, 10, alwaysFirst)).toEqual([])
    expect(planScreenBurst(3, 0, alwaysFirst)).toEqual([])
  })

  /**
   * A burst note carries an assetIndex and NO keyId, and that is the whole
   * mechanism rather than an omission: `getSoundAttributes` caches a sample
   * together with its detune and channel flips under a keyId, so naming one
   * would either fight the explicit index or bake this burst's sample into
   * whatever key shares the id.
   */
  it('names a sample without claiming to be a key', () => {
    const voice = burstNoteVoice({ assetIndex: 3, delayMs: 0 })
    expect(voice.assetIndex).toBe(3)
    expect(voice.keyId).toBeUndefined()
  })
})
