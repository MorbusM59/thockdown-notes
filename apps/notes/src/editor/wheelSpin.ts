// Spin-to-keep-scrolling: a wheel gesture that outlives the hand that made it.
//
// ## What it is
//
// Three quick nudges in the same direction read as a SPIN rather than three
// separate scrolls, and the view keeps going on its own at the rate the spin
// established, coasting to a stop. The user owns both numbers, in
// Options > Animations:
//
//   auto scroll (b)  how close together nudges must be to read as a spin,
//                    10-50ms, plus an OFF position one step to the left of
//                    10 where the whole feature is bypassed.
//   cut off (d_max)  the interval at which the coast is over, 50-500ms.
//   dampen (c)       how fast the coast decays: a = 1/(10*(101-c)), c from 1
//                    to 100, so a runs 0.001 to 0.1 and a HIGHER c damps
//                    harder. Position 0 is off, meaning a = 0 exactly: the
//                    coast never stops on its own. c is the number in the
//                    formula only by way of a; it is also the
//                    shape of the control, and the one it displays -- and
//                    reads gentle-to-heavy left to right with no reversal.
//
// ## The shape of the gesture
//
// A spin is three nudges, so it has two gaps, and their mean d_avg is the
// only thing the coast knows about how hard the wheel was turned. The nth
// simulated nudge follows the last one after
//
//   d_n = d_avg * (1 + n*a)^n
//
// starting with d_0 = d_avg after the third real nudge -- so the coast
// begins at exactly the rate the hand set, which is what makes it feel like
// a continuation rather than an animation that took over. Both the base and
// the exponent grow with n, so the intervals stay nearly flat for a long
// while and then let go quickly: a coast that holds its speed while it is
// useful and does not trail off into a crawl. That is the whole reason for
// the n in the base -- a plain (1+a)^n with an a this small would take
// hundreds of nudges to slow down at all.
//
// ## Why real nudges are ignored for a fixed 500ms
//
// A spin does not end on the nudge that triggers it. The hand is still
// turning, and those trailing nudges arrive while the coast is already
// running -- acting on them would double the scroll rate at exactly the
// moment the user stopped asking for more of it, and treating them as the
// "user interrupted" signal would kill the coast the instant it started.
// The window is a flat 500ms rather than a multiple of the gesture's own
// speed, because the tail of a spin is a property of the HAND -- how long
// it takes to stop turning a wheel -- and not of how fast the wheel was
// going. A fast spin has a short d_avg and the longest tail of all, which
// is precisely the case a proportional window served worst.

/** Slider bounds, in the units the user sets them in. */
export const WHEEL_SPIN_THRESHOLD_MIN_MS = 10
export const WHEEL_SPIN_THRESHOLD_MAX_MS = 50
export const WHEEL_SPIN_THRESHOLD_STEP_MS = 1
/**
 * One step left of the smallest real threshold: spin detection off.
 *
 * A sentinel step rather than a separate toggle, for the same reason the
 * dampen slider has one: the setting is a single number that persists, and
 * "off" is the natural left end of a control whose right end is "easiest to
 * trigger". It is 9 rather than 0 so the track stays contiguous at one step
 * per millisecond -- a 0-50 slider would have eight positions in it that
 * mean nothing. `resolveWheelSpinThresholdMs` turns it into the 0 the rest
 * of the code reads as off.
 */
export const WHEEL_SPIN_THRESHOLD_OFF = WHEEL_SPIN_THRESHOLD_MIN_MS - WHEEL_SPIN_THRESHOLD_STEP_MS
/**
 * The dampen slider steps through c; the decay is a = 1/(10*(101-c)).
 *
 * The inversion inside the formula is what lets the control run in the
 * direction it should: c goes up, a goes up, damping gets heavier, all
 * left to right, so no `reverseScale` is needed and the number on the track
 * rises as the coast gets shorter.
 */
