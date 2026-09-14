// The seam between the escape-hold quick-actions ring (EscapeHoldPanel.tsx)
// and any feature that wants to *live inside* it rather than merely add a
// button to it.
//
// The ring already had one job: show whichever of a fixed set of note
// actions are currently available, run one, and close. That model has no
// room for a feature that takes the ring over for a while and keeps taking
// input -- the adventure game (src/adventure) is the first, but nothing in
// this file knows about it, and nothing about it is game-shaped. A future
// note-picker, a confirm/cancel prompt, or a multi-step wizard would all
// use the same two hooks below without the panel gaining a second special
// case.
//
// Two directions, deliberately separate:
//   - `entryCells` are added to the ordinary quick-actions ring. This is
//     how a feature becomes reachable at all. They are already filtered for
//     availability by whoever supplies them -- the ring's own rule is that
//     an unavailable action drops out entirely rather than rendering
//     disabled, so there is no `disabled` flag here on purpose.
//   - `activeMode`, when non-null, REPLACES the ring wholesale: its cells
//     are the only cells, and its prompt is what the ring's centre reads.
//     The panel contributes nothing of its own while a mode is up, so a
//     mode never has to fight the built-in actions for slots.
//
// Neither direction gives the supplier any control over the ring's
// geometry, animation, focus model, or close behaviour. Those stay the
// panel's own, which is what keeps a mode from having to reimplement the
// dial to be usable.

/**
 * What one cell would DO, shown while that cell is the one you are about to
 * activate.
 *
 * Prose, not a readout: these lines are computed live against the state the
 * player is actually in (an item's "+10% damage" is rendered as "+10% damage
 * (3 held)"), so they are of unpredictable length and cannot be an icon and a
 * value.
 *
 * The `title` is deliberately NOT drawn. It is always the cell's own label,
 * which the ring's centre is already showing at the moment this appears --
 * printing it twice, an inch apart, is noise. It stays here because assistive
 * tech and the tooltip need the lines attributed to something.
 */
export interface EscapeMenuCellDetail {
  title: string
  /** One line per effect. Already rendered into words, already accurate. */
  lines: string[]
}

export interface EscapeMenuCell {
  /**
   * Stable across renders for as long as this cell means the same thing.
   * Used as the React key, so a cell that keeps its id keeps its DOM node
   * (and therefore its focus) when the surrounding set is rebuilt.
   */
  id: string
  /** Shown in the ring's centre while this cell is focused or hovered. */
  label: string
  /** A Font Awesome class string, e.g. `fa-solid fa-fire`. */
  icon: string
  /**
   * Whether activating this cell leaves the menu up. The ring's default is
   * to close on activation -- a quick action does its thing and gets out of
   * the way. A cell that opens or advances a mode sets this, because the
   * whole point of a mode is that the next input also happens here. Note
   * that this is about the MENU, not the mode: a mode's own "leave" cell
   * leaves this false so that quitting closes the ring in one press.
   */
  keepsMenuOpen?: boolean
  /**
   * What this cell would do, for the chapter bar to show while this is the
   * cell in the selection spot. Optional: an ordinary quick action does what
   * its own label says and has nothing to add.
   *
   * It belongs to the CELL rather than to the mode's `status` because it is a
   * fact about this option, authored where the option is. The mode's chrome
   * stays static -- it never learns which cell is focused, so a mode cannot
   * start narrating through the dial (see EscapeMenuModeChrome).
   */
  detail?: EscapeMenuCellDetail
  onSelect: () => void | Promise<void>
}

export interface EscapeMenuReadout {
  /** Stable identity for React keys. */
  key: string
  /**
   * A Font Awesome class string. REQUIRED, not optional: a strip where some
   * readouts are named by a glyph and others by a word is two strips, and the
   * words are what crowd the bar -- eight abbreviations read as a code the
   * player has to learn, where eight icons read as a status line at a glance.
   */
  icon: string
  /**
   * What the readout IS, in words -- read out for assistive tech and shown as
   * the tooltip. Not drawn on the pill: the icon says which quantity this is
   * and the value says how much, and a bar has room for exactly that.
   */
  label: string
  /** Its current value, already formatted. */
  value: string
}

