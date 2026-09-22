import type { KeyboardEvent } from 'react'

export function directionFromKey(event: Pick<KeyboardEvent<HTMLDivElement>, 'key' | 'shiftKey'>): 1 | -1 | null {
  const key = event.key.toLowerCase()
  if (key === 'w' || key === 'a' || key === 'arrowup' || key === 'arrowleft') return -1
  if (key === 's' || key === 'd' || key === 'arrowdown' || key === 'arrowright') return 1
  if (key === 'tab') return event.shiftKey ? -1 : 1
  return null
}
