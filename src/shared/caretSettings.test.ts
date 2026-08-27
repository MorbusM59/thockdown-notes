import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CARET_ANIMATION_PRESETS,
  CARET_ANIMATION_PRESET_KEYS,
  CARET_BLINK_EASING_CONTROL_POINTS,
  CARET_FRAME_DURATION_MIN_MS,
  CARET_FRAME_DURATION_MAX_MS,
  CARET_FRAME_DURATION_SMOOTH_MAX_MS,
  CARET_MAX_BAKED_STEPS,
  buildCaretBlinkKeyframesCss,
  isCaretAnimationPresetKey,
  resolveCaretSegmentStepCount,
  type CaretBlinkKeyframeOptions,
} from './caretSettings'

const baseOptions: CaretBlinkKeyframeOptions = {
  presetKey: 'heartbeat',
  animationDurationMs: 1200,
  frameDurationMs: CARET_FRAME_DURATION_MIN_MS,
  caretColor: 'rgba(0, 0, 0, 0.3)',
  outlineColor: 'rgba(10, 20, 30, 0.8)',
  haloColor: 'rgba(200, 100, 50, 0.5)',
  haloSpreadPx: 6,
}

const build = (overrides: Partial<CaretBlinkKeyframeOptions> = {}) =>
  buildCaretBlinkKeyframesCss({ ...baseOptions, ...overrides })

/** Every `<percent>% { ... }` block in the generated rule, in order. */
const stopsOf = (css: string) => css.trim().split('\n').slice(1, -1)

const percentsOf = (css: string) =>
  stopsOf(css).map((line) => Number(line.trim().match(/^([\d.]+)%/)![1]))

const fillAlphasOf = (css: string) =>
  [...css.matchAll(/background-color: rgba\([^)]*?,\s*([\d.]+)\)/g)].map((match) => Number(match[1]))

describe('resolveCaretSegmentStepCount', () => {
  it('honours the keyframe when a frame is longer than the segment', () => {
    expect(resolveCaretSegmentStepCount(80, 100)).toBe(1)
    expect(resolveCaretSegmentStepCount(100, 100)).toBe(1)
  })

  it('splits a segment evenly across the sections the frame duration would have made', () => {
    // The worked example from the spec: a 150ms segment at 100ms per frame
    // "would create two sections of 100ms and 50ms", so it becomes two of 75ms.
    expect(resolveCaretSegmentStepCount(150, 100)).toBe(2)
    expect(resolveCaretSegmentStepCount(300, 100)).toBe(3)
    expect(resolveCaretSegmentStepCount(301, 100)).toBe(4)
  })

  it('never returns a step count below 1, whatever it is handed', () => {
    expect(resolveCaretSegmentStepCount(0, 100)).toBe(1)
    expect(resolveCaretSegmentStepCount(-50, 100)).toBe(1)
    expect(resolveCaretSegmentStepCount(150, 0)).toBe(1)
    expect(resolveCaretSegmentStepCount(Number.NaN, 100)).toBe(1)
    expect(resolveCaretSegmentStepCount(150, Number.NaN)).toBe(1)
  })
})

