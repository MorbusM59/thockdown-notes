/**
 * The grid wave's rotation (GridWave.tsx): three nested pivots turning with
 * the music's beat, reduced to the one transform that draws the same thing.
 *
 * The PRIMARY pivot is the scene's centre. The SECONDARY starts a quarter of
 * the scene's width to its left and is carried round by the primary; the
 * TERTIARY starts a quarter of the width to the primary's right (half the
 * width right of the secondary) and is carried round by both. Each turns the
 * same way; the tertiary once every `waveTertiaryBeats` beats, the secondary
 * four times slower and the primary sixteen times slower.
 *
 * Built literally, the tertiary pivot can wander three quarters of the width
 * from the centre, and a layer covering every reach would be some 2.65 widths
 * square. It need not be: the bands are STRIPES, so three rotations about
 * three points compose into one rotation (the sum of the three angles) and
 * one shift, and a stripe pattern moved along its own stripes is unchanged
 * and moved across them by a whole wave length is unchanged too. What is
 * left of the shift is a fraction of one wave length across the stripes, so
 * the layer stays as wide as the scene's diagonal plus one wave length,
 * centred where it always was. `waveTurnTransform` returns exactly that.
 *
 * The step itself is the layout's setting, published here by the notes app's
 * `useBeatFeedback` the way the sway range is published to `parallaxSway`,
 * so the scene's components do not have to carry it.
 */

import { DEFAULT_VISUALIZER_IMMERSIVE, waveTertiaryBeats, type VisualizerMix } from '@thockdown/look/visualizer'

/** Each pivot's turns per TERTIARY turn, primary first. */
const PIVOT_SHARES = [1 / 16, 1 / 4, 1] as const

export interface WaveAngles {
  primary: number
  secondary: number
  tertiary: number
}

export const WAVE_ANGLES_AT_REST: WaveAngles = { primary: 0, secondary: 0, tertiary: 0 }

/**
 * The angles after `beats` more beats at step `waveTurn`, in radians,
 * clockwise positive (screen coordinates, y down). Accumulated rather than
 * computed from a total, so changing the step mid-way changes the rate and
 * never the angle.
 */
export function advanceWaveAngles(angles: WaveAngles, waveTurn: number, beats: number): WaveAngles {
  const perTurn = waveTertiaryBeats(waveTurn)
  if (perTurn === null) return WAVE_ANGLES_AT_REST
  const tertiary = (2 * Math.PI * beats) / perTurn
  return {
    primary: angles.primary + tertiary * PIVOT_SHARES[0],
    secondary: angles.secondary + tertiary * PIVOT_SHARES[1],
    tertiary: angles.tertiary + tertiary * PIVOT_SHARES[2],
  }
}

type Point = { x: number; y: number }

function rotateAbout(point: Point, pivot: Point, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos }
}

/**
 * Where the nested pivots take `point` of the band layer, in scene
 * coordinates with the primary pivot at the origin: the innermost rotation
 * first, each pivot where it started in its parent's frame.
 */
export function nestedWavePoint(point: Point, angles: WaveAngles, widthPx: number): Point {
  const secondary = { x: -widthPx / 4, y: 0 }
  const tertiary = { x: widthPx / 4, y: 0 }
  const inTertiary = rotateAbout(point, tertiary, angles.tertiary)
  const inSecondary = rotateAbout(inTertiary, secondary, angles.secondary)
  return rotateAbout(inSecondary, { x: 0, y: 0 }, angles.primary)
}

/**
 * The CSS transform for the band layer (its origin at its centre, which sits
 * on the primary pivot), equal to the nested rotations for a stripe pattern
 * whose stripes run along the layer's local y and repeat every `periodPx`
 * along its local x: one rotation by the angles' sum, then the shift the
 * pivots make, kept only across the stripes and only modulo one wave length.
 */
export function waveTurnTransform(angles: WaveAngles, widthPx: number, periodPx: number): string {
  const angle = angles.primary + angles.secondary + angles.tertiary
  // The shift of the layer's centre (the primary pivot, the origin).
  const shift = nestedWavePoint({ x: 0, y: 0 }, angles, widthPx)
  const acrossX = Math.cos(angle)
  const acrossY = Math.sin(angle)
  const across = shift.x * acrossX + shift.y * acrossY
  const kept = periodPx > 0 ? across - periodPx * Math.floor(across / periodPx) : 0
  return `translate(${kept * acrossX}px, ${kept * acrossY}px) rotate(${angle}rad)`
}

