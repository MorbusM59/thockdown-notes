/**
 * The whole mobile app: the desktop soundscape panel, plus what the desktop
 * keeps elsewhere -- the on/off switch and master volume (on the audio bar's
 * soundscape button there), export and import (the options panel's quick
 * actions there), and a clip of the current soundscape, which the desktop
 * does not have.
 *
 * As on the desktop (App.tsx), the engine follows the preferences state and
 * nothing else. The native session (backgroundAudioHost.ts) is driven by the
 * engine while this page runs; its notification and lock-screen controls
 * drive it while the page is paused, and the page FOLLOWS them through the
 * same preferences state on its return (followSession), so those controls
 * are more controls, not a second path to the engine.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { readNowPlaying, subscribeNowPlaying } from '@thockdown/visualizer/sound/nowPlaying'
import { soundscapeConfiguration, soundscapeEngine } from '@thockdown/soundscape/SoundscapeEngine'
import { volumeGain } from '@thockdown/audio/volumeLaw'
import { resumedOutputContext } from '@thockdown/soundscape/audioOutputBus'
import {
  activeSoundscape,
  fromSoundscapeEditingView,
  moveSoundscapePreset,
  soundscapeEditingView,
  setSoundscapeIcon,
  soundscapePresets,
  type SoundscapePreferences,
  type SoundscapePreset,
  applySoundscapePreset,
} from '@thockdown/soundscape/soundscape'
import { exportSoundscapes, importSoundscapes } from '@thockdown/soundscape/soundscapeFileActions'
import {
  DARK_FACTORY_PRESETS,
  DARK_PRESET_ICONS,
  DARK_PRESET_THEMES,
  LIGHT_FACTORY_PRESETS,
  LIGHT_PRESET_ICONS,
  LIGHT_PRESET_THEMES,
} from '@thockdown/look/presets'
import { OptionsFixedSection } from '@thockdown/interaction/OptionsFixedSection'
import { AccordionGroup, AccordionSection } from '@thockdown/interaction/AccordionSection'
import { applyDocumentTheme, themeFrame } from '@thockdown/look/loadoutTheme'
import { ThemeBlendOverlays, ThemeGlazeLayers } from '@thockdown/look/ThemeLayers'
import { nativeSoundscape, type RegularMode, type SessionState, type SoundSource } from './backgroundAudioHost'
import { nativePlayback } from './playbackMode'
import { reportFirstFrame, styleSystemBars } from './launchHandover'
import {
  CLIP_MINUTES,
  loadClipMinutes,
  loadLook,
  loadPreferences,
  loadSchedule,
  loadTimer,
  saveClipMinutes,
  saveLook,
  saveSchedule,
  saveTimer,
  savePreferences,
  type MobileLook,
} from './preferencesStore'
import { currentEntryId, currentSoundscapeName, followSession, sessionEntries } from './sessionEntries'
import { musicScheduleEvents, sanitizeSchedule, scheduleEvents, type Schedule } from './schedule'
import { ScheduleDock, ScheduleRows } from './ScheduleRows'
import { fadeSecFor, remainingText, type TimerSettings } from './timer'
import { TimerRow } from './TimerRow'
import { VisualizerGlaze } from '@thockdown/visualizer/visualizer/VisualizerGlaze'
import { prepareLookTextures } from '@thockdown/look/textures/textureStore'
import { usePublishLayoutScene } from '@thockdown/visualizer/shared/publishLayoutScene'
import { lookTextureRequests, useLookTextures } from '@thockdown/look/textures/useLookTextures'
import { DashboardDock, DashboardSets, DashboardSoundscapes, DockHelpButton, DockHelpRow } from './Dashboard'
import { PresetDock, PresetGrid, PresetIconPicker } from '@thockdown/interaction/PresetListControls'
import { SOUNDSTAGE_KIND, withActiveSoundstage } from '@thockdown/visualizer/shared/soundstages'
import { helpFor } from './helpText'
import { SoundscapeControls, SubsectionHelp } from '@thockdown/soundscape/SoundscapeOptions'
import { SoundscapeDock } from '@thockdown/soundscape/SoundscapeDock'
import { IconPickerGrid } from '@thockdown/interaction/iconPicker/IconPicker'
import { PageScrollbar } from './PageScrollbar'
import { installTouchScroll } from '@thockdown/interaction/touchScroll'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { installSoundscapeFiles } from './soundscapeFiles'
import { useStepDrag } from './useStepDrag'
import { VisualizerPage } from './VisualizerPage'
import { SidebarFrame } from '@thockdown/interaction/SidebarFrame'
import { MusicLibraryDock, MusicLibraryPanel, MusicSetIconPicker } from '@thockdown/visualizer/library/MusicLibraryPanel'
import { closeIconPick, isPickingIconFor, readIconPick, setIconPickQuery, subscribeIconPick, toggleIconPick } from '@thockdown/interaction/iconPicker/iconPick'
import { DEFAULT_MUSIC_SET_LIST_GROUPING, type MusicSetListGrouping } from '@thockdown/visualizer/shared/musicSetList'
import { DashboardAppSections, MobileTabSelector, VisualizerButtons } from './MobileTabs'
import { SoundstagesDock, SoundstagesTab } from './SoundstagesTab'
import { loadSoundstages, saveSoundstages } from './soundstageStore'
import { activeSoundstage } from '@thockdown/visualizer/shared/soundstages'
import { loadTab, saveTab, type MobileTab } from './mobileTabList'
import { musicStageOf, nativeMusic } from './nativeMusic'
import { setMusicStage, startMobileMusicPlayer } from './mobileMusicPlayer'
import { loadBeatSettings, loadVisualizerFont, loadVisualizerState, PHONE_OUTPUT_DEVICE, saveBeatSettings, saveVisualizerFont, saveVisualizerState } from './visualizerStore'
import { DEFAULT_VISUALIZER_FONT } from '@thockdown/visualizer/shared/visualizerFont'
import { VisualizerFontControls } from '@thockdown/visualizer/visualizer/VisualizerFontControls'
import { monoFontFamily } from '@thockdown/visualizer/visualizer/visualizerFonts'
import { editVisualizerState, NEUTRAL_VISUALIZER_PRESET, shownVisualizer, VISUALIZER_PRESET_KIND, type VisualizerPresetPreferences } from '@thockdown/visualizer/shared/visualizerPresets'
import type { VisualizerSettings } from '@thockdown/look/visualizer'
import { VisualizerSceneControls } from '@thockdown/visualizer/visualizer/VisualizerSceneControls'
import { BeatDelayControl, BeatSignalControls } from '@thockdown/visualizer/beat/BeatDetectionControls'
import { BeatLoopCalibration } from '@thockdown/visualizer/beat/BeatLoopCalibration'
import { LOOP_03 } from '@thockdown/visualizer/beat/beatLoops'
import { createNativeBeatLoopPlayer } from './nativeBeatLoop'
import { useSelectorReorder } from '@thockdown/interaction/useSelectorReorder'

installSoundscapeFiles()

// The beat delay calibration plays its loop natively, where the music plays (nativeBeatLoop.ts); there is none in a browser.
const beatLoopPlayer = nativeMusic ? createNativeBeatLoopPlayer(nativeMusic) : null
/**
 * The phone ships ONE loop, AAC at 128 kbps (ffmpeg -i 03.wav -c:a aac -b:a
 * 128k -movflags +faststart 03.m4a; it decodes to the WAV's exact length and
 * alignment): the desktop steps through seven with a right press, which a
 * finger has no counterpart for, and seven would be most of the app's size.
 * Loop 03 is the plainest to judge by: sparse, straight hits on a slow bar,
 * so no hit can be mistaken for its neighbour.
 */
