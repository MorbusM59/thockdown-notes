import { describe, expect, it } from 'vitest'
import { DEFAULT_VISUALIZER_IMMERSIVE, DEFAULT_VISUALIZER_TRACKERS, glazeLayerShare, IMMERSIVE_GLAZE_STRENGTH_MAX, DEFAULT_VISUALIZER_CARET, defaultVisualizer, FALL_MAX_SEC, FALL_MIN_SEC, pulseCurve, pulseRingStrength, roundedSquareGauge, pulseTimeToTravel, pulseTravelBoxes, sanitizeVisualizer, mixResponse, soleMix } from './visualizer'

describe('sanitizeVisualizer', () => {
  it('fills a layout saved before the visualizer with the defaults for its inversion', () => {
    expect(sanitizeVisualizer(undefined, false)).toEqual(defaultVisualizer(false))
    expect(sanitizeVisualizer(undefined, true)).toEqual(defaultVisualizer(true))
    expect(defaultVisualizer(true).edge.color).not.toBe(defaultVisualizer(false).edge.color)
  })

  it('keeps each block its own mix, colour and effect, bounded', () => {
    const v = sanitizeVisualizer({
      trackers: {},
      edge: { mix: { kicks: 2, hits: -1, band: 0.4 }, color: 'rgba(1, 2, 3, 0.5)', effect: -7 },
      pane: { mix: 'x', color: '' },
      immersive: { pulseMix: { kicks: 0.5, band: 1 } },
    }, false)
    expect(v.edge).toMatchObject({ mix: { kicks: 1, hits: 0, band: 0.4 }, color: 'rgba(1, 2, 3, 0.5)', effect: -1 })
    expect(v.pane.mix).toEqual(defaultVisualizer(false).pane.mix)
    expect(v.pane.color).toBe(defaultVisualizer(false).pane.color)
    // The pulse takes no band, whatever was saved.
    expect(v.immersive.pulseMix.band).toBe(0)
    expect(v.immersive.pulseMix.kicks).toBe(0.5)
    expect(v.caret.effect).toBe(DEFAULT_VISUALIZER_CARET.effect)
  })

  it('keeps only what the caret reads, so an older save with a source loads without it', () => {
    const v = sanitizeVisualizer({ caret: { effect: 0.3, shape: 0.2, fallSec: 0.5, source: 'snare', frequencyHz: 300, contrast: 0.2 } }, false)
    expect(v.caret).toEqual({ followsMusic: true, effect: 0.3, shape: 0.2, fallSec: 0.5 })
  })

  it('migrates a layout from before the caret switch: it followed the music whenever its caret had an effect', () => {
    expect(sanitizeVisualizer({ caret: { effect: 0.4 } }, false).caret.followsMusic).toBe(true)
    expect(sanitizeVisualizer({ caret: { effect: 0 } }, false).caret.followsMusic).toBe(false)
    // A visualizer with no caret block never followed; no visualizer at all takes the defaults.
    expect(sanitizeVisualizer({}, false).caret.followsMusic).toBe(false)
    expect(sanitizeVisualizer(undefined, false).caret.followsMusic).toBe(DEFAULT_VISUALIZER_CARET.followsMusic)
    // The old bounce blink is now the switch's button.
    expect(sanitizeVisualizer(undefined, false, 'bounce').caret.followsMusic).toBe(true)
    expect(sanitizeVisualizer({ caret: { effect: 0 } }, false, 'bounce').caret.followsMusic).toBe(true)
    // A saved switch wins over both.
    expect(sanitizeVisualizer({ caret: { effect: 0.4, followsMusic: false } }, false, 'bounce').caret.followsMusic).toBe(false)
  })
})

