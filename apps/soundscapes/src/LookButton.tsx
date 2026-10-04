/**
 * The look, in one button, showing the moon (dark mode is the thing it
 * toggles; lit while dark mode is on).
 * - A TAP switches between light and dark mode (each remembers its own
 *   preset, so switching back returns to it).
 * - A DRAG up or down steps through the current mode's presets, wrapping
 *   (useStepDrag.ts): up the next, down the previous. While it does, and
 *   for a moment after, the button shows the preset's own icon.
 */
import type { MobileLook } from './preferencesStore'
import { useStepDrag } from './useStepDrag'

interface LookButtonProps {
  look: MobileLook
  presetCount: number
  icon: string
  presetName: string
  onChange: (look: MobileLook) => void
}

export function LookButton({ look, presetCount, icon, presetName, onChange }: LookButtonProps) {
  const mode = look.mode
  const { handlers, adjusting } = useStepDrag({
    begin: () => look.preset[mode],
    step: (base, steps) => {
      const preset = (((base + steps) % presetCount) + presetCount) % presetCount
      if (preset !== look.preset[mode]) onChange({ ...look, preset: { ...look.preset, [mode]: preset } })
    },
    tap: () => onChange({ ...look, mode: mode === 'dark' ? 'light' : 'dark' }),
  })
  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn${mode === 'dark' ? ' is-active' : ''}`}
      aria-label={`${presetName}, ${mode} mode: tap for ${mode === 'dark' ? 'light' : 'dark'} mode, drag up or down for another look`}
      data-secondary-press="none"
      {...handlers}
    >
      <span className={adjusting ? icon : 'fa-solid fa-moon'} aria-hidden="true" />
    </button>
  )
}
