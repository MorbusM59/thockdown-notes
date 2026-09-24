import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StateService } from './stateService'
import { UI_FONT_SCALE_MAX, UI_FONT_SCALE_MIN } from '../src/shared/UiTypography'
import { THOCKQUEST } from '../src/adventure/content'
import { choose, enterEntryScreen, type DirectorDeps } from '../src/adventure/core/director'
import { emptySave } from '../src/adventure/model/gameState'
import { ROOT_STAGE_ID, STAGES } from '../src/adventure/stages'
import { DEFAULT_AMBIENT_SETTINGS } from '../src/shared/ambientSound'

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

  it('round-trips ambient layer settings and named custom presets through real sanitization', async () => {
    const channels = DEFAULT_AMBIENT_SETTINGS.map((channel, index) => ({
      ...channel,
      enabled: index === 0 || index === 2,
      volume: [0.41, 0.12, 0.88][index] ?? channel.volume,
      modulationAmplitude: [0.73, 0.26, 0.94][index] ?? channel.modulationAmplitude,
      type: (['pink', 'brown', 'white'] as const)[index] ?? channel.type,
    }))
    const ambientSound = {
      enabled: true,
      settings: channels,
      activePresetId: 'night-rain',
      customPresets: [{ id: 'night-rain', name: 'Night rain', settings: channels }],
    }
    await new StateService(dataRoot).saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', ambientSound },
    })

    const loaded = await new StateService(dataRoot).loadAppState()
    expect(loaded.menu?.ambientSound).toEqual(ambientSound)
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

  it('persists double size mode\'s own font sizes across a save -> fresh-instance load', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '',
        editorFontSize: 18, viewFontSize: 17, uiFontScale: UI_FONT_SCALE_MAX,
        doubleSizeEditorFontSize: 11, doubleSizeViewFontSize: 12.5, doubleSizeUiFontScale: UI_FONT_SCALE_MIN,
      },
    })

    const loaded = await new StateService(dataRoot).loadAppState()
    expect(loaded.menu?.editorFontSize).toBe(18)
    expect(loaded.menu?.viewFontSize).toBe(17)
    expect(loaded.menu?.uiFontScale).toBe(UI_FONT_SCALE_MAX)
    expect(loaded.menu?.doubleSizeEditorFontSize).toBe(11)
    expect(loaded.menu?.doubleSizeViewFontSize).toBe(12.5)
    expect(loaded.menu?.doubleSizeUiFontScale).toBe(UI_FONT_SCALE_MIN)
  })

  it('keeps double size mode\'s font sizes absent for a save that never had them, so the app can seed them from the regular ones', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', editorFontSize: 18 },
    })

    const loaded = await new StateService(dataRoot).loadAppState()
    expect(loaded.menu?.editorFontSize).toBe(18)
    expect(loaded.menu?.doubleSizeEditorFontSize).toBeUndefined()
    expect(loaded.menu?.doubleSizeViewFontSize).toBeUndefined()
    expect(loaded.menu?.doubleSizeUiFontScale).toBeUndefined()
  })

  it('guards the font sizes against damaged values: out of range is clamped, anything not a number falls back', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '',
        editorFontSize: 400,
        // An old discrete size key: no longer migrated, so it falls back like any bad value.
        viewFontSize: 'm' as unknown as number,
        doubleSizeEditorFontSize: 'l' as unknown as number,
        doubleSizeViewFontSize: -3,
      },
    })

    const loaded = await new StateService(dataRoot).loadAppState()
    expect(loaded.menu?.editorFontSize).toBe(24)
    expect(loaded.menu?.viewFontSize).toBe(16)
    // A damaged double-size value stays missing, so the app seeds it from the regular one.
    expect(loaded.menu?.doubleSizeEditorFontSize).toBeUndefined()
    expect(loaded.menu?.doubleSizeViewFontSize).toBe(6)
  })

  it('persists the wheel-spin and wheel-step sliders, including the 0 that means "off"', async () => {
    // sanitizeMenu is an allowlist, and a numeric field it never learned
    // about is dropped silently -- so a slider can be wired perfectly on the
    // renderer side and still come back at its default on every restart.
    // Zero is tested explicitly because it is a meaningful VALUE here (the
    // feature switched off), not an absent field, and the two are easy to
    // conflate in a sanitizer.
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        wheelSpinThresholdMs: 0,
        wheelSpinDampenDivisor: 0,
        wheelSpinCutoffMs: 350,
        wheelStepRows: 4,
        wheelStepLines: 2.7,
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.wheelSpinThresholdMs).toBe(0)
    expect(loaded.menu?.wheelSpinDampenDivisor).toBe(0)
    expect(loaded.menu?.wheelSpinCutoffMs).toBe(350)
    // The two step sliders travel the same allowlist, and the render view's
    // is fractional -- a sanitizer that rounded or truncated would look
    // correct on the edit view's and quietly move the other one.
    expect(loaded.menu?.wheelStepRows).toBe(4)
    expect(loaded.menu?.wheelStepLines).toBe(2.7)
  })

  it('persists the note size threshold and its override across a save -> fresh-instance load', async () => {
    // The pair that decides whether a note's scrollbar is measured in pixels
    // or counts characters (editor/documentPosition.ts). Both halves are
    // here for the reason the wheel-slider test above records: sanitizeMenu
    // is a hand-maintained allowlist, and a field missing from it is dropped
    // on every real read and write however correct the renderer side is.
    // `false` is asserted explicitly rather than assumed, because a dropped
    // boolean and a stored `false` are indistinguishable from the renderer.
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        noteSizeThresholdBlocks: 73,
        forceCharacterScrollbarThumb: true,
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.noteSizeThresholdBlocks).toBe(73)
    expect(loaded.menu?.forceCharacterScrollbarThumb).toBe(true)

    const offWriter = new StateService(dataRoot)
    await offWriter.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        noteSizeThresholdBlocks: 10,
        forceCharacterScrollbarThumb: false,
      },
    })
    const offReader = new StateService(dataRoot)
    const offLoaded = await offReader.loadAppState()
    expect(offLoaded.menu?.noteSizeThresholdBlocks).toBe(10)
    expect(offLoaded.menu?.forceCharacterScrollbarThumb).toBe(false)
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

  it('persists the slot overlay across a save -> fresh-instance load, and drops a malformed one', async () => {
    const writer = new StateService(dataRoot)
    const overlay = { kind: 'undocked' as const, sectionId: 'section-1', previousNoteId: 'note-2', noteId: 'note-3' }
    await writer.saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', slotOverlay: overlay },
    })

    const reader = new StateService(dataRoot)
    expect((await reader.loadAppState()).menu?.slotOverlay).toEqual(overlay)

    // An undocked overlay without its note is not an undocked overlay --
    // keeping it would leave the renderer holding a return with nothing to
    // return from.
    const badWriter = new StateService(dataRoot)
    await badWriter.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        slotOverlay: { kind: 'undocked', sectionId: 'section-1', previousNoteId: null } as never,
      },
    })
    const badReader = new StateService(dataRoot)
    expect((await badReader.loadAppState()).menu?.slotOverlay).toBeUndefined()
  })

  it('persists a saved adventure across a save -> fresh-instance load, and drops a corrupt one', async () => {
    // Same allowlist hazard as every test above, with one extra edge: this
    // field is an object, so "present but structurally wrong" is a real
    // possibility a boolean never had. A corrupt save must come back as
    // absent -- the renderer already handles "no saved adventure" and would
    // otherwise be handed half a game to play.
    //
    // The save under test is a game PART WAY THROUGH, not a fresh one: the
    // director's stack is what makes "leave at any moment and come back to
    // the same screen" true, so a round trip that kept the numbers and lost
    // the stack would pass a weaker test while breaking the actual promise.
    const deps: DirectorDeps = {
      stages: STAGES,
      content: THOCKQUEST,
      rootStageId: ROOT_STAGE_ID,
    }
    const nowMs = 1_700_000_000_000
    const started = choose(enterEntryScreen(emptySave(4242), deps, nowMs), 'welcome:start', deps, nowMs).save
    const save = choose(started, 'origin:warrior', deps, nowMs).save
    expect(save.director.stack.length).toBeGreaterThan(0)

    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: { sidebarMode: 'date', selectedMonths: [], selectedYears: [], searchQuery: '', adventure: save },
    })

    const reader = new StateService(dataRoot)
    expect((await reader.loadAppState()).menu?.adventure).toEqual(save)

    const corruptWriter = new StateService(dataRoot)
    await corruptWriter.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        adventure: { ...save, version: 'not-a-version' } as unknown as typeof save,
      },
    })

    const corruptReader = new StateService(dataRoot)
    expect((await corruptReader.loadAppState()).menu?.adventure).toBeNull()

    // The overlay is a separate field from the save and is dropped just as
    // silently if sanitizeMenu never learns about it -- which would restart
    // the app with the game intact but nowhere on screen.
    const viewWriter = new StateService(dataRoot)
    await viewWriter.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        adventure: save,
        slotOverlay: { kind: 'adventure', sectionId: 'default', previousNoteId: 'note-1' },
      },
    })
    const viewReader = new StateService(dataRoot)
    expect((await viewReader.loadAppState()).menu?.slotOverlay)
      .toEqual({ kind: 'adventure', sectionId: 'default', previousNoteId: 'note-1' })
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

  // The music player's sound-options row replaced the sidebar's volume/reverb
  // sliders, and its mute/bypass switches are FLAGS over retained levels
  // rather than zeroed levels -- which only works if the flags themselves
  // survive a restart. A flag missing from sanitizeMenu would be dropped
  // silently and the app would come back audible with the level intact,
  // exactly the failure mode this file exists for.
  it('persists the music sound-option flags across a save -> fresh-instance load', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        musicVolume: 0.42,
        musicReverbAmount: 0.6,
        musicReverbRoom: 0.75,
        musicMuted: true,
        musicReverbBypassed: true,
        musicSoundOptionsOpen: true,
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.musicMuted).toBe(true)
    expect(loaded.menu?.musicReverbBypassed).toBe(true)
    expect(loaded.menu?.musicSoundOptionsOpen).toBe(true)
    // The levels are retained, not destroyed, by the flags being on.
    expect(loaded.menu?.musicVolume).toBe(0.42)
    expect(loaded.menu?.musicReverbAmount).toBe(0.6)
    expect(loaded.menu?.musicReverbRoom).toBe(0.75)
  })

  // The sixth ("Lounge") bucket needs the persisted-slot allowlist to know
  // about it; sanitizeMusicActiveSlots hard-coded 1-5 before it existed.
  it('persists an active slot from the full playlist range', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: null,
      menu: {
        sidebarMode: 'date',
        selectedMonths: [],
        selectedYears: [],
        searchQuery: '',
        musicActiveSlots: [1, 6, 7, 0],
      },
    })

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.menu?.musicActiveSlots).toEqual([1, 6])
  })

  it('clearAppState resets persisted app state back to the default baseline', async () => {
    const writer = new StateService(dataRoot)
    await writer.saveAppState({
      selectedNoteId: 'note-123',
      menu: {
        sidebarMode: 'find',
        selectedMonths: [3],
        selectedYears: [2024],
        searchQuery: 'stale query',
        slotOverlay: { kind: 'guide', sectionId: 'section-1', previousNoteId: 'note-2' },
        debuggingEnabled: true,
      },
    })

    await writer.clearAppState()

    const reader = new StateService(dataRoot)
    const loaded = await reader.loadAppState()
    expect(loaded.selectedNoteId).toBeNull()
    expect(loaded.menu?.sidebarMode).toBe('date')
    expect(loaded.menu?.searchQuery).toBe('')
    expect(loaded.menu?.slotOverlay).toBeUndefined()
    expect(loaded.menu?.debuggingEnabled).toBe(false)
  })
})