describe('buildCaretBlinkKeyframesCss', () => {
  /**
   * The regression that sent this back once: `color-mix()` and `var()` inside
   * an animated property are not interpolable in Chromium 124 (Electron 30),
   * which animated the blink discretely -- four hard brightness flips instead
   * of the heartbeat. Newer Chromium interpolates them, so only a real build
   * showed it.
   */
  it('emits plain rgba stops, never color-mix() or var()', () => {
    for (const presetKey of CARET_ANIMATION_PRESET_KEYS) {
      for (const frameDurationMs of [CARET_FRAME_DURATION_MIN_MS, 100, CARET_FRAME_DURATION_MAX_MS]) {
        const css = build({ presetKey, frameDurationMs })
        expect(css).not.toContain('color-mix')
        expect(css).not.toContain('var(')
      }
    }
  })

  it('resolves each surface off its own colour, scaling only alpha', () => {
    const css = build({ presetKey: 'bigBeat' })
    // The 65% apex scales every surface's own alpha by 0.9.
    expect(css).toContain('background-color: rgba(0, 0, 0, 0.27)')
    expect(css).toContain('outline-color: rgba(10, 20, 30, 0.72)')
    expect(css).toContain('box-shadow: 0 0 0 6px rgba(200, 100, 50, 0.45)')
  })

  it('leaves the animation unquantized at frame durations shorter than a display frame', () => {
    for (const frameDurationMs of [CARET_FRAME_DURATION_MIN_MS, CARET_FRAME_DURATION_SMOOTH_MAX_MS]) {
      const css = build({ frameDurationMs })
      expect(percentsOf(css)).toEqual([0, 10, 65, 85, 100])
      expect(fillAlphasOf(css)).toEqual([0.18, 0.03, 0.27, 0.09, 0.18])
    }
  })

  it('bakes one hold pair per step, sized from that segment’s own length', () => {
    // heartbeat stops sit at 0/10/65/85/100%, so at a 1000ms cycle the
    // segments are 100 / 550 / 200 / 150 ms. At 100ms per frame that is
    // 1 / 6 / 2 / 2 steps -- the last being the spec's worked example.
    const css = build({ animationDurationMs: 1000, frameDurationMs: 100 })
    const expectedSteps = 1 + 6 + 2 + 2
    // Two stops per step (the step's start and the hold that closes it), plus
    // the final stop that lands the cycle back on its closing value.
    expect(stopsOf(css)).toHaveLength((expectedSteps * 2) + 1)
  })

  it('holds each step flat, then jumps', () => {
    const css = build({ presetKey: 'fadeMid', animationDurationMs: 1000, frameDurationMs: 250 })
    const percents = percentsOf(css)
    const alphas = fillAlphasOf(css)
    // 0->50% and 50->100% are 500ms each, so two steps apiece.
    expect(alphas).toHaveLength(9)
    for (let index = 0; index < 8; index += 2) {
      // Each pair shares one value, and the second lands just short of the
      // next step's start -- that is what makes it a hold rather than a ramp.
      expect(alphas[index]).toBe(alphas[index + 1])
      expect(percents[index + 1]).toBeGreaterThan(percents[index])
      if (index + 2 < percents.length) {
        expect(percents[index + 1]).toBeLessThan(percents[index + 2])
      }
    }
  })

  it('samples the real eased curve rather than a linear ramp', () => {
    const css = build({ presetKey: 'fadeMid', animationDurationMs: 1000, frameDurationMs: 100 })
    const alphas = fillAlphasOf(css)
    // fadeMid runs 0 -> 1 over the first half in 5 steps. cubic-bezier(.4,0,.2,1)
    // is ease-in-out, so the middle step must sit below the linear midpoint of
    // its own span -- a linear ramp would put step 2 of 5 at exactly 0.4.
    const risingSteps = alphas.slice(0, 10).filter((_value, index) => index % 2 === 0)
    expect(risingSteps[0]).toBe(0)
    expect(risingSteps[2]).toBeGreaterThan(0)
    expect(risingSteps[2]).toBeLessThan(0.4)
    // ...and still climbing monotonically.
    for (let index = 1; index < risingSteps.length; index += 1) {
      expect(risingSteps[index]).toBeGreaterThan(risingSteps[index - 1])
    }
  })

  it('keeps stops ordered and inside 0..100% for every preset and frame duration', () => {
    for (const presetKey of CARET_ANIMATION_PRESET_KEYS) {
      for (const frameDurationMs of [5, 20, 45, 100, 250, CARET_FRAME_DURATION_MAX_MS]) {
        for (const animationDurationMs of [100, 1200, 5000]) {
          const percents = percentsOf(build({ presetKey, frameDurationMs, animationDurationMs }))
          expect(percents[0]).toBe(0)
          expect(percents[percents.length - 1]).toBe(100)
          for (let index = 1; index < percents.length; index += 1) {
            expect(percents[index]).toBeGreaterThan(percents[index - 1])
          }
        }
      }
    }
  })

  it('caps how many steps it will bake, however extreme the settings', () => {
    const css = build({ presetKey: 'bounce', animationDurationMs: 5000, frameDurationMs: 20 })
    expect(stopsOf(css).length).toBeLessThanOrEqual((CARET_MAX_BAKED_STEPS * 2) + 1)
  })

  it('falls back to the heartbeat rather than emitting an empty rule for an unknown preset', () => {
    // @ts-expect-error -- deliberately outside the union, standing in for a
    // stale value read back from a loadout written by a future version.
    const css = build({ presetKey: 'nope' })
    expect(percentsOf(css)).toEqual([0, 10, 65, 85, 100])
  })

  it('falls back to a visible colour when one cannot be parsed', () => {
    const css = build({ caretColor: 'not-a-colour' })
    expect(css).toContain('background-color: rgba(0, 0, 0,')
    expect(css).not.toContain('not-a-colour')
  })
})

describe('isCaretAnimationPresetKey', () => {
  it('accepts every shipped key and nothing else', () => {
    for (const presetKey of CARET_ANIMATION_PRESET_KEYS) {
      expect(isCaretAnimationPresetKey(presetKey)).toBe(true)
    }
    expect(isCaretAnimationPresetKey('heartbeat; }')).toBe(false)
    expect(isCaretAnimationPresetKey('')).toBe(false)
    expect(isCaretAnimationPresetKey(undefined)).toBe(false)
    expect(isCaretAnimationPresetKey(7)).toBe(false)
  })
})

describe('caret animation presets', () => {
  it('starts at 0% and ends at 100% with monotonically increasing stops', () => {
    for (const presetKey of CARET_ANIMATION_PRESET_KEYS) {
      const stops = CARET_ANIMATION_PRESETS[presetKey].stops
      expect(stops[0].atPercent).toBe(0)
      expect(stops[stops.length - 1].atPercent).toBe(100)
      for (let index = 1; index < stops.length; index += 1) {
        expect(stops[index].atPercent).toBeGreaterThan(stops[index - 1].atPercent)
      }
    }
  })

  it('keeps every alpha inside 0..1', () => {
    for (const presetKey of CARET_ANIMATION_PRESET_KEYS) {
      for (const stop of CARET_ANIMATION_PRESETS[presetKey].stops) {
        expect(stop.alpha).toBeGreaterThanOrEqual(0)
        expect(stop.alpha).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('easing agreement with the stylesheet', () => {
  it('samples the same curve index.css animates with', () => {
    // The unquantized path leaves easing to the browser and the baked path
    // samples it here, so the two must be the same curve or the frame slider
    // would change the blink's shape as well as its smoothness.
    const css = readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8')
    const caretRule = css.slice(css.indexOf('.thockdown-block-caret {'))
    const animation = caretRule.slice(0, caretRule.indexOf('}')).match(/animation:[^;]+;/)![0]
    const [x1, y1, x2, y2] = CARET_BLINK_EASING_CONTROL_POINTS
    expect(animation).toContain(`cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`)
  })
})
