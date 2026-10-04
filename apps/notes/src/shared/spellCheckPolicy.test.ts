import { describe, expect, it } from 'vitest'
import { resolveSpellCheckSurfaceState } from './spellCheckPolicy'

describe('resolveSpellCheckSurfaceState', () => {
  it('enables spellcheck only on the active editor surface when the global toggle is on', () => {
    expect(resolveSpellCheckSurfaceState({
      globalToggleEnabled: true,
      isEditorSurface: true,
      isActiveEditor: true,
      isInputField: false,
    })).toBe(true)

    expect(resolveSpellCheckSurfaceState({
      globalToggleEnabled: true,
      isEditorSurface: true,
      isActiveEditor: false,
      isInputField: false,
    })).toBe(false)
  })

  it('never enables spellcheck on ordinary input fields or non-editor surfaces', () => {
    expect(resolveSpellCheckSurfaceState({
      globalToggleEnabled: true,
      isEditorSurface: false,
      isActiveEditor: true,
      isInputField: true,
    })).toBe(false)

    expect(resolveSpellCheckSurfaceState({
      globalToggleEnabled: true,
      isEditorSurface: false,
      isActiveEditor: false,
      isInputField: false,
    })).toBe(false)
  })
})
