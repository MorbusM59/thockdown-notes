/**
 * The web page's interface to the native music (MusicPlugin.java,
 * MusicSession.java): the music plays in the app's process, rendered ahead
 * with the soundscape into one output, so it keeps playing with the page
 * paused; the page picks folders, keeps the catalog and sends the
 * soundstage, the volume and the transport.
 *
 * The library is two documents (musicLibrary.ts): the CATALOG, which this
 * page writes whole, and the ROTATION, which only the native renderer moves
 * and this page only reads.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { MusicStage } from '@thockdown/audio/musicMix'
import { fitEqBandGains } from '@thockdown/visualizer/shared/musicEqCurve'
import type { SoundstageSettings } from '@thockdown/visualizer/shared/soundstages'
import type { MusicCatalog, MusicRotation } from './musicLibrary'

export interface NativeMusicPlugin {
  /** The system's folder picker: the tree chosen, its read grant kept across restarts. */
  pickFolder(): Promise<{ uri?: string }>
  releaseFolder(options: { uri: string }): Promise<void>
  /** The audio files under `uri` with their tags, except `known` paths; every path found as `paths`. */
  scanFolder(options: { uri: string; known: string[] }): Promise<{ added: ScannedSong[]; paths: string[] }>
  getLibrary(): Promise<{ catalog: string; rotation: string }>
  setCatalog(options: { catalog: string }): Promise<void>
  play(options: { stage: string }): Promise<void>
  setStage(options: { stage: string }): Promise<void>
  pause(): Promise<void>
  stop(): Promise<void>
  skip(): Promise<void>
  choose(options: { songId: number }): Promise<void>
  seek(options: { seconds: number }): Promise<void>
  /** A gain, 0..1: the app's volume curve is applied before it is sent. */
  setVolume(options: { volume: number }): Promise<void>
  /** The visualizer's spectrum in `bands` log bands, sent as `spectrum` events while it is on; 0 stops it. */
  setSpectrum(options: { bands: number }): Promise<void>
  getState(): Promise<{ playing: boolean }>
  /** What is heard changed (a new song, another second, play or pause): the song and the seconds into it at the output's playhead `frame`. */
  addListener(event: 'heard', listener: (data: { songId: number | null; seconds: number; frame: number; sampleRate: number; playing: boolean }) => void): Promise<PluginListenerHandle>
  /** Spectrum frames (spectrumFrames.ts's batches, as JSON text; nativeMusicListening.ts reads them). */
  addListener(event: 'spectrum', listener: (data: { batches: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'failure', listener: (data: { message: string }) => void): Promise<PluginListenerHandle>
}

export interface ScannedSong {
  filePath: string
  title: string
  artist: string
  album: string
  durationSec: number
}

/** The native music, or null in a plain browser. */
export const nativeMusic: NativeMusicPlugin | null = Capacitor.isNativePlatform()
  ? registerPlugin<NativeMusicPlugin>('Music')
  : null

/** A soundstage as the native processing takes it (musicMix.ts's MusicStage), the EQ curve fitted to the bands as the desktop fits it. */
export function musicStageOf(stage: SoundstageSettings): MusicStage {
  return {
    eqGainsDb: Array.from(fitEqBandGains(stage.eq)),
    reverbAmount: stage.reverb,
    size: stage.size,
    foliage: stage.room,
    width: stage.width,
  }
}

/** The library as stored. */
export async function loadMusicLibrary(plugin: NativeMusicPlugin): Promise<{ catalog: MusicCatalog; rotation: MusicRotation }> {
  const stored = await plugin.getLibrary()
  return { catalog: JSON.parse(stored.catalog) as MusicCatalog, rotation: JSON.parse(stored.rotation) as MusicRotation }
}