describe('a layout saved before the trackers', () => {
  it('reads each block as following its old source in full, and the trackers as that block\'s tuning', () => {
    const v = sanitizeVisualizer({
      edge: { source: 'kick', groove: 0.8, contrast: 0.3, frequencyHz: 90 },
      pane: { source: 'hat', groove: 7, contrast: 0.1 },
    }, false)
    expect(v.edge.mix).toEqual(soleMix('kicks'))
    expect(v.pane.mix).toEqual(soleMix('hits'))
    expect(v.trackers.kicks).toEqual({ groove: 0.8, contrast: 0.3 })
    expect(v.trackers.hits).toEqual({ groove: 1, contrast: 0.1 })
    // The pulse rode the edge.
    expect(v.immersive.pulseMix).toEqual(soleMix('kicks'))
    // The wave followed the snare.
    expect(v.immersive.waveMix).toEqual(soleMix('hits'))
  })

  it('takes a band block\'s band as the band tracker, the first block winning', () => {
    const v = sanitizeVisualizer({ edge: { source: 'band', frequencyHz: 440, octaves: 2, contrast: 0.2 }, pane: { source: 'band', frequencyHz: 99 } }, false)
    expect(v.trackers.band).toEqual({ frequencyHz: 440, octaves: 2, contrast: 0.2 })
    expect(v.pane.mix).toEqual(soleMix('band'))
    expect(sanitizeVisualizer({ edge: { source: 'kick', effect: 0 } }, false).immersive.pulseMix.kicks).toBe(0)
    // A band edge set no pulse drum: the kick.
    expect(v.immersive.pulseMix).toEqual(soleMix('kicks'))
  })

  it('reads a layout saved before the source existed', () => {
    const v = sanitizeVisualizer({ pane: { frequencyHz: 0 }, edge: { frequencyHz: 440 } }, false)
    expect(v.pane.mix).toEqual(soleMix('kicks'))
    expect(v.edge.mix).toEqual(soleMix('band'))
    expect(v.trackers.band.frequencyHz).toBe(440)
  })

  it('looks as the defaults did for a layout that saved the defaults', () => {
    const v = sanitizeVisualizer({ edge: { source: 'kick' }, pane: { source: 'snare' } }, false)
    expect(v.edge.mix).toEqual(defaultVisualizer(false).edge.mix)
    expect(v.pane.mix).toEqual(defaultVisualizer(false).pane.mix)
    expect(v.trackers).toEqual(DEFAULT_VISUALIZER_TRACKERS)
  })
})

describe('mixResponse', () => {
  const mix = (kicks: number, hits: number, band: number) => ({ kicks, hits, band })
  it('adds the contributions and caps at a full response', () => {
    expect(mixResponse(mix(1, 0, 0), 1, 0, 0)).toBe(1)
    expect(mixResponse(mix(1, 1, 0), 1, 1, 0)).toBe(1)
    expect(mixResponse(mix(0.5, 0, 0), 1, 0, 0)).toBe(0.5)
    expect(mixResponse(mix(1 / 3, 1 / 3, 1 / 3), 1, 1, 1)).toBeCloseTo(1)
    expect(mixResponse(mix(1 / 3, 1 / 3, 1 / 3), 1, 0, 0)).toBeCloseTo(1 / 3)
  })
  it('stays inside 0..1 for every mix and every response', () => {
    for (let i = 0; i < 2000; i++) {
      const r = mixResponse(mix(Math.random(), Math.random(), Math.random()), Math.random(), Math.random(), Math.random())
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1)
    }
    expect(mixResponse(mix(0, 0, 0), 1, 1, 1)).toBe(0)
  })
})

it('reads an old saved scale as gone, and gives the glaze the wave\'s mix when it had none', () => {
  const v = sanitizeVisualizer({ immersive: { waveMix: { kicks: 0.4, hits: 0, band: 0.6, normalize: 1 } } }, false)
  expect(v.immersive.waveMix).toEqual({ kicks: 0.4, hits: 0, band: 0.6 })
  expect(v.immersive.glazeMix).toEqual({ kicks: 0.4, hits: 0, band: 0.6 })
  const w = sanitizeVisualizer({ immersive: { waveMix: { kicks: 1, hits: 0, band: 0 }, glazeMix: { kicks: 0, hits: 0.5, band: 0 } } }, false)
  expect(w.immersive.glazeMix).toEqual({ kicks: 0, hits: 0.5, band: 0 })
})

it('turns a saved amount and invert into a signed effect', () => {
  const v = sanitizeVisualizer({ caret: { amount: 0.4, invert: true }, edge: { amount: 0.3 } }, false)
  expect(v.caret.effect).toBe(-0.4)
  expect(v.edge.effect).toBe(0.3)
  expect(v.caret).not.toHaveProperty('invert')
})

it('reads the fall of a layout saved with one mass slider, or with the first fall shape', () => {
  const v = sanitizeVisualizer({ caret: { mass: 0 }, edge: { mass: 1 }, pane: { fallSec: 99, fallShape: 3 } }, false)
  expect(v.caret).toMatchObject({ shape: 1, fallSec: FALL_MIN_SEC })
  expect(v.edge.shape).toBe(-1)
  expect(v.edge.fallSec).toBeCloseTo(1.6, 6)
  expect(v.pane).toMatchObject({ shape: 1, fallSec: FALL_MAX_SEC })
})

