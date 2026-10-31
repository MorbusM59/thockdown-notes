/**
 * The visualizer mode's swaying glaze: a slow camera drifting over glaze
 * layers that sit at different DEPTHS, so the near ones travel further than
 * the far ones and the layers shift against each other.
 *
 * The motion is the CAMERA's, shared by every layer and scaled by each
 * layer's depth, which is what makes it read as parallax rather than as
 * several things wobbling. A small share of each layer's motion is its own
 * (`OWN_SHARE`), so no two layers ever move in exact proportion. Each axis is
 * two sines at periods that share no common multiple worth noticing, so the
 * path never visibly repeats.
 *
 * THE MUSIC BREATHES THROUGH IT (`MusicBreath`): the bass level against its
 * own long average (MilkDrop's `bass_att`), heavily smoothed, widens the
 * sway and quickens it a little while a passage is louder than usual, and
 * lets it settle to a calm drift with no music at all. It follows passages,
 * never beats: a beat would show as a jerk.
 *
 * The layers are moved by `transform` alone on elements that are promoted to
 * their own compositor layers (`visualizer.css`), so a frame repaints
 * nothing: the gradients are rasterized once and only composited again.
 */

/** The part of each layer's motion that is its own rather than the camera's. */
const OWN_SHARE = 0.18
/** Vertical motion relative to horizontal: a sway, wider than it is tall. */
const VERTICAL_SHARE = 0.6
/** The camera's periods, in seconds at normal speed, two per axis. */
const PERIODS_X = [23, 9.7] as const
const PERIODS_Y = [31, 13.3] as const
const WEIGHTS = [0.7, 0.3] as const
const GOLDEN = 0.6180339887498949

/**
 * Layer `index`'s depth (0 the nearest, at 1) for a range spread of `spread`
 * (0 to 1, Options > Visualizer > Immersive): each layer travels
 * `1 - spread / 2` as far as the one in front of it, so at 0 every layer has
 * the nearest's range and at 1 each has half the range of the one in front.
 */
export function swayDepth(index: number, spread: number): number {
  return (1 - spread / 2) ** index
}

/** How far a layer must reach past the slot on every side so its sway never shows an edge. */
export function swayOverscanPx(amplitudePx: number): number {
  // Both the camera/own split and the two sines' weights sum to 1, so no
  // offset ever exceeds the amplitude itself.
  return Math.ceil(amplitudePx) + 1
}

function wave(phaseSec: number, periods: readonly [number, number], offset: number): number {
  return WEIGHTS[0] * Math.sin((2 * Math.PI * phaseSec) / periods[0] + offset)
    + WEIGHTS[1] * Math.sin((2 * Math.PI * phaseSec) / periods[1] + 2.3 * offset)
}

/**
 * Layer `index`'s offset in px at `phaseSec` (the integrated, music-scaled
 * time) for a layer at `depth` (1 nearest, toward 0 farthest).
 */
export function swayOffset(index: number, depth: number, phaseSec: number, amplitudePx: number): { x: number; y: number } {
  const own = 2 * Math.PI * GOLDEN * (index + 1)
  const x = (1 - OWN_SHARE) * wave(phaseSec, PERIODS_X, 0) + OWN_SHARE * wave(phaseSec * 1.13, PERIODS_X, own)
  const y = (1 - OWN_SHARE) * wave(phaseSec, PERIODS_Y, 1.1) + OWN_SHARE * wave(phaseSec * 0.91, PERIODS_Y, own + 0.7)
  return { x: x * depth * amplitudePx, y: y * depth * amplitudePx * VERTICAL_SHARE }
}

/** Time constants of the bass's long average and of how the sway follows it. */
const AVERAGE_TAU_SEC = 8
const FOLLOW_TAU_SEC = 1.5

/**
 * How much the music is moving the sway: `attack` is the bass power against
 * its own recent average, smoothed, so 1 is "as loud as this music usually
 * is" whatever the track's level, and 0 is silence.
 */
export class MusicBreath {
  private average = 0
  private follow = 0

  /** Takes the bass power (linear) since the last step, `dtSec` ago, and returns the smoothed ratio. */
  step(bassPower: number, dtSec: number): number {
    const dt = Math.max(0, dtSec)
    const power = Number.isFinite(bassPower) && bassPower > 0 ? bassPower : 0
    this.average += (power - this.average) * (1 - Math.exp(-dt / AVERAGE_TAU_SEC))
    const ratio = this.average > 1e-12 ? Math.min(3, power / this.average) : 0
    this.follow += (ratio - this.follow) * (1 - Math.exp(-dt / FOLLOW_TAU_SEC))
    return this.follow
  }

  get value(): number {
    return this.follow
  }
}

