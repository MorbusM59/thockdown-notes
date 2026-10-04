// WHAT A KEYSTROKE SOUNDS LIKE, named once.
//
// A key's sound is not just a sample: it is a sample PLUS a fixed set of
// options -- an arrow is detuned up and quiet, Enter is detuned down, Tab
// carries a two-tap echo. Those options lived at their call sites, spelled
// out inline, in three different files. That was fine while the editor was
// the only thing with keys.
//
// It stopped being fine the moment a second surface needed the same sounds.
// The escape-hold ring is a keyboard interface too -- arrows turn its dial,
// Enter takes the choice, a back cell undoes one -- and it has to sound like
// the editor's keyboard, not merely similar to it. Copying the numbers into
// a fourth file is how "similar" happens: one of the copies gets tuned and
// the other does not, and nothing says so.
//
// So the voices are DATA, in one place, and every caller plays a named one.
// This is the same argument `TypingSoundManager` already makes against
// itself and loses: its prewarm deliberately skips arrows, backspace, tab
// and undo/redo because "prewarming them would mean guessing those options,
// and guessing wrong would bake a wrong detune/gain/echo into the cached
// bounce". The options were unguessable because they were unwritten. They
// are written now.
//
// NOT a registry of every key. Only the keys whose sound is a FIXED
// decision somebody made. Ordinary characters are not here: their voice is
// "the sample this character always gets", which `keyId` already expresses
// and which varies per character by design.

import type { TypingSoundPlayOptions } from './TypingSoundManager'

/**
 * The arrow keys. Detuned up and played quietly -- a cursor move is smaller
 * than a character.
 *
 * Per DIRECTION, because `keyId` is what pins a sample: all four arrows
 * sounding identical would be one voice, and they are four. A caller that
 * moves in one dimension (the ring's dial) still names a real arrow rather
 * than inventing a fifth id, so it gets a sound the ear has already heard
 * from the editor.
 */
export const ARROW_KEY_VOICES = {
  ArrowUp: { keyId: 'key:ArrowUp', detune: 1200, gain: 0.3 },
  ArrowDown: { keyId: 'key:ArrowDown', detune: 1200, gain: 0.3 },
  ArrowLeft: { keyId: 'key:ArrowLeft', detune: 1200, gain: 0.3 },
  ArrowRight: { keyId: 'key:ArrowRight', detune: 1200, gain: 0.3 },
} as const satisfies Record<string, TypingSoundPlayOptions>

export type ArrowKeyName = keyof typeof ARROW_KEY_VOICES

/**
 * Enter. Detuned DOWN, which is what makes it read as a commit rather than
 * as another character.
 *
 * Carries no `keyId` on purpose, and that is the one voice here where the
 * omission is the decision: Enter draws a fresh random sample every time,
 * so a run of them does not machine-gun one note.
 */
export const ENTER_KEY_VOICE: TypingSoundPlayOptions = { detune: -500 }

/**
 * Backspace. The plainest voice in the set -- no detune, no gain change --
 * because in the editor it arrives through the ordinary text-change path
 * (`deriveTypingSoundKeyId` returns `key:backspace` and nothing else), and a
 * surface with no text to delete has to sound like that path or it is a
 * different key.
 */
export const BACKSPACE_KEY_VOICE: TypingSoundPlayOptions = { keyId: 'key:backspace' }

/** Tab. Loud, with a two-tap echo: the one key in the set that announces itself. */
export const TAB_KEY_VOICE: TypingSoundPlayOptions = {
  keyId: 'key:Tab',
  gain: 0.7,
  echo: { count: 2, delayMs: 80, decay: 0.4 },
}

/** Shift+Tab: the same key going the other way, so the same voice reversed. */
export const SHIFT_TAB_KEY_VOICE: TypingSoundPlayOptions = {
  keyId: 'key:Shift:Tab',
  reverse: true,
  gain: 0.7,
  echo: { count: 2, delayMs: 80, decay: 0.4 },
  detune: 600,
}