export const WHEEL_SPIN_DAMPEN_DIVISOR_MIN = 1
export const WHEEL_SPIN_DAMPEN_DIVISOR_MAX = 100
export const WHEEL_SPIN_DAMPEN_DIVISOR_STEP = 1
/** The tenfold in a = 1/(10*(101-c)). */
export const WHEEL_SPIN_DAMPEN_DIVISOR_SCALE = 10
/** The 101 in a = 1/(10*(101-c)): one past the top of the range, so c = 100 leaves a divisor of 1. */
export const WHEEL_SPIN_DAMPEN_DIVISOR_PIVOT = WHEEL_SPIN_DAMPEN_DIVISOR_MAX + 1

/**
 * One step below the gentlest real setting, where a is 0 rather than tiny.
 *
 * 1/(10*(101-c)) can be made very small but never zero, and "never slows
 * down" is a genuinely different behaviour from "slows down imperceptibly"
 * -- the coast runs until something stops it. So it gets a position of its
 * own rather than being faked with a large divisor, and the position is a
 * sentinel VALUE rather than a separate boolean because a slider that
 * persists one number is worth more than a tidier type. It sits at the
 * gentle end because that is the direction it continues.
 */
export const WHEEL_SPIN_DAMPEN_ENDLESS = 0

export const DEFAULT_WHEEL_SPIN_THRESHOLD_MS = 20
/** a = 1/810, about 0.0012: a long coast by default, ended by the 10*b limit rather than by decay. */
export const DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR = 20

/** How many nudges make a spin. Two gaps, hence the d_avg the whole coast runs on. */
export const WHEEL_SPIN_NUDGE_COUNT = 3

/**
 * How long real wheel input is swallowed after a spin is registered.
 *
 * See the module comment: this is the hand finishing its own gesture, and a
 * hand takes about as long to stop whatever speed it was turning at.
 */
export const WHEEL_SPIN_GRACE_MS = 500

/**
 * The interval at which the coast is declared over: the user's `d_max`.
 *
 * A geometric decay never reaches zero speed, so something has to call it.
 * This was derived from the spin threshold for a while, on the theory that
 * one number should not need a second; in practice the two answer different
 * questions -- how quick a spin has to be, and how slow a coast may get
 * before it stops being one -- and tying them together meant tuning either
 * could only be done by accepting whatever it did to the other.
 */
export const WHEEL_SPIN_CUTOFF_MIN_MS = 50
export const WHEEL_SPIN_CUTOFF_MAX_MS = 500
export const WHEEL_SPIN_CUTOFF_STEP_MS = 25
export const DEFAULT_WHEEL_SPIN_CUTOFF_MS = 150

export type WheelSpinDirection = -1 | 1

/** A coast in progress. */
export interface WheelSpinCoast {
  direction: WheelSpinDirection
  /** Rows per simulated nudge -- whatever the real nudges were worth. */
  rowsPerNudge: number
  /** The mean gap of the spin that started this, in ms. */
  averageGapMs: number
  /** How many simulated nudges have already fired. */
  firedCount: number
  /** Real nudges arriving before this are the tail of the spin itself. */
  ignoreUntilMs: number
}

export interface WheelSpinState {
  lastNudgeMs: number | null
  lastDirection: WheelSpinDirection | null
  /** Gaps of the current same-direction streak, newest last, at most two. */
  gapsMs: number[]
  coast: WheelSpinCoast | null
}

export function createWheelSpinState(): WheelSpinState {
  return { lastNudgeMs: null, lastDirection: null, gapsMs: [], coast: null }
}

/**
 * What the caller should do about a real wheel nudge.
 *
 * `scroll` is the ordinary case, with no coast running. The rest are what a
 * nudge means to a coast that IS running, and they divide on direction:
 *
 * `stop` is the reader taking it back, and only a nudge the OTHER way means
 * that. It ends the coast and scrolls nothing, so the gesture that stops the
 * page cannot also move it -- you can halt on the line you meant to.
 *
 * A nudge the SAME way is not an interruption at all, it is a request for
 * more of what is already happening, and it gets `extend`: one more nudge of
 * distance, coast untouched. `ignore` still swallows the tail of the spin
 * that started the coast, because those nudges are the hand finishing its
 * own gesture rather than asking for anything.
 *
 * `respin` is three same-way nudges quick enough to be a spin of their own,
 * arriving while a coast runs. It reports the rate they were turned at and
 * leaves the decision to the caller, which is the only party that knows how
 * fast the coast is going right now: adopt it with `refreshWheelSpinCoast`
 * if it is faster, and treat it as an `extend` if it is not. A reader
 * spinning harder wants to go faster; a reader spinning slower than the
 * coast already is has not asked for it to slow down.
 */
