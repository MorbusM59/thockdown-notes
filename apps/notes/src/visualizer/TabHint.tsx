/**
 * While the panels are hidden (panelsShown.ts), the boxes one row beneath
 * the cutout say how to bring them back: "[Tab]" under an odd cutout, "Hit
 * [Tab]!" under an even one, so it is centred either way, one letter per box.
 * Shown only while the cursor is
 * (`CursorIdle.tsx`), fading with it (visualizer.css).
 */

import type { VisualizerLayout } from './visualizerLayout'

export function TabHint({ layout }: { layout: VisualizerLayout }) {
  const { boxPx, originXPx, originYPx, cutout } = layout
  if (cutout.size <= 0) return null
  const text = Array.from(cutout.size % 2 === 1 ? '[Tab]' : 'Hit [Tab]!')
  const column = cutout.column + (cutout.size - text.length) / 2
  const row = cutout.row + cutout.size + 1
  return (
    <>
      {text.map((char, index) => (char === ' ' ? null : (
        <div
          key={index}
          className="visualizer-letter visualizer-tab-hint"
          style={{ left: originXPx + (column + index) * boxPx, top: originYPx + row * boxPx, width: boxPx, height: boxPx, lineHeight: `${boxPx}px` }}
        >
          {char}
        </div>
      )))}
    </>
  )
}
