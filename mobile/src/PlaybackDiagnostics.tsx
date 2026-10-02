/**
 * TEMPORARY: a readout of the soundscape's playback statistics
 * (SoundscapeEngine.subscribeStats), for finding where the dropouts on an
 * app switch come from. Read after switching away and back:
 * - "Player ran dry" rising means the render worker fell behind;
 * - "Output underruns" rising while the player never ran dry means audio
 *   was queued and the output path below the player stalled anyway.
 * Delete this, and its mount in MobileSoundscapeApp, once that is settled.
 */
import { useEffect, useState } from 'react'
import { soundscapeEngine, type SoundscapePlaybackStats } from '../../src/sound/SoundscapeEngine'
import { OptionsSubsectionLabel } from '../../src/sidebar/OptionsSubsectionLabel'

const seconds = (value: number) => `${value.toFixed(2)} s`

export function PlaybackDiagnostics() {
  const [stats, setStats] = useState<SoundscapePlaybackStats | null>(null)
  useEffect(() => soundscapeEngine.subscribeStats(setStats), [])
  const rows: Array<[string, string]> = stats
    ? [
        ['Queued ahead', seconds(stats.queuedSec)],
        ['Player ran dry', `${stats.playerDryEvents} times, ${seconds(stats.playerDrySec)}`],
        ['Output underruns', stats.outputUnderrunEvents === null
          ? 'not reported by this WebView'
          : `${stats.outputUnderrunEvents} times, ${seconds(stats.outputUnderrunSec ?? 0)}`],
      ]
    : [['Status', 'start a soundscape']]
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
