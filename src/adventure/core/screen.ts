// What the player is looking at: one question, its options, and what just
// happened.
//
// This is the ONLY thing the game hands to the ring. The ring is an input
// device -- it says how a choice is expressed (an icon and a few words) and
// how many will fit, and it says nothing whatsoever about the bookkeeping
// underneath. So a Screen carries no game concepts at all: no stats, no
// enemies, no levels. Those reach the bars as readouts the director
// assembles, not as anything a screen knows about.
//
// Where each part lands is fixed (see the design document):
//   - `narration` -> the chapter bar, below the editor.
//   - the stats readout -> the tab bar, above it.
//   - a choice's label -> the ring's centre, while that choice is focused.
//   - a choice's `detail` -> the tab bar, replacing the stats readout while
//     that choice is focused. This is how an item or trait shows what it
//     actually does, with numbers computed live rather than written down in
//     advance (see model/modifiers.ts).

/** What the tab bar shows while one particular choice is in the selection spot. */
export interface ChoiceDetail {
  title: string
  /** One line per effect. Already rendered into words, already accurate. */
  lines: string[]
}

export interface Choice {
  /**
   * Stable for as long as this choice means the same thing: it is the
   * ring's React key, so a choice that keeps its id keeps its DOM node, and
   * therefore its focus, when the set around it is rebuilt.
   */
  id: string
  /** A few words. Shown in the ring's centre while focused. */
  label: string
  /** A Font Awesome class string, e.g. `fa-solid fa-fire`. */
  icon: string
  detail?: ChoiceDetail
}

export interface Screen {
  stageId: string
  /** Changes when this is a new question, so the ring resets its dial. */
  screenKey: string
  /** The result of the last choice, and the frame for this one. */
  narration: string
  choices: Choice[]
}

/**
 * The ring stays readable only up to a point, and a stage that offers more
 * than this is a content problem rather than a layout one.
 *
 * It was NINE, leaving room for the three the director added to every
 * screen. The director adds none now, so the whole budget is the stage's --
 * the same twelve, spent entirely on the question being asked instead of
 * three cells' worth of standing furniture.
 *
 * PROVISIONAL, and now known to be TOO HIGH: the ring holds ten cells, not
 * twelve. Twelve sit 37.3px apart at their tightest, against a 44px button,
 * once the reader's rounding and spacing sliders are at maximum -- see
 * `escapeHoldRingCapacity.test.ts`, which computes it from the real layout,
 * and open question 8 in docs/adventure-platform.md. Which way to close the
 * gap is a design decision and has not been taken, so this number is left
 * standing rather than quietly reduced.
 */
export const MAX_STAGE_CHOICES = 12
