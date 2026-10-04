import type { KeyboardEvent, ReactNode } from 'react'

/**
 * Renders `children` (the pill's normal display markup) unless `isEditing`,
 * in which case it renders the shared in-place <input> instead -- same
 * classes as the caller passes in `className`, so it stays visually in the
 * pill's slot with zero hand-kept-in-sync styling. Pairs with
 * useInlinePillEdit, which owns the editing/draft state this just renders.
 */
export function InlinePillOrInput({
  isEditing,
  value,
  onChange,
  onCommit,
  onCancel,
  className,
  ariaLabel,
  children,
}: {
  isEditing: boolean
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  className: string
  ariaLabel: string
  children: ReactNode
}) {
  if (!isEditing) return <>{children}</>

  return (
    <input
      className={className}
      value={value}
      autoFocus
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      aria-label={ariaLabel}
    />
  )
}
