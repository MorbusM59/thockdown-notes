import { describe, expect, it } from 'vitest'

import { directionFromKey } from './EscapeHoldPanel'

describe('EscapeHoldPanel keyboard rotation', () => {
  it('accepts WASD as directional aliases for the ring', () => {
    expect(directionFromKey({ key: 'w' } as KeyboardEvent<HTMLDivElement>)).toBe(-1)
    expect(directionFromKey({ key: 'a' } as KeyboardEvent<HTMLDivElement>)).toBe(-1)
    expect(directionFromKey({ key: 's' } as KeyboardEvent<HTMLDivElement>)).toBe(1)
    expect(directionFromKey({ key: 'd' } as KeyboardEvent<HTMLDivElement>)).toBe(1)
    expect(directionFromKey({ key: 'W' } as KeyboardEvent<HTMLDivElement>)).toBe(-1)
    expect(directionFromKey({ key: 'D' } as KeyboardEvent<HTMLDivElement>)).toBe(1)
  })

  it('keeps the existing arrow and tab behavior', () => {
    expect(directionFromKey({ key: 'ArrowUp' } as KeyboardEvent<HTMLDivElement>)).toBe(-1)
    expect(directionFromKey({ key: 'ArrowLeft' } as KeyboardEvent<HTMLDivElement>)).toBe(-1)
    expect(directionFromKey({ key: 'ArrowDown' } as KeyboardEvent<HTMLDivElement>)).toBe(1)
    expect(directionFromKey({ key: 'ArrowRight' } as KeyboardEvent<HTMLDivElement>)).toBe(1)
    expect(directionFromKey({ key: 'Tab' } as KeyboardEvent<HTMLDivElement>)).toBe(1)
    expect(directionFromKey({ key: 'Tab', shiftKey: true } as KeyboardEvent<HTMLDivElement>)).toBe(-1)
  })
})