export type WheelSpinAction =
  | { kind: 'scroll'; rows: number; startsCoast: boolean }
  | { kind: 'ignore' }
  | { kind: 'stop' }
  | { kind: 'extend'; rows: number }
  | { kind: 'respin'; rows: number; averageGapMs: number }

export interface WheelSpinInput {
  nowMs: number
  direction: WheelSpinDirection
  /** Rows this nudge is worth, always positive. */
  rows: number
  /** The user's `b`, in ms. Callers must not call this module at all when 0. */
  thresholdMs: number
}

/** Starts the streak over at this nudge, without touching a running coast. */
function resetStreak(state: WheelSpinState, nowMs: number, direction: WheelSpinDirection): void {
  state.gapsMs = []
  state.lastNudgeMs = nowMs
  state.lastDirection = direction
}

/** Ends any coast, and forgets the streak that started it. */
export function cancelWheelSpin(state: WheelSpinState): void {
  state.coast = null
  state.gapsMs = []
  state.lastNudgeMs = null
  state.lastDirection = null
}

export function registerWheelSpinNudge(state: WheelSpinState, input: WheelSpinInput): WheelSpinAction {
  const { nowMs, direction, rows, thresholdMs } = input

  if (state.coast) {
    // A nudge the other way is the reader taking it back, and it is the only
    // thing that is -- checked before the grace window, because a hand
    // finishing its own spin does not reverse, so a reversal inside the
    // window is a real one and waiting 500ms to honour it would read as the
    // page ignoring the wheel.
    if (direction !== state.coast.direction) {
      cancelWheelSpin(state)
      return { kind: 'stop' }
    }
    // Still the tail of the spin that started this. See WHEEL_SPIN_GRACE_MS:
    // these nudges are the hand stopping, not a request for more, and
    // extending on them would add the whole tail of every spin.
    if (nowMs < state.coast.ignoreUntilMs) return { kind: 'ignore' }

    // Past the grace, and going the same way. Every one of these is worth an
    // extra nudge; the streak is tracked as well, so three quick ones can be
    // recognised as a fresh spin and offered to the caller.
    const coastGapMs = state.lastNudgeMs === null ? Number.POSITIVE_INFINITY : nowMs - state.lastNudgeMs
    if (state.lastDirection !== direction || coastGapMs > thresholdMs) {
      resetStreak(state, nowMs, direction)
      return { kind: 'extend', rows }
    }

    state.gapsMs.push(coastGapMs)
    state.lastNudgeMs = nowMs
    state.lastDirection = direction
    if (state.gapsMs.length < WHEEL_SPIN_NUDGE_COUNT - 1) {
      return { kind: 'extend', rows }
    }

    const respinGapMs = state.gapsMs.reduce((total, gap) => total + gap, 0) / state.gapsMs.length
    state.gapsMs = []
    // Deliberately does NOT touch the coast: the caller may decline this, and
    // a declined respin must leave the grace window and the rate exactly as
    // they were, or a slower spin would silently mute the next half second of
    // nudges. `refreshWheelSpinCoast` is what adopting it looks like.
    return { kind: 'respin', rows, averageGapMs: respinGapMs }
  }

  const gapMs = state.lastNudgeMs === null ? Number.POSITIVE_INFINITY : nowMs - state.lastNudgeMs
  const continuesStreak = state.lastDirection === direction && gapMs <= thresholdMs

  if (!continuesStreak) {
    resetStreak(state, nowMs, direction)
    return { kind: 'scroll', rows, startsCoast: false }
  }

  state.gapsMs.push(gapMs)
  state.lastNudgeMs = nowMs
  state.lastDirection = direction

  if (state.gapsMs.length < WHEEL_SPIN_NUDGE_COUNT - 1) {
    return { kind: 'scroll', rows, startsCoast: false }
  }

  const averageGapMs = state.gapsMs.reduce((total, gap) => total + gap, 0) / state.gapsMs.length
  state.coast = {
    direction,
    rowsPerNudge: rows,
    averageGapMs,
    firedCount: 0,
    ignoreUntilMs: nowMs + WHEEL_SPIN_GRACE_MS,
  }
  state.gapsMs = []
  // The third nudge is a real one: it scrolls, AND it starts the coast.
  return { kind: 'scroll', rows, startsCoast: true }
}

