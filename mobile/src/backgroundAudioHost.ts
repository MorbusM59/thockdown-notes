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
 * The native soundscape output (BackgroundAudioPlugin.java,
 * SoundscapeAudioOutput.java); used through nativeSoundscapeOutput.ts.
 */
export interface NativeOutputPlugin {
  /** Open the output; its sample rate is the device's. */
  openOutput(): Promise<{ sampleRate: number }>
  /** Queue `data` (base64 of interleaved 16-bit little-endian stereo at half scale) at `startFrame`. */
  write(options: { startFrame: number; data: string }): Promise<void>
  setVolume(options: { volume: number; timeConstantSec: number }): Promise<void>
  closeOutput(): Promise<void>
  addListener(event: 'played', listener: (data: { frame: number }) => void): Promise<PluginListenerHandle>
  addListener(
    event: 'outputStats',
    listener: (data: {
      playedFrames: number
      queuedFrames: number
      dryFrames: number
      dryEvents: number
      deviceUnderruns: number
      trackRestarts: number
      lastError: number
    }) => void,
  ): Promise<PluginListenerHandle>
}

const nativePlugin = Capacitor.isNativePlatform()
  ? registerPlugin<BackgroundAudioPlugin & NativeOutputPlugin>('BackgroundAudio')
  : null

export const backgroundAudioHost: BackgroundAudioPlugin = nativePlugin ?? {
  start: async () => {},
  stop: async () => {},
  addListener: async () => ({ remove: async () => {} }),
}

/** The native output, or null in a plain browser, where the engine keeps its Web Audio output. */
export const nativeOutputPlugin: NativeOutputPlugin | null = nativePlugin