/** One pill on the chrome's strip. Its tooltip is where the detail goes. */
export interface EscapeMenuChromePill {
  key: string
  /** A Font Awesome class string. */
  icon: string
  /** Read out for assistive tech, and the tooltip's first line. */
  label: string
  /** The rest of the tooltip, one line each. */
  detail?: string[]
  /**
   * Lit, as one of a set where exactly one is. The host draws the state; what
   * it MEANS is the mode's business.
   */
  isActive?: boolean
  /**
   * What pressing it does, if anything. A pill without this is a readout, as
   * every pill was until the first one needed to be pressed.
   *
   * THE ONE PLACE A MODE IS TOUCHED OUTSIDE THE RING, and the line is worth
   * stating because the rule it bends is real: every GESTURE a mode has
   * belongs in the ring, because a gesture is a step in the game and the ring
   * is where the game is played. This is not a step. The strip is what the
   * run is CARRYING, and marking one of those to keep is a property of the
   * thing carried -- it can be set at any time, changed freely, and costs
   * nothing until the level ends. Putting it in the ring would make a
   * standing preference into a screen, and one that could only be answered at
   * the moment it is spent.
   *
   * It stays out of the two BARS, which remain untouchable: those carry state
   * and narration, and there is nothing on them that is a thing you have.
   */
  onActivate?: () => void
}

/**
 * One of the stats row's small bordered boxes: a quantity the mode is
 * accumulating, named by an icon rather than a word.
 *
 * The icon's SIDE is not a field. There are two of these and they sit at
 * opposite ends of the strip, so each one's icon goes on its outward side --
 * a property of where the box is, which the host already knows, rather than
 * one more thing for a mode to get backwards.
 */
export interface EscapeMenuChromeMeter {
  key: string
  /** A Font Awesome class string, drawn beside the value as a bare label. */
  icon: string
  /** Read out for assistive tech, and the tooltip. */
  label: string
  /** Already formatted. */
  value: string
}

/** One subdivision of the chrome's rail: a track, with its icon at the foot. */
export interface EscapeMenuChromeGauge {
  key: string
  /** A Font Awesome class string, drawn at the foot of the track. */
  icon: string
  /**
   * How full, 0..1. Clamped by the host; a value outside it is a caller bug,
   * not a layout one.
   *
   * OMITTED means the track exists and its fill is not yet knowable -- the
   * quantity is real and named, the curve that scales it is not written. An
   * empty track says "this is here and has nothing to report"; a zeroed one
   * would say "this is here and the answer is none", which is a different
   * claim and, where the rule is undecided, a false one.
   *
   * A FULL bar stops where a real scrollbar thumb stops -- the same gap to the
   * track's top edge -- so the two readings in the same rail are measured
   * against one geometry rather than each being flush against a different
   * thing. It then rests one `--spacing-large` short of that and strains
   * against the edge on a loop, because a bar that has nothing left to fill
   * otherwise reads as a bar that stopped reporting.
   */
  ratio?: number
  /**
   * A short number under the icon, inside the track -- what the gauge's own
   * quantity has bought so far, where the bar above it is progress toward the
   * next one. Two digits: it is a tally in a column as wide as a scrollbar,
   * not a readout. The host clamps what it draws and leaves the true figure
   * to the tooltip.
   *
   * Omitted draws no number and the bar's floor drops accordingly, so a gauge
   * that counts nothing does not reserve a strip for it.
   */
  count?: number
  label: string
  detail?: string[]
}

/**
 * The button the chrome's toggle slot shows while a mode owns it -- or a
 * RESERVED position, when `onActivate` is absent.
 *
 * Reserved is a third state, distinct from both "a button" and "omitted", and
 * it exists because omitting a control changes the LAYOUT: the positions
 * around the editor are a composition, and dropping one closes the gap it
 * held, moving everything beside it. The word-count panel gained a space it
 * never had the first time a mode left the toggle out. A mode that intends to
 * claim a position later says so by reserving it, and the geometry stays put.
 *
 * A reserved position is inert, not disabled-looking: it draws no icon and
 * takes no press, because a control that looks pressable and does nothing is
 * worse than an empty frame.
 */
export interface EscapeMenuChromeToggle {
  /** A Font Awesome class string. Omitted on a reserved position. */
  icon?: string
  label: string
  isActive: boolean
  /** Omitted RESERVES the position: it holds its space and does nothing. */
  onActivate?: () => void
}

