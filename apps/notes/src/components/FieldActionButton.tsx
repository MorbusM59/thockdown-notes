/**
 * THE FIELD'S ACTION BUTTON: the one button every search, find and filter
 * field carries, so a field can be used start to finish with the mouse alone
 * as well as with the keyboard alone.
 *
 * It has two functions, and its icon says which it has now:
 * - while the field holds the keyboard, it SUBMITS what was typed, exactly as
 *   the Enter key would (`onSubmit`), and shows the field's own icon
 *   (`icon`: a magnifying glass for a search, a funnel for a filter);
 * - while it does not, and the field holds something, it CLEARS the field and
 *   leaves the keyboard where it is (`onClear`) -- clearing an applied
 *   filter is not a request to type a new one.
 * With the field empty there is nothing to submit or clear, focused or not,
 * so it shows the field's icon and is disabled.
 *
 * A press must not move the keyboard (focusOwnership.ts suppresses a press's
 * focus at the window), and the mousedown default is cancelled here as well,
 * so a field that held the keyboard still holds it when the click arrives and
 * the click reads the function the button was showing when it was pressed.
 */
export function FieldActionButton({
  isFieldFocused,
  hasValue,
  icon,
  submitLabel,
  onSubmit,
  onClear,
  className,
}: {
  isFieldFocused: boolean
  hasValue: boolean
  /** The field's icon, a Font Awesome class: shown while there is nothing to clear. */
  icon: string
  /** The tooltip while it submits ("Search", "Filter"). */
  submitLabel: string
  onSubmit: () => void
  onClear: () => void
  className: string
}) {
  const isClear = hasValue && !isFieldFocused
  const label = isClear ? 'Clear' : submitLabel
  return (
    <button
      type="button"
      className={className}
      data-tooltip={label}
      aria-label={label}
      disabled={!hasValue}
      /* mouse-default: focus semantics, read by focusOwnership on mousedown */
      onMouseDown={(event) => event.preventDefault()}
      onClick={isClear ? onClear : onSubmit}
    >
      <span className={isClear ? 'fa-solid fa-xmark' : `fa-solid ${icon}`} aria-hidden="true" />
    </button>
  )
}
