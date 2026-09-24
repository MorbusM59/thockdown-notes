import type { KeyboardEvent } from 'react'

/**
 * Which way a key turns the escape-hold ring's dial: -1 back, 1 forward,
 * null for a key that does not turn it. Arrow keys and W/A/S/D map the same
 * way (up/left back, down/right forward) so the dial can be driven from
 * either hand's home position; Tab turns forward and Shift+Tab back. Letters
 * are matched case-insensitively, so Caps Lock or Shift does not disable
 * them. Every key named here reaches the one `rotateOneStep` in
 * EscapeHoldPanel.tsx, like a wheel notch does.
 */
export function directionFromKey(event: Pick<KeyboardEvent<HTMLDivElement>, 'key' | 'shiftKey'>): 1 | -1 | null {
  const key = event.key.toLowerCase()
  if (key === 'w' || key === 'a' || key === 'arrowup' || key === 'arrowleft') return -1
  if (key === 's' || key === 'd' || key === 'arrowdown' || key === 'arrowright') return 1
  if (key === 'tab') return event.shiftKey ? -1 : 1
  return null
}
