/**
 * A colour target: a swatch showing one colour the reader can set.
 *
 * A left click LINKS it (colorStaging.ts): the picker takes its colour, and
 * from then on the picker writes into it as it moves; the button shows as
 * active, and a second click unlinks it. A right click writes the staged
 * colour into it at once, through the channel mask, without linking it.
 * Every colour target in the options panel is one of these, so the two
 * gestures mean the same thing everywhere.
 *
 * A link does not outlive its section: folding the section, or the panel
 * unmounting, ends it. The staged colour stays, which is how a colour is
 * carried from one section to another.
 */
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { useAccordionSectionOpen } from '@thockdown/interaction/accordionSectionOpen'
import { hsvaToRgba, parseCssColorToRgba, rgbaToCssColor, rgbaToHsva } from '@thockdown/look/colorMath'
import { applyStagedColor, getColorStaging, linkTarget, unlinkTarget, useLinkedColor } from './colorStaging'

export interface ColorTargetButtonProps {
  /** The target's current colour, as CSS. */
  color: string
  /** Font Awesome classes for the swatch's glyph. */
  glyph: string
  tooltip: string
  onApply: (css: string) => void
  /** A stable id for the link, for a caller that needs to know which target is linked. */
  linkId?: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export function ColorTargetButton({ color, glyph, tooltip, onApply, linkId, className, style, children }: ColorTargetButtonProps) {
  const ownId = useId()
  const id = linkId ?? ownId
  const linkedColor = useLinkedColor(id)
  const isLinked = linkedColor !== null
  const sectionOpen = useAccordionSectionOpen()
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply

  useEffect(() => {
    if (!sectionOpen) unlinkTarget(id)
  }, [sectionOpen, id])
  useEffect(() => () => unlinkTarget(id), [id])

  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-color-target${isLinked ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--options-swatch-color': linkedColor ?? color, ...style } as CSSProperties}
      data-tooltip={tooltip}
      aria-pressed={isLinked}
      onClick={() => {
        if (isLinked) {
          unlinkTarget(id)
          return
        }
        const rgba = parseCssColorToRgba(color)
        if (rgba) linkTarget(id, rgbaToHsva(rgba), (css) => onApplyRef.current(css))
      }}
      onPointerDown={(event) => {
        if (event.button !== 2) return
        event.stopPropagation()
        const current = parseCssColorToRgba(color)
        if (!current) return
        const { color: staged, mask } = getColorStaging()
        onApply(rgbaToCssColor(hsvaToRgba(applyStagedColor(rgbaToHsva(current), staged, mask))))
      }}
      data-secondary-press="action"
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className={`options-color-swatch-glyph ${glyph}`} aria-hidden="true" />
      {children}
    </button>
  )
}