/** The widest the music ever makes the sway, as a share of the set range: what a layer's overscan has to cover. */
export const BREATH_AMPLITUDE_MAX = 1.5

/** The sway's width and speed for a breath: calm (0.6 and 0.8) in silence, 1 at the music's usual level, at most `BREATH_AMPLITUDE_MAX` and 1.3. */
export function breathScales(breath: number): { amplitude: number; speed: number } {
  return {
    amplitude: Math.min(BREATH_AMPLITUDE_MAX, 0.6 + 0.4 * breath),
    speed: Math.min(1.3, 0.8 + 0.2 * breath),
  }
}

/**
 * The layers on screen, registered by the component that draws them
 * (`VisualizerGlaze.tsx`) and moved by the loop that reads the music
 * (`VisualizerScene.tsx`), which live in different parts of the tree.
 *
 * A RADIAL layer sways on the closed path above and nothing else: it stays
 * in place and does not answer the snare. A LINEAR stack is ENDLESS: its
 * gradient repeats every `periodPx` along the gradient and is invariant
 * along its stripes, so its whole position is one number, `s`, the distance
 * along the gradient, and any `s` is drawn by the same picture shifted by
 * `s` modulo the period. Its element is laid out with the gradient running
 * along its own x axis and turned to the stack's angle (`VisualizerGlaze.tsx`),
 * so the move is one `translateX` of the wrapped `s`; the element reaches
 * half a period past the screen at either end, which is all the wrap needs.
 * `s` is the sway projected onto the gradient, plus the drift, plus the
 * snare's pushes, none of them bounded.
 */
type SwayLayer = { element: HTMLElement; index: number; depth: number; linear: { periodPx: number; angleDeg: number } | null }
const layers = new Set<SwayLayer>()
/** The nearest layer's range in px at the music's usual level: the reader's setting, published by the component that draws the layers. */
let rangePx = 0

export function setSwayRange(px: number): void {
  rangePx = px
}

export function registerSwayLayer(element: HTMLElement, index: number, depth: number, linear: { periodPx: number; angleDeg: number } | null = null): () => void {
  const layer = { element, index, depth, linear }
  layers.add(layer)
  return () => {
    layers.delete(layer)
    element.style.transform = ''
  }
}

/** The push per hit in px for the nearest stack (signed), the share of it slid back, and the drift in px per second of sway. */
let pushPx = 0
let returnShare = 1
let driftPxPerSec = 0

export function setSwayMotion(push: number, slideBack: number, drift: number): void {
  pushPx = push
  returnShare = slideBack
  driftPxPerSec = drift
}

/**
 * The snare's push along the gradient, in px for the nearest stack. Each hit
 * (the wave's snare response rising, `GridWave.tsx`) adds the push at once;
 * as the response falls on the wave's fall, `returnShare` of it slides back.
 * What is not slid back is KEPT, folded into `keptPx` at the next hit, so a
 * return below 1 moves the stacks on for good: the same distance on every
 * hit, wherever the sway is, since the stacks have no edge to reach.
 */
let keptPx = 0
let lastResponse = 0
let pushInFlight = 0

function pushOffsetPx(response: number): number {
  return pushInFlight * (1 - returnShare * (1 - response))
}

export function setSwaySnare(response: number): void {
  if (response > lastResponse) {
    keptPx += pushOffsetPx(lastResponse)
    // In the drift's direction, so a push hurries the drift along.
    pushInFlight = driftPxPerSec < 0 ? -pushPx : pushPx
  }
  lastResponse = response
}

/** `value` wrapped into [-period/2, period/2). */
export function wrapToPeriod(value: number, period: number): number {
  if (!(period > 0)) return 0
  return value - period * Math.floor(value / period + 0.5)
}

/** Moves every registered layer to where the sway is at `phaseSec`, with the music's breath widening it by `breathAmplitude`. */
export function applySway(phaseSec: number, breathAmplitude: number): void {
  const amplitudePx = rangePx * breathAmplitude
  const pushedPx = keptPx + pushOffsetPx(lastResponse)
  for (const layer of layers) {
    const { x, y } = swayOffset(layer.index, layer.depth, phaseSec, amplitudePx)
    if (layer.linear === null) {
      layer.element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
      continue
    }
    // The gradient's direction on screen (CSS angles run clockwise from up; y points down).
    const radians = (layer.linear.angleDeg * Math.PI) / 180
    const along = x * Math.sin(radians) - y * Math.cos(radians)
    const s = along + layer.depth * (driftPxPerSec * phaseSec + pushedPx)
    layer.element.style.transform = `translate3d(${wrapToPeriod(s, layer.linear.periodPx).toFixed(2)}px, 0, 0)`
  }
}
