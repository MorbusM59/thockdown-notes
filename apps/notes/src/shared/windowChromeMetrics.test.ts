import { describe, expect, it } from 'vitest'
import { AUDIO_GRID_COLUMNS } from './audioPlayer'
import {
  BTN_SQUARE_LARGE_SIZE_PX,
  computeWindowControlsCollapsedWidthPx,
  computeWindowControlsMetrics,
  computeWindowControlsWidthPx,
  DEFAULT_SPACING_REGULAR_PX,
  WINDOW_CONTROLS_PANEL_BORDER_PX,
} from './windowChromeMetrics'

/**
 * These figures have to agree with what the browser actually lays out, and
 * twice now they have not: the panel was derived one playlist bucket short
 * (21px of overflow, the window buttons sitting outside their own panel) and,
 * underneath that, never counted the panel's border-box border at all.
 *
 * The expectations below are MEASURED values, read off the rendered app at
 * the default spacing setting with Playwright, not re-derived from the same
 * arithmetic they check -- a test that recomputes the formula would have
 * passed happily through both bugs.
 */
describe('window-controls panel width', () => {
  it('matches the panel measured in the browser at default spacing', () => {
    // Measured: .window-controls-grid offsetWidth === 261, and its contents
    // (audio player 128 + gap 4 + window buttons 128) end flush with its right
    // edge rather than a pixel past it.
    expect(computeWindowControlsWidthPx(DEFAULT_SPACING_REGULAR_PX)).toBe(261)
  })

  it('matches the collapsed panel probe the mini-mode handler measures', () => {
    // Measured: the is-collapsed clone laid out at max-content is 178 wide.
    expect(computeWindowControlsCollapsedWidthPx(DEFAULT_SPACING_REGULAR_PX)).toBe(178)
  })

  it('measures the audio player as one button per playlist bucket', () => {
    // Measured: .audio-micro-grid is 124 wide (6 columns of 19, 5 gaps of 2),
    // and .audio-controls adds its 4px left padding on top.
    const { audioWidthPx } = computeWindowControlsMetrics(DEFAULT_SPACING_REGULAR_PX)
    expect(audioWidthPx).toBe(128)

    // Tied to the bucket count rather than a literal: adding a bucket has to
    // widen the panel, which is the failure this whole module exists for.
    const smallGapPx = DEFAULT_SPACING_REGULAR_PX / 2
    const buttonPx = (BTN_SQUARE_LARGE_SIZE_PX - smallGapPx) / 2
    expect(audioWidthPx).toBe(
      DEFAULT_SPACING_REGULAR_PX + AUDIO_GRID_COLUMNS * buttonPx + (AUDIO_GRID_COLUMNS - 1) * smallGapPx,
    )
  })

  it('counts the panel border, which is inside its border-box width', () => {
    // Collapsed is bordered on all four sides, full-width only on the left, so
    // the collapsed figure carries exactly one more border than the difference
    // in buttons would otherwise explain.
    const spacing = DEFAULT_SPACING_REGULAR_PX
    const { windowButtonWidthPx } = computeWindowControlsMetrics(spacing)
    const twoHiddenButtons = 2 * windowButtonWidthPx
    expect(
      computeWindowControlsWidthPx(spacing) - computeWindowControlsCollapsedWidthPx(spacing),
    ).toBe(twoHiddenButtons - WINDOW_CONTROLS_PANEL_BORDER_PX)
  })

  it('scales every term with the spacing setting', () => {
    // Nothing in here may be a fixed pixel count that ignores the user's
    // spacing, or the panel stops fitting its contents at non-default settings.
    expect(computeWindowControlsWidthPx(8)).toBeGreaterThan(computeWindowControlsWidthPx(4))
    expect(computeWindowControlsWidthPx(2)).toBeLessThan(computeWindowControlsWidthPx(4))
  })

  it('never returns a fractional width, so a track can never round down under its content', () => {
    for (const spacing of [1, 3, 5, 7, 9]) {
      expect(Number.isInteger(computeWindowControlsWidthPx(spacing))).toBe(true)
      expect(Number.isInteger(computeWindowControlsCollapsedWidthPx(spacing))).toBe(true)
    }
  })
})
