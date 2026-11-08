import { describe, expect, it } from 'vitest'
import { DEFAULT_VISUALIZER_IMMERSIVE, DEFAULT_VISUALIZER_TRACKERS, glazeLayerShare, IMMERSIVE_GLAZE_STRENGTH_MAX, DEFAULT_VISUALIZER, defaultVisualizerColors, sanitizeVisualizerColors, FALL_MAX_SEC, FALL_MIN_SEC, pulseCurve, pulseRingStrength, roundedSquareGauge, pulseTimeToTravel, pulseTravelBoxes, sanitizeVisualizer, mixResponse, soleMix } from './visualizer'

describe('sanitizeVisualizer', () => {
  it('fills a save without a visualizer with the defaults', () => {
    expect(sanitizeVisualizer(undefined)).toEqual(DEFAULT_VISUALIZER)
  })

  it('keeps each block its own mix and effect, bounded, and drops a colour saved with a layout', () => {
    const v = sanitizeVisualizer({
      trackers: {},
      edge: { mix: { thump: 2, pierce: -1, tick: 0.4 }, color: 'rgba(1, 2, 3, 0.5)', effect: -7 },
      pane: { mix: 'x', color: '' },
      immersive: { pulseMix: { thump: 0.5, tick: 1 }, waveColor: 'red' },
    })
    expect(v.edge).toMatchObject({ mix: { thump: 1, pierce: 0, tick: 0.4 }, effect: -1 })
    expect(v.edge).not.toHaveProperty('color')
    expect(v.immersive).not.toHaveProperty('waveColor')
    expect(v.pane.mix).toEqual(DEFAULT_VISUALIZER.pane.mix)
    expect(v.immersive.pulseMix).toEqual({ thump: 0.5, pierce: DEFAULT_VISUALIZER.immersive.pulseMix.pierce, tick: 1 })
    expect(v.caret).toEqual(DEFAULT_VISUALIZER.caret)
  })

  it('keeps only what the caret reads, so an older save with a source or its switch loads without it', () => {
    const v = sanitizeVisualizer({ caret: { followsMusic: false, effect: 0.3, shape: 0.2, fallSec: 0.5, source: 'snare', frequencyHz: 300, contrast: 0.2 } })
    expect(v.caret).toEqual({ shape: 0.2, fallSec: 0.5 })
  })
})

describe('the grid beat', () => {
  it('copies an old save\'s edge and pane into both modes\' grid panes, then stands apart', () => {
    const v = sanitizeVisualizer({ edge: { effect: 0.7, spreadPx: 12 }, pane: { effect: 0.2 } })
    for (const mode of ['light', 'dark'] as const) {
      expect(v.grid[mode].edge.effect).toBe(v.edge.effect)
      expect(v.grid[mode].edge.spreadPx).toBe(v.edge.spreadPx)
      expect(v.grid[mode].editorPane).toEqual(v.pane)
      expect(v.grid[mode].readerPane).toEqual(v.pane)
    }
    const w = sanitizeVisualizer({ ...v, grid: { ...v.grid, dark: { ...v.grid.dark, readerPane: { ...v.pane, effect: 0.9 } } } })
    expect(w.grid.dark.readerPane.effect).toBe(0.9)
    expect(w.grid.light.readerPane.effect).toBe(v.pane.effect)
    expect(w.grid.dark.editorPane.effect).toBe(v.pane.effect)
    expect(w.pane).toEqual(v.pane)
  })

  it('reads a single-set save into both modes', () => {
    const single = { ...DEFAULT_VISUALIZER.grid.dark, editorPane: { ...DEFAULT_VISUALIZER.grid.dark.editorPane, effect: 0.42 } }
    const v = sanitizeVisualizer({ ...DEFAULT_VISUALIZER, grid: single })
    expect(v.grid.light).toEqual(v.grid.dark)
    expect(v.grid.light.editorPane.effect).toBe(0.42)
  })

  it('round-trips the defaults', () => {
    expect(sanitizeVisualizer(DEFAULT_VISUALIZER).grid).toEqual(DEFAULT_VISUALIZER.grid)
  })
})

describe('sanitizeVisualizerColors', () => {
  it('gives a layout without them the defaults for its inversion', () => {
    expect(sanitizeVisualizerColors(undefined, false)).toEqual(defaultVisualizerColors(false))
    expect(sanitizeVisualizerColors(undefined, true)).toEqual(defaultVisualizerColors(true))
    expect(defaultVisualizerColors(true).edge).not.toBe(defaultVisualizerColors(false).edge)
  })

  it('reads the colours a layout saved on its visualizer blocks before they were separated', () => {
    const legacy = {
      edge: { color: 'rgba(1, 2, 3, 0.5)' }, pane: { color: '' },
      immersive: { waveColor: 'w', pulseColor: 'p', accentColor: '', letterboxColor: 'l' },
    }
    expect(sanitizeVisualizerColors(undefined, false, legacy)).toEqual({
      edge: 'rgba(1, 2, 3, 0.5)', pane: defaultVisualizerColors(false).pane, wave: 'w', pulse: 'p', accent: '', letterbox: 'l',
    })
    // The legacy block names too.
    expect(sanitizeVisualizerColors(undefined, false, { shade: { color: 's' }, outline: { color: 'o' } })).toMatchObject({ edge: 's', pane: 'o' })
    // Saved colours win over a legacy visualizer.
    expect(sanitizeVisualizerColors({ edge: 'e' }, false, legacy).edge).toBe('e')
  })
})

