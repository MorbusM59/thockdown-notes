/**
 * TEMPORARY: a readout of the soundscape's playback statistics
 * (SoundscapeEngine.subscribeStats), kept until playback through the native
 * output is confirmed on a device:
 * - "Queued ahead": audio queued at the output past what it has played;
 * - "Output ran dry": silence the output played for want of queued audio;
 * - "Device underruns": the audio device's own count (AudioTrack's on
 *   Android), silence it played because the output did not deliver in time.
 * Delete this, and its mount in MobileSoundscapeApp, once that is settled.
 */
import { useEffect, useState } from 'react'
import { soundscapeEngine, type SoundscapePlaybackStats } from '../../src/sound/SoundscapeEngine'
import { OptionsSubsectionLabel } from '../../src/sidebar/OptionsSubsectionLabel'

declare const __MOBILE_BUILD_ID__: string

const seconds = (value: number) => `${value.toFixed(2)} s`

export function PlaybackDiagnostics() {
  const [stats, setStats] = useState<SoundscapePlaybackStats | null>(null)
  useEffect(() => soundscapeEngine.subscribeStats(setStats), [])
  const rows: Array<[string, string]> = stats
    ? [
        ['Queued ahead', seconds(stats.queuedSec)],
        ['Output ran dry', `${stats.outputDryEvents} times, ${seconds(stats.outputDrySec)}`],
        ['Device underruns', stats.deviceUnderruns === null ? 'not reported' : String(stats.deviceUnderruns)],
      ]
    : [['Status', 'start a soundscape']]
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
