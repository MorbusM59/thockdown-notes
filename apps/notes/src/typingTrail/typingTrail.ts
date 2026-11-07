/**
 * The typing trail: a box traced on the grid lines above and below each
 * character typed, fading away behind the caret, so the eye finds the line
 * being typed in. It is a visual aid only and measures nothing about the
 * typing.
 *
 * A box's alpha is two factors:
 *
 * 1. The trail colour's own alpha (the `flowTrail` highlight colour), which
 *    the box's border is drawn in, so a box at level 1 is exactly that
 *    colour.
 * 2. The box's LEVEL, 0..1, as its opacity: set when the box is created and
 *    then faded by `fadeCurve(t, fadeMaxTime, fadeShape)` to nothing, after
 *    which the box removes itself.
 *
 * The level a new box starts at is what the PREVIOUS box has faded to at
 * that moment plus one step of `gainPercent / 100`, capped at 1 (`nextTrailLevel`);
 * the first box on a new visual row (a wrap or a line break) starts fresh,
 * from one step.
 * So the trail settles in over its first `100 / gainPercent` characters rather
 * than appearing at full strength, holds at full while typing goes on faster
 * than a step fades, and starts again from low after a pause, because by
 * then the previous box has faded. The previous box's current level is
 * computed from its creation level and age, never read back from the DOM, so
 * a keystroke forces no style or layout read.
 */

import { DEFAULT_TYPING_TRAIL_SETTINGS, type TypingTrailSettings } from '../shared/typingTrailSettings'
import { setLiveStyle } from '../shared/liveStyle'

/** Samples per curve: the curve is not one CSS can name, so it becomes a linear keyframe list. */
const SAMPLES = 32

/** `((maxTime - t) / maxTime) ^ (2 ^ shape)`: 1 at t = 0, 0 at t = maxTime. */
export function fadeCurve(t: number, maxTime: number, shape: number): number {
  const left = Math.max(0, Math.min(1, (maxTime - t) / maxTime))
  return left ** (2 ** shape)
}

/** The box a level was last given to: the level it started at and when, in seconds. */
export interface TrailBoxBirth {
  level: number
  bornSec: number
}

/** A box's level `nowSec`: its starting level times the fade since it was created. */
export function trailLevelAt(box: TrailBoxBirth, nowSec: number, settings: TypingTrailSettings): number {
  return box.level * fadeCurve(nowSec - box.bornSec, settings.fadeMaxTime, settings.fadeShape)
}

/** The level a box created `nowSec` starts at: the previous box's current level plus `gainPercent / 100`, at most 1. */
export function nextTrailLevel(previous: TrailBoxBirth | null, nowSec: number, settings: TypingTrailSettings): number {
  const before = previous === null ? 0 : trailLevelAt(previous, nowSec, settings)
  return Math.min(1, before + settings.gainPercent / 100)
}

/** The curve sampled into a linear keyframe list; `map` turns each sample (1 falling to 0) into a keyframe's properties. */
export function curveKeyframes(maxTime: number, shape: number, map: (fade: number) => Keyframe): Keyframe[] {
  const keyframes: Keyframe[] = []
  for (let i = 0; i <= SAMPLES; i += 1) {
    keyframes.push({ ...map(fadeCurve((maxTime * i) / SAMPLES, maxTime, shape)), offset: i / SAMPLES })
  }
  return keyframes
}

/** A keystroke that types a character into the note (a box is left only for these): no shortcut chord, no auto-repeat. */
export function typesCharacter(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>): boolean {
  if ((event.ctrlKey && !event.altKey) || event.metaKey || event.repeat) return false
  return event.key.length === 1
}

