/**
 * The live typing flow meter: the model in `flowModel.ts` fed by the editor's
 * keydowns, and its level handed to whatever presents it (the look, the
 * reverb, the caret -- wired in `useFlowFeedback.ts`).
 *
 * What a listener receives is the PRESENTED level: the model's level passed
 * through an exponential follower with time constant `PRESENT_TAU_SEC`. A hit
 * is a step in the model, and a step in a filter, a reverb send or a halo
 * reads as a flicker; the follower turns the steps into a ramp and turns a
 * break into a quick fall instead of a cut. It is exact for any frame length
 * (`1 - exp(-dt / tau)`), so the frame rate never changes what is shown.
 *
 * The frame loop runs only while something is moving: it starts on a hit or
 * a break and stops once both the model and the presented level are at zero.
 * A meter that is switched off costs one boolean check per keydown.
 */

import { classifyFlowKey, EMPTY_FLOW_STATE, flowHit, flowLevelAt, type FlowState, type FlowTuning } from './flowModel'
import { DEFAULT_FLOW_SETTINGS } from '../shared/flowSettings'

const PRESENT_TAU_SEC = 0.2
/** Below this the presented level is reported as exactly zero, so consumers can switch an effect off rather than hold it at a trace. */
const PRESENT_FLOOR = 0.002

type Listener = (level: number) => void

let enabled = false
let tuning: FlowTuning = DEFAULT_FLOW_SETTINGS
let state: FlowState = EMPTY_FLOW_STATE
let presented = 0
let lastFrameSec: number | null = null
let frameHandle: number | null = null
const listeners = new Set<Listener>()

const nowSec = (): number => performance.now() / 1000

function publish(level: number): void {
  presented = level
  for (const listener of listeners) listener(level)
}

function frame(): void {
  frameHandle = null
  const now = nowSec()
  const dt = lastFrameSec === null ? 0 : now - lastFrameSec
  lastFrameSec = now
  const target = flowLevelAt(state, now, tuning)
  let next = presented + (target - presented) * (1 - Math.exp(-dt / PRESENT_TAU_SEC))
  if (target < PRESENT_FLOOR && next < PRESENT_FLOOR) {
    // Only the presentation stops. The model's state is left alone: its level
    // is already nothing, and its rhythm estimate is what the next hits build
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
    tuning = { thresholdWpm: next.thresholdWpm, buildKeys: next.buildKeys, fadeSec: next.fadeSec, rhythm: next.rhythm }
    if (enabled === next.enabled) return
    enabled = next.enabled
    if (!enabled) {
      if (frameHandle !== null) cancelAnimationFrame(frameHandle)
      frameHandle = null
      state = EMPTY_FLOW_STATE
      lastFrameSec = null
      if (presented !== 0) publish(0)
    }
  },

  /** Called for every keydown the editor sees while it is editable. */
  reportKey(event: KeyboardEvent): void {
    if (!enabled) return
    const kind = classifyFlowKey(event)
    if (kind === 'ignore') return
    state = kind === 'hit' ? flowHit(state, nowSec(), tuning) : EMPTY_FLOW_STATE
    ensureRunning()
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    listener(presented)
    return () => {
      listeners.delete(listener)
    }
  },
}
