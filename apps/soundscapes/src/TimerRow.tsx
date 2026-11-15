/**
 * The timer (timer.ts) as a row of six buttons: the five durations, then
 * infinity, exactly one of them active.
 *
 * - A DURATION: a tap makes it the timer, or, when it already is, hands
 *   over to infinity; hold, then drag up or down, to change it on its grid
 *   (useStepDrag), which also restarts the countdown when it is the active one.
 * - INFINITY: a tap plays until stopped.
 */
import { durationLines, stepDuration, type TimerSettings } from './timer'
import { useStepDrag } from './useStepDrag'

interface TimerRowProps {
  timer: TimerSettings
  onChange: (update: (timer: TimerSettings) => TimerSettings) => void
}

function DurationButton({ seconds, active, onTap, onStep }: { seconds: number; active: boolean; onTap: () => void; onStep: (seconds: number) => void }) {
  const { handlers } = useStepDrag({
    begin: () => seconds,
    step: (base, steps) => onStep(stepDuration(base, steps)),
    tap: onTap,
  })
  const lines = durationLines(seconds)
  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn mobile-timer-btn${active ? ' is-active' : ''}`}
      aria-pressed={active}
      aria-label={`Timer ${lines.join(' ')}`}
      data-secondary-press="none"
      {...handlers}
    >
      {lines.map((line) => <span key={line}>{line}</span>)}
    </button>
  )
}

export function TimerRow({ timer, onChange }: TimerRowProps) {
  return (
    <div className="options-loadout-grid mobile-timer" role="group" aria-label="Timer">
      {timer.durations.map((seconds, index) => (
        <DurationButton
          // By position: a duration changing must not remount the button being dragged.
          key={index}
          seconds={seconds}
          active={timer.active === index}
          onTap={() => onChange((current) => ({ ...current, active: current.active === index ? null : index }))}
          onStep={(next) => onChange((current) => ({ ...current, durations: current.durations.map((value, at) => (at === index ? next : value)) }))}
        />
      ))}
      <button
        type="button"
        className={`btn-icon options-color-swatch options-loadout-btn${timer.active === null ? ' is-active' : ''}`}
        aria-pressed={timer.active === null}
        aria-label="No timer"
        onClick={() => onChange((current) => ({ ...current, active: null }))}
      >
        <span className="fa-solid fa-infinity" aria-hidden="true" />
      </button>
    </div>
  )
}