/**
 * What the grid wave reads of the layout that is not CSS: the rotation step
 * and the wave length in boxes (the shift is kept modulo one wave length),
 * the wave's fall after each snare hit, and the centre pulse's starting
 * speed and decay (`VisualizerImmersive`).
 */
export interface GridWaveSettings {
  waveTurn: number
  waveBoxes: number
  pulseSpeed: number
  pulseHalfLifeSec: number
  pulseFadeSec: number
  /** The wave's fall after each hit of its mix. */
  waveShape: number
  waveFallSec: number
  /** How much each tracker shows the wave, and sets off the centre pulse (`VisualizerImmersive`). */
  waveMix: VisualizerMix
  glazeMix: VisualizerMix
  pulseMix: VisualizerMix
  /** The edge's fall after each of its hits, which the centre solid's thump follows. */
  edgeShape: number
  edgeFallSec: number
  /** The centre cutout's corner roundness, 0 square to 1 a circle (`cutoutRing.ts`). */
  cutoutRound: number
  /** The centre pulse's ring: its colour and edge softness (`pulseRingStrength`). */
  pulseColor: string
  pulseSoftness: number
  /** The layout's signal boost for the centre pulse (`VisualizerImmersive.pulseBoost`). */
  pulseBoost: number
}

let settings: GridWaveSettings = { waveTurn: 0, waveBoxes: 1, pulseSpeed: 20, pulseHalfLifeSec: 5, pulseFadeSec: 5, waveShape: 0, waveFallSec: 0.25, waveMix: DEFAULT_VISUALIZER_IMMERSIVE.waveMix, glazeMix: DEFAULT_VISUALIZER_IMMERSIVE.glazeMix, pulseMix: DEFAULT_VISUALIZER_IMMERSIVE.pulseMix, edgeShape: 0, edgeFallSec: 0.25, cutoutRound: 0, pulseColor: 'transparent', pulseSoftness: 1, pulseBoost: 1 }
const listeners = new Set<() => void>()

export function setGridWaveSettings(next: GridWaveSettings): void {
  if (next.waveTurn === settings.waveTurn && next.waveBoxes === settings.waveBoxes
    && next.pulseSpeed === settings.pulseSpeed && next.pulseHalfLifeSec === settings.pulseHalfLifeSec && next.pulseFadeSec === settings.pulseFadeSec
    && next.waveShape === settings.waveShape && next.waveFallSec === settings.waveFallSec
    && next.waveMix === settings.waveMix && next.glazeMix === settings.glazeMix && next.pulseMix === settings.pulseMix
    && next.edgeShape === settings.edgeShape && next.edgeFallSec === settings.edgeFallSec
    && next.cutoutRound === settings.cutoutRound
    && next.pulseColor === settings.pulseColor && next.pulseSoftness === settings.pulseSoftness && next.pulseBoost === settings.pulseBoost) return
  settings = next
  for (const listener of listeners) listener()
}

export function readGridWaveSettings(): GridWaveSettings {
  return settings
}

export function subscribeGridWaveSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A frame further than this from the last is a seek or a stall, not playback. */
const MAX_FRAME_SEC = 0.25
/** How quickly the turning rate follows a change of tempo. */
const TEMPO_EASE_SEC = 2

/**
 * Turns the music's TEMPO, frame by frame, into the beats that passed: the
 * time heard since the last frame over the beat period, at a rate that takes
 * the first tempo heard as it is and eases every later change over
 * `TEMPO_EASE_SEC` (a new tempo, or a grid read at double or half the last).
 * A frame with no beat (`periodSec` NaN), or further than `MAX_FRAME_SEC`
 * from the last (a seek, a stall), passes no beats.
 */
export function createTempoFollower(): (timeSec: number, periodSec: number) => number {
  let lastTime = NaN
  let beatsPerSec = NaN
  return (timeSec, periodSec) => {
    const dt = timeSec - lastTime
    lastTime = timeSec
    if (!(periodSec > 0)) return 0
    const target = 1 / periodSec
    if (Number.isNaN(beatsPerSec)) beatsPerSec = target
    if (!(dt > 0 && dt < MAX_FRAME_SEC)) return 0
    beatsPerSec += (target - beatsPerSec) * (1 - Math.exp(-dt / TEMPO_EASE_SEC))
    return dt * beatsPerSec
  }
}
