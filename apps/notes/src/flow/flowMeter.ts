/**
 * The live typing flow meter: the model in `flowModel.ts` fed by the editor's
 * keydowns, and its level handed to whatever presents it (the look, the
 * reverb, the caret -- wired in `useFlowFeedback.ts`).
 *
 * What a listener receives is the PRESENTED level: the model's level passed
 * through an exponential follower with time constant `PRESENT_TAU_SEC`. A hit
 * is a step in the model, and a step in a filter, a reverb send or a halo
 * reads as a flicker; the follower turns the steps into a ramp. The one step
 * that is NOT ramped is the unlock (reaching a full meter), shown at once. It is exact for any frame length
 * (`1 - exp(-dt / tau)`), so the frame rate never changes what is shown.
 *
 * The frame loop runs only while something is moving: it starts on a hit and
 * stops once both the model and the presented level are at zero.
 * A meter that is switched off costs one boolean check per keydown.
 */

import { EMPTY_FLOW_STATE, PAUSE_SEC, flowHit, flowLevelAt, isFlowHit, presentedFlow, type FlowState, type FlowTuning } from './flowModel'
import { DEFAULT_FLOW_SETTINGS } from '../shared/flowSettings'

const PRESENT_TAU_SEC = 0.2
/** Below this the presented level is reported as exactly zero, so consumers can switch an effect off rather than hold it at a trace. */
const PRESENT_FLOOR = 0.002

type Listener = (level: number) => void
type KickListener = () => void
type FullListener = (full: boolean) => void

/**
 * FULL FLOW is a STATE, not only a level: it begins when the meter reaches
 * full from below. Consumers that show something only at full (the edge glow)
 * subscribe to it with `subscribeFull`. It ends when
 * the presented level drops below full: the model's hidden buffer above full
 * already carries a reader at the sustaining pace, so no second margin is
 * needed and full flow means the meter at 100%.
 *
 * The KICK is the one-off event marking the state's start: the moment flow
 * is achieved, landed as an event rather than as a value arriving. It also
 * waits `KICK_MIN_INTERVAL_SEC` since the last one, so dropping out and
 * straight back in enters the state again without a second fanfare.
 */
const KICK_MIN_INTERVAL_SEC = 3

let enabled = false
let tuning: FlowTuning = DEFAULT_FLOW_SETTINGS
let state: FlowState = EMPTY_FLOW_STATE
let presented = 0
let lastFrameSec: number | null = null
let frameHandle: number | null = null
const listeners = new Set<Listener>()
const kickListeners = new Set<KickListener>()
const fullListeners = new Set<FullListener>()
let isFull = false
let lastKickSec = -Infinity
let trailFade = { fadeMaxTime: DEFAULT_FLOW_SETTINGS.fadeMaxTime, fadeShape: DEFAULT_FLOW_SETTINGS.fadeShape, lineRamp: DEFAULT_FLOW_SETTINGS.lineRamp }
let trailStrength = DEFAULT_FLOW_SETTINGS.trail
let peakStrength = DEFAULT_FLOW_SETTINGS.peak

/**
 * The TYPING RATE: characters per second over the last `RATE_MEMORY_KEYS`
 * characters typed, for the reader's own reference (the word count panel
 * shows it while they type). A personal figure rather than words per minute,
 * which assumes a word length and a controlled text. A gap longer than the
 * model's `PAUSE_SEC` restarts it, and that long after the last character it
 * is withdrawn (null), so the panel goes back to the word count.
 */
const RATE_MEMORY_KEYS = 10
type RateListener = (charactersPerSecond: number | null) => void
const rateListeners = new Set<RateListener>()
let rateStamps: number[] = []
let rateTimer: ReturnType<typeof setTimeout> | null = null

function publishRate(rate: number | null): void {
  for (const listener of rateListeners) listener(rate)
}

function reportCharacter(now: number): void {
  const last = rateStamps[rateStamps.length - 1]
  if (last !== undefined && now - last > PAUSE_SEC) rateStamps = []
  rateStamps = [...rateStamps, now].slice(-RATE_MEMORY_KEYS)
  if (rateTimer !== null) clearTimeout(rateTimer)
  rateTimer = setTimeout(() => {
    rateTimer = null
    rateStamps = []
    publishRate(null)
  }, PAUSE_SEC * 1000)
  if (rateStamps.length < 2) return
  const span = rateStamps[rateStamps.length - 1] - rateStamps[0]
  if (span > 0) publishRate((rateStamps.length - 1) / span)
}

const nowSec = (): number => performance.now() / 1000

function publish(level: number): void {
  presented = level
  if (isFull && level < 1) setFull(false)
  for (const listener of listeners) listener(level)
}

