/**
 * Hands the reader's flow settings to the meter, and the meter's level to the
 * channels that need no React: the caret's glow and effect strength, the
 * reverb send, the music's EQ, and the peak's sound on the kick (`flowPeak.ts`). The look is the third channel and lives in `FlowOverlays`,
 * because it has to go through the theme.
 */

import { useEffect } from 'react'
import type { FlowSettings } from '../shared/flowSettings'
import { flowMeter } from './flowMeter'
import { typingSoundManager } from '../sound/TypingSoundManager'
import { soundscapeEngine } from '@thockdown/soundscape/SoundscapeEngine'
import { peakSound } from './flowPeak'
import { musicPlayerService } from '../sound/MusicPlayerService'

/** At full flow the soundscape's weather swings between this share of a full gust and a full gust, rather than from a full lull. */
const WEATHER_FLOOR_AT_FULL_FLOW = 0.8

/**
 * At full flow and full strength the caret's own halo (Options > Caret) grows
 * by this much blur and spread, and its colour grows more
 * opaque (`--flow-caret-alpha`). The effect slider also blends to zero through
 * `--flow-caret-effect`. The whole caret, halo included, fades out with the
 * LEVEL (`--flow-caret-fade`) whenever the trail is on at all, because the
 * trail's leading edge takes over the caret's cell: at full flow only that
 * edge marks it. At zero trail strength flow leaves the caret as it is. `--flow-trail-head` is the trail's leading edge. The blink
 * keyframes consume these variables (`buildCaretBlinkKeyframesCss`), so the
 * flow draws nothing of its own: a halo of zero size still grows, and one
 * whose colour is transparent stays invisible.
 */
const HALO_GROW_BLUR_PX = 12
const HALO_GROW_SPREAD_PX = 2.5
/** The share of the way to opaque that the halo colour moves at full flow and full strength. */
const CARET_ALPHA_BOOST = 0.6

function setCaretFlow(grow: number, fade: number): void {
  const root = document.documentElement
  if (grow <= 0) {
    root.style.removeProperty('--flow-halo-blur')
    root.style.removeProperty('--flow-halo-spread')
    root.style.removeProperty('--flow-caret-alpha')
    root.style.removeProperty('--flow-caret-effect')
    root.style.removeProperty('--flow-caret-fade')
    root.style.removeProperty('--flow-trail-head')
    return
  }
  root.style.setProperty('--flow-halo-blur', `${(grow * HALO_GROW_BLUR_PX).toFixed(2)}px`)
  root.style.setProperty('--flow-halo-spread', `${(grow * HALO_GROW_SPREAD_PX).toFixed(2)}px`)
  root.style.setProperty('--flow-caret-alpha', (grow * CARET_ALPHA_BOOST).toFixed(3))
  root.style.setProperty('--flow-caret-effect', grow.toFixed(3))
  root.style.setProperty('--flow-caret-fade', Math.min(1, fade).toFixed(3))
  // The trail's leading edge (CM6Editor) glows at the live level, no decay.
  root.style.setProperty('--flow-trail-head', grow.toFixed(3))
}

/**
 * The music's flow EQ (`MusicPlayerService.setFlowEq`): proportional to the
 * level below full flow, reaching half the curve, and the whole curve in full
 * flow, so arriving doubles it.
 */
function musicEqAmount(level: number, full: boolean): number {
  return full ? 1 : 0.5 * Math.max(0, Math.min(1, level))
}

export function useFlowFeedback(settings: FlowSettings): void {
  const { enabled, gainPercent, decayPercent, fadeMaxTime, fadeShape, lineRamp, trail, peak, reverb, amp } = settings

  useEffect(() => {
    flowMeter.configure({ enabled, gainPercent, decayPercent })
  }, [enabled, gainPercent, decayPercent])

  useEffect(() => {
    flowMeter.configureTrail({ strength: trail, peak, fadeMaxTime, fadeShape, lineRamp })
  }, [trail, peak, fadeMaxTime, fadeShape, lineRamp])

  useEffect(() => {
    let lastLevel = 0
    let full = false
    const unsubscribe = flowMeter.subscribe((level) => {
      lastLevel = level
      musicPlayerService.setFlowEq(amp * musicEqAmount(level, full))
      setCaretFlow(level * trail, trail > 0 ? level : 0)
      typingSoundManager.setFlowReverb(level * reverb)
      soundscapeEngine.setWeatherFloor(level * WEATHER_FLOOR_AT_FULL_FLOW)
    })
    const unsubscribeKick = flowMeter.subscribeKick(() => peakSound(peak))
    const unsubscribeFull = flowMeter.subscribeFull((isFull) => {
      full = isFull
      musicPlayerService.setFlowEq(amp * musicEqAmount(lastLevel, full))
    })
    return () => {
      unsubscribe()
      unsubscribeFull()
      musicPlayerService.setFlowEq(0)
      unsubscribeKick()
      setCaretFlow(0, 0)
      typingSoundManager.setFlowReverb(0)
      soundscapeEngine.setWeatherFloor(0)
    }
  }, [trail, peak, reverb, amp])
}
