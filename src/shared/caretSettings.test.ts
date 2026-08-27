import { describe, expect, it } from 'vitest'
import {
  CARET_ANIMATION_PRESETS,
  CARET_ANIMATION_PRESET_KEYS,
  CARET_FRAME_DURATION_MIN_MS,
  buildCaretBlinkKeyframesCss,
  isCaretAnimationPresetKey,
  resolveCaretSegmentStepCount,
} from './caretSettings'

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
  it('leaves the animation unquantized at the minimum frame duration', () => {
    const css = buildCaretBlinkKeyframesCss('heartbeat', 1200, CARET_FRAME_DURATION_MIN_MS)
    expect(css).not.toContain('steps(')
  })

  it('emits one step count per segment, derived from that segment’s own length', () => {
    // heartbeat stops sit at 0/10/65/85/100%, so at a 1000ms cycle the
    // segments are 100 / 550 / 200 / 150 ms. At 100ms per frame that is
    // 1 / 6 / 2 / 2 steps -- the last one being the spec's worked example.
    const css = buildCaretBlinkKeyframesCss('heartbeat', 1000, 100)
    const stepCounts = [...css.matchAll(/steps\((\d+), jump-end\)/g)].map((match) => Number(match[1]))
    expect(stepCounts).toEqual([1, 6, 2, 2])
  })

  it('emits no timing function on the final stop, which has no segment after it', () => {
    const css = buildCaretBlinkKeyframesCss('fadeMid', 1000, 100)
    const lines = css.trim().split('\n')
    expect(lines[lines.length - 2]).toContain('100%')
    expect(lines[lines.length - 2]).not.toContain('steps(')
  })

  it('fades fill, outline and halo together off the same alpha', () => {
    const css = buildCaretBlinkKeyframesCss('bigBeat', 1200, CARET_FRAME_DURATION_MIN_MS)
    // The 65% apex carries alpha 0.9 on all three surfaces.
    expect(css).toContain('color-mix(in srgb, var(--color-caret) 90%, transparent)')
    expect(css).toContain('color-mix(in srgb, var(--caret-outline-color) 90%, transparent)')
    expect(css).toContain('color-mix(in srgb, var(--caret-halo-color) 90%, transparent)')
  })

  it('reproduces the historical heartbeat alphas exactly', () => {
    const css = buildCaretBlinkKeyframesCss('heartbeat', 1200, CARET_FRAME_DURATION_MIN_MS)
    const fillAlphas = [...css.matchAll(/var\(--color-caret\) ([\d.]+)%/g)].map((match) => Number(match[1]))
    expect(fillAlphas).toEqual([60, 10, 90, 30, 60])
  })

  it('falls back to the heartbeat rather than emitting an empty rule for an unknown preset', () => {
    // @ts-expect-error -- deliberately outside the union, standing in for a
    // stale value read back from a loadout written by a future version.
    const css = buildCaretBlinkKeyframesCss('nope', 1200, CARET_FRAME_DURATION_MIN_MS)
    expect(css).toContain('var(--color-caret) 60%')
  })

  it('builds a syntactically complete rule for every shipped preset', () => {
    for (const presetKey of CARET_ANIMATION_PRESET_KEYS) {
      const css = buildCaretBlinkKeyframesCss(presetKey, 3000, 45)
      expect(css.startsWith('@keyframes thockdown-blink {')).toBe(true)
      expect(css.trim().endsWith('}')).toBe(true)
      // One block per stop, plus the opening and closing lines.
      expect(css.trim().split('\n')).toHaveLength(CARET_ANIMATION_PRESETS[presetKey].stops.length + 2)
    }
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
