/**
 * A colour target: a swatch showing one colour the reader can set. A left
 * click applies the staged colour through the channel mask; a held right
 * click copies the target's masked channels into the staging
 * (colorStaging.ts). Every colour target in the options panel is one of
 * these, so the two gestures mean the same thing everywhere.
 */
import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { hsvaToRgba, parseCssColorToRgba, rgbaToCssColor, rgbaToHsva } from '@thockdown/look/colorMath'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { applyStagedColor, copyIntoStaging, getColorStaging, setStagedColor } from './colorStaging'

export interface ColorTargetButtonProps {
  /** The target's current colour, as CSS. */
  color: string
  /** Font Awesome classes for the swatch's glyph. */
  glyph: string
  tooltip: string
  onApply: (css: string) => void
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export function ColorTargetButton({ color, glyph, tooltip, onApply, className, style, children }: ColorTargetButtonProps) {
  const cancelHoldRef = useRef<(() => void) | null>(null)
  const cancelHold = useCallback(() => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }, [])
  useEffect(() => cancelHold, [cancelHold])

  const apply = () => {
    const current = parseCssColorToRgba(color)
    if (!current) return
    const { color: staged, mask } = getColorStaging()
    onApply(rgbaToCssColor(hsvaToRgba(applyStagedColor(rgbaToHsva(current), staged, mask))))
  }

  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-color-target${className ? ` ${className}` : ''}`}
      style={{ '--options-swatch-color': color, ...style } as CSSProperties}
      data-tooltip={tooltip}
      onClick={apply}
      onPointerDown={(event) => {
        if (event.button !== 2) return
        event.stopPropagation()
        cancelHold()
        cancelHoldRef.current = armHold(() => {
          cancelHoldRef.current = null
          const source = parseCssColorToRgba(color)
          if (!source) return
          const { mask } = getColorStaging()
          setStagedColor((staged) => copyIntoStaging(staged, rgbaToHsva(source), mask))
        }, HOLD_CONFIRM_MS)
      }}
      onPointerUp={(event) => {
        if (event.button === 2) cancelHold()
      }}
      onMouseLeave={cancelHold}
      data-secondary-press="action"
      onContextMenu={(event) => {
        event.preventDefault()
        cancelHold()
      }}
    >
      <span className={`options-color-swatch-glyph ${glyph}`} aria-hidden="true" />
      {children}
    </button>
  )
}
