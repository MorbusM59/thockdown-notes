import { useCallback, useRef, useState } from 'react'
import { useNonPassiveWheel } from './useNonPassiveWheel'
import { clamp } from './clamp'


function formatCompactSettingNumber(value: number, step: number): string {
  const normalizedStep = String(step)
  const decimalIndex = normalizedStep.indexOf('.')
  const decimalPlaces = decimalIndex >= 0 ? normalizedStep.length - decimalIndex - 1 : 0
  return value.toFixed(decimalPlaces).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

type CompactScrollbarSliderProps = {
  id: string
  value: number
  min: number
  max: number
  step: number
  trackLabel: string
  /**
   * What the tooltip calls the value, when that is not what the rail calls
   * the control.
   *
   * The rail's own label has to fit inside the track, so it names the
   * setting; the tooltip has room to name the UNIT the number is in, which
   * is often the more useful of the two ("note size threshold" on the rail,
   * "characters: 20000" on hover). Defaults to `trackLabel`, which is right
   * whenever the setting and its unit are the same word.
   */
  tooltipLabel?: string
  ariaLabel: string
  reverseScale?: boolean
  defaultValue?: number
  /**
   * Greys the control out and ignores every input.
   *
   * For a setting that another control has taken out of play -- the value is
   * still shown, and still stored, because it is what the setting returns to
   * when that other control lets go of it.
   */
  disabled?: boolean
  /**
   * What the tooltip shows, when that is not the stored number itself.
   *
   * A control's steps and the quantity a user is actually tuning are not
   * always the same thing -- the wheel-spin dampen slider steps through a
   * divisor and displays the decay it computes from it. The stored value
   * still drives everything else (position, keyboard, aria-valuenow); this
   * only changes what is read out.
   */
  formatValue?: (value: number) => string
  /**
   * What a right click does: `reset` returns to `defaultValue`, `type` opens a
   * field inside the slider's own box for typing a value in. The field takes
   * the box's exact size, so opening it cannot move the layout; Enter commits,
   * Escape or leaving the field cancels.
   */
  secondaryPress?: 'reset' | 'type'
  /**
   * Shows the slider as not in effect while leaving it fully usable -- for a
   * value that is still edited but that a press elsewhere will not apply.
   * Unlike `disabled`, input is not ignored.
   */
  dimmed?: boolean
  onCommit: (value: number) => void
}

export function CompactScrollbarSlider({
  id,
  value,
  min,
  max,
  step,
  trackLabel,
  tooltipLabel,
  ariaLabel,
  reverseScale = false,
  defaultValue,
  disabled = false,
  formatValue,
  secondaryPress = 'reset',
  dimmed = false,
  onCommit,
}: CompactScrollbarSliderProps) {
  const [entry, setEntry] = useState<string | null>(null)
  /** The kind of pointer that last pressed the slider: a `contextmenu` cannot say whether it came from a mouse. */
  const pressPointerTypeRef = useRef('mouse')
  const railRef = useRef<HTMLDivElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const valueSpan = Math.max(max - min, Number.EPSILON)

  const valueToRatio = useCallback((nextValue: number) => {
    const normalized = clamp((nextValue - min) / valueSpan, 0, 1)
    return reverseScale ? 1 - normalized : normalized
  }, [min, reverseScale, valueSpan])

  const ratioToValue = useCallback((ratioFromLeft: number) => {
    const normalized = reverseScale ? 1 - ratioFromLeft : ratioFromLeft
    return min + (clamp(normalized, 0, 1) * valueSpan)
  }, [min, reverseScale, valueSpan])

  const ratio = valueToRatio(value)

  const snapValue = useCallback((nextValue: number) => {
    const steps = Math.round((nextValue - min) / step)
    return clamp(min + (steps * step), min, max)
  }, [max, min, step])

  const applyPointerValue = useCallback((clientX: number) => {
    const rail = railRef.current
    if (!rail) return

    const rect = rail.getBoundingClientRect()
    if (rect.width <= 0) return

    const styles = getComputedStyle(rail)
    const gap = Number.parseFloat(styles.getPropertyValue('--canonical-scroll-handle-gap')) || 3
    const baseThumbSize = Number.parseFloat(styles.getPropertyValue('--canonical-scroll-handle-thickness')) || 10
    const thumbSize = baseThumbSize + 2
    const thumbInset = gap - 1
    const startX = rect.left + thumbInset + (thumbSize / 2)
    const travel = Math.max(1, rect.width - (thumbInset * 2) - thumbSize)
    const nextRatio = clamp((clientX - startX) / travel, 0, 1)
    onCommit(snapValue(ratioToValue(nextRatio)))
  }, [onCommit, ratioToValue, snapValue])

  const nudgeBy = useCallback((delta: number) => {
    onCommit(snapValue(value + delta))
  }, [onCommit, snapValue, value])

  const handleWheel = useCallback((event: WheelEvent) => {
    if (disabled) return
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (dominantDelta === 0) return

    event.preventDefault()
    event.stopPropagation()
    // Shift moves ten steps at a time, as PageUp/PageDown do.
    const stepSize = event.shiftKey ? step * 10 : step
    nudgeBy(dominantDelta > 0 ? -stepSize : stepSize)
  }, [disabled, nudgeBy, step])

  const commitEntry = (text: string) => {
    setEntry(null)
    const parsed = Number.parseFloat(text.replace(',', '.'))
    if (Number.isFinite(parsed)) onCommit(snapValue(parsed))
  }

  useNonPassiveWheel(shellRef, handleWheel)

  return (
    <div
      id={id}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(formatCompactSettingNumber(value, step))}
      aria-valuetext={formatValue ? formatValue(value) : undefined}
      aria-disabled={disabled || undefined}
      className={`utility-setting-scrollbar-shell${isDragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}${dimmed ? ' is-dimmed' : ''}`}
      data-live-tooltip={`${tooltipLabel ?? trackLabel}: ${formatValue ? formatValue(value) : formatCompactSettingNumber(value, step)}`}
      ref={shellRef}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault()
          nudgeBy(-step)
          return
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault()
          nudgeBy(step)
          return
        }
        if (event.key === 'PageUp') {
          event.preventDefault()
          nudgeBy(step * 10)
          return
        }
        if (event.key === 'PageDown') {
          event.preventDefault()
          nudgeBy(-(step * 10))
          return
        }
        if (event.key === 'Home') {
          event.preventDefault()
          onCommit(reverseScale ? max : min)
          return
        }
        if (event.key === 'End') {
          event.preventDefault()
          onCommit(reverseScale ? min : max)
        }
      }}
      onPointerDown={(event) => {
        pressPointerTypeRef.current = event.pointerType
        if (disabled) return
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setIsDragging(true)
        applyPointerValue(event.clientX)
      }}
      onPointerMove={(event) => {
        if (!isDragging) return
        applyPointerValue(event.clientX)
      }}
      onPointerUp={(event) => {
        if (!isDragging) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        setIsDragging(false)
      }}
      onPointerCancel={() => setIsDragging(false)}
      data-secondary-press="action"
      onContextMenu={(event) => {
        event.preventDefault()
        // A right-click resets; a long press is not one. Android raises
        // `contextmenu` for a long press too, which reset a slider the reader
        // was holding to adjust.
        if (pressPointerTypeRef.current !== 'mouse') return
        if (disabled) return
        if (secondaryPress === 'type') {
          setEntry(formatCompactSettingNumber(value, step))
          return
        }
        if (defaultValue !== undefined) onCommit(snapValue(defaultValue))
      }}
    >
      {entry !== null ? (
        <input
          className="utility-setting-scrollbar-entry"
          aria-label={ariaLabel}
          inputMode="decimal"
          spellCheck={false}
          autoFocus
          value={entry}
          onFocus={(event) => event.currentTarget.select()}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => setEntry(event.target.value.replace(/[^0-9.,-]/g, ''))}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              commitEntry(entry)
            } else if (event.key === 'Escape' || event.key === 'Tab') {
              event.preventDefault()
              setEntry(null)
            }
          }}
          onBlur={() => setEntry(null)}
        />
      ) : null}
      <div className="utility-setting-scrollbar-rail" ref={railRef} aria-hidden="true">
        <span className="utility-setting-scrollbar-track-label">{trackLabel}</span>
        <div
          className="utility-setting-scrollbar-thumb"
          style={{
            left: `calc((var(--canonical-scroll-handle-gap) - 1px) + (${ratio} * (100% - ((var(--canonical-scroll-handle-gap) - 1px) * 2) - (var(--canonical-scroll-handle-thickness) + 2px))))`,
          }}
        />
      </div>
    </div>
  )
}