/**
 * Adopt a `respin`: the coast now runs at the rate that gesture was turned at.
 *
 * Called only by a caller that has decided the new rate is the faster one.
 * The grace window is reopened because the new spin has a tail of its own,
 * exactly as the first one did -- the hand is still turning.
 */
export function refreshWheelSpinCoast(
  state: WheelSpinState,
  nowMs: number,
  averageGapMs: number,
  rowsPerNudge: number,
): void {
  if (!state.coast) return
  state.coast.averageGapMs = averageGapMs
  state.coast.rowsPerNudge = rowsPerNudge
  state.coast.firedCount = 0
  state.coast.ignoreUntilMs = nowMs + WHEEL_SPIN_GRACE_MS
  state.gapsMs = []
}

/**
 * The interval the coast is running at right now, in ms.
 *
 * The same `d_n = d_avg * (1 + n*a)^n` the schedule is built from, read at
 * the nudge the coast has reached rather than the one it starts on -- which
 * is the number a fresh spin has to beat to be worth adopting. Null when no
 * coast is running. Callers that do not advance `firedCount` (the render
 * view rides a precomputed curve instead) measure their own rate and do not
 * use this.
 */
export function currentWheelSpinDelayMs(
  state: WheelSpinState,
  dampenDivisor: number,
): number | null {
  const coast = state.coast
  if (!coast) return null
  const decay = resolveWheelSpinDecay(dampenDivisor)
  const n = coast.firedCount
  const delayMs = coast.averageGapMs * Math.pow(1 + (n * decay), n)
  return Number.isFinite(delayMs) && delayMs > 0 ? delayMs : null
}

/**
 * The threshold the rest of the code runs on: 0 when the slider is off.
 *
 * Everything downstream already treats a non-positive threshold as "do not
 * detect spins", so the off position resolves to that rather than being a
 * second condition every call site has to remember.
 */
export function resolveWheelSpinThresholdMs(thresholdMs: number): number {
  if (!Number.isFinite(thresholdMs) || thresholdMs <= WHEEL_SPIN_THRESHOLD_OFF) return 0
  return Math.min(WHEEL_SPIN_THRESHOLD_MAX_MS, thresholdMs)
}

/** What the auto-scroll slider shows: a plain millisecond count, or the word for its off position. */
export function formatWheelSpinThreshold(thresholdMs: number): string {
  const resolved = resolveWheelSpinThresholdMs(thresholdMs)
  return resolved <= 0 ? 'off' : String(resolved)
}

/** The cut off to actually measure against, whatever the caller passed. */
export function resolveWheelSpinCutoffMs(cutoffMs: number): number {
  if (!Number.isFinite(cutoffMs)) return DEFAULT_WHEEL_SPIN_CUTOFF_MS
  return Math.max(WHEEL_SPIN_CUTOFF_MIN_MS, Math.min(WHEEL_SPIN_CUTOFF_MAX_MS, cutoffMs))
}

