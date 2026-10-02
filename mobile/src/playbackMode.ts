/**
 * Chooses the soundscape's playback, once, at startup.
 *
 * In the app, render and play natively (nativeSoundscapePlayback.ts), where
 * the WebView pausing its JavaScript in the background cannot reach it. A
 * WebView too old to provide the renderer's sandbox, and a plain browser,
 * keep the web playback.
 */
import { soundscapeEngine } from '../../src/sound/SoundscapeEngine'
import { nativeSoundscapePlugin } from './backgroundAudioHost'
import { nativeSoundscapePlayback } from './nativeSoundscapePlayback'

/** Which playback is in use, and why, for Diagnostics. */
export const playbackMode: Promise<string> = nativeSoundscapePlugin
  ? nativeSoundscapePlugin.isRendererSupported().then(({ supported }) => {
    if (!supported) return 'web page (this WebView has no JavaScriptSandbox)'
    soundscapeEngine.usePlayback(nativeSoundscapePlayback(nativeSoundscapePlugin!))
    return 'native'
  })
  : Promise.resolve('web page (browser)')