describe('pulseCurve', () => {
  const shapes = Array.from({ length: 41 }, (_, i) => -1 + i / 20)
  const FRAME_SEC = 1 / 60

  it('falls from exactly 1 to exactly 0, never rising, at every shape', () => {
    for (const shape of shapes) {
      expect(pulseCurve(0, shape)).toBe(1)
      expect(pulseCurve(1, shape)).toBe(0)
      let last = 1
      for (let i = 1; i <= 1000; i++) {
        const value = pulseCurve(i / 1000, shape)
        expect(value).toBeLessThanOrEqual(last)
        last = value
      }
    }
  })

  // The property the fall is for: drawn at 60 frames a second, every frame of
  // its length shows a value of its own, and none of them is a jump to
  // nothing -- at the shortest fall the step is bounded, the landing is soft,
  // and every step shrinks in proportion as the fall gets longer.
  it('is drawn as a run of distinct values on every frame, with a soft landing', () => {
    for (const fallSec of [FALL_MIN_SEC, 0.25, 1, FALL_MAX_SEC]) {
      const frames = Math.floor(fallSec / FRAME_SEC)
      const scale = FALL_MIN_SEC / fallSec
      for (const shape of shapes) {
        let last = 1
        let biggest = 0
        for (let f = 1; f <= frames; f++) {
          const value = pulseCurve((f * FRAME_SEC) / fallSec, shape)
          expect(value).toBeLessThan(last)
          biggest = Math.max(biggest, last - value)
          last = value
        }
        // The step to nothing after the last frame drawn.
        expect(last).toBeLessThan(0.3 * scale + 1e-9)
        expect(biggest).toBeLessThan(Math.min(0.55, 0.55 * scale * 1.6 + 0.02))
      }
    }
  })

  it('puts a ride cymbal low early and a thump high late', () => {
    expect(pulseCurve(0.25, 1)).toBeLessThan(0.35)
    expect(pulseCurve(0.75, 1)).toBeGreaterThan(0)
    expect(pulseCurve(0.6, -1)).toBeGreaterThan(0.7)
  })
})

it('gives a save without the edge geometry its defaults, and bounds and rounds what it has', () => {
  expect(sanitizeVisualizer({ edge: {} }, false).edge).toMatchObject({ spreadPx: defaultVisualizer(false).edge.spreadPx, blurPx: defaultVisualizer(false).edge.blurPx })
  expect(sanitizeVisualizer({ edge: { spreadPx: 14.7, blurPx: 900 } }, false).edge).toMatchObject({ spreadPx: 15, blurPx: 200 })
  expect(sanitizeVisualizer({ edge: { spreadPx: -5, blurPx: 'x' } }, false).edge).toMatchObject({ spreadPx: 0, blurPx: defaultVisualizer(false).edge.blurPx })
})

it('reads a layout saved under the old block names, shade and outline, as the edge and the pane', () => {
  const v = sanitizeVisualizer({ shade: { effect: 0.4, spreadPx: 12 }, outline: { effect: -0.3, color: 'rgba(1, 2, 3, 1)' } }, false)
  expect(v.edge).toMatchObject({ effect: 0.4, spreadPx: 12 })
  expect(v.pane).toMatchObject({ effect: -0.3, color: 'rgba(1, 2, 3, 1)' })
  expect(sanitizeVisualizer({ edge: { effect: 0.1 }, shade: { effect: 0.9 } }, false).edge.effect).toBe(0.1)
})

// The fall slider (SidebarOptionsPanel's `renderFallSliders`) is a log track
// whose step puts the block's default on the grid counted from the minimum;
// a reset snaps the default to that grid (CompactScrollbarSlider's
// `snapValue`), so it must land back on the default, for every block.
it('every block\'s default fall survives the fall slider\'s reset', () => {
  const v = defaultVisualizer(false)
  for (const fall of [v.caret.fallSec, v.edge.fallSec, v.pane.fallSec]) {
    const min = Math.log(FALL_MIN_SEC)
    const step = Math.log(fall / FALL_MIN_SEC) / 90
    const snapped = Math.exp(min + Math.round((Math.log(fall) - min) / step) * step)
    expect(snapped).toBeCloseTo(fall, 12)
    expect(Math.round(snapped * 1000)).toBe(Math.round(fall * 1000))
  }
})

