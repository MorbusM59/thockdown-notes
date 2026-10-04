import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { describe, expect, it } from 'vitest'

import { directionFromKey } from './escapeHoldDirection'

describe('EscapeHoldPanel keyboard rotation', () => {
  it('accepts WASD as directional aliases for the ring', () => {
    expect(directionFromKey({ key: 'w' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(-1)
    expect(directionFromKey({ key: 'a' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(-1)
    expect(directionFromKey({ key: 's' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(1)
    expect(directionFromKey({ key: 'd' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(1)
    expect(directionFromKey({ key: 'W' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(-1)
    expect(directionFromKey({ key: 'D' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(1)
  })

  it('keeps the existing arrow and tab behavior', () => {
    expect(directionFromKey({ key: 'ArrowUp' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(-1)
    expect(directionFromKey({ key: 'ArrowLeft' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(-1)
    expect(directionFromKey({ key: 'ArrowDown' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(1)
    expect(directionFromKey({ key: 'ArrowRight' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(1)
    expect(directionFromKey({ key: 'Tab' } as ReactKeyboardEvent<HTMLDivElement>)).toBe(1)
    expect(directionFromKey({ key: 'Tab', shiftKey: true } as ReactKeyboardEvent<HTMLDivElement>)).toBe(-1)
  })
})
