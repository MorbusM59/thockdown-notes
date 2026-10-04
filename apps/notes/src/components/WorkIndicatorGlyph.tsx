import { memo } from 'react'
import gearSvgSource from '@fortawesome/fontawesome-free/svgs/solid/gear.svg?raw'
import { useWorkIndicatorAngle } from '../shared/useWorkIndicatorAngle'

interface WorkIndicatorGlyphProps {
  speedX: number
  ramp: number
  skew: number
}

/**
 * The sidebar's options cogwheel, which turns while the app is working.
 *
 * ## Why this is its own component
 *
 * The angle changes every frame while the wheel moves, and the hook that
 * produces it holds React state. Calling it in App.tsx would re-render the
 * entire application sixty times a second to rotate one glyph -- an
 * indicator whose whole message is "the app is busy" must not be a reason the
 * app is busy. Here, the re-render is this span and nothing else.
 *
 * ## Why the glyph and not the button
 *
 * The button carries `is-active` and the app-wide `data-pressed` look
 * (shared/pressTracking.ts). Rotating the button would rotate those with it
 * and put a transform on an element whose styling is already doing work.
 * The glyph is the moving part, so the glyph is what moves.
 *
 * What the rotation MEANS is in shared/workIndicatorSpin.ts: the wheel's
 * artwork repeats every 60° (six teeth), so it turns in 60° increments and can only ever
 * come to rest looking like itself.
 */
/**
 * The gear's outline, taken from Font Awesome's own SVG of the icon the font
 * draws, so it is the same artwork.
 */
const GEAR_PATH = /\sd="([^"]+)"/.exec(gearSvgSource)?.[1] ?? ''

export const WorkIndicatorGlyph = memo(function WorkIndicatorGlyph({ speedX, ramp, skew }: WorkIndicatorGlyphProps) {
  const angleDeg = useWorkIndicatorAngle(speedX, ramp, skew)
  // AN SVG, NOT THE FONT GLYPH. Rotating text rotated a glyph Chromium
  // places on the pixel grid (baseline and glyph origin snapped) inside a box
  // whose centre -- the rotation's pivot -- sits at a fractional position, and
  // the two disagreed by a different amount at every angle: the centre hole
  // moved by up to a CSS pixel as the wheel turned, measured by overlaying
  // frames. A vector path is not snapped, and this viewBox puts the artwork's
  // centre (256, 256) exactly at the box's centre, which is where
  // `transform` pivots. The box keeps the font icon's footprint, 1.25em by
  // 1em, so nothing around it moves.
  return (
    <svg
      className="view-toggle-options-glyph"
      viewBox="-64 0 640 512"
      width="1.25em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      // Inline because it is a continuously varying value; a class could only
      // express a fixed animation, and the timing here is derived from the
      // reader's own animation settings rather than from a keyframe.
      //
      // Applied at rest too (rotate(0deg)), not dropped: an element with no
      // transform is rasterised on a different path from one with any, and
      // the wheel coming to rest would then shift by a fraction of a pixel.
      style={{ transform: `rotate(${angleDeg}deg)` }}
    >
      <path fill="currentColor" d={GEAR_PATH} />
    </svg>
  )
})
