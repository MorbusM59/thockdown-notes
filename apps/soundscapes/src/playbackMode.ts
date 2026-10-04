/**
 * Chooses the soundscape's playback, once, at startup: in the app, the
 * native session (nativeSoundscapePlayback.ts), where the WebView pausing
 * its JavaScript in the background cannot reach it. A WebView too old to
 * provide the renderer's sandbox, and a plain browser, keep the web
 * playback, which plays only while the app is in the foreground and has no
 * media controls.
 */
import { soundscapeEngine } from '../../../src/sound/SoundscapeEngine'
import { nativeSoundscape } from './backgroundAudioHost'
import { nativeSoundscapePlayback } from './nativeSoundscapePlayback'

/** Whether the native session plays the soundscape: its media controls, clips and saving to files exist only then. */
export const nativePlayback: Promise<boolean> = (() => {
  const plugin = nativeSoundscape
  if (!plugin) return Promise.resolve(false)
  return plugin.isRendererSupported().then(({ supported }) => {
    if (supported) soundscapeEngine.usePlayback(nativeSoundscapePlayback(plugin))
    return supported
  })
})()
