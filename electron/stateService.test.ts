import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StateService } from './stateService'

// Regression coverage for the exact bug class this file is prone to:
// sanitizeMenu (private, routed through by both saveAppState and
// loadAppState) is a hand-maintained allowlist of PersistedMenuState's
// fields -- a field can exist on the type, be written correctly by the
// renderer, and still never actually persist in the real app if
// sanitizeMenu simply never learned about it. isDoubleSizeMode shipped this
// way for a full release: the renderer-side fix (App.tsx's
// persistedMenuStateRef) was real and necessary but insufficient on its
// own, and went undetected because it was only verified against the
// browser-mode mock (installBrowserMockBridges.ts), which clones state
// verbatim and never exercises sanitizeMenu at all. Only a test against the
// real StateService (actual file I/O, actual sanitization) can catch this.
describe('StateService app-state field round-trip', () => {
  let dataRoot: string

  beforeEach(() => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-state-test-'))
  })

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('persists isDoubleSizeMode across a save -> fresh-instance load, simulating an app restart', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', isDoubleSizeMode: true },
    })

    // A fresh instance (no in-memory cache carried over) reading from disk
    // is what a real app restart does -- not reusing the same StateService
    // object, which would trivially pass via its own cachedAppState.
    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.isDoubleSizeMode).toBe(true)
  })

  it('persists isDoubleSizeMode: false explicitly (not just "field present")', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', isDoubleSizeMode: false },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.isDoubleSizeMode).toBe(false)
  })

  it('flushAppStateOnClose (the before-quit safety net) also preserves isDoubleSizeMode', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', isDoubleSizeMode: true },
    })
    await writer.flushAppStateOnClose()

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.isDoubleSizeMode).toBe(true)
  })

  it('round-trips every other boolean menu toggle touched by the same persistMenuStateNow consolidation (App.tsx/CLAUDE.md)', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        isSidebarVisible: false,
        reviewGutterVisibleBySection: { sectionA: true },
        reviewFlagsVisibleBySection: { sectionA: false },
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.isSidebarVisible).toBe(false)
    expect(loaded.menu?.reviewGutterVisibleBySection).toEqual({ sectionA: true })
    expect(loaded.menu?.reviewFlagsVisibleBySection).toEqual({ sectionA: false })
  })

  it('persists the guide overlay and undocked note overlay across a save -> fresh-instance load', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        guideView: { sectionId: 'section-1', previousNoteId: 'note-2' },
        undockedNote: { noteId: 'note-3', sectionId: 'section-1', previousNoteId: 'note-2' },
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.guideView).toEqual({ sectionId: 'section-1', previousNoteId: 'note-2' })
    expect(loaded.menu?.undockedNote).toEqual({ noteId: 'note-3', sectionId: 'section-1', previousNoteId: 'note-2' })
  })

  it('persists the unified global spellcheck toggle across a save -> fresh-instance load', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        spellCheckEnabled: true,
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.spellCheckEnabled).toBe(true)
  })
})
