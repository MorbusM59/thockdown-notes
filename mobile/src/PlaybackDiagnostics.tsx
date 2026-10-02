/**
 * TEMPORARY: a readout of the soundscape's playback (SoundscapeEngine's
 * statistics and failures), kept until playback through the native output
 * is confirmed over long runs on a device:
 * - "Played": how far the output has played since it opened;
 * - "Updated": time since the output last reported; a number that keeps
 *   growing while a soundscape is on means the output itself stopped;
 * - "Queued ahead": audio queued at the output past what it has played;
 * - "Output ran dry": silence the output played for want of queued audio;
 * - "Device underruns": the audio device's own count (AudioTrack's on
 *   Android);
 * - "Output restarts": device streams rebuilt after the system refused a
 *   write, with the last error code;
 * - "Playback": native (rendered and played by the app's service) or the
 *   web page's, and why;
 * - "Last failure": anything that tore playback down.
 * Delete this, and its mount in MobileSoundscapeApp, once that is settled.
 */
import { useEffect, useState } from 'react'
import { soundscapeEngine, type SoundscapePlaybackStats } from '../../src/sound/SoundscapeEngine'
import { OptionsSubsectionLabel } from '../../src/sidebar/OptionsSubsectionLabel'
import { playbackMode } from './playbackMode'

declare const __MOBILE_BUILD_ID__: string

const seconds = (value: number) => `${value.toFixed(2)} s`

export function PlaybackDiagnostics() {
  const [stats, setStats] = useState<{ value: SoundscapePlaybackStats; at: number } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [mode, setMode] = useState('…')
  useEffect(() => { void playbackMode.then(setMode) }, [])
  useEffect(() => soundscapeEngine.subscribeStats((value) => setStats({ value, at: Date.now() })), [])
  useEffect(() => soundscapeEngine.subscribeFailures((value) => setFailure(`${new Date().toLocaleTimeString()}: ${value}`)), [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const rows: Array<[string, string]> = []
  if (stats) {
    const value = stats.value
    if (value.playedSec !== null) rows.push(['Played', seconds(value.playedSec)])
    rows.push(['Updated', `${Math.max(0, Math.round((now - stats.at) / 1000))} s ago`])
    rows.push(['Queued ahead', seconds(value.queuedSec)])
    rows.push(['Output ran dry', `${value.outputDryEvents} times, ${seconds(value.outputDrySec)}`])
    rows.push(['Device underruns', value.deviceUnderruns === null ? 'not reported' : String(value.deviceUnderruns)])
    if (value.outputRestarts !== null) {
      rows.push(['Output restarts', value.outputRestarts === 0 ? '0' : `${value.outputRestarts} (last error ${value.lastOutputError})`])
    }
  } else {
    rows.push(['Status', 'start a soundscape'])
  }
  rows.push(['Playback', mode])
  rows.push(['Last failure', failure ?? 'none'])
  rows.push(['Build', __MOBILE_BUILD_ID__])
  return (
    <div className="utility-setting-slider-stack" aria-label="Playback diagnostics">
      <OptionsSubsectionLabel>Diagnostics</OptionsSubsectionLabel>
      <dl className="mobile-diagnostics">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