const BEAT_LOOPS = [{ ...LOOP_03, url: new URL('./assets/loops/03.m4a', import.meta.url).href }]

const PRESETS = { light: LIGHT_FACTORY_PRESETS, dark: DARK_FACTORY_PRESETS }
const PRESET_ICONS = { light: LIGHT_PRESET_ICONS, dark: DARK_PRESET_ICONS }
const PRESET_NAMES = { light: LIGHT_PRESET_THEMES, dark: DARK_PRESET_THEMES }


/** A clip length as the button shows it: 5m, 1h. */
/**
 * The help section a tab shows in help mode in place of its controls, by its
 * heading in helpText.ts. Soundscapes and Schedules explain each subsection
 * in place instead (`help`), so they have none here.
 */
const TAB_HELP: Partial<Record<MobileTab, string>> = { dashboard: 'Dashboard', songs: 'Songs', visualizer: 'Visualizer', soundstages: 'Soundstages' }

function TabHelp({ heading }: { heading: string }) {
  return (
    <OptionsFixedSection heading={heading} iconClass="fa-circle-question">
      <SubsectionHelp paragraphs={helpFor(heading)!} />
    </OptionsFixedSection>
  )
}

const SOUNDSCAPE_CHANNEL_KEY = 'thockdown:soundscape-channel'

/** Whether the soundscape's channel is switched into the mix: on unless switched out before. */
function loadSoundscapeChannel(): boolean {
  try {
    return localStorage.getItem(SOUNDSCAPE_CHANNEL_KEY) !== 'off'
  } catch {
    return true
  }
}

