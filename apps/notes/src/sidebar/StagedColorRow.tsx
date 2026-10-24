/**
 * A section's colour targets and the staged H/S/V/A that is applied to
 * them: the closed loop the Cursor and Caret sections use (left-click a
 * target swatch to apply the staged colour to it, hold right-click on one to
 * copy its colour back into the staging), as one component holding its own
 * staging, so a section is a list of targets rather than a copy of the
 * handlers. The Cursor and Caret sections still carry their own copies in
 * App.tsx (docs/pending-review-and-removal.md).
 */

import { useCallback, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { hsvaToRgba, parseCssColorToRgba, rgbaToCssColor, rgbaToHsva, type HsvaColor } from '@thockdown/look/colorMath'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'

export interface StagedColorTarget {
  id: string
  color: string
  /** Font Awesome classes for the swatch's glyph. */
  glyph: string
  tooltip: string
  onApply: (css: string) => void
}

type Control = 'h' | 's' | 'v' | 'a'

const CONTROLS: ReadonlyArray<{ control: Control; glyph: string; name: string }> = [
  { control: 'h', glyph: 'fa-solid fa-rainbow', name: 'Hue' },
  { control: 's', glyph: 'fa-solid fa-droplet', name: 'Saturation' },
  { control: 'v', glyph: 'fa-solid fa-circle-half-stroke', name: 'Value' },
  { control: 'a', glyph: 'fa-solid fa-eye', name: 'Alpha' },
]

function valueOf(hsva: HsvaColor, control: Control): number {
  return control === 'h' ? hsva.h : hsva[control] * 255
}

function withValue(hsva: HsvaColor, control: Control, raw: number): HsvaColor {
  return control === 'h'
    ? { ...hsva, h: Math.max(0, Math.min(360, raw)) }
    : { ...hsva, [control]: Math.max(0, Math.min(1, raw / 255)) }
}

export function StagedColorRow({ targets, label }: { targets: StagedColorTarget[]; label: string }) {
  const [hsva, setHsva] = useState<HsvaColor>(() => rgbaToHsva(parseCssColorToRgba(targets[0]?.color ?? '') ?? { r: 255, g: 255, b: 255, a: 1 }))
  const [drag, setDrag] = useState<{ control: Control; pointerId: number; startY: number; base: number } | null>(null)
  const cancelHoldRef = useRef<(() => void) | null>(null)

  const cancelHold = useCallback(() => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }, [])

  const display = useMemo(() => ({
    h: rgbaToCssColor(hsvaToRgba({ h: hsva.h, s: 1, v: 1, a: 1 })),
    s: rgbaToCssColor(hsvaToRgba({ h: hsva.h, s: hsva.s, v: 1, a: 1 })),
    v: rgbaToCssColor(hsvaToRgba({ h: hsva.h, s: 0, v: hsva.v, a: 1 })),
    a: rgbaToCssColor(hsvaToRgba({ h: hsva.h, s: 0, v: 0, a: hsva.a })),
  }), [hsva])

  const startCopyHold = (target: StagedColorTarget, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.stopPropagation()
    cancelHold()
    cancelHoldRef.current = armHold(() => {
      cancelHoldRef.current = null
      const rgba = parseCssColorToRgba(target.color)
      if (rgba) setHsva(rgbaToHsva(rgba))
    }, HOLD_CONFIRM_MS)
  }

  const startDrag = (control: Control, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ control, pointerId: event.pointerId, startY: event.clientY, base: valueOf(hsva, control) })
  }

  const moveDrag = (control: Control, event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.control !== control || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    setHsva((previous) => withValue(previous, control, drag.base + drag.startY - event.clientY))
  }

  const stopDrag = (control: Control, event: PointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.control !== control || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDrag(null)
  }

  const wheel = (control: Control, event: WheelEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (delta === 0) return
    setHsva((previous) => withValue(previous, control, valueOf(previous, control) + (delta > 0 ? -1 : 1)))
  }

  return (
    <div className="options-caret-settings-grid" role="group" aria-label={label}>
      {targets.map((target) => (
        <button
          key={target.id}
          type="button"
          className="btn-icon options-color-swatch"
          style={{ background: target.color }}
          data-tooltip={`${target.tooltip} — click to apply, hold right-click to copy`}
          onClick={() => target.onApply(rgbaToCssColor(hsvaToRgba(hsva)))}
          onPointerDown={(event) => startCopyHold(target, event)}
          onPointerUp={(event) => { if (event.button === 2) cancelHold() }}
          onMouseLeave={cancelHold}
          data-secondary-press="action"
          onContextMenu={(event) => { event.preventDefault(); cancelHold() }}
        ><span className={`options-color-swatch-glyph ${target.glyph}`} aria-hidden="true" /></button>
      ))}
      {CONTROLS.map(({ control, glyph, name }) => (
        <button
          key={control}
          type="button"
          className={`btn-icon options-color-swatch options-hsva-control${control === 'a' ? ' options-hsva-alpha' : ''}${drag?.control === control ? ' is-dragging' : ''}`}
          style={control === 'a' ? { background: 'var(--color-background-light)', color: display.a } : { background: display[control] }}
          data-live-tooltip={`${name}: ${Math.round(valueOf(hsva, control))}`}
          onPointerDown={(event) => startDrag(control, event)}
          onPointerMove={(event) => moveDrag(control, event)}
          onPointerUp={(event) => stopDrag(control, event)}
          onPointerCancel={(event) => stopDrag(control, event)}
          onLostPointerCapture={(event) => stopDrag(control, event)}
          onWheel={(event) => wheel(control, event)}
        ><span className={`options-hsva-glyph ${glyph}`} aria-hidden="true" /></button>
      ))}
    </div>
  )
}
