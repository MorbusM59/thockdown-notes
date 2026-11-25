/**
 * The timer's picker (timer.ts), shown in the dashboard's toggle row
 * (DashboardToggleRow.tsx) when the Timer button is held: its five durations.
 *
 * - A tap selects that duration, switches the timer on and returns to the
 *   toggle row.
 * - Hold, then drag up or down, to step the duration through DURATIONS_SEC
 *   (useStepDrag); the picker stays up, and the countdown restarts when it is
 *   the selected one.
 */
import { durationLabel, stepDuration, type TimerSettings } from './timer'
import { useStepDrag } from './useStepDrag'

function DurationButton({ seconds, selected, onTap, onStep }: { seconds: number; selected: boolean; onTap: () => void; onStep: (seconds: number) => void }) {
  const { handlers } = useStepDrag({
    begin: () => seconds,
    step: (base, steps) => onStep(stepDuration(base, steps)),
    tap: onTap,
  })
  const label = durationLabel(seconds)
  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn mobile-timer-btn${selected ? ' is-active' : ''}`}
      aria-pressed={selected}
      aria-label={`Timer ${label}`}
      data-secondary-press="none"
      {...handlers}
    >
      {label}
    </button>
  )
}

export function TimerPicker({ timer, onChange, onPicked }: {
  timer: TimerSettings
  onChange: (update: (timer: TimerSettings) => TimerSettings) => void
  onPicked: () => void
}) {
  return timer.durations.map((seconds, index) => (
    <DurationButton
      // By position: a duration changing must not remount the button being dragged.
      key={index}
      seconds={seconds}
      selected={timer.selected === index}
      onTap={() => {
        onChange((current) => ({ ...current, selected: index, enabled: true }))
        onPicked()
      }}
      onStep={(next) => onChange((current) => ({ ...current, durations: current.durations.map((value, at) => (at === index ? next : value)) }))}
    />
  ))
}
