import type React from 'react'

export const FILTER_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
export const FILTER_YEARS = ['older', 2022, 2023, 2024, 2025, 2026] as const

export const CLEAR_MONTHS_SIGNAL = -1
export const CLEAR_YEARS_SIGNAL = 'clear-all' as const

export type YearValue = number | 'older' | typeof CLEAR_YEARS_SIGNAL

export function handleMultiSelect<T>(
  value: T,
  event: React.MouseEvent,
  currentSelection: Set<T>,
  allValues: readonly T[],
  setSelection: (selection: Set<T>) => void,
): void {
  if (event.ctrlKey || event.metaKey) {
    const newSelection = new Set(currentSelection)
    if (newSelection.has(value)) {
      newSelection.delete(value)
    } else {
      newSelection.add(value)
    }
    setSelection(newSelection)
    return
  }

  if (event.shiftKey && currentSelection.size === 1) {
    const anchor = Array.from(currentSelection)[0]
    const anchorIndex = allValues.indexOf(anchor)
    const clickIndex = allValues.indexOf(value)
    const start = Math.min(anchorIndex, clickIndex)
    const end = Math.max(anchorIndex, clickIndex)
    const rangeValues = allValues.slice(start, end + 1)
    setSelection(new Set(rangeValues))
    return
  }

  if (event.shiftKey && currentSelection.size > 1) {
    const newSelection = new Set(currentSelection)
    if (!newSelection.has(value)) {
      newSelection.add(value)
    }
    setSelection(newSelection)
    return
  }

  if (currentSelection.size === 1 && currentSelection.has(value)) {
    setSelection(new Set())
  } else {
    setSelection(new Set([value]))
  }
}
