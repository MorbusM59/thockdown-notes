/**
 * THE FIELD'S ACTION BUTTON: the one button every search, find and filter
 * field carries, so a field can be used start to finish with the mouse alone
 * as well as with the keyboard alone.
 *
 * It has two functions, and its icon says which it has now:
 * - while the field holds the keyboard, it is the field's ENTER: pressing it
 *   submits what was typed, exactly as the Enter key would (`onSubmit`);
 * - while it does not, and the field holds something, it CLEARS the field and
 *   leaves the keyboard where it is (`onClear`) -- clearing an applied
 *   filter is not a request to type a new one.
 * With the field empty and unfocused there is nothing to do, so it is
 * disabled.
 *
 * A press must not move the keyboard (focusOwnership.ts suppresses a press's
 * focus at the window), and the mousedown default is cancelled here as well,
 * so a field that held the keyboard still holds it when the click arrives and
 * the click reads the function the button was showing when it was pressed.
 */
export function FieldActionButton({
  isFieldFocused,
  hasValue,
  onSubmit,
  onClear,
  className,
}: {
  isFieldFocused: boolean
  hasValue: boolean
  onSubmit: () => void
  onClear: () => void
  className: string
}) {
  const label = isFieldFocused ? 'Enter' : 'Clear'
  return (
    <button
      type="button"
      className={className}
      data-tooltip={label}
      aria-label={label}
      disabled={!isFieldFocused && !hasValue}
      /* mouse-default: focus semantics, read by focusOwnership on mousedown */
      onMouseDown={(event) => event.preventDefault()}
      onClick={isFieldFocused ? onSubmit : onClear}
    >
      <span className={isFieldFocused ? 'fa-solid fa-turn-down fa-rotate-90' : 'fa-solid fa-xmark'} aria-hidden="true" />
    </button>
  )
}
