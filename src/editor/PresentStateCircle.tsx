// The "empty scrollbar that's just a circle" affordance. Single
// responsibility, deliberately: it only reflects/toggles the present manual
// save-point state. Returning from a history preview to the live document is
// the timeline slider's job (dragging/navigating to the rightmost mark) --
// see the design discussion this was built from for why splitting these two
// jobs apart is preferable to v1's single overloaded "present box".

export type PresentStateCircleProps = {
  hasPendingManualChanges: boolean
  onCreateManualSnapshot: () => void
  onGoToPresent?: () => void
  isPresent?: boolean
  disabled?: boolean
}

export function PresentStateCircle({
  hasPendingManualChanges,
  onCreateManualSnapshot,
  onGoToPresent,
  isPresent = true,
  disabled,
}: PresentStateCircleProps) {
  return (
    <button
      type="button"
      className={[
        'manual-snapshot-circle',
        hasPendingManualChanges ? 'is-hollow' : 'is-filled',
        !isPresent ? 'not-present' : '',
      ].filter(Boolean).join(' ')}
      disabled={disabled}
      aria-pressed={!hasPendingManualChanges}
      aria-label={
        hasPendingManualChanges
          ? 'Create a manual save point'
          : 'Current text matches your last manual save'
      }
      title={
        hasPendingManualChanges
          ? 'Create a manual save point'
          : 'On your last manual save'
      }
      onClick={() => {
        if (disabled) return
        if (!isPresent) {
          onGoToPresent?.()
          return
        }
        if (hasPendingManualChanges) {
          onCreateManualSnapshot()
        } else {
          onGoToPresent?.()
        }
      }}
    >
      <span className="manual-snapshot-circle-dot" aria-hidden="true" />
    </button>
  )
}
