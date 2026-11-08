import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { armHold, HOLD_CONFIRM_MS } from './holdTiming'

/**
 * The UNSAVED PRESET of a preset list: the plus after the factory and saved
 * presets of the layouts, the soundstages and the soundscapes alike.
 *
 * Every one of those lists follows one rule. The live settings are always
 * kept as the unsaved preset, and the plus is drawn exactly while that
 * preset equals none of the others: the host renders this only then, having
 * derived it from the settings, never from a stored flag. It is a preset
 * like the rest: a click selects it (pressed while the live settings are
 * it), so the reader can try another preset and come back. Holding it saves
 * it as a new preset, which then stands where the plus stood, and the plus
 * goes because the unsaved preset now equals that new one.
 *
 * The hold is a primary press held for `HOLD_CONFIRM_MS` (`armHold`: so the
 * cursor announces it, and a finger gets it too). Saving is not destructive,
 * a saved preset can be deleted again, so it takes the shorter threshold.
 * A completed hold swallows the click its release produces.
 */
export function UnsavedPresetButton({ active, noun, canSave = true, onSelect, onSave, secondary }: {
  /** The live settings are the unsaved preset. */
  active: boolean
  /** What a saved preset is called, for the tooltip: "layout", "soundstage". */
  noun: string
  /** False when the list is full: the hold does nothing and the tooltip says so. */
  canSave?: boolean
  onSelect: () => void
  onSave: () => void
  /** A host's own right-press gesture on the button, with its tooltip line. */
  secondary?: {
    tooltip: string
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void
  }
}) {
  const holdRef = useRef<{ pointerId: number; cancel: () => void } | null>(null)
  const swallowClickRef = useRef(false)
  useEffect(() => () => holdRef.current?.cancel(), [])

  const end = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (holdRef.current?.pointerId === event.pointerId) {
      holdRef.current.cancel()
      holdRef.current = null
    }
    secondary?.onPointerEnd(event)
  }

  const tooltip = [
    'Unsaved changes',
    canSave ? `Hold to save them as a new ${noun}.` : `The list is full: delete a ${noun} to save these.`,
    secondary?.tooltip,
  ].filter(Boolean).join('\n')

  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn options-loadout-plus${active ? ' is-active' : ''}`}
      data-tooltip={tooltip}
      aria-label={`Unsaved changes. Hold to save as a new ${noun}.`}
      aria-pressed={active}
      data-secondary-press={secondary ? 'action' : 'none'}
      onClick={() => {
        if (swallowClickRef.current) {
          swallowClickRef.current = false
          return
        }
        if (!active) onSelect()
      }}
      onPointerDown={(event) => {
        swallowClickRef.current = false
        if (event.button === 2) {
          secondary?.onPointerDown(event)
          return
        }
        if (event.button !== 0 || !canSave) return
        holdRef.current?.cancel()
        const cancel = armHold(() => {
          holdRef.current = null
          swallowClickRef.current = true
          onSave()
        }, HOLD_CONFIRM_MS)
        holdRef.current = { pointerId: event.pointerId, cancel }
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onMouseLeave={() => {
        holdRef.current?.cancel()
        holdRef.current = null
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <span className="options-loadout-plus-glyph fa-solid fa-plus" aria-hidden="true" />
    </button>
  )
}