describe('a layout saved with the kicks, hits and band trackers', () => {
  it('reads them as the thump, the pierce and the tick, the band\'s level contrast not carried over', () => {
    const v = sanitizeVisualizer({
      trackers: { kicks: { contrast: 0.3 }, hits: { contrast: 0.2 }, band: { frequencyHz: 20000, octaves: 4, contrast: 0 } },
      edge: { mix: { kicks: 1, hits: 0.5, band: 0.25 } },
      immersive: { waveMix: { kicks: 0, hits: 0, band: 1 } },
    })
    expect(v.trackers).toEqual({ thump: { contrast: 0.3, pattern: 0.5 }, pierce: { contrast: 0.2, pattern: 0.5 }, tick: DEFAULT_VISUALIZER_TRACKERS.tick })
    expect(v.edge.mix).toEqual({ thump: 1, pierce: 0.5, tick: 0.25 })
    expect(v.immersive.waveMix).toEqual(soleMix('tick'))
  })
})

describe('a layout saved before the trackers', () => {
  it('reads each block as following its old source in full, and the trackers as that block\'s tuning', () => {
    const v = sanitizeVisualizer({
      edge: { source: 'kick', groove: 0.8, contrast: 0.3, frequencyHz: 90 },
      pane: { source: 'hat', groove: 7, contrast: 0.1 },
    })
    expect(v.edge.mix).toEqual(soleMix('thump'))
    expect(v.pane.mix).toEqual(soleMix('tick'))
    expect(v.trackers.thump).toEqual({ contrast: 0.3, pattern: 0.5 })
    // A hat's contrast was the drum score's, not the tick's.
    expect(v.trackers.tick).toEqual(DEFAULT_VISUALIZER_TRACKERS.tick)
    // The pulse rode the edge.
    expect(v.immersive.pulseMix).toEqual(soleMix('thump'))
    // The wave followed the snare.
    expect(v.immersive.waveMix).toEqual(soleMix('pierce'))
  })

  it('reads a band block as following the tick', () => {
    const v = sanitizeVisualizer({ edge: { source: 'band', frequencyHz: 440, octaves: 2, contrast: 0.2 }, pane: { source: 'band', frequencyHz: 99 } })
    expect(v.trackers.tick).toEqual(DEFAULT_VISUALIZER_TRACKERS.tick)
    expect(v.pane.mix).toEqual(soleMix('tick'))
    expect(sanitizeVisualizer({ edge: { source: 'kick', effect: 0 } }).immersive.pulseMix.thump).toBe(0)
    // A band edge set no pulse drum: the thump.
    expect(v.immersive.pulseMix).toEqual(soleMix('thump'))
  })

  it('reads a layout saved before the source existed', () => {
    const v = sanitizeVisualizer({ pane: { frequencyHz: 0 }, edge: { frequencyHz: 440 } })
    expect(v.pane.mix).toEqual(soleMix('thump'))
    expect(v.edge.mix).toEqual(soleMix('tick'))
  })

  it('looks as the defaults did for a layout that saved the defaults', () => {
    const v = sanitizeVisualizer({ edge: { source: 'kick' }, pane: { source: 'snare' } })
    expect(v.edge.mix).toEqual(DEFAULT_VISUALIZER.edge.mix)
    expect(v.pane.mix).toEqual(DEFAULT_VISUALIZER.pane.mix)
    expect(v.trackers).toEqual(DEFAULT_VISUALIZER_TRACKERS)
  })
})

describe('mixResponse', () => {
  const mix = (thump: number, pierce: number, tick: number) => ({ thump, pierce, tick })
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
  const v = sanitizeVisualizer({ immersive: { waveMix: { kicks: 0.4, hits: 0, band: 0.6, normalize: 1 } } })
  expect(v.immersive.waveMix).toEqual({ thump: 0.4, pierce: 0, tick: 0.6 })
  expect(v.immersive.glazeMix).toEqual({ thump: 0.4, pierce: 0, tick: 0.6 })
  const w = sanitizeVisualizer({ immersive: { waveMix: { kicks: 1, hits: 0, band: 0 }, glazeMix: { kicks: 0, hits: 0.5, band: 0 } } })
  expect(w.immersive.glazeMix).toEqual({ thump: 0, pierce: 0.5, tick: 0 })
})

