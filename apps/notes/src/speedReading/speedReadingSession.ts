/**
 * One speed reading session: from Alt+< until any other key or a click.
 *
 * ## Two views, one gesture vocabulary
 * - **Render view** scrolls the page by itself at the reader's words per
 *   minute. Holding Space (or Down) eases the scroll to a stop and releasing
 *   it eases it back up -- the speed curve, `speedEnvelope.ts`.
 * - **Edit view** shows the note a chunk at a time in one row of the box grid
 *   (`speedReadingChunks.ts`, drawn by `SpeedReadingEditOverlay`). A press of
 *   Space (or Down) shows the next chunk at once; holding it carries on at the
 *   reader's words per minute, eased in on the same curve -- the way a held
 *   page key steps once and then travels. Up goes back a chunk.
 * - **Left and Right** lower and raise the words per minute in steps of five:
 *   a tap is one step, a hold accelerates on the same press-and-hold curve the
 *   music player's volume uses (`shared/holdToAdjust.ts`).
 *
 * ## The session holds the keyboard
 * Every key is taken in the window's CAPTURE phase, before the editor or the
 * app's own shortcuts see it, and none of them passes through: Space would
 * otherwise type into the note, the arrows move the caret, and the key that
 * ends the session would go on to do what it does elsewhere. The key that
 * ends it is swallowed on the way up too, because Escape acts on its RELEASE
 * (App.tsx switches views on Escape's keyup). Modifier keys alone neither act
 * nor end it, or Alt+< could never be pressed to end it. A click ends it and
 * goes on to be the click it was.
 *
 * One `requestAnimationFrame` loop drives everything that moves, and it runs
 * only while something does: always in the render view, and in the edit view
 * only while Space or an arrow is held.
 */
import { buildHoldRampPlan, holdFullTravelSec, quantizeHoldTravel, sampleHoldTravel, type HoldRampPlan } from '../shared/holdToAdjust'
import { borrowAutoScrollBehavior } from '@thockdown/interaction/scrollBehaviorLock'
import { cancelSmoothScroll } from '@thockdown/interaction/smoothScrollRegistry'
import { RESTING, stepSpeedEnvelope, type SpeedCurve, type SpeedEnvelopeState } from './speedEnvelope'
import { nextChunk, wordStartAt, type SpeedReadingChunk } from './speedReadingChunks'
import {
  clampWpm,
  SPEED_READING_WPM_MAX,
  SPEED_READING_WPM_MIN,
  SPEED_READING_WPM_STEP,
} from './speedReadingSettings'
import { commitSpeedReadingSettings, getSpeedReadingSettings, setSpeedReadingDisplay } from './speedReadingStore'

export type SpeedReadingSessionTarget =
  | { view: 'edit'; text: string; from: number }
  | { view: 'render'; scroller: HTMLElement }

export interface SpeedReadingSession {
  /** Ends from outside: the note, the view or the slot changed under it. */
  end: () => void
}

/** What the session leaves behind: in the edit view, where reading had got to. */
export interface SpeedReadingSessionResult {
  readOffset: number | null
  /** True when the reader ended it (a key or a click), false when it was ended from outside. */
  byReader: boolean
}

const ADVANCE_CODES = new Set(['Space', 'ArrowDown'])
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Fn'])

/** The longest frame the loop integrates over: a stall resumes rather than lurches. */
const MAX_FRAME_SEC = 0.1

/**
 * The render view's pace is words per minute over the page's words per pixel,
 * and the page says what that is: the blocks on screen are counted, so the
 * font, its size, letter spacing, line height and the pane's width all enter
 * by being what the text is laid out with. Re-counted after every quarter of
 * a screen travelled, and approached over this many seconds rather than
 * jumped to, so a heading or a short paragraph does not jolt the pace.
 */
const DENSITY_SAMPLE_SPAN = 0.25
const DENSITY_SETTLE_SEC = 1
const DENSITY_PROBES = 7
/**
 * A block with almost no words (an image, a rule) is passed at no more than
 * this many times the pace of plain text, so it is seen rather than skipped.
 */
const MAX_PACE_OVER_TEXT = 4
/** Average letters to a word, with its space, for the plain-text estimate. */
const LETTERS_PER_WORD = 6
/** An average letter's width, as a share of the font size. */
const LETTER_WIDTH_EM = 0.5

function countWords(text: string | null): number {
  if (!text) return 0
  let count = 0
  let inWord = false
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    const space = code === 32 || code === 10 || code === 9 || code === 13 || code === 160
    if (!space && !inWord) count += 1
    inWord = !space
  }
  return count
}

/** Words per pixel of plain paragraph text in this pane, from its font metrics. */
function plainTextDensity(scroller: HTMLElement): number {
  const style = getComputedStyle(scroller)
  const fontSize = parseFloat(style.fontSize) || 16
  const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.5
  const letterSpacing = parseFloat(style.letterSpacing) || 0
  const letter = fontSize * LETTER_WIDTH_EM + letterSpacing
  const wordsPerLine = Math.max(1, scroller.clientWidth / (letter * LETTERS_PER_WORD))
  return wordsPerLine / lineHeight
}

