import { memo } from 'react'
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
 * artwork repeats every 45°, so it turns in 45° increments and can only ever
 * come to rest looking like itself.
 */
export const WorkIndicatorGlyph = memo(function WorkIndicatorGlyph({ speedX, ramp, skew }: WorkIndicatorGlyphProps) {
  const angleDeg = useWorkIndicatorAngle(speedX, ramp, skew)
  return (
    <span
      className="view-toggle-options-glyph fa-solid fa-gear"
      aria-hidden="true"
      // Inline because it is a continuously varying value; a class could only
      // express a fixed animation, and the timing here is derived from the
      // reader's own animation settings rather than from a keyframe.
      style={angleDeg === 0 ? undefined : { transform: `rotate(${angleDeg}deg)` }}
    />
  )
})
