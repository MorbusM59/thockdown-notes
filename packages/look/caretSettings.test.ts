import { describe, expect, it } from 'vitest'
import { buildCaretBlinkKeyframesCss, type CaretBlinkKeyframeOptions } from './caretSettings'

const baseOptions: CaretBlinkKeyframeOptions = {
  levels: [0.6, 0.1, 0.9, 0.3, 0.6],
  caretColor: 'rgba(0, 0, 0, 0.3)',
  outlineColor: 'rgba(10, 20, 30, 0.8)',
  haloColor: 'rgba(200, 100, 50, 0.5)',
  haloSpreadPx: 6,
  haloBlurPx: 0,
}

const build = (overrides: Partial<CaretBlinkKeyframeOptions> = {}) =>
  buildCaretBlinkKeyframesCss({ ...baseOptions, ...overrides })

/** Every `<percent>% { ... }` block in the generated rule, in order. */
const stopsOf = (css: string) => css.trim().split('\n').slice(1, -1)

const percentsOf = (css: string) =>
  stopsOf(css).map((line) => Number(line.trim().match(/^([\d.]+)%/)![1]))

const fillAlphasOf = (css: string) =>
  [...css.matchAll(/background-color: rgba\([^,]+,\s*[^,]+,\s*[^,]+,\s*calc\(([\d.]+)/g)].map((match) => Number(match[1]))

describe('buildCaretBlinkKeyframesCss', () => {
  /**
   * The regression that sent this back once: `color-mix()` and `var()` inside
   * an animated property are not interpolable in Chromium 124 (Electron 30),
   * which animated the blink discretely. Only the two holds may be var()s.
   */
  it('emits plain rgba colour stops, never color-mix() or var() in a colour', () => {
    const css = build()
    expect(css).not.toContain('color-mix')
    expect(css.replace(/var\(--(caret-typing-hold|beat-caret-hold), 0\)/g, '')).not.toContain('var(')
  })

  it('puts one stop per level, evenly spaced from 0 to 100%', () => {
    const css = build()
    expect(percentsOf(css)).toEqual([0, 25, 50, 75, 100])
    expect(fillAlphasOf(css)).toEqual([0.18, 0.03, 0.27, 0.09, 0.18])
  })

  it('resolves each surface off its own colour, scaling only alpha, held toward its own alpha', () => {
    const css = build({ levels: [0.9, 0.9] })
    expect(css).toContain('background-color: rgba(0, 0, 0, calc(0.27 + (0.3 - 0.27) * max(var(--caret-typing-hold, 0), var(--beat-caret-hold, 0))))')
    expect(css).toContain('outline-color: rgba(10, 20, 30, calc(0.72 + (0.8 - 0.72) * max(var(--caret-typing-hold, 0), var(--beat-caret-hold, 0))))')
    expect(css).toContain('box-shadow: 0 0 0px 6px rgba(200, 100, 50, calc(0.45 + (0.5 - 0.45) * max(var(--caret-typing-hold, 0), var(--beat-caret-hold, 0))))')
  })

  it('carries blur and spread independently into the halo shadow', () => {
    expect(build({ haloBlurPx: 4 })).toContain('box-shadow: 0 0 4px 6px rgba(200, 100, 50,')
    expect(build({ haloSpreadPx: 0, haloBlurPx: 9 })).toContain('box-shadow: 0 0 9px 0px rgba(200, 100, 50,')
    expect(build({ haloBlurPx: -3 })).toContain('box-shadow: 0 0 0px 6px rgba(200, 100, 50,')
  })

  it('clamps a level outside 0..1', () => {
    expect(fillAlphasOf(build({ levels: [-1, 2] }))).toEqual([0, 0.3])
  })

  it('falls back to a visible colour when one cannot be parsed', () => {
    const css = build({ caretColor: 'not-a-colour' })
    expect(css).toContain('background-color: rgba(0, 0, 0,')
    expect(css).not.toContain('not-a-colour')
  })
})
