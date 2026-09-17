// WHAT THE RING SOUNDS LIKE.
//
// The escape-hold ring is a keyboard interface: arrows turn its dial, Enter
// takes the choice, a back cell undoes one. So it sounds like the editor's
// keyboard -- not similar to it, the same, out of the one set of named
// voices (src/sound/keyVoices.ts). Everything here is about WHICH voice and
// WHEN; the voices themselves are not this module's to invent.
//
// Pure, and deliberately so: the two decisions worth getting right are
// decisions about a list (which samples, at what offsets), and a decision
// about a list is testable without an AudioContext, a ring, or a timer.
//
// THE DIAL IS ONE SOUND, whatever turned it. Arrows, Tab and the wheel all
// go through `rotateOneStep`, whose whole doc comment is that everything
// below it is about the dial and nothing about the input that moved it --
// so giving Tab its own voice there would be the first thing to make those
// inputs distinguishable, and the ring's own contract says they must not
// be. Tab's voice is spent on something else entirely (a screen arriving
// from outside the ring), which is the only place in this feature where the
// player is told HOW something happened rather than WHAT happened.

import {
  ARROW_KEY_VOICES,
  BACKSPACE_KEY_VOICE,
  ENTER_KEY_VOICE,
  type ArrowKeyName,
} from '../sound/keyVoices'
import type { TypingSoundPlayOptions } from '../sound/TypingSoundManager'

/**
 * Turning the dial one step. The arrow the ring's own geometry implies:
 * anticlockwise is up, clockwise is down, which is what the arrow keys that
 * drive it already mean (`directionFromKey`).
 */
export function dialStepVoice(direction: 1 | -1): TypingSoundPlayOptions {
  const arrow: ArrowKeyName = direction === -1 ? 'ArrowUp' : 'ArrowDown'
  return ARROW_KEY_VOICES[arrow]
}

/**
 * Taking a choice. Enter, unless the choice UNDOES one -- a way back is a
 * backspace, and the ring has several ("Take your leave", "Leave it",
 * "Change your mind").
 *
 * DECLARED by the cell, never inferred from its id or its icon. Both of
 * those have been tried elsewhere in this app and both are the drift
 * `sanitizeMenu`'s allowlist is a standing complaint about: a hand-kept
 * table of "ids that mean back" goes stale the first time content names a
 * cell something new, and silently -- the cell simply starts sounding like
 * a commit.
 */
export function cellActivationVoice(isBack: boolean | undefined): TypingSoundPlayOptions {
  return isBack ? BACKSPACE_KEY_VOICE : ENTER_KEY_VOICE
}

/**
 * Sweeping the pointer from one cell to another. The dial's own voice, in
 * the direction the dial would have had to turn to get there -- so running
 * the mouse round the ring sounds like turning it, which is what it is.
 *
 * SHORTEST WAY ROUND, because the ring is a ring: from the last cell to the
 * first is one step forward, not `count - 1` steps back. An exact half-lap
 * has no shorter side and resolves forward; nothing about a sound needs that
 * tie broken any more carefully than consistently.
 */
export function hoverStepVoice(fromIndex: number, toIndex: number, count: number): TypingSoundPlayOptions {
  if (count <= 0) return dialStepVoice(1)
  const forward = ((toIndex - fromIndex) % count + count) % count
  return dialStepVoice(forward * 2 <= count ? 1 : -1)
}

/** One sample of the screen-arrival burst: which sample, when, and where. */
export interface BurstNote {
  /** Index into the active sound set's samples. */
  assetIndex: number
  /** Offset from the start of the burst. */
  delayMs: number
  /**
   * Which cell this note belongs to, counted from the ring's top. The cell
   * POPS IN on this note, so the sound and the thing appearing are one
   * event rather than two that happen to be scheduled alike -- and it is
   * what the note is panned by.
   */
  slot: number
}

/** The gap between the burst's notes, when nothing shortens it. */
export const BURST_GAP_MS = 50

/**
 * HOW FAR APART THE NOTES FALL: fifty milliseconds, unless that would make
 * the burst outlast a page-up scroll, in which case the whole burst is
 * squeezed into that time instead.
 *
 * `t` is the user's own smooth-scroll duration (ScrollCurvePlan's
 * `getRenderScrollTotalTimeSec`) -- the same live value the ring's rotation
 * curve already borrows rather than inventing a dial-specific one
 * (escapeHoldRotationCurve.ts). It is the app's standing answer to "how long
 * may a thing take to arrive", so a screen that announces itself for longer
 * than a page takes to turn is announcing itself for too long by the app's
 * own measure.
 *
 * `n - 1` gaps join `n` notes, so the last note lands at exactly `t`. A
 * single-choice screen has no gap to divide and takes the default; so does a
 * `t` of zero or nonsense, because a burst with no spacing at all is one
 * sound rather than a count.
 */