function saveSoundscapeChannel(on: boolean): void {
  try {
    localStorage.setItem(SOUNDSCAPE_CHANNEL_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the switch holds until the app is closed.
  }
}

function clipLengthLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`
}

/** The name a clip of the current soundscape is saved under. */
function clipName(preferences: SoundscapePreferences, minutes: number): string {
  return `${activeSoundscape(preferences).name} - ${minutes} min`.replace(/[^\w .-]+/g, '')
}

export function MobileSoundscapeApp() {
  // Regular mode starts STOPPED: closing the app stops it (the session's
  // rule), so a stored `enabled` describes a session that no longer exists.
  // A session that outlived this page says otherwise when asked (getState).
  const [preferences, setPreferences] = useState<SoundscapePreferences>(() => ({ ...loadPreferences(), enabled: false }))
  // The soundscape the Soundscapes tab edits, which need not be the one that
  // plays (the dashboard picks that): null edits the one that plays.
  const [editedSoundscapeId, setEditedSoundscapeId] = useState<string | null>(null)
  const editingView = soundscapeEditingView(preferences, editedSoundscapeId)
  const applyEditingView = (next: SoundscapePreferences) => {
    const applied = fromSoundscapeEditingView(preferences, editedSoundscapeId, next)
    setPreferences(applied.preferences)
    setEditedSoundscapeId(applied.editedId)
  }
  const [regular, setRegular] = useState<RegularMode>('stopped')
  const [source, setSource] = useState<SoundSource>('none')
  // The look is one of the desktop's factory visual presets, drawn through
  // the same shared theme code the desktop uses (shared/loadoutTheme.ts).
  const [look, setLook] = useState<MobileLook>(loadLook)
  const loadout = PRESETS[look.mode][look.preset[look.mode]]
  const theme = useMemo(() => themeFrame(loadout, { isPreviewMode: false }), [loadout])
  // The layout's textures, generated from its materials as on the desktop
  // (@thockdown/look/textures), on the shell beside the theme's variables.
  const textureVariables = useLookTextures(loadout.textureMaterials, true)
  // The layout's box bevel and invert, which the grids and the visualizer
  // read beyond its CSS variables, as the desktop publishes them.
  usePublishLayoutScene(loadout.boxBevel, loadout.filterInvert)
  const shellStyle = useMemo<CSSProperties & Record<string, string>>(() => ({ ...theme.shellVariables, ...textureVariables }), [theme.shellVariables, textureVariables])
  // A layout switch is one change, as on the desktop (App.tsx's
  // applyEntryToLiveState): the new layout's textures are brought into the
  // store first, so its colours and textures arrive in the same frame. Only
  // the latest press is applied.
  const lookSwitchTicketRef = useRef(0)
  const switchLook = useCallback((next: MobileLook) => {
    const ticket = ++lookSwitchTicketRef.current
    void prepareLookTextures(lookTextureRequests(PRESETS[next.mode][next.preset[next.mode]].textureMaterials), true).then(() => {
      if (ticket === lookSwitchTicketRef.current) setLook(next)
    })
  }, [])

  // Every soundscape, factory (as the listener left it) and their own.
  const { customPresets, factoryEdits } = preferences
  const presets = useMemo(() => soundscapePresets({ customPresets, factoryEdits }), [customPresets, factoryEdits])
  // Whether the native session plays (playbackMode.ts); the engine is not
  // started before that is settled, or its first start would open the web
  // playback instead.
  const [native, setNative] = useState<boolean | null>(null)
  // Whether this page shows the state it will keep: the playback mode is
  // settled and, where a native session exists, the page has followed it
  // once. Until then the controls would show stopped and local preferences,
  // and a session that outlived the page (a recreated activity) would repaint
  // them moments later, so the launch overlay is held until this is true.
  const [hydrated, setHydrated] = useState(false)
  const [clipProgress, setClipProgress] = useState<number | null>(null)
  const [clipMinutes, setClipMinutes] = useState(loadClipMinutes)
  const pageScrollerRef = useRef<HTMLDivElement | null>(null)
  // A finger scrolls the page wherever it is not given to a control (touchScroll.ts).
  useEffect(() => (pageScrollerRef.current ? installTouchScroll(pageScrollerRef.current) : undefined), [])
  // Dragging a soundscape to reorder it, as on the desktop: a finger held
  // still picks it up, and travelling on drags it -- onto another soundscape
  // to move it there, or onto the schedule's rows (ScheduleRows.tsx).
  const presetReorder = useSelectorReorder(
    'soundscape',
    (dragged, target) => setPreferences((current) => moveSoundscapePreset(current, dragged, target)),
    { picture: 'copy' },
  )
  // The ICON PICKER (iconPick.ts, the desktop's store): opened from a dock's
  // mark (the edited soundscape's, the open song set's, the active
  // soundstage's), it replaces the tab's page while it is open. Not
  // persisted; a pick, the mark again, another tab, or another soundscape
  // chosen for editing closes it.
  const iconPick = useSyncExternalStore(subscribeIconPick, readIconPick)
  // HELP MODE: every subsection shows an explanation in place of its
  // controls (helpText.ts). The system's back gesture ends it (takeBack,
  // below).
  const [helpMode, setHelpMode] = useState(false)
  // The visualizer page (VisualizerPage.tsx), opened from the Visualizer tab.
  const [visualizerOpen, setVisualizerOpen] = useState(false)
  const closeVisualizer = useCallback(() => setVisualizerOpen(false), [])
  // The tab shown (MobileTabs.tsx), remembered across launches.
  const [tab, setTab] = useState<MobileTab>(loadTab)
  const selectTab = useCallback((next: MobileTab) => {
    setTab(next)
    saveTab(next)
    pageScrollerRef.current?.scrollTo({ top: 0 })
  }, [])
  const [songsGrouping, setSongsGrouping] = useState<MusicSetListGrouping>(DEFAULT_MUSIC_SET_LIST_GROUPING)
  // The soundstages (SoundstagesTab.tsx): stored, and the active one sent to the native music whenever it changes.
  const [soundstages, setSoundstages] = useState(loadSoundstages)
  const activeStage = useMemo(() => activeSoundstage(soundstages).settings, [soundstages])
  useEffect(() => {
    saveSoundstages(soundstages)
  }, [soundstages])
  useEffect(() => {
    setMusicStage(JSON.stringify(musicStageOf(activeStage)))
  }, [activeStage])
  // The music library and player the shared music views read (mobileMusicPlayer.ts).
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  // The visualizer's settings and presets, and beat detection's delay
  // (visualizerStore.ts): the settings in force are the active preset's
  // over the rest, as on the desktop (VisualizerState).
  const [visualizerState, setVisualizerState] = useState(loadVisualizerState)
  useEffect(() => saveVisualizerState(visualizerState), [visualizerState])
  const visualizer = useMemo(() => shownVisualizer(visualizerState), [visualizerState])
  const setVisualizer = useCallback((updater: (previous: VisualizerSettings) => VisualizerSettings) => {
    setVisualizerState((state) => editVisualizerState(state, updater))
  }, [])
  const setVisualizerPresets = useCallback((presets: VisualizerPresetPreferences) => {
    setVisualizerState((state) => ({ ...state, presets }))
  }, [])
  const [beatSettings, setBeatSettings] = useState(loadBeatSettings)
  // The visualizer's text size, outside its presets as the desktop's font is (visualizerStore.ts).
  const [visualizerFont, setVisualizerFont] = useState(loadVisualizerFont)
  useEffect(() => saveVisualizerFont(visualizerFont), [visualizerFont])
  useEffect(() => saveBeatSettings(beatSettings), [beatSettings])
  useEffect(() => {
    if (!nativeMusic) return
    let stop: (() => void) | null = null
    let cancelled = false
    void startMobileMusicPlayer(nativeMusic).then((stopPlayer) => {
      if (cancelled) stopPlayer()
      else {
        stop = stopPlayer
        setLibraryLoaded(true)
      }
    })
    return () => { cancelled = true; stop?.() }
  }, [])
  // The system's back gesture steps back through what is up, and leaves the
  // app only from the dashboard: help closes first, then an icon picker,
  // then any other tab returns to the dashboard. The visualizer, over it
  // all, takes the gesture itself. One effect decides it, so the gesture is
  // taken or released once per change of what it would do.
  const pickingIcon = iconPick !== null
  const backStep: (() => void) | null = visualizerOpen
    ? null
    : helpMode ? () => setHelpMode(false)
    : pickingIcon ? closeIconPick
    : tab !== 'dashboard' ? () => selectTab('dashboard')
    : null
  const backStepRef = useRef(backStep)
  useEffect(() => { backStepRef.current = backStep })
  const backTaken = backStep !== null
  useEffect(() => {
    if (!native || !backTaken) return undefined
    void nativeSoundscape!.takeBack({ taken: true })
    const handle = nativeSoundscape!.addListener('back', () => backStepRef.current?.())
    return () => {
      void nativeSoundscape!.takeBack({ taken: false })
      void handle.then((h) => h.remove())
    }
  }, [native, backTaken])
  const help = helpMode ? helpFor : undefined
  const toggleHelp = () => setHelpMode((current) => !current)

  useEffect(() => {
    void nativePlayback.then((supported) => {
      setNative(supported)
      if (!supported) setHydrated(true)
    })
  }, [])

  // The soundscape's CHANNEL in the mix (the dashboard's podcast button):
  // switched out, it plays on silent, by the engine's channel switch and,
  // for what the session plays without this page (the schedule), the volume
  // the session is given.
  const [soundscapeChannel, setSoundscapeChannel] = useState(loadSoundscapeChannel)
  useEffect(() => {
    saveSoundscapeChannel(soundscapeChannel)
    soundscapeEngine.setChannel(soundscapeChannel)
  }, [soundscapeChannel])
  const sessionVolume = soundscapeChannel ? volumeGain(preferences.masterVolume) : 0

  useEffect(() => {
    savePreferences(preferences)
    if (native !== null) soundscapeEngine.apply(preferences)
  }, [preferences, native])

  // The daily schedule (schedule.ts). Its events are worked out here and
  // handed to the native session, which runs them with or without this page.
  const [schedule, setSchedule] = useState<Schedule>(() => loadSchedule(soundscapePresets(preferences)))
  // The schedule entry docked for editing (its name and delete), if any.
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  useEffect(() => saveSchedule(schedule), [schedule])
  // A deleted soundscape leaves the schedule rows that held it empty.
  useEffect(() => setSchedule((current) => sanitizeSchedule(current, presets)), [presets])
  // A deleted song set leaves the schedule rows that held it without one,
  // once the library has been read (before, no set is known yet).
  const { musicSets } = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  useEffect(() => {
    if (!libraryLoaded) return
    const known = new Set(musicSets.map((set) => set.slot))
    setSchedule((current) => (current.entries.every((entry) => entry.setId === null || known.has(entry.setId))
      ? current
      : { ...current, entries: current.entries.map((entry) => (entry.setId === null || known.has(entry.setId) ? entry : { ...entry, setId: null })) }))
  }, [libraryLoaded, musicSets])
  const events = useMemo(() => scheduleEvents(schedule), [schedule])
  const musicEvents = useMemo(() => musicScheduleEvents(schedule), [schedule])
  useEffect(() => {
    if (!native) return
    const named = new Set(events.map((event) => event.presetId))
    void nativeSoundscape!.setSchedule({
      enabled: schedule.enabled,
      masterVolume: sessionVolume,
      events,
      musicEvents,
      entries: presets
        .filter((preset) => named.has(preset.id))
        .map((preset) => ({ id: preset.id, name: preset.name, configuration: JSON.stringify(soundscapeConfiguration(preset.settings)) })),
    })
  }, [native, schedule.enabled, events, musicEvents, presets, sessionVolume])

  // The timer (timer.ts): its active duration and fade go to the session,
  // which counts down; what it reports back is shown under the dock's name.
  const [timer, setTimer] = useState<TimerSettings>(loadTimer)
  useEffect(() => saveTimer(timer), [timer])
  const timerSeconds = timer.active === null ? 0 : timer.durations[timer.active]
  useEffect(() => {
    if (!native) return
    void nativeSoundscape!.setTimer({ seconds: timerSeconds, fadeSec: fadeSecFor(timerSeconds) })
  }, [native, timerSeconds])
  const [countdown, setCountdown] = useState<{ endsAtMs: number; remainingMs: number }>({ endsAtMs: -1, remainingMs: -1 })
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    if (countdown.endsAtMs < 0) return undefined
    const tick = window.setInterval(() => setClock(Date.now()), 1000)
    setClock(Date.now())
    return () => window.clearInterval(tick)
  }, [countdown.endsAtMs])
  const timeLeftMs = countdown.endsAtMs >= 0 ? countdown.endsAtMs - clock : countdown.remainingMs
  const timeLeft = timeLeftMs >= 0 ? `(${remainingText(timeLeftMs)})` : null

  const editedId = activeSoundscape(editingView).id
  const pickingSoundscapeIcon = isPickingIconFor(iconPick, { kind: 'soundscape', id: editedId })
  useEffect(() => closeIconPick(), [editedId, tab])

  // What the media controls step through, published whenever it changes.
  const entries = useMemo(() => sessionEntries(presets), [presets])
  const currentId = currentEntryId(preferences)
  const currentName = currentSoundscapeName(preferences)
  useEffect(() => {
    if (!native) return
    void nativeSoundscape!.publish({ entries, currentId, currentName, masterVolume: sessionVolume })
  }, [native, entries, currentId, currentName, sessionVolume])

  // Follow the session: when a media control, the schedule or the system
  // changes it, on a stop's outcome, at startup, and on coming back to the
  // foreground, since a report made while this page was paused may not have
  // reached it.
  const followRef = useRef<((state: SessionState) => void) | null>(null)
  useEffect(() => {
    if (!native) return undefined
    const follow = (state: SessionState) => {
      setRegular(state.regular)
      setSource(state.source)
      setCountdown({ endsAtMs: state.endsAtMs, remainingMs: state.remainingMs })
      setPreferences((current) => followSession(current, state))
      setSchedule((current) => (current.enabled === state.scheduleEnabled ? current : { ...current, enabled: state.scheduleEnabled }))
    }
    followRef.current = follow
    void nativeSoundscape!.getState().then(follow).finally(() => setHydrated(true))
    const handles = [
      nativeSoundscape!.addListener('sessionChanged', follow),
      nativeSoundscape!.addListener('countdown', setCountdown),
      nativeSoundscape!.addListener('clipProgress', ({ fraction }) => setClipProgress(fraction)),
      nativeSoundscape!.addListener('clipFinished', () => setClipProgress(null)),
    ]
    const catchUp = () => {
      if (document.visibilityState === 'visible') void nativeSoundscape!.getState().then(follow)
    }
    document.addEventListener('visibilitychange', catchUp)
    return () => {
      document.removeEventListener('visibilitychange', catchUp)
      for (const handle of handles) void handle.then((h) => h.remove())
    }
  }, [native])

  const toggleClip = () => {
    if (!native) return
    if (clipProgress !== null) {
      void nativeSoundscape!.cancelClip()
      return
    }
    setClipProgress(0)
    void nativeSoundscape!.renderClip({
      configuration: JSON.stringify(soundscapeConfiguration(preferences.settings)),
      seconds: clipMinutes * 60,
      name: clipName(preferences, clipMinutes),
    })
  }
  // A drag up or down on the clip button steps through the lengths,
  // stopping at either end; not while a clip is being made.
  const clipDrag = useStepDrag({
    begin: () => CLIP_MINUTES.indexOf(clipMinutes as typeof CLIP_MINUTES[number]),
    step: (base, steps) => {
      if (clipProgress !== null) return
      const minutes = CLIP_MINUTES[Math.max(0, Math.min(CLIP_MINUTES.length - 1, base + steps))]
      if (minutes === clipMinutes) return
      setClipMinutes(minutes)
      saveClipMinutes(minutes)
    },
    tap: toggleClip,
  })

  // A browser (not the native shell, which allows playback without a
  // gesture) keeps the audio context suspended until the first touch.
  useEffect(() => {
    const unlock = () => { void resumedOutputContext() }
    window.addEventListener('pointerdown', unlock, { once: true, capture: true })
    return () => window.removeEventListener('pointerdown', unlock, { capture: true })
  }, [])

  // A layout effect, so the theme is in place before the frame it belongs to
  // is painted: the first frame on screen is already the themed one, which is
  // what the launch overlay waits for (launchHandover.ts), together with `hydrated`.
  useLayoutEffect(() => {
    applyDocumentTheme(document.documentElement, loadout)
    styleSystemBars(look.mode)
    saveLook(look)
  }, [loadout, look])

  useEffect(() => { if (hydrated) void reportFirstFrame() }, [hydrated])

  // REGULAR MODE (see SoundscapeSession.java for how it and the schedule
  // decide what is heard). Set here for what this page does; the session's
  // own changes arrive through `follow`. PLAYING runs the engine; PAUSED and
  // STOPPED close it, and the session tells a pause from a stop.
  const setRegularMode = useCallback((mode: RegularMode) => {
    setRegular(mode)
    if (mode !== 'stopped') setSource('regular')
    setPreferences((current) => (current.enabled === (mode === 'playing') ? current : { ...current, enabled: mode === 'playing' }))
  }, [])

  // A soundscape picked on the dashboard: while a soundscape is heard it is
  // played in regular mode, overruling the schedule (which a long press on
  // the power button hands back to) and crossfading into it; while none is,
  // it is only made the one the play button starts.
  const pickSoundscape = (preset: SoundscapePreset) => {
    if (!preferences.enabled) {
      setPreferences(applySoundscapePreset(preferences, preset, false))
      return
    }
    setPreferences(applySoundscapePreset(preferences, preset))
    setRegular('playing')
    setSource('regular')
  }

  // The files button: a tap imports, a long press exports (with the same
  // swallowed click after it as the power button).
  const filesHoldRef = useRef<(() => void) | null>(null)
  const swallowFilesClickRef = useRef(false)
  useEffect(() => () => filesHoldRef.current?.(), [])
  const stopRegular = () => {
    if (regular === 'stopped') return
    setRegularMode('stopped')
    // What takes over is the session's to work out (the schedule's run, or
    // nothing); it answers with the outcome.
    if (native) void nativeSoundscape!.stop().then((state) => followRef.current?.(state))
  }
  const toggleSchedule = async () => {
    if (schedule.enabled) {
      setSchedule((current) => ({ ...current, enabled: false }))
      return
    }
    // The schedule needs exact alarms; without them it cannot act on time.
    if (native && !(await nativeSoundscape!.ensureExactAlarms()).granted) return
    setSchedule((current) => ({ ...current, enabled: true }))
  }

  const dockContent = tab === 'dashboard' ? (
                    <DashboardDock
                      timeLeft={timeLeftMs >= 0 ? remainingText(timeLeftMs) : null}
                      soundscape={regular}
                      onSoundscapeTransport={setRegularMode}
                      onStop={stopRegular}
                      soundscapeChannel={soundscapeChannel}
                      onSoundscapeChannel={setSoundscapeChannel}
                      soundscapeVolume={preferences.masterVolume}
                      onSoundscapeVolume={(volume) => setPreferences((current) => ({ ...current, masterVolume: volume }))}
                      schedule={schedule.enabled}
                      scheduleHeard={source === 'schedule'}
                      onScheduleToggle={() => { void toggleSchedule() }}
                      help={helpMode}
                      onHelpToggle={toggleHelp}
                    />
                  )
                  : tab === 'songs' ? (
                    <MusicLibraryDock
                      grouping={songsGrouping}
                      onGroupingChange={setSongsGrouping}
                      trailing={<DockHelpButton active={helpMode} onToggle={toggleHelp} />}
                    />
                  )
                  : tab === 'soundscapes' ? (
                    <SoundscapeDock
                      preferences={editingView}
                      onChange={applyEditingView}
                      picking={pickingSoundscapeIcon}
                      onTogglePicker={() => toggleIconPick({ kind: 'soundscape', id: editedId })}
                      // The time left is the playing soundscape's.
                      detail={editingView === preferences ? timeLeft : null}
                      trailing={<DockHelpButton active={helpMode} onToggle={toggleHelp} />}
                    />
                  )
                  : tab === 'schedules' && editingEntryId !== null ? <ScheduleDock schedule={schedule} editingId={editingEntryId} onChange={setSchedule} onEdit={setEditingEntryId} trailing={<DockHelpButton active={helpMode} onToggle={toggleHelp} />} />
                  : tab === 'soundstages' ? <SoundstagesDock preferences={soundstages} onChange={setSoundstages} trailing={<DockHelpButton active={helpMode} onToggle={toggleHelp} />} />
                  : tab === 'visualizer' ? <PresetDock kind={VISUALIZER_PRESET_KIND} list={visualizerState.presets} onChange={setVisualizerPresets} pickKind="visualizer" resetTo={NEUTRAL_VISUALIZER_PRESET} trailing={<DockHelpButton active={helpMode} onToggle={toggleHelp} />} />
                  : null

  // The desktop's frame, outermost first (see shared/loadoutTheme.ts), so the
  // shared stylesheet and theme variables land where they expect to.
  return (
    <div className="app-root" style={theme.rootVariables}>
      <div className="app-saturate-wrapper" style={{ ...theme.wrapperStyle, position: 'fixed', inset: 0 }}>
        {/* The linear and radial glaze are drawn by VisualizerGlaze from the
            LAYOUT's glaze at the visualizer's glaze settings, on every tab
            as in the visualizer; only the visualizer scene feeds it the
            music's breath and pushes. Gloom and sheen stay as they are. */}
        <ThemeGlazeLayers glaze={{ ...theme.glaze, linear: 'none', radial: 'none' }} />
        <VisualizerGlaze glaze={loadout.glaze} immersive={visualizer.immersive} />
        <div className="app-sheen">
          <div className={`app-shell mobile-app-shell${theme.shadowFlip ? ' shadow-flip' : ''}`} style={shellStyle}>
            {visualizerOpen ? <VisualizerPage onExit={closeVisualizer} colors={loadout.visualizerColors} mode={look.mode} visualizer={visualizer} beatSettings={beatSettings} font={visualizerFont} /> : null}
            <div className="mobile-page">
            <div className="mobile-soundscape-shell notes-sidebar">
              <MobileTabSelector tab={tab} onChange={selectTab} />
              <SidebarFrame
                panelMode
                contentRef={pageScrollerRef}
                // Each dock in the desktop's dock wrapper (sidebarFrame.css's
                // .sidebar-plain-dock), which sets it off the panel and the edge.
                // Every dock ends with the help button at its bottom right,
                // in the dock's own last row, and a tab with no dock gets a
                // row holding it alone.
                dock={<div className="sidebar-plain-dock">
                  {dockContent ?? <DockHelpRow active={helpMode} onToggle={toggleHelp} />}
                </div>}
                scrollbar={<PageScrollbar scrollerRef={pageScrollerRef} />}
              >
              <div className="options-content sidebar-options-content mobile-tab-content">
                {helpMode && TAB_HELP[tab] ? <TabHelp heading={TAB_HELP[tab]!} /> : null}
                {tab === 'dashboard' && !helpMode ? (<>
                  <DashboardSets />
                  <DashboardSoundscapes preferences={preferences} onPick={pickSoundscape} />
                  <OptionsFixedSection heading="Timer" iconClass="fa-hourglass-half">
                    <TimerRow timer={timer} onChange={setTimer} />
                  </OptionsFixedSection>
                  <OptionsFixedSection heading="Soundstage" iconClass="fa-sliders">
                    <PresetGrid kind={SOUNDSTAGE_KIND} list={soundstages} onChange={(list) => setSoundstages(withActiveSoundstage(soundstages, list))} idPrefix="stage" label="Soundstages" plural="a soundstage" creates={false} />
                  </OptionsFixedSection>
                  <OptionsFixedSection heading="Layout" iconClass="fa-paint-roller">
                    {/* Dark mode, then the mode's presets: a tap picks one. */}
                    <div className="options-loadout-grid" role="group" aria-label="Layout">
                      <button
                        type="button"
                        className={`btn-icon options-color-swatch options-loadout-btn${look.mode === 'dark' ? ' is-active' : ''}`}
                        aria-label="Dark mode"
                        aria-pressed={look.mode === 'dark'}
                        onClick={() => switchLook({ ...look, mode: look.mode === 'dark' ? 'light' : 'dark' })}
                      >
                        <span className="fa-solid fa-moon" aria-hidden="true" />
                      </button>
                      {PRESET_ICONS[look.mode].map((icon, index) => (
                        <button
                          key={index}
                          type="button"
                          className={`btn-icon options-color-swatch options-loadout-btn${look.preset[look.mode] === index ? ' is-active' : ''}`}
                          aria-label={PRESET_NAMES[look.mode][index]}
                          aria-pressed={look.preset[look.mode] === index}
                          onClick={() => switchLook({ ...look, preset: { ...look.preset, [look.mode]: index } })}
                        >
                          <span className={icon} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </OptionsFixedSection>
                  <VisualizerButtons onOpen={() => setVisualizerOpen(true)} />
                  <OptionsFixedSection heading="Tools" iconClass="fa-toolbox">
                    <div className="options-loadout-grid" role="group" aria-label="Soundscape tools">
                      <button
                        type="button"
                        className="btn-icon options-color-swatch options-loadout-btn"
                        aria-label="Import soundscapes; hold to export yours"
                        aria-disabled={!native}
                        data-secondary-press="none"
                        onClick={() => {
                          if (swallowFilesClickRef.current) {
                            swallowFilesClickRef.current = false
                            return
                          }
                          if (!native) return
                          void importSoundscapes(preferences).then((next) => { if (next) setPreferences(next) })
                        }}
                        onPointerDown={() => {
                          swallowFilesClickRef.current = false
                          filesHoldRef.current?.()
                          filesHoldRef.current = armHold(() => {
                            filesHoldRef.current = null
                            swallowFilesClickRef.current = true
                            if (native && preferences.customPresets.length > 0) void exportSoundscapes(preferences.customPresets, 'my-soundscapes')
                          }, HOLD_CONFIRM_MS)
                        }}
                        onPointerUp={() => { filesHoldRef.current?.(); filesHoldRef.current = null }}
                        onPointerCancel={() => { filesHoldRef.current?.(); filesHoldRef.current = null }}
                        onPointerLeave={() => { filesHoldRef.current?.(); filesHoldRef.current = null }}
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        <span className="fa-solid fa-rotate" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`btn-icon options-color-swatch options-loadout-btn${clipProgress !== null ? ' is-active' : ''}`}
                        aria-label={clipProgress !== null
                          ? `Rendering a ${clipMinutes} minute clip, ${Math.round(clipProgress * 100)}%: press to cancel`
                          : `Save a ${clipMinutes} minute clip of this soundscape; drag up or down to change its length`}
                        aria-disabled={!native}
                        data-secondary-press="none"
                        {...clipDrag.handlers}
                      >
                        {clipProgress !== null
                          ? <span className="mobile-clip-progress" aria-hidden="true">{Math.round(clipProgress * 100)}%</span>
                          : clipDrag.adjusting
                            ? <span className="mobile-clip-progress" aria-hidden="true">{clipLengthLabel(clipMinutes)}</span>
                            : <span className="fa-solid fa-circle-down" aria-hidden="true" />}
                      </button>
                    </div>
                  </OptionsFixedSection>
                  <DashboardAppSections />
                </>) : null}
                {/* Picking an icon (a dock's mark) replaces the page with
                    the picker and its filter, as on the desktop. */}
                {tab === 'songs' && !helpMode ? (iconPick?.target.kind === 'musicSet' ? (<>
                  <IconFilter query={iconPick.query} />
                  <MusicSetIconPicker query={iconPick.query} />
                </>) : <MusicLibraryPanel grouping={songsGrouping} filter="" editsOnTap selectorHeading={{ heading: 'Song Sets', iconClass: 'fa-compact-disc' }} />) : null}
                {tab === 'soundscapes' ? (pickingSoundscapeIcon ? (<>
                  <IconFilter query={iconPick!.query} />
                  <IconPickerGrid
                    label={activeSoundscape(editingView).name}
                    current={activeSoundscape(editingView).icon}
                    query={iconPick!.query}
                    onPick={(icon) => {
                      closeIconPick()
                      setPreferences((current) => setSoundscapeIcon(current, activeSoundscape(editingView).id, icon))
                    }}
                  />
                </>) : <SoundscapeControls
                  preferences={editingView}
                  onChange={applyEditingView}
                  presetReorder={presetReorder}
                  help={help}
                />) : null}
                {tab === 'schedules' ? (<>
                <OptionsFixedSection heading="Schedule" iconClass="fa-clock">
                  {helpMode ? <SubsectionHelp paragraphs={helpFor('Schedule')!} /> : <ScheduleRows
                    schedule={schedule}
                    presets={presets}
                    musicSets={musicSets}
                    onChange={setSchedule}
                    editingId={editingEntryId}
                    onEdit={setEditingEntryId}
                  />}
                </OptionsFixedSection>
                </>) : null}
                {tab === 'visualizer' && !helpMode ? <>
                <OptionsFixedSection heading="Presets" iconClass="fa-star">
                  <PresetGrid kind={VISUALIZER_PRESET_KIND} list={visualizerState.presets} onChange={setVisualizerPresets} idPrefix="visualizer-preset" label="Visualizer presets" plural="a visualizer preset" />
                  <PresetIconPicker kind={VISUALIZER_PRESET_KIND} list={visualizerState.presets} onChange={setVisualizerPresets} pickKind="visualizer" query="" />
                </OptionsFixedSection>
                <AccordionGroup>
                  <AccordionSection ariaLabel="Font" heading="Font" iconClass="fa-font">
                    <VisualizerFontControls font={visualizerFont} onChange={setVisualizerFont} defaultSizePx={DEFAULT_VISUALIZER_FONT.sizePx} />
                  </AccordionSection>
                  <AccordionSection ariaLabel="Delay" heading="Delay" iconClass="fa-stopwatch">
                    {beatLoopPlayer ? <BeatLoopCalibration
                      loops={BEAT_LOOPS}
                      startLoop={beatLoopPlayer}
                      fontFamily={monoFontFamily(visualizerFont.style)}
                      fontPerBox={1 / visualizerFont.boxSize}
                      falls={{ edge: visualizer.edge, pane: visualizer.pane[look.mode] }}
                      delayMs={beatSettings.delayMsByDevice[PHONE_OUTPUT_DEVICE] ?? 0}
                      onChange={(delayMs) => setBeatSettings((prev) => ({ ...prev, delayMsByDevice: { ...prev.delayMsByDevice, [PHONE_OUTPUT_DEVICE]: delayMs } }))}
                    /> : null}
                    <BeatDelayControl beatSettings={beatSettings} outputDevice={PHONE_OUTPUT_DEVICE} onBeatSettings={setBeatSettings} />
                  </AccordionSection>
                  <AccordionSection ariaLabel="Signal" heading="Signal" iconClass="fa-wave-square">
                    <BeatSignalControls visualizer={visualizer} setVisualizer={setVisualizer} />
                  </AccordionSection>
                  <VisualizerSceneControls visualizer={visualizer} setVisualizer={setVisualizer} uiMode={look.mode} folds />
                </AccordionGroup>
                </> : null}
                {tab === 'soundstages' && !helpMode ? <SoundstagesTab preferences={soundstages} onChange={setSoundstages} /> : null}
              </div>
              </SidebarFrame>
            </div>
            </div>
          </div>
        </div>
        <ThemeBlendOverlays theme={theme} />
      </div>
    </div>
  )
}

/** The icon picker's filter, over the picker in the tab's page (iconPick.ts's query). */
function IconFilter({ query }: { query: string }) {
  return (
    <input
      className="options-curve-cell options-curve-field mobile-icon-filter"
      aria-label="Filter the icons"
      placeholder="Filter icons..."
      value={query}
      onChange={(event) => setIconPickQuery(event.target.value)}
    />
  )
}
