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

/** How far the nearest layer travels from rest, as a share of the slot's shorter side. */
export const SWAY_AMPLITUDE_SHARE = 0.035
/** The part of each layer's motion that is its own rather than the camera's. */
const OWN_SHARE = 0.18
/** Vertical motion relative to horizontal: a sway, wider than it is tall. */
const VERTICAL_SHARE = 0.6
/** The camera's periods, in seconds at normal speed, two per axis. */
const PERIODS_X = [23, 9.7] as const
const PERIODS_Y = [31, 13.3] as const
const WEIGHTS = [0.7, 0.3] as const
const GOLDEN = 0.6180339887498949

/** The nearest layer's amplitude for a slot of `widthPx` by `heightPx`. */
export function swayAmplitudePx(widthPx: number, heightPx: number): number {
  return SWAY_AMPLITUDE_SHARE * Math.min(widthPx, heightPx)
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

/** The sway's width and speed for a breath: calm (0.6 and 0.8) in silence, 1 at the music's usual level, at most 1.5 and 1.3. */
export function breathScales(breath: number): { amplitude: number; speed: number } {
  return {
    amplitude: Math.min(1.5, 0.6 + 0.4 * breath),
    speed: Math.min(1.3, 0.8 + 0.2 * breath),
  }
}

/**
 * The layers on screen, registered by the component that draws them
 * (`VisualizerGlaze.tsx`) and moved by the loop that reads the music
 * (`VisualizerScene.tsx`), which live in different parts of the tree.
 */
type SwayLayer = { element: HTMLElement; index: number; depth: number }
const layers = new Set<SwayLayer>()

export function registerSwayLayer(element: HTMLElement, index: number, depth: number): () => void {
  const layer = { element, index, depth }
  layers.add(layer)
  return () => {
    layers.delete(layer)
    element.style.transform = ''
  }
}

/** Moves every registered layer to where the sway is at `phaseSec`. */
export function applySway(phaseSec: number, amplitudePx: number): void {
  for (const layer of layers) {
    const { x, y } = swayOffset(layer.index, layer.depth, phaseSec, amplitudePx)
    layer.element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
  }
}
