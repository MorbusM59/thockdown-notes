/**
 * The look, in one button: the current visual preset's icon.
 * - A TAP switches between light and dark mode (each remembers its own
 *   preset, so switching back returns to it).
 * - A DRAG up or down steps through the current mode's presets: up the next,
 *   down the previous, wrapping. It behaves like a schedule slot's minute
 *   drag (ScheduleGrid.tsx), by the same rules, so the two feel alike: a
 *   press becomes a drag only once the finger leaves the button, a step is
 *   the button's own height measured from where the press began (leaving
 *   is the first step), and moving back undoes steps. A release inside the
 *   button is always a tap.
 */
import { useRef } from 'react'
import type { MobileLook } from './preferencesStore'

interface LookButtonProps {
  look: MobileLook
  presetCount: number
  icon: string
  presetName: string
  onChange: (look: MobileLook) => void
}

interface LookPress {
  pointerId: number
  y: number
  box: DOMRect
  preset: number
  stepPx: number
  dragging: boolean
}

export function LookButton({ look, presetCount, icon, presetName, onChange }: LookButtonProps) {
  const pressRef = useRef<LookPress | null>(null)
  const mode = look.mode
  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn${mode === 'dark' ? ' is-active' : ''}`}
      aria-label={`${presetName}, ${mode} mode: tap for ${mode === 'dark' ? 'light' : 'dark'} mode, drag up or down for another look`}
      data-secondary-press="none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pressRef.current = {
          pointerId: event.pointerId,
          y: event.clientY,
          box: event.currentTarget.getBoundingClientRect(),
          preset: look.preset[mode],
          stepPx: Math.max(1, event.currentTarget.offsetHeight),
          dragging: false,
        }
      }}
      onPointerMove={(event) => {
        const press = pressRef.current
        if (!press || press.pointerId !== event.pointerId) return
        const { box } = press
        if (!press.dragging) {
          if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) return
          press.dragging = true
        }
        // Up is the next preset: screen y grows downwards.
        const steps = Math.round((press.y - event.clientY) / press.stepPx)
        const preset = (((press.preset + steps) % presetCount) + presetCount) % presetCount
        if (preset !== look.preset[mode]) onChange({ ...look, preset: { ...look.preset, [mode]: preset } })
      }}
      onPointerUp={(event) => {
        const press = pressRef.current
        if (!press || press.pointerId !== event.pointerId) return
        pressRef.current = null
        if (!press.dragging) onChange({ ...look, mode: mode === 'dark' ? 'light' : 'dark' })
      }}
      onPointerCancel={() => { pressRef.current = null }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className={icon} aria-hidden="true" />
    </button>
  )
}