/** The decay term a = 1/(10*(101-c)) -- or 0 at the off position, where the coast never ends by itself. */
export function resolveWheelSpinDecay(dampenDivisor: number): number {
  if (!Number.isFinite(dampenDivisor)) return resolveWheelSpinDecay(DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR)
  if (dampenDivisor <= WHEEL_SPIN_DAMPEN_ENDLESS) return 0
  const safeDivisor = Math.max(
    WHEEL_SPIN_DAMPEN_DIVISOR_MIN,
    Math.min(WHEEL_SPIN_DAMPEN_DIVISOR_MAX, dampenDivisor),
  )
  return 1 / (WHEEL_SPIN_DAMPEN_DIVISOR_SCALE * (WHEEL_SPIN_DAMPEN_DIVISOR_PIVOT - safeDivisor))
}

/**
 * How long until the next simulated nudge, or null when the coast is over.
 *
 * `d_n = d_avg * (1 + n*a)^n`, with n counted from the first simulated nudge,
 * and the coast declared finished once that exceeds the user's cut off.
 */
export function nextWheelSpinDelayMs(
  state: WheelSpinState,
  dampenDivisor: number,
  cutoffMs: number,
): number | null {
  const coast = state.coast
  if (!coast) return null
  const decay = resolveWheelSpinDecay(dampenDivisor)
  const n = coast.firedCount
  const delayMs = coast.averageGapMs * Math.pow(1 + n * decay, n)
  if (!Number.isFinite(delayMs) || delayMs <= 0) return null
  // At a = 0 the interval never grows, so the cut off could only ever fire
  // on the first nudge, and only if d_avg exceeded it. Skipping the check
  // outright is the honest reading of the endless position: it says the
  // coast does not end by itself, and a limit that could is a contradiction
  // waiting for an edge case to expose it.
  if (decay === 0) return delayMs
  if (delayMs > resolveWheelSpinCutoffMs(cutoffMs)) return null
  return delayMs
}

/** Records that a simulated nudge fired, and reports what it should scroll. */
export function takeWheelSpinNudge(state: WheelSpinState): { direction: WheelSpinDirection; rows: number } | null {
  const coast = state.coast
  if (!coast) return null
  coast.firedCount += 1
  return { direction: coast.direction, rows: coast.rowsPerNudge }
}

// ---------------------------------------------------------------------------
// Live tunables.
//
// Same shape as ScrollCurvePlan.ts's: the wheel handler needs these at event
// time, deep inside a mount-time effect, where a React prop would mean either
// re-attaching listeners on every slider drag or reading a stale closure. The
// slider writes here; the handler reads here.
// ---------------------------------------------------------------------------

let wheelSpinThresholdMs = DEFAULT_WHEEL_SPIN_THRESHOLD_MS
let wheelSpinDampenDivisor = DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR

export function setWheelSpinThresholdMs(next: number): void {
  wheelSpinThresholdMs = Number.isFinite(next)
    ? Math.max(WHEEL_SPIN_THRESHOLD_OFF, Math.min(WHEEL_SPIN_THRESHOLD_MAX_MS, next))
    : DEFAULT_WHEEL_SPIN_THRESHOLD_MS
}
/** The raw slider position, off sentinel included -- for the control itself. */
export function getWheelSpinThresholdMs(): number { return wheelSpinThresholdMs }
/** The threshold to actually detect spins with: 0 means do not. */
export function getWheelSpinEffectiveThresholdMs(): number {
  return resolveWheelSpinThresholdMs(wheelSpinThresholdMs)
}

let wheelSpinCutoffMs = DEFAULT_WHEEL_SPIN_CUTOFF_MS

export function setWheelSpinCutoffMs(next: number): void {
  wheelSpinCutoffMs = resolveWheelSpinCutoffMs(next)
}
export function getWheelSpinCutoffMs(): number { return wheelSpinCutoffMs }

export function setWheelSpinDampenDivisor(next: number): void {
  wheelSpinDampenDivisor = Number.isFinite(next)
    ? Math.max(WHEEL_SPIN_DAMPEN_ENDLESS, Math.min(WHEEL_SPIN_DAMPEN_DIVISOR_MAX, next))
    : DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR
}
export function getWheelSpinDampenDivisor(): number { return wheelSpinDampenDivisor }