/**
 * WHAT THE CHROME AROUND THE EDITOR SHOWS while a mode owns the slot.
 *
 * The ring's centre is a small circle whose entire job is naming the cell you
 * are about to activate -- it says what one press does, and nothing else. A
 * mode that tries to narrate through it makes the one label a player actually
 * needs harder to read, so a mode does not get to: it hands its standing
 * state here instead, and the host renders it in the space the editor already
 * has for exactly this.
 *
 * ONE RULE COVERS ALL SIX SURFACES: a mode owning a slot owns that slot's
 * chrome. The editor underneath has been emptied, so its word count, its
 * timeline and its scrollbar describe nothing -- a surface this record does
 * not fill goes BLANK rather than falling back to them. Two of the six (the
 * tab bar and the chapter bar) worked this way from the start and the other
 * four did not, which is the drift this record exists to close.
 *
 * Present whenever the mode is, INCLUDING while the menu is down: a mode that
 * owns an editor slot keeps describing itself there whether or not the ring
 * happens to be raised over it.
 */
export interface EscapeMenuModeChrome {
  /**
   * What KIND of thing this slot is showing, for the tab bar's identity
   * pill, where a collection's name would otherwise be ("User Guide" is the
   * existing precedent). That pill is a fixed 120px and clips, so this is a
   * short label -- roughly twelve characters -- not a name.
   */
  title: string
  /**
   * What just happened and what is being asked -- shown on the CHAPTER BAR
   * below the editor, where a reader already looks for "what is going on
   * with this".
   *
   * A LIST, NEWEST FIRST, one pill each, in that bar's own scrolling,
   * fade-masked strip (shared/usePillStripScroll.ts) -- so a mode with a
   * sequence to show pushes the older entries rightward under the fade
   * instead of overwriting them or growing one pill past the bar. One entry
   * is the ordinary case and reads as the single line this used to be;
   * anything that accumulates (a combat round, entry by entry) is the reason
   * it is a list, and WHEN the list is cut back to one is the mode's own
   * decision -- the host neither trims it nor remembers it.
   *
   * Each entry is narrationMarkup.ts's small vocabulary: bold action, italic
   * outcome, and `[fa-solid fa-burst|hit]` where one glyph says what a
   * sentence would.
   */
  narration: readonly string[]
  /**
   * Running state, as pills on the TAB BAR above the editor -- where a
   * reader already looks for "what am I holding". Keep it to a handful.
   */
  readouts: EscapeMenuReadout[]
  /**
   * The button in the slot's toggle position, left of the word-count panel.
   * Omitted means an EMPTY position, not the editor's own line-number /
   * freeze toggle: that button reports on a document this slot is not
   * showing, and a mode must never leave state from underneath it on screen.
   */
  toggle?: EscapeMenuChromeToggle
  /**
   * WHICH one, and where in it -- shown in the note-id position on the
   * CHAPTER BAR, the pill a note uses to say `$SOMETHING` while that bar is
   * in tag mode. The mode formats it; the host only places it.
   *
   * A FIXED width that clips, exactly as the note's own id pill is, and for
   * the same reason turned up a second time: this text changes on every step
   * (`I [Welcome]` to `IV [Character Creation]`), and a pill that hugs it
   * would shove the narration beside it sideways each time. The full text is
   * in its tooltip.
   */
  identity?: string
  /**
   * The button at the head of the CHAPTER BAR, where a note's
   * tags/chapters toggle sits. Omitted leaves it EMPTY, for the same reason
   * `toggle` does -- that button switches between a note's two layers, and a
   * mode has neither.
   */
  barToggle?: EscapeMenuChromeToggle
  /**
   * The two boxes flanking the strip, in the positions a note's word count
   * occupies. What a mode SPENDS goes here, beside what it has spent it on:
   * the strip between them is what the run is carrying, and a currency read
   * from the tab bar a whole editor away from the things it buys was two
   * halves of one thought in two places.
   */
  meters?: {
    leading?: EscapeMenuChromeMeter
    trailing?: EscapeMenuChromeMeter
  }
  /**
   * Two groups of pills across the timeline's width -- `leading` from the
   * left, `trailing` from the right. What a mode is accumulating belongs
   * here, always visible, rather than behind a cell that costs a ring slot
   * on every screen to reach.
   */
  strip?: {
    leading: EscapeMenuChromePill[]
    trailing: EscapeMenuChromePill[]
  }
  /**
   * The button at the far right of the counter row, where a note's
   * manual-snapshot control sits. Omitted leaves it EMPTY, for the same
   * reason `toggle` does: a snapshot button is about a document this slot is
   * not showing.
   */
  action?: EscapeMenuChromeToggle
  /**
   * The scrollbar rail, divided into one track per gauge, top to bottom.
   * A LIST from the first day it exists, because the second gauge is a
   * layout question and answering it once is cheaper than answering it
   * again later against a single-value field.
   */
  gauges?: EscapeMenuChromeGauge[]
}

