/**
 * Hands the reader's flow settings to the meter, and the meter's level to the
 * channels that need no React: the caret's hold, the trail's source at
 * the caret, the reverb send, the
 * soundscape's weather and the music's EQ. The look is the other channel and
 * lives in `FlowOverlays`, because it has to go through the theme.
 */

import { useEffect } from 'react'
import type { FlowSettings } from '../shared/flowSettings'
import { flowMeter } from './flowMeter'
import { typingSoundManager } from '../sound/TypingSoundManager'
import { soundscapeEngine } from '@thockdown/soundscape/SoundscapeEngine'
import { musicPlayerService } from '../sound/MusicPlayerService'
import { TRAIL_ALPHA_AT_FULL_FLOW } from './flowTrail'
import { setFlowStyle } from './flowStyle'

/** At full flow the soundscape's weather swings between this share of a full gust and a full gust, rather than from a full lull. */
const WEATHER_FLOOR_AT_FULL_FLOW = 0.8

/**
 * The caret's HOLD, 0..1, as `--flow-caret-effect`: while the reader types the
 * caret stays at the peak of its own blink (1), and once typing stops the
 * hold follows the idle decay (`flowMeter.subscribeIdle`, the grace period
 * and then the idle fade curve) down to 0, so the ordinary blink takes over
 * as `1 - hold`. The blink keyframes consume it (`buildCaretBlinkKeyframesCss`).
 * It does not depend on the level: the caret is the same at any flow.
 */
function setCaretHold(hold: number): void {
  setFlowStyle('--flow-caret-effect', hold <= 0 ? null : hold.toFixed(3))
}

export function useFlowFeedback(settings: FlowSettings): void {
  const { enabled, gainPercent, decayPercent, idleGraceMs, idleShape, idleDuration, fadeMaxTime, fadeShape, lineRamp, trail, reverb, amp } = settings

  useEffect(() => {
    flowMeter.configure({ enabled, gainPercent, decayPercent, idleGraceMs, idleShape, idleDuration })
  }, [enabled, gainPercent, decayPercent, idleGraceMs, idleShape, idleDuration])

  useEffect(() => {
    flowMeter.configureTrail({ strength: trail, fadeMaxTime, fadeShape, lineRamp })
  }, [trail, fadeMaxTime, fadeShape, lineRamp])

  useEffect(() => flowMeter.subscribeIdle(setCaretHold), [])
  useEffect(() => () => setCaretHold(0), [])

  useEffect(() => {
    const unsubscribe = flowMeter.subscribe((level) => {
      // The trail's source at the caret (CM6Editor's .flow-trail-source): the
      // alpha a box typed now would start at, and its saturation.
      // Set on the elements that read them (flowStyle.ts), never on <html>.
      setFlowStyle('--flow-trail-source', (Math.min(1, level) * trail * TRAIL_ALPHA_AT_FULL_FLOW).toFixed(4))
      setFlowStyle('--flow-trail-source-saturation', Math.min(1, level).toFixed(4))
      // The music's flow EQ (`MusicPlayerService.setFlowEq`) in proportion to
      // the level, the whole curve at full flow, scaled by the amp slider.
      musicPlayerService.setFlowEq(amp * level)
      typingSoundManager.setFlowReverb(level * reverb)
      soundscapeEngine.setWeatherFloor(level * WEATHER_FLOOR_AT_FULL_FLOW)
    })
    return () => {
      unsubscribe()
      setFlowStyle('--flow-trail-source', null)
      setFlowStyle('--flow-trail-source-saturation', null)
      musicPlayerService.setFlowEq(0)
      typingSoundManager.setFlowReverb(0)
      soundscapeEngine.setWeatherFloor(0)
    }
  }, [trail, reverb, amp])
}
