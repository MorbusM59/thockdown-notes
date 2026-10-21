/**
 * One speed reading session: the speed reading mode (F2, `useSpeedReading.ts`)
 * running in one view over one note. The mode switching off, the view or the
 * note changing, or the escape ring coming up ends the session; nothing the
 * reader presses inside it does.
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
 * ## Which keys the session takes
 * Its own keys are taken in the window's CAPTURE phase, before the editor or
 * the app's shortcuts see them: Space would otherwise type into the note and
 * the arrows move the caret. In the edit view the editor is read-only while
 * the session runs (`useSpeedReading.ts`), because the note under the reading
 * row is hidden and an edit there would be made blind; plain typing keys are
 * swallowed besides, so they do not move the hidden caret. Everything else passes through and does
 * what it does anywhere: Escape switches views (and the mode reads on in the
 * other one), F2 switches the mode off, a shortcut with a modifier is that
 * shortcut, and a click is a click.
 *
 * Escape's press is also the edit view's moment to hand its position over
 * (`onLeave`): App switches views on Escape's RELEASE, and the caret has to
 * be where reading got to before then for the switch to carry it across.
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
  chunkDurationSec,
  clampWpm,
  SPEED_READING_LETTERS_PER_WORD,
  SPEED_READING_WPM_MAX,
  SPEED_READING_WPM_MIN,
  SPEED_READING_WPM_STEP,
} from './speedReadingSettings'
import { commitSpeedReadingSettings, getSpeedReadingSettings, setSpeedReadingDisplay } from './speedReadingStore'

export type SpeedReadingSessionTarget =
  | { view: 'edit'; text: string; from: number }
  | { view: 'render'; scroller: HTMLElement }

export interface SpeedReadingSession {
  /** Stops the session; the mode, the view or the note changed. */
  end: () => void
  /** Hands the edit view's position over through `onLeave`, as Escape's press does. */
  leave: () => void
}

export interface SpeedReadingSessionHandlers {
  /**
   * Where the edit view's reading has got to, as a source offset: the end of
   * the chunk on show, or the start of a line break's empty one.
   */
  onLeave: (readOffset: number) => void
}

/** A key that edits the note when pressed without a modifier. */
function editsText(event: KeyboardEvent): boolean {
  return event.key.length === 1 || event.key === 'Enter' || event.key === 'Tab'
    || event.key === 'Backspace' || event.key === 'Delete'
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
  const wordsPerLine = Math.max(1, scroller.clientWidth / (letter * SPEED_READING_LETTERS_PER_WORD))
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
  handlers: SpeedReadingSessionHandlers,
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
  let timeCredit = 0
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
  // scrollTop lands on whole device pixels, so a slow page would move in
  // visible one-pixel steps. The whole pixels go to scrollTop and the fraction
  // is drawn as a `translate` on the pane's content and its texture (the
  // texture is a sibling that follows scrollTop through its mask), composited
  // for the session's length so the shift costs no repaint. `translate`, not
  // `transform`, so whatever transform those elements carry is left alone.
  const shifted: HTMLElement[] = scroller
    ? [...scroller.children, scroller.previousElementSibling].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && (el.parentElement === scroller || el.classList.contains('markdown-preview-texture')),
    )
    : []
  for (const el of shifted) el.style.willChange = 'translate'
  let shownFraction = 0
  const showFraction = (fraction: number) => {
    if (fraction === shownFraction) return
    shownFraction = fraction
    const value = fraction === 0 ? '' : `0 ${-fraction}px`
    for (const el of shifted) el.style.translate = value
  }
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
      timeCredit += step.fullPaceSec
      const { fixationMs } = getSpeedReadingSettings()
      while (chunk) {
        const duration = chunkDurationSec(chunk.text, wpm, widthBoxes, fixationMs)
        if (timeCredit < duration) break
        timeCredit -= duration
        if (!advance()) {
          timeCredit = 0
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
      if (Math.abs(actual - written) > 2) {
        position = actual
        showFraction(0)
      }
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
      scroller.scrollTop = Math.floor(position)
      written = scroller.scrollTop
      showFraction(Math.max(0, Math.min(0.999, position - written)))
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

  const leave = () => {
    if (target.view === 'edit' && chunk) handlers.onLeave(chunk.words > 0 ? chunk.end : chunk.start)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || MODIFIER_KEYS.has(event.key)) return
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey
    if (event.key === 'Escape') {
      if (!event.repeat) leave()
      return
    }
    const ownKey = plain && (ADVANCE_CODES.has(event.code) || event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp')
    if (!ownKey) {
      if (target.view === 'edit' && plain && editsText(event)) swallow(event)
      return
    }
    swallow(event)
    if (ADVANCE_CODES.has(event.code)) {
      if (event.repeat || heldAdvance.has(event.code)) return
      const wasHeld = heldAdvance.size > 0
      heldAdvance.add(event.code)
      if (target.view === 'edit' && !wasHeld) {
        envelope = RESTING
        timeCredit = 0
        advance()
      }
      ensureFrames()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
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
    if (!event.repeat) back()
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (heldAdvance.delete(event.code)) {
      swallow(event)
      if (target.view === 'edit' && heldAdvance.size === 0) timeCredit = 0
      return
    }
    if (wpmHold && event.key === wpmHold.key) {
      swallow(event)
      wpmHold = null
      return
    }
  }

  const releaseAll = () => {
    heldAdvance.clear()
    wpmHold = null
    timeCredit = 0
    if (target.view === 'edit') envelope = RESTING
  }

  const listeners: Array<[string, EventListener]> = [
    ['keydown', onKeyDown as EventListener],
    ['keyup', onKeyUp as EventListener],
    ['blur', releaseAll],
  ]
  for (const [type, listener] of listeners) window.addEventListener(type, listener, true)

  function end() {
    if (ended) return
    ended = true
    for (const [type, listener] of listeners) window.removeEventListener(type, listener, true)
    if (rafId !== null) cancelAnimationFrame(rafId)
    rafId = null
    showFraction(0)
    for (const el of shifted) el.style.willChange = ''
    releaseScrollBehavior?.()
    setSpeedReadingDisplay(null)
    if (wpm !== startSettings[wpmKey]) commitSpeedReadingSettings({ ...getSpeedReadingSettings(), [wpmKey]: wpm })
  }

  publish()
  ensureFrames()
  return { end, leave }
}
