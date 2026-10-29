import { describe, expect, it } from 'vitest'
import { DEFAULT_VISUALIZER_IMMERSIVE, glazeLayerShare, IMMERSIVE_GLAZE_STRENGTH_MAX, DEFAULT_EDGE_BLUR_PX, DEFAULT_VISUALIZER_CARET, defaultVisualizer, FALL_MAX_SEC, FALL_MIN_SEC, pulseCurve, sanitizeVisualizer, SOURCE_SLIDER_MAX, SOURCE_SLIDER_MIN, sourceAtSlider, sourceSliderValue } from './visualizer'

describe('sanitizeVisualizer', () => {
  it('fills a layout saved before the visualizer with the defaults for its inversion', () => {
    expect(sanitizeVisualizer(undefined, false)).toEqual(defaultVisualizer(false))
    expect(sanitizeVisualizer(undefined, true)).toEqual(defaultVisualizer(true))
    expect(defaultVisualizer(true).edge.color).not.toBe(defaultVisualizer(false).edge.color)
  })

  it('keeps each block its own band, colour and effect, bounded', () => {
    const v = sanitizeVisualizer({
      edge: { source: 'snare', frequencyHz: 300, color: 'rgba(1, 2, 3, 0.5)', effect: -7 },
      pane: { source: 'cowbell', frequencyHz: 99999, color: '' },
    }, false)
    expect(v.edge).toMatchObject({ source: 'snare', frequencyHz: 300, color: 'rgba(1, 2, 3, 0.5)', effect: -1 })
    expect(v.pane.frequencyHz).toBe(20000)
    expect(v.pane.source).toBe('band')
    expect(v.pane.color).toBe(defaultVisualizer(false).pane.color)
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

it('keeps a drum\'s groove beside the band\'s width, bounded, and reads a layout saved before groove at 0', () => {
  const v = sanitizeVisualizer({ edge: { source: 'hat', octaves: 2, groove: 0.8 }, pane: { source: 'kick', octaves: 3, groove: 7 } }, false)
  expect(v.edge).toMatchObject({ octaves: 2, groove: 0.8 })
  expect(v.pane).toMatchObject({ octaves: 3, groove: 1 })
  expect(sanitizeVisualizer({ edge: { source: 'snare', octaves: 2 } }, false).edge.groove).toBe(0)
})

it('reads a layout saved before the source existed', () => {
  const v = sanitizeVisualizer({ pane: { frequencyHz: 0 }, edge: { frequencyHz: 440 } }, false)
  expect(v.pane.source).toBe('kick')
  expect(v.edge).toMatchObject({ source: 'band', frequencyHz: 440 })
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
  expect(sanitizeVisualizer({ edge: {} }, false).edge).toMatchObject({ spreadPx: 0, blurPx: DEFAULT_EDGE_BLUR_PX })
  expect(sanitizeVisualizer({ edge: { spreadPx: 14.7, blurPx: 900 } }, false).edge).toMatchObject({ spreadPx: 15, blurPx: 200 })
  expect(sanitizeVisualizer({ edge: { spreadPx: -5, blurPx: 'x' } }, false).edge).toMatchObject({ spreadPx: 0, blurPx: DEFAULT_EDGE_BLUR_PX })
})

describe('the source slider', () => {
  it('puts the kick at the left end, the snare at the centre and the hat at the right end', () => {
    const at = (source: 'kick' | 'snare' | 'hat') => sourceSliderValue({ source, frequencyHz: 100 })
    expect(at('kick')).toBeGreaterThan(SOURCE_SLIDER_MIN)
    expect(at('hat')).toBeLessThan(SOURCE_SLIDER_MAX)
    expect(at('kick') - SOURCE_SLIDER_MIN).toBeCloseTo(SOURCE_SLIDER_MAX - at('hat'))
    expect(at('snare')).toBeCloseTo((SOURCE_SLIDER_MIN + SOURCE_SLIDER_MAX) / 2)
    expect(sourceAtSlider(SOURCE_SLIDER_MIN, 100).source).toBe('kick')
    expect(sourceAtSlider((SOURCE_SLIDER_MIN + SOURCE_SLIDER_MAX) / 2, 100).source).toBe('snare')
    expect(sourceAtSlider(SOURCE_SLIDER_MAX, 100).source).toBe('hat')
  })

  it('returns every source and band frequency to the position it came from', () => {
    for (const source of ['kick', 'snare', 'hat'] as const) {
      expect(sourceAtSlider(sourceSliderValue({ source, frequencyHz: 440 }), 440)).toEqual({ source, frequencyHz: 440 })
    }
    for (const frequencyHz of [20, 70, 440, 630, 640, 2000, 20000]) {
      expect(sourceAtSlider(sourceSliderValue({ source: 'band', frequencyHz }), 1)).toEqual({ source: 'band', frequencyHz })
    }
  })

  it('runs the spectrum upwards from left to right, through the snare', () => {
    let last = 0
    for (let v = SOURCE_SLIDER_MIN; v <= SOURCE_SLIDER_MAX; v += 0.01) {
      const at = sourceAtSlider(v, 1)
      if (at.source !== 'band') continue
      expect(at.frequencyHz).toBeGreaterThanOrEqual(last)
      last = at.frequencyHz
    }
    expect(last).toBeGreaterThan(19000)
  })
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
    expect(sanitizeVisualizer({ immersive: { glazeStrength: 9, glazeSpread: -9 } }, false).immersive).toEqual({ glazeStrength: IMMERSIVE_GLAZE_STRENGTH_MAX, glazeSpread: -1 })
    expect(sanitizeVisualizer({}, false).immersive).toEqual(DEFAULT_VISUALIZER_IMMERSIVE)
  })
})