export function burstGapMs(choiceCount: number, totalTimeSec: number): number {
  if (choiceCount <= 1) return BURST_GAP_MS
  if (!Number.isFinite(totalTimeSec) || totalTimeSec <= 0) return BURST_GAP_MS
  return Math.min(BURST_GAP_MS, (totalTimeSec * 1000) / (choiceCount - 1))
}

/**
 * HOW LONG A CELL TAKES TO ARRIVE -- half a page-up scroll -- and therefore
 * HOW LONG ITS NOTE IS HELD BACK. One function because those are one
 * quantity: the cell fades and grows into place over this, and its note
 * lands on the moment it gets there rather than on the moment it sets off.
 * Two numbers here would be a sound that drifts off the thing it announces.
 *
 * Read by the panel for both -- the animation's duration goes to the CSS as
 * a custom property, the same value offsets the note's timer -- so the
 * reader's Scrolling Behavior sliders set the feel of this the way they set
 * the dial's rotation. A nonsense `t` falls back to the same default the
 * gap does, since at that point neither has a duration to divide.
 */
export function cellArrivalMs(totalTimeSec: number): number {
  if (!Number.isFinite(totalTimeSec) || totalTimeSec <= 0) return BURST_GAP_MS
  return (totalTimeSec * 1000) / 2
}

/**
 * WHERE A CELL IS, as the sound manager's pan takes it (-1 leftmost, 1
 * rightmost).
 *
 * Fed from the ring's OWN geometry (`computeEscapeHoldPointAtSlot`, the same
 * function that positions the button) rather than from an angle recomputed
 * here: the ring is a rounded square, not a circle, so its cells are not
 * evenly spread across the width and a second opinion about where a cell is
 * would pan the sound somewhere the cell is not.
 *
 * This is mode-B pan -- the caller-supplied position the spatial slider
 * already knows how to weigh (TypingSoundPlayOptions.pan). Passing it is the
 * whole of "obey the slider": at neutral the manager ignores it, dialled
 * towards B it applies it, and none of that is re-decided here.
 */
export function panForRingX(x: number, ringHalfWidthPx: number): number {
  if (!(ringHalfWidthPx > 0)) return 0
  return Math.max(-1, Math.min(1, x / ringHalfWidthPx))
}

/**
 * A NEW SCREEN, ANNOUNCED: one ordinary key sound per choice on it, all
 * different, fifty milliseconds apart.
 *
 * It reads as the screen being typed out, and it carries real information --
 * the player hears how many options arrived before the dial has drawn them.
 *
 * ALL DIFFERENT, which is the part that needs arranging. A plain random pick
 * per note repeats about as often as it does not (ten samples, four notes:
 * better than even odds of a collision), and a repeat inside a burst does
 * not read as a coincidence, it reads as one key pressed twice. So the
 * samples are DRAWN WITHOUT REPLACEMENT from a shuffled pool, refilled when
 * a screen has more choices than the set has samples -- at which point a
 * repeat is arithmetic rather than luck, and the refill at least keeps it as
 * far from its first use as it can be.
 *
 * `pick` is injected rather than reaching for `Math.random` so this is a
 * function of its inputs: the test asserts distinctness and spacing, not a
 * particular shuffle.
 */
export function planScreenBurst(
  choiceCount: number,
  assetCount: number,
  gapMs: number = BURST_GAP_MS,
  pick: (upperExclusive: number) => number = (upper) => Math.floor(Math.random() * upper),
): BurstNote[] {
  const notes: BurstNote[] = []
  if (choiceCount <= 0 || assetCount <= 0) return notes

  let pool: number[] = []
  for (let index = 0; index < choiceCount; index += 1) {
    if (pool.length === 0) pool = Array.from({ length: assetCount }, (_, at) => at)
    const taken = pool.splice(Math.min(pick(pool.length), pool.length - 1), 1)[0]
    notes.push({ assetIndex: taken, delayMs: index * gapMs, slot: index })
  }
  return notes
}

/**
 * A burst note as the sound manager takes it.
 *
 * No `keyId`, and that is the whole trick: a keyId PINS a sample together
 * with its detune and its channel flips (`getSoundAttributes` caches them as
 * one unit), so naming one here would either fight the explicit assetIndex
 * or bake this burst's sample into whatever key shares the id. With no
 * keyId, the manager takes the uncached path, honours the assetIndex it was
 * handed, randomises the rest exactly as it does for an unfamiliar key, and
 * writes nothing to the history.
 */
export function burstNoteVoice(note: BurstNote, pan?: number): TypingSoundPlayOptions {
  return pan === undefined ? { assetIndex: note.assetIndex } : { assetIndex: note.assetIndex, pan }
}