describe('glazeLayerShare', () => {
  it('gives every layer all of the strength at the centre and ramps by depth at either end', () => {
    for (const position of [0, 0.3, 1]) expect(glazeLayerShare(position, 0)).toBe(1)
    expect(glazeLayerShare(0, -1)).toBe(0)
    expect(glazeLayerShare(1, -1)).toBe(1)
    expect(glazeLayerShare(0, 1)).toBe(1)
    expect(glazeLayerShare(1, 1)).toBe(0)
    expect(glazeLayerShare(0, -0.5)).toBeCloseTo(0.5)
  })

  it('bounds a saved immersive block and defaults a missing one', () => {
    expect(sanitizeVisualizer({ immersive: { glazeStrength: 9, glazeSpread: -9, swayRangePx: 999, swaySpread: 5, swayPush: -99, swayReturn: 9, swayDrift: 999, waveColor: 7, waveBoxes: 9999, waveSec: 0, waveTurn: -9, waveShape: 3, waveFallSec: 99, pulseColor: '', pulseSpeed: 999, pulseHalfLifeSec: 0, pulseFadeSec: 99, pulseSoftness: 7, pulseBoost: -2, cutoutRound: 3 } }, false).immersive).toEqual({ waveMix: soleMix('hits'), glazeMix: soleMix('hits'), pulseMix: DEFAULT_VISUALIZER_IMMERSIVE.pulseMix, glazeStrength: IMMERSIVE_GLAZE_STRENGTH_MAX, glazeSpread: -1, swayRangePx: 200, swaySpread: 1, swayPush: -10, swayReturn: 1, swayDrift: 200, waveColor: defaultVisualizer(false).immersive.waveColor, waveBoxes: 256, waveSec: 0.5, waveTurn: -5, waveShape: 1, waveFallSec: FALL_MAX_SEC, pulseColor: defaultVisualizer(false).immersive.pulseColor, pulseSpeed: 100, pulseHalfLifeSec: 0.1, pulseFadeSec: 5, pulseSoftness: 1, pulseBoost: 0, cutoutRound: 1, accentColor: defaultVisualizer(false).immersive.accentColor, letterboxColor: defaultVisualizer(false).immersive.letterboxColor })
    expect(sanitizeVisualizer({ trackers: {} }, false).immersive).toEqual(defaultVisualizer(false).immersive)
  })
})

describe('pulseTravelBoxes', () => {
  it('halves its speed every half-life', () => {
    // Speed at t: the travel's derivative, read numerically.
    const speedAt = (t: number) => (pulseTravelBoxes(t + 1e-5, 10, 0.3) - pulseTravelBoxes(t, 10, 0.3)) / 1e-5
    expect(speedAt(0)).toBeCloseTo(10, 2)
    expect(speedAt(0.3) / speedAt(0)).toBeCloseTo(0.5, 3)
    expect(pulseTimeToTravel(pulseTravelBoxes(1.7, 10, 2), 10, 2)).toBeCloseTo(1.7, 6)
    // Total reach is speed x half-life / ln 2: farther never arrives.
    expect(pulseTimeToTravel(100, 10, 1)).toBe(Infinity)
  })
})

describe('roundedSquareGauge', () => {
  it('is the square at 0, the circle at 1, and 1 on the rounded edge between', () => {
    expect(roundedSquareGauge(0.6, -0.9, 0)).toBeCloseTo(0.9)
    expect(roundedSquareGauge(0.6, 0.8, 1)).toBeCloseTo(1)
    // Corner of a half-rounded square: the arc's centre is (0.5, 0.5), radius 0.5.
    const at = 0.5 + 0.5 * Math.SQRT1_2
    expect(roundedSquareGauge(at, -at, 0.5)).toBeCloseTo(1)
    expect(roundedSquareGauge(2 * at, 2 * at, 0.5)).toBeCloseTo(2)
    expect(roundedSquareGauge(1, 0.3, 0.5)).toBeCloseTo(1)
  })
})

describe('pulseRingStrength', () => {
  it('is zero off the ring and full at its middle', () => {
    expect(pulseRingStrength(0.7, 1)).toBe(0)
    expect(pulseRingStrength(1, 1)).toBe(0)
    expect(pulseRingStrength(0.875, 1)).toBeCloseTo(1)
    expect(pulseRingStrength(0.76, 0)).toBe(1)
  })
})
