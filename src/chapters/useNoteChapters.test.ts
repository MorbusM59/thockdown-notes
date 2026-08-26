import { describe, expect, it, vi } from 'vitest'
import { applyCreateChapterModeTransition } from './useNoteChapters'

describe('applyCreateChapterModeTransition', () => {
  it('switches from render mode to edit mode when creating a chapter', () => {
    const toggleRenderViewMode = vi.fn()
    const setIsPreviewMode = vi.fn()

    applyCreateChapterModeTransition({
      isPreviewMode: true,
      isForcedPreviewNote: false,
      setIsPreviewMode,
      toggleRenderViewMode,
    })

    expect(toggleRenderViewMode).toHaveBeenCalledTimes(1)
    expect(setIsPreviewMode).not.toHaveBeenCalled()
  })

  it('forces a forced-preview note back into edit mode instead of toggling', () => {
    const toggleRenderViewMode = vi.fn()
    const setIsPreviewMode = vi.fn()

    applyCreateChapterModeTransition({
      isPreviewMode: true,
      isForcedPreviewNote: true,
      setIsPreviewMode,
      toggleRenderViewMode,
    })

    expect(setIsPreviewMode).toHaveBeenCalledWith(false)
    expect(toggleRenderViewMode).not.toHaveBeenCalled()
  })

  it('does nothing while the section is already in edit mode', () => {
    const toggleRenderViewMode = vi.fn()
    const setIsPreviewMode = vi.fn()

    applyCreateChapterModeTransition({
      isPreviewMode: false,
      isForcedPreviewNote: false,
      setIsPreviewMode,
      toggleRenderViewMode,
    })

    expect(toggleRenderViewMode).not.toHaveBeenCalled()
    expect(setIsPreviewMode).not.toHaveBeenCalled()
  })
})
