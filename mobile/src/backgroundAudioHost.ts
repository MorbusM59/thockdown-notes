/**
 * The web page's interface to the native soundscape session
 * (mobile/android/.../BackgroundAudioPlugin.java, SoundscapeSession.java).
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
 * controls, clips or sharing.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/** One soundscape the media controls step through. */
export interface SessionEntry {
  id: string
  name: string
  /** A ConfigureMessage as JSON, as the engine would send it (soundscapeConfiguration). */
  configuration: string
}

export interface SessionState {
  playing: boolean
  /** The entry playing, or null if none of the published entries is. */
  currentId: string | null
}

export interface NativeSoundscapePlugin {
  isRendererSupported(): Promise<{ supported: boolean }>
  /** The soundscapes the media controls step through, which one is current, and the listener's volume. */
  publish(options: { entries: SessionEntry[]; currentId: string | null; masterVolume: number }): Promise<void>
  getState(): Promise<SessionState>
  /** Start playing, or carry on; idempotent. */
  play(): Promise<void>
  /** Hold where it is, keeping the session and its controls up. */
  pause(): Promise<void>
  /** `configuration` is a ConfigureMessage as JSON. */
  configure(options: { configuration: string }): Promise<void>
  setVolume(options: { volume: number; timeConstantSec: number }): Promise<void>
  /** Render `seconds` of `configuration` to `<name>.m4a` and offer it through the share sheet. */
  renderClip(options: { configuration: string; seconds: number; name: string }): Promise<void>
  cancelClip(): Promise<void>
  /** Write `content` to a file named `name` and offer it through the share sheet. */
  shareText(options: { content: string; name: string }): Promise<void>
  /** A media control changed what plays. */
  addListener(event: 'sessionChanged', listener: (state: SessionState) => void): Promise<PluginListenerHandle>
  addListener(event: 'rendererFailure', listener: (data: { message: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'clipProgress', listener: (data: { fraction: number }) => void): Promise<PluginListenerHandle>
  /** The clip is done: `shared` is false when it failed or was cancelled. */
  addListener(event: 'clipFinished', listener: (data: { shared: boolean }) => void): Promise<PluginListenerHandle>
}

/** The native session, or null in a plain browser. */
export const nativeSoundscape: NativeSoundscapePlugin | null = Capacitor.isNativePlatform()
  ? registerPlugin<NativeSoundscapePlugin>('BackgroundAudio')
  : null
