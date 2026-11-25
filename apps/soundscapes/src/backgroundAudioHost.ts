/**
 * The web page's interface to the native soundscape session
 * (apps/soundscapes/android/.../BackgroundAudioPlugin.java, SoundscapeSession.java).
 *
 * The session renders and plays the soundscape in the app's own process,
 * keeps the foreground service and its notification and lock-screen
 * controls up while it exists, and outlives the web page. The page drives
 * it while the page runs; the media controls drive it while the page is
 * paused or gone, and the page catches up through `getState` and the
 * `sessionChanged` event (see MobileSoundscapeApp.tsx).
 *
 * In a plain browser (vite dev) there is no native side: `nativeSoundscape`
 * is null, the engine keeps its web playback, and there are no media
 * controls, clips or saving to files.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { MusicScheduleEvent, ScheduleEvent } from './schedule'

/** One soundscape the media controls step through. */
export interface SessionEntry {
  id: string
  name: string
  /** A ConfigureMessage as JSON, as the engine would send it (soundscapeConfiguration). */
  configuration: string
}

/** Regular mode: the soundscape the listener chose, which overrules the schedule while playing or paused. */
export type RegularMode = 'stopped' | 'playing' | 'paused'

/** What is heard: the listener's choice, the schedule's run, or nothing. */
export type SoundSource = 'regular' | 'schedule' | 'none'

/** The native session's state (SoundscapeSession.java, where the rules combining the two are written). */
export interface SessionState {
  regular: RegularMode
  source: SoundSource
  /** The soundscape heard or paused on (an entry's id), or null. */
  currentId: string | null
  scheduleEnabled: boolean
  /** When what is heard ends (wall clock, ms): the timer's end, or the scheduled run's next change; -1 for none. */
  endsAtMs: number
  /** The timer's time left while paused (ms); -1 for none. */
  remainingMs: number
}

/** The schedule as the native side runs it (schedule.ts works it out). */
export interface NativeSchedule {
  enabled: boolean
  /** The listener's volume as a GAIN (volumeGain of the slider), for a run started with no web page to ask. */
  masterVolume: number
  events: ScheduleEvent[]
  /** The song set's events (schedule.ts's music channel), played by the native music session. */
  musicEvents: MusicScheduleEvent[]
  /** Every soundscape the events name. */
  entries: SessionEntry[]
}

export interface NativeSoundscapePlugin {
  isRendererSupported(): Promise<{ supported: boolean }>
  /**
   * The soundscapes the media controls step through, which one is current,
   * the name of the soundscape being played (which may be outside those
   * entries), and the listener's volume.
   */
  publish(options: { entries: SessionEntry[]; currentId: string | null; currentName: string | null; masterVolume: number }): Promise<void>
  getState(): Promise<SessionState>
  /** The timer (timer.ts): how long a soundscape the listener plays runs, `seconds` 0 for no end, and the fade it ends over. */
  setTimer(options: { seconds: number; fadeSec: number }): Promise<void>
  /** Store and arm the schedule; turning it on applies its state at this moment. */
  setSchedule(schedule: NativeSchedule): Promise<void>
  /** Whether exact alarms are allowed; if not, opens the system page that grants them. */
  ensureExactAlarms(): Promise<{ granted: boolean }>
  /** Regular mode PLAYING; idempotent. */
  play(): Promise<void>
  /** Regular mode PAUSED, from PLAYING only (a stop that came first stands). */
  pause(): Promise<void>
  /** Regular mode STOPPED: the schedule takes over, or the session ends. Resolves the outcome. */
  stop(): Promise<SessionState>
  /** `configuration` is a ConfigureMessage as JSON; `transitionSec` 0 for a settings change, else a change of soundscape crossfaded that long. */
  configure(options: { configuration: string; transitionSec: number }): Promise<void>
  setVolume(options: { volume: number; timeConstantSec: number }): Promise<void>
  /** The visualizer's spectrum of the soundscape in this many log bands, sent as `spectrum` events; 0 stops it (nativeMusicListening.ts). */
  setSpectrum(options: { bands: number }): Promise<void>
  /** Ask where to save `<name>.m4a` (the system's "Save as" dialog), then render `seconds` of `configuration` into it. */
  renderClip(options: { configuration: string; seconds: number; name: string }): Promise<void>
  cancelClip(): Promise<void>
  /** Save `content` as a file named `name`, where the reader chooses in the system's "Save as" dialog. */
  saveText(options: { content: string; name: string }): Promise<{ saved: boolean }>
  /** Whether the page takes the system's back gesture, which then arrives as `back` instead of leaving the app. */
  takeBack(options: { taken: boolean }): Promise<void>
  /** A media control or the schedule changed what plays. */
  addListener(event: 'sessionChanged', listener: (state: SessionState) => void): Promise<PluginListenerHandle>
  /** The timer's countdown started, held or ended, for any reason (the page's own changes included). */
  addListener(event: 'countdown', listener: (data: { endsAtMs: number; remainingMs: number }) => void): Promise<PluginListenerHandle>
  addListener(event: 'back', listener: () => void): Promise<PluginListenerHandle>
  /** Spectrum frames (soundscapeRenderer.ts's batches, as JSON) and the soundscape output's playhead as they were sent. */
  addListener(event: 'spectrum', listener: (data: { batches: string; playhead: number }) => void): Promise<PluginListenerHandle>
  addListener(event: 'rendererFailure', listener: (data: { message: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'clipProgress', listener: (data: { fraction: number }) => void): Promise<PluginListenerHandle>
  /** The clip is done: `saved` is false when it failed or was cancelled (the dialog included). */
  addListener(event: 'clipFinished', listener: (data: { saved: boolean }) => void): Promise<PluginListenerHandle>
}

/** The native session, or null in a plain browser. */
export const nativeSoundscape: NativeSoundscapePlugin | null = Capacitor.isNativePlatform()
  ? registerPlugin<NativeSoundscapePlugin>('BackgroundAudio')
  : null
