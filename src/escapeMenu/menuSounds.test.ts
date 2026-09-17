import { describe, expect, it } from 'vitest'

import {
  BURST_GAP_MS,
  burstGapMs,
  burstNoteVoice,
  cellActivationVoice,
  cellArrivalMs,
  dialStepVoice,
  hoverStepVoice,
  panForRingX,
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
    const notes = planScreenBurst(4, 10, BURST_GAP_MS, alwaysFirst)
    expect(notes).toHaveLength(4)
    expect(notes.map((note) => note.delayMs)).toEqual([0, BURST_GAP_MS, BURST_GAP_MS * 2, BURST_GAP_MS * 3])
  })

  it('never repeats a sample inside one burst', () => {
    // A repeat does not read as a coincidence, it reads as one key pressed
    // twice -- which is exactly the count the burst exists to convey. Held
    // against BOTH extremes of the pick function, so this asserts the
    // draw-without-replacement and not one lucky shuffle.
    for (const pick of [alwaysFirst, alwaysLast]) {
      const notes = planScreenBurst(10, 10, BURST_GAP_MS, pick)
      expect(new Set(notes.map((note) => note.assetIndex)).size).toBe(10)
    }
  })

  it('refills the pool rather than running out, when a screen has more choices than there are samples', () => {
    const notes = planScreenBurst(13, 10, BURST_GAP_MS, alwaysFirst)
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
    expect(planScreenBurst(0, 10, BURST_GAP_MS, alwaysFirst)).toEqual([])
    expect(planScreenBurst(3, 0, BURST_GAP_MS, alwaysFirst)).toEqual([])
  })

  /**
   * A burst note carries an assetIndex and NO keyId, and that is the whole
   * mechanism rather than an omission: `getSoundAttributes` caches a sample
   * together with its detune and channel flips under a keyId, so naming one
   * would either fight the explicit index or bake this burst's sample into
   * whatever key shares the id.
   */
  it('names a sample without claiming to be a key', () => {
    const voice = burstNoteVoice({ assetIndex: 3, delayMs: 0, slot: 0 })
    expect(voice.assetIndex).toBe(3)
    expect(voice.keyId).toBeUndefined()
  })
})


/**
 * THE BURST MAY NEVER OUTLAST A PAGE TURN. `t` is the reader's own
 * smooth-scroll duration -- the app's standing answer to how long a thing may
 * take to arrive, and the same live value the ring's rotation curve already
 * borrows -- so a screen that announced itself for longer than that would be
 * announcing itself for longer than the app's own measure allows.
 */
describe('how far apart the notes fall', () => {
  it('is fifty milliseconds when the scroll duration leaves room for it', () => {
    // Four notes need three gaps; at 1s of scroll there is room for 50ms each.
    expect(burstGapMs(4, 1)).toBe(BURST_GAP_MS)
  })

  it('squeezes the whole burst into the scroll duration when fifty would overrun', () => {
    // Five notes, four gaps, 100ms of scroll -> 25ms each, and the last note
    // lands at exactly t rather than four times beyond it.
    expect(burstGapMs(5, 0.1)).toBeCloseTo(25, 10)
    expect(burstGapMs(5, 0.1) * 4).toBeCloseTo(100, 10)
  })

  it('never divides by a gap that does not exist', () => {
    // One choice has no gap to divide, and dividing by n-1 would be infinite.
    expect(burstGapMs(1, 0.001)).toBe(BURST_GAP_MS)
    expect(burstGapMs(0, 0.001)).toBe(BURST_GAP_MS)
  })

  it('falls back rather than collapsing the burst into one sound', () => {
    // A zero or nonsense duration would otherwise space every note at 0ms,
    // which is n sounds at once -- exactly not a count.
    expect(burstGapMs(4, 0)).toBe(BURST_GAP_MS)
    expect(burstGapMs(4, Number.NaN)).toBe(BURST_GAP_MS)
    expect(burstGapMs(4, -1)).toBe(BURST_GAP_MS)
  })

  it('reaches the plan, so the notes are actually spaced by it', () => {
    const notes = planScreenBurst(3, 10, 20, alwaysFirst)
    expect(notes.map((note) => note.delayMs)).toEqual([0, 20, 40])
  })
})

describe('how long a cell takes to arrive', () => {
  it('is half a page-up scroll, so it is the reader\'s own number', () => {
    expect(cellArrivalMs(1)).toBeCloseTo(500, 10)
    expect(cellArrivalMs(0.24)).toBeCloseTo(120, 10)
  })

  it('falls back on a duration it cannot halve', () => {
    // Zero would be an icon that never animates and a note with no offset;
    // the same fallback the gap takes, because at that point neither has a
    // duration to divide.
    expect(cellArrivalMs(0)).toBe(BURST_GAP_MS)
    expect(cellArrivalMs(Number.NaN)).toBe(BURST_GAP_MS)
    expect(cellArrivalMs(-1)).toBe(BURST_GAP_MS)
  })

  it('offsets every note equally, so the deal is not bunched or slowed', () => {
    // The offset moves each note onto its OWN cell's landing: the notes stay
    // exactly one gap apart, and the burst still ends one arrival after the
    // last cell set off.
    const arrival = cellArrivalMs(0.2)
    const landings = planScreenBurst(3, 10, 20, alwaysFirst).map((note) => note.delayMs + arrival)
    expect(landings).toEqual([arrival, arrival + 20, arrival + 40])
  })
})

describe('where each note comes from', () => {
  it('names the cell it belongs to, so the sound and the pop-in are one event', () => {
    expect(planScreenBurst(3, 10, BURST_GAP_MS, alwaysFirst).map((note) => note.slot)).toEqual([0, 1, 2])
  })

  it('pans a cell by its share of the ring, and centres what has no width to sit in', () => {
    expect(panForRingX(0, 60)).toBe(0)
    expect(panForRingX(60, 60)).toBe(1)
    expect(panForRingX(-60, 60)).toBe(-1)
    expect(panForRingX(30, 60)).toBeCloseTo(0.5, 10)
    // A point beyond the extent is still a legal pan, not a louder one.
    expect(panForRingX(9999, 60)).toBe(1)
    expect(panForRingX(10, 0)).toBe(0)
  })

  it('carries the pan only when there is one, so a caller that has none is unchanged', () => {
    // The manager reads `pan` only when the spatial slider is dialled towards
    // mode B; passing undefined has to stay distinguishable from passing 0,
    // which is a real position (dead centre).
    expect(burstNoteVoice({ assetIndex: 1, delayMs: 0, slot: 0 })).toEqual({ assetIndex: 1 })
    expect(burstNoteVoice({ assetIndex: 1, delayMs: 0, slot: 0 }, 0)).toEqual({ assetIndex: 1, pan: 0 })
  })
})
