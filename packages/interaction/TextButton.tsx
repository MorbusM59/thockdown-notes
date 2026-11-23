import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * THE TEXT BUTTON: a micro button (`.options-curve-button`, a row of
 * `--entry-height`) that is as wide as its column rather than square, and says
 * what it does in a few words ("Replace all", "By artist...") instead of
 * showing an icon. The one sanctioned exception to the no-static-text rule
 * for panels: use it where an icon would not get the action across at once.
 * `isActive` marks the chosen one of a set, as the micro buttons do.
 */
export function TextButton({ isActive = false, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { isActive?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={`options-curve-cell options-curve-button text-button${isActive ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
    >
      <span className="text-button-label">{children}</span>
    </button>
  )
}