/**
 * The caret's TYPING HOLD, 0..1, as `--caret-typing-hold` on the caret
 * (`shared/liveStyle.ts`): a typed character sets it to 1, so the caret
 * stands at the peak of its own blink, and it falls back to 0 on the same
 * fade curve a trail box fades on, so the ordinary blink returns as the
 * trail behind it goes. The blink keyframes take the larger of it and the
 * music's hold (`buildCaretBlinkKeyframesCss`), so neither breaks the other.
 * A frame loop runs only while the hold is falling.
 *
 * The same loop writes the trail's SOURCE, `--typing-trail-source`: the
 * caret's grid cell framed in the trail colour at the level the next box
 * would start at, the last box's level plus one gain step, faded with it
 * (`min(1, (level + gain) x hold)`, the hold and the last box sharing a birth
 * time and a curve). So the frame shows the trail's current strength and
 * goes out with it, with no jump when the fade ends.
 */
let holdStartSec: number | null = null
let holdFrame: number | null = null

function holdStep(): void {
  holdFrame = null
  if (holdStartSec === null) return
  const hold = fadeCurve(nowSec() - holdStartSec, settings.fadeMaxTime, settings.fadeShape)
  if (hold <= 0) {
    holdStartSec = null
    setLiveStyle('--caret-typing-hold', null)
    setLiveStyle('--typing-trail-source', null)
    return
  }
  setLiveStyle('--caret-typing-hold', hold.toFixed(3))
  setLiveStyle('--typing-trail-source', sourceLevel(hold).toFixed(3))
  holdFrame = requestAnimationFrame(holdStep)
}

/** The source frame's level: the next box's starting level, faded by the hold. */
function sourceLevel(hold: number): number {
  return Math.min(1, ((last?.level ?? 0) + settings.gainPercent / 100) * hold)
}

function holdCaret(): void {
  holdStartSec = nowSec()
  setLiveStyle('--caret-typing-hold', '1')
  setLiveStyle('--typing-trail-source', sourceLevel(1).toFixed(3))
  if (holdFrame === null) holdFrame = requestAnimationFrame(holdStep)
}

function releaseCaret(): void {
  if (holdFrame !== null) cancelAnimationFrame(holdFrame)
  holdFrame = null
  holdStartSec = null
  setLiveStyle('--caret-typing-hold', null)
  setLiveStyle('--typing-trail-source', null)
}

let enabled = false
let settings: TypingTrailSettings = DEFAULT_TYPING_TRAIL_SETTINGS
let last: TrailBoxBirth | null = null
/** The visual row (the cell's top, in scroll coordinates) the last box was drawn on. */
let lastRow: number | null = null

const nowSec = (): number => performance.now() / 1000

export const typingTrail = {
  configure(next: { enabled: boolean } & TypingTrailSettings): void {
    const { enabled: nextEnabled, ...rest } = next
    settings = rest
    enabled = nextEnabled
    if (!enabled) {
      last = null
      lastRow = null
      releaseCaret()
    }
  },

  /** Whether this keydown leaves a box: the trail is on and the key types a character. */
  leavesBox(event: KeyboardEvent): boolean {
    return enabled && typesCharacter(event)
  },

  /**
   * The level the box this keydown leaves on visual row `row` should start
   * at, or null when it leaves none. A box on a new row starts fresh, from
   * one step, rather than building on the row above. Records the box as the
   * one the next keystroke builds on, and holds the caret.
   */
  levelFor(event: KeyboardEvent, row: number): number | null {
    if (!enabled || !typesCharacter(event)) return null
    const now = nowSec()
    const level = nextTrailLevel(row === lastRow ? last : null, now, settings)
    last = { level, bornSec: now }
    lastRow = row
    holdCaret()
    return level
  },

  /** The most recent box's level now, for a mark that continues the trail without being a step of it (the caret left behind at a line break). */
  currentLevel(): number {
    return last === null ? 0 : trailLevelAt(last, nowSec(), settings)
  },

  /** Fades a box from `level` to nothing on the trail's curve, then removes it. */
  fadeBox(el: HTMLElement, level: number): void {
    const { fadeMaxTime, fadeShape } = settings
    const animation = el.animate(
      curveKeyframes(fadeMaxTime, fadeShape, (fade) => ({ opacity: level * fade })),
      { duration: fadeMaxTime * 1000, fill: 'forwards' },
    )
    animation.onfinish = () => el.remove()
  },
}