function setFull(next: boolean): void {
  isFull = next
  for (const listener of fullListeners) listener(next)
}

function frame(): void {
  frameHandle = null
  const now = nowSec()
  const dt = lastFrameSec === null ? 0 : now - lastFrameSec
  lastFrameSec = now
  const target = presentedFlow(flowLevelAt(state, now, tuning))
  let next = presented + (target - presented) * (1 - Math.exp(-dt / PRESENT_TAU_SEC))
  if (target < PRESENT_FLOOR && next < PRESENT_FLOOR) {
    // Only the presentation stops. The model's state is left alone: its level
    // is already nothing, and its interval history is what the next hits build
    // on -- clearing it here wiped the estimate after every early keystroke,
    // so it never warmed up. A stale estimate is restarted by the pause rule.
    publish(0)
    lastFrameSec = null
    return
  }
  if (next < PRESENT_FLOOR) next = 0
  if (next !== presented) publish(next)
  frameHandle = requestAnimationFrame(frame)
}

function ensureRunning(): void {
  if (frameHandle === null) frameHandle = requestAnimationFrame(frame)
}

export const flowMeter = {
  configure(next: { enabled: boolean } & FlowTuning): void {
    tuning = { gainPercent: next.gainPercent, decayPercent: next.decayPercent }
    if (enabled === next.enabled) return
    enabled = next.enabled
    if (!enabled) {
      if (frameHandle !== null) cancelAnimationFrame(frameHandle)
      frameHandle = null
      state = EMPTY_FLOW_STATE
      lastFrameSec = null
      if (presented !== 0) publish(0)
      if (rateTimer !== null) clearTimeout(rateTimer)
      rateTimer = null
      rateStamps = []
      publishRate(null)
    }
  },

  /** Called for every keydown the editor sees while it is editable. */
  reportKey(event: KeyboardEvent): void {
    if (!enabled) return
    if (!isFlowHit(event)) return
    const now = nowSec()
    if (event.key.length === 1) reportCharacter(now)
    const before = flowLevelAt(state, now, tuning)
    state = flowHit(state, now, tuning)
    // The unlock is presented at once rather than ramped: reaching full is
    // the one moment that should land as an event, not as a value arriving.
    if (before < 1 && state.levelAtHit > 1) {
      publish(1)
      if (!isFull) {
        setFull(true)
        if (now - lastKickSec >= KICK_MIN_INTERVAL_SEC) {
          lastKickSec = now
          for (const listener of kickListeners) listener()
        }
      }
    }
    ensureRunning()
  },

  /** The trail's strength, fade, new-row ramp and peak (`flow/flowTrail.ts`); the editor reads them per keystroke (`trailBox`) and per kick (`peakStrength`). */
  configureTrail(trail: { strength: number; peak: number; fadeMaxTime: number; fadeShape: number; lineRamp: number }): void {
    trailFade = { fadeMaxTime: trail.fadeMaxTime, fadeShape: trail.fadeShape, lineRamp: trail.lineRamp }
    trailStrength = trail.strength
    peakStrength = trail.peak
  },

  /** The reader's peak strength, 0..1. */
  peakStrength(): number {
    return peakStrength
  },

  /**
   * What a box left by this keydown should look like, or null when it should
   * leave none. Only a CHARACTER or Space leaves one: Enter is a hit for the
   * meter but types no cell. `level` is the presented flow at the moment of
   * the key times the trail strength, 0..1; `flow/flowTrail.ts` turns it and the fade into alpha.
   */
  trailBox(event: KeyboardEvent): { level: number; fadeMaxTime: number; fadeShape: number; lineRamp: number } | null {
    if (!enabled || presented <= 0 || trailStrength <= 0) return null
    if (event.key.length !== 1 || !isFlowHit(event)) return null
    return { level: Math.min(1, presented) * trailStrength, ...trailFade }
  },

  /** Called once each time flow is achieved (see the kick, above). */
  subscribeKick(listener: KickListener): () => void {
    kickListeners.add(listener)
    return () => {
      kickListeners.delete(listener)
    }
  },

  /** Called with the typing rate (see TYPING RATE, above) on every character, and with null once typing pauses. */
  subscribeRate(listener: RateListener): () => void {
    rateListeners.add(listener)
    return () => {
      rateListeners.delete(listener)
    }
  },

  /**
   * Called with true when full flow begins and false when it ends (see FULL
   * FLOW, above), and at once with true when subscribing during it, so a
   * consumer re-subscribing after a settings change does not lose the state.
   */
  subscribeFull(listener: FullListener): () => void {
    fullListeners.add(listener)
    if (isFull) listener(true)
    return () => {
      fullListeners.delete(listener)
    }
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    listener(presented)
    return () => {
      listeners.delete(listener)
    }
  },
}