it('turns a saved amount and invert into a signed effect', () => {
  const v = sanitizeVisualizer({ caret: { amount: 0.4, invert: true }, edge: { amount: 0.3 } })
  expect(v.edge.effect).toBe(0.3)
  expect(v.caret).not.toHaveProperty('invert')
})

it('reads the fall of a layout saved with one mass slider, or with the first fall shape', () => {
  const v = sanitizeVisualizer({ caret: { mass: 0 }, edge: { mass: 1 }, pane: { fallSec: 99, fallShape: 3 } })
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
  expect(sanitizeVisualizer({ edge: {} }).edge).toMatchObject({ spreadPx: DEFAULT_VISUALIZER.edge.spreadPx, blurPx: DEFAULT_VISUALIZER.edge.blurPx })
  expect(sanitizeVisualizer({ edge: { spreadPx: 14.7, blurPx: 900 } }).edge).toMatchObject({ spreadPx: 15, blurPx: 200 })
  expect(sanitizeVisualizer({ edge: { spreadPx: -5, blurPx: 'x' } }).edge).toMatchObject({ spreadPx: 0, blurPx: DEFAULT_VISUALIZER.edge.blurPx })
})

it('reads a layout saved under the old block names, shade and outline, as the edge and the pane', () => {
  const v = sanitizeVisualizer({ shade: { effect: 0.4, spreadPx: 12 }, outline: { effect: -0.3, color: 'rgba(1, 2, 3, 1)' } })
  expect(v.edge).toMatchObject({ effect: 0.4, spreadPx: 12 })
  expect(v.pane).toMatchObject({ effect: -0.3 })
  expect(sanitizeVisualizer({ edge: { effect: 0.1 }, shade: { effect: 0.9 } }).edge.effect).toBe(0.1)
})

// The fall slider (SidebarOptionsPanel's `renderFallSliders`) is a log track
// whose step puts the block's default on the grid counted from the minimum;
// a reset snaps the default to that grid (CompactScrollbarSlider's
// `snapValue`), so it must land back on the default, for every block.
it('every block\'s default fall survives the fall slider\'s reset', () => {
  const v = DEFAULT_VISUALIZER
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
    expect(sanitizeVisualizer({ immersive: { glazeStrength: 9, glazeSpread: -9, swayRangePx: 999, swaySpread: 5, swayPush: -99, swayReturn: 9, swayDrift: 999, waveBoxes: 9999, waveBeats: 0, waveTurn: -9, waveShape: 3, waveFallSec: 99, pulseSpeed: 999, pulseHalfLifeSec: 0, pulseFadeSec: 99, pulseSoftness: 7, pulseBoost: -2, cutoutRound: 3 } }).immersive).toEqual({ waveMix: soleMix('pierce'), glazeMix: soleMix('pierce'), pulseMix: DEFAULT_VISUALIZER_IMMERSIVE.pulseMix, glazeStrength: IMMERSIVE_GLAZE_STRENGTH_MAX, glazeSpread: -1, swayRangePx: 200, swaySpread: 1, swayPush: -10, swayReturn: 1, swayDrift: 200, waveBoxes: 256, waveBeats: 1, waveTurn: -5, waveShape: 1, waveFallSec: FALL_MAX_SEC, pulseSpeed: 100, pulseHalfLifeSec: 0.1, pulseFadeSec: 5, pulseSoftness: 1, pulseBoost: 0, cutoutRound: 1})
    expect(sanitizeVisualizer({ trackers: {} }).immersive).toEqual(DEFAULT_VISUALIZER.immersive)
  })

  it('reads a wave travel saved in seconds as beats at the fallback tempo', () => {
    expect(sanitizeVisualizer({ immersive: { waveSec: 3.5 } }).immersive.waveBeats).toBe(7)
    expect(sanitizeVisualizer({ immersive: { waveSec: 30 } }).immersive.waveBeats).toBe(60)
    expect(sanitizeVisualizer({ immersive: { waveSec: 6, waveBeats: 16 } }).immersive.waveBeats).toBe(16)
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

describe('roundedSquareOffsetGauge', () => {
  it('equals the scaled gauge for a circle and keeps a square side straight', async () => {
    const { roundedSquareOffsetGauge } = await import('./visualizer')
    for (const [x, y] of [[0.3, 0.4], [2, 1], [-1.5, 3]]) expect(roundedSquareOffsetGauge(x, y, 1)).toBeCloseTo(roundedSquareGauge(x, y, 1))
    expect(roundedSquareOffsetGauge(2, 0.9, 0)).toBeCloseTo(2)
    // A square's corner rounds off: the point at distance 1 diagonally from its corner.
    expect(roundedSquareOffsetGauge(1 + Math.SQRT1_2, 1 + Math.SQRT1_2, 0)).toBeCloseTo(2)
  })
})