/** Words per pixel of what is on screen now, or null where nothing could be counted. */
function measuredDensity(scroller: HTMLElement): number | null {
  const rect = scroller.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const seen = new Set<Element>()
  let words = 0
  let height = 0
  for (let i = 0; i < DENSITY_PROBES; i += 1) {
    const y = rect.top + (rect.height * (i + 0.5)) / DENSITY_PROBES
    const block = document.elementFromPoint(x, y)?.closest('[data-index], [data-tail-index]')
    if (!block || seen.has(block) || !scroller.contains(block)) continue
    seen.add(block)
    words += countWords(block.textContent)
    height += block.getBoundingClientRect().height
  }
  return height > 0 ? words / height : null
}

export function startSpeedReadingSession(
  target: SpeedReadingSessionTarget,
  onEnd: (result: SpeedReadingSessionResult) => void,
): SpeedReadingSession | null {
  const startSettings = getSpeedReadingSettings()
  const wpmKey = target.view === 'edit' ? 'editWpm' : 'renderWpm'
  let wpm = startSettings[wpmKey]
  const widthBoxes = startSettings.rowWidth
  const curve = (): SpeedCurve => {
    const s = getSpeedReadingSettings()
    return { ramp: s.curveRamp, shape: s.curveShape, speedSec: s.curveSpeedSec }
  }

  // Edit view: the chunk on show, and where each earlier one began.
  let chunk: SpeedReadingChunk | null = null
  const history: number[] = []
  let wordCredit = 0
  if (target.view === 'edit') {
    chunk = nextChunk(target.text, wordStartAt(target.text, target.from), widthBoxes)
      ?? nextChunk(target.text, 0, widthBoxes)
    if (!chunk) return null
  }

  // Render view: the scroll position kept in floating point (scrollTop rounds),
  // what was last written, and the page's measured words per pixel.
  const scroller = target.view === 'render' ? target.scroller : null
  // The render pane scrolls smoothly in CSS, which would animate every one of
  // this loop's writes and so retarget itself each frame without moving; any
  // journey already under way is the reader's past, not where they read from.
  if (scroller) cancelSmoothScroll(scroller)
  const releaseScrollBehavior = scroller ? borrowAutoScrollBehavior(scroller) : null
  let position = scroller?.scrollTop ?? 0
  let written = position
  const minimumDensity = scroller ? plainTextDensity(scroller) / MAX_PACE_OVER_TEXT : 0
  let densityTarget = scroller ? Math.max(minimumDensity, measuredDensity(scroller) ?? plainTextDensity(scroller)) : 0
  let density = densityTarget
  let densitySampledAt = position

  let envelope: SpeedEnvelopeState = RESTING
  const heldAdvance = new Set<string>()
  let wpmHold: { key: string; direction: -1 | 1; from: number; plan: HoldRampPlan | null; startMs: number } | null = null
  let rafId: number | null = null
  let lastFrameMs: number | null = null
  let ended = false

  const publish = () => {
    setSpeedReadingDisplay({
      wpm,
      row: chunk ? { text: chunk.text, widthBoxes } : null,
    })
  }

  const advance = (): boolean => {
    if (target.view !== 'edit' || !chunk) return false
    const next = nextChunk(target.text, chunk.end, widthBoxes)
    if (!next) return false
    history.push(chunk.start)
    chunk = next
    publish()
    return true
  }

  const back = () => {
    if (target.view !== 'edit') return
    const start = history.pop()
    if (start === undefined) return
    chunk = nextChunk(target.text, start, widthBoxes) ?? chunk
    publish()
  }

  const needsFrames = () => target.view === 'render' || heldAdvance.size > 0 || wpmHold !== null

  const frame = (nowMs: number) => {
    rafId = null
    if (ended) return
    const dtSec = lastFrameMs === null ? 0 : Math.min(MAX_FRAME_SEC, (nowMs - lastFrameMs) / 1000)
    lastFrameMs = nowMs

    if (wpmHold) {
      const travel = wpmHold.plan
        ? quantizeHoldTravel(sampleHoldTravel(wpmHold.plan, (nowMs - wpmHold.startMs) / 1000), SPEED_READING_WPM_STEP)
        : 0
      const next = clampWpm(wpmHold.from + wpmHold.direction * Math.max(SPEED_READING_WPM_STEP, travel))
      if (next !== wpm) {
        wpm = next
        publish()
      }
    }

    if (target.view === 'edit' && heldAdvance.size > 0) {
      const step = stepSpeedEnvelope(curve(), envelope, 1, dtSec)
      envelope = step.state
      wordCredit += (wpm / 60) * step.fullPaceSec
      while (chunk && wordCredit >= chunk.words) {
        wordCredit -= chunk.words
        if (!advance()) {
          wordCredit = 0
          break
        }
      }
    }

    if (scroller) {
      const step = stepSpeedEnvelope(curve(), envelope, heldAdvance.size > 0 ? 0 : 1, dtSec)
      envelope = step.state
      // Anything else that moved the page -- the wheel, the preview window
      // re-anchoring above the reader -- is where reading now is.
      const actual = scroller.scrollTop
      if (Math.abs(actual - written) > 2) position = actual
      const viewport = scroller.clientHeight
      if (Math.abs(position - densitySampledAt) >= viewport * DENSITY_SAMPLE_SPAN) {
        densitySampledAt = position
        const measured = measuredDensity(scroller)
        if (measured !== null) densityTarget = Math.max(minimumDensity, measured)
      }
      density += (densityTarget - density) * Math.min(1, dtSec / DENSITY_SETTLE_SEC)
      const pxPerSec = (wpm / 60) / Math.max(minimumDensity, density)
      const max = Math.max(0, scroller.scrollHeight - viewport)
      position = Math.min(max, position + pxPerSec * step.fullPaceSec)
      scroller.scrollTop = position
      written = scroller.scrollTop
      // At the end of the page it simply stops moving and waits for a key: a
      // page still being laid out, or one shorter than the pane, would
      // otherwise end the session before it had begun.
    }

    if (needsFrames()) rafId = requestAnimationFrame(frame)
    else lastFrameMs = null
  }

  const ensureFrames = () => {
    if (rafId === null && !ended && needsFrames()) rafId = requestAnimationFrame(frame)
  }

  const swallow = (event: KeyboardEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || MODIFIER_KEYS.has(event.key)) return
    swallow(event)
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey
    if (plain && ADVANCE_CODES.has(event.code)) {
      if (event.repeat || heldAdvance.has(event.code)) return
      const wasHeld = heldAdvance.size > 0
      heldAdvance.add(event.code)
      if (target.view === 'edit' && !wasHeld) {
        envelope = RESTING
        wordCredit = 0
        advance()
      }
      ensureFrames()
      return
    }
    if (plain && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      if (event.repeat) return
      const direction = event.key === 'ArrowRight' ? 1 : -1
      const range = SPEED_READING_WPM_MAX - SPEED_READING_WPM_MIN
      // The volume's feel per STEP: it crosses a hundred steps in one full
      // travel, so a range of more steps takes proportionally longer.
      const steps = range / SPEED_READING_WPM_STEP
      wpmHold = { key: event.key, direction, from: wpm, plan: buildHoldRampPlan(range, holdFullTravelSec() * (steps / 100)), startMs: performance.now() }
      const next = clampWpm(wpm + direction * SPEED_READING_WPM_STEP)
      if (next !== wpm) {
        wpm = next
        publish()
      }
      ensureFrames()
      return
    }
    if (plain && event.key === 'ArrowUp') {
      if (!event.repeat) back()
      return
    }
    if (event.repeat) return
    swallowRelease(event.code)
    end(true)
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (heldAdvance.delete(event.code)) {
      swallow(event)
      if (target.view === 'edit' && heldAdvance.size === 0) wordCredit = 0
      return
    }
    if (wpmHold && event.key === wpmHold.key) {
      swallow(event)
      wpmHold = null
      return
    }
    if (!MODIFIER_KEYS.has(event.key)) swallow(event)
  }

  const releaseAll = () => {
    heldAdvance.clear()
    wpmHold = null
    wordCredit = 0
    if (target.view === 'edit') envelope = RESTING
  }

  const onPointerDown = () => end(true)

  const listeners: Array<[string, EventListener]> = [
    ['keydown', onKeyDown as EventListener],
    ['keyup', onKeyUp as EventListener],
    ['pointerdown', onPointerDown],
    ['blur', releaseAll],
  ]
  for (const [type, listener] of listeners) window.addEventListener(type, listener, true)

  function end(byReader = false) {
    if (ended) return
    ended = true
    for (const [type, listener] of listeners) window.removeEventListener(type, listener, true)
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
    releaseScrollBehavior?.()
    setSpeedReadingDisplay(null)
    if (wpm !== startSettings[wpmKey]) commitSpeedReadingSettings({ ...getSpeedReadingSettings(), [wpmKey]: wpm })
    onEnd({ readOffset: chunk ? chunk.start : null, byReader })
  }

  publish()
  ensureFrames()
  return { end: () => end(false) }
}

/**
 * Swallows the release of the key that ended a session, which arrives after
 * the session's own listeners are gone. Escape acts on its release; without
 * this, ending a session with Escape would also switch views.
 */
function swallowRelease(code: string) {
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code !== code) return
    event.preventDefault()
    event.stopImmediatePropagation()
    done()
  }
  const done = () => {
    window.removeEventListener('keyup', onKeyUp, true)
    window.removeEventListener('blur', done, true)
  }
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('blur', done, true)
}
