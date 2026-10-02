/**
 * What the platform must do for the soundscape to keep playing while the app
 * is in the background or the screen is off. The web side only states WHETHER
 * a soundscape is audible (and what to call it); keeping the process and its
 * WebView alive, and putting a notification and lock-screen control up, is
 * the native shell's job.
 *
 * Android: a foreground service of type mediaPlayback
 * (mobile/android/.../BackgroundAudioPlugin.kt). iOS, later: an AVAudioSession
 * in the playback category, behind this same interface.
 *
 * In a plain browser (vite dev) there is no native side and every call is a
 * no-op, so the app runs there unchanged, minus background playback.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface BackgroundAudioPlugin {
  /** Start, or update, the session. Idempotent. */
  start(options: { title: string }): Promise<void>
  /** End the session. Idempotent. */
  stop(): Promise<void>
  /** The listener pressed the notification's / lock screen's stop control. */
  addListener(event: 'stopRequested', listener: () => void): Promise<PluginListenerHandle>
}

/**
 * The soundscape running natively (BackgroundAudioPlugin.java: the
 * renderer in a JavaScriptSandbox and Android's own audio output); used
 * through nativeSoundscapePlayback.ts.
 */
export interface NativeSoundscapePlugin {
  isRendererSupported(): Promise<{ supported: boolean }>
  openRenderer(): Promise<void>
  /** `configuration` is a ConfigureMessage as JSON. */
  configure(options: { configuration: string }): Promise<void>
  setVolume(options: { volume: number; timeConstantSec: number }): Promise<void>
  closeRenderer(): Promise<void>
  addListener(
    event: 'outputStats',
    listener: (data: {
      sampleRate: number
      playedFrames: number
      queuedFrames: number
      dryFrames: number
      dryEvents: number
      deviceUnderruns: number
      trackRestarts: number
      lastError: number
    }) => void,
  ): Promise<PluginListenerHandle>
  addListener(event: 'rendererFailure', listener: (data: { message: string }) => void): Promise<PluginListenerHandle>
}

const nativePlugin = Capacitor.isNativePlatform()
  ? registerPlugin<BackgroundAudioPlugin & NativeSoundscapePlugin>('BackgroundAudio')
  : null

export const backgroundAudioHost: BackgroundAudioPlugin = nativePlugin ?? {
  start: async () => {},
  stop: async () => {},
  addListener: async () => ({ remove: async () => {} }),
}

/** The native soundscape, or null in a plain browser, where the engine keeps its web playback. */
export const nativeSoundscapePlugin: NativeSoundscapePlugin | null = nativePlugin