export interface EscapeMenuMode {
  /** Identifies the feature holding the ring; distinct modes never merge. */
  id: string
  /**
   * Changes exactly when the ring now represents a NEW decision -- a new
   * step, a new set of cells. The panel resets its dial to the top and
   * cancels any in-flight rotation when this changes, so each step starts
   * from a predictable position instead of wherever the previous step's
   * dial happened to be left. Holding it steady across a re-render that did
   * not change the decision leaves the dial alone, which is what makes it
   * safe to rebuild the mode object on every render.
   */
  stepKey: string
  /** The only cells shown while this mode is up. */
  cells: EscapeMenuCell[]
  /** Everything that does not belong in the ring -- see above. */
  status?: EscapeMenuModeChrome
  /**
   * A MODE AND ITS RING ARE ONE UNIT, IN ITS OWN SLOT, and this is one half
   * of saying so.
   *
   * The other half is not a field at all: while a mode owns a slot, that
   * SLOT draws the ring by derivation (SectionEditorArea's
   * `isEscapeHoldActive`), not because whoever opened it also remembered to
   * raise it. That direction matters on restore, where a persisted overlay
   * comes back and a transient "the reader raised it" flag does not -- an
   * overlay that could exist without its ring is half a mode, occupying a
   * slot with nothing in it.
   *
   * "IN ITS OWN SLOT" is the correction a second slot forced, and it is the
   * distinction to hold on to: a mode does NOT compete for the one ring the
   * window has. The quick-actions ring is a transient menu over whatever the
   * reader is looking at, so it follows focus; a mode is a slot's persistent
   * interface that merely borrows the same chrome, so it does not. Treating
   * them as the same thing meant opening a second slot took the game's own
   * interface away from it -- the game still there, still occupying its
   * slot, with no menu -- and made Escape in an unrelated note dismiss it.
   *
   * What it means for this mode when the RING GOES DOWN -- Escape, or a cell
   * that does not keep the menu open.
   *
   * For an ordinary quick action, lowering the ring means nothing: the ring
   * is a launcher and the app carries on. For a mode that IS its feature's
   * whole interface, it means the feature is over -- and leaving the mode
   * "running" behind a lowered ring is exactly how a slot ends up occupied
   * with nothing visible in it and a toggle still lit.
   *
   * Optional, because a mode that survives its ring being lowered is a
   * legitimate thing to be; it just has to say so by omission rather than by
   * the host guessing.
   */
  onDismiss?: () => void
}

export interface EscapeMenuContribution {
  /**
   * Cells added to the ordinary quick-actions ring. Nothing supplies these
   * today -- the one mode that exists is reached from a window control
   * instead -- but they are the other half of the seam and cost one line in
   * the panel: a feature that is LAUNCHED from the ring rather than living
   * inside it belongs here, and would otherwise have to be special-cased
   * into the panel's own cell list the way the built-in actions are.
   */
  entryCells: EscapeMenuCell[]
  activeMode: EscapeMenuMode | null
}

/**
 * The "nothing to contribute" value. A shared frozen constant rather than a
 * fresh `{ entryCells: [], activeMode: null }` per render, so a consumer
 * that memoizes on identity is not defeated by the idle case.
 */
export const EMPTY_ESCAPE_MENU_CONTRIBUTION: EscapeMenuContribution = Object.freeze({
  entryCells: Object.freeze([]) as unknown as EscapeMenuCell[],
  activeMode: null,
})
