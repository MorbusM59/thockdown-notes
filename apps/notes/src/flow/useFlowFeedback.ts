/**
 * Hands the reader's flow settings to the meter, and the meter's level to the
 * two channels that need no React: the caret's glow (see setHaloGrowth) and
 * the reverb send. The look is the third channel and lives in `FlowOverlays`,
 * because it has to go through the theme.
 */

import { useEffect } from 'react'
import type { FlowSettings } from '../shared/flowSettings'
import { flowMeter } from './flowMeter'
import { typingSoundManager } from '../sound/TypingSoundManager'

/**
 * At full flow and full strength the caret's own halo (Options > Caret) grows
 * by this much blur and spread, in its own colour. The blink keyframes add
 * these variables to the halo's lengths (`buildCaretBlinkKeyframesCss`), so
 * the flow draws nothing of its own: a halo of zero size still grows, and one
 * whose colour is transparent stays invisible.
 */
const HALO_GROW_BLUR_PX = 12
const HALO_GROW_SPREAD_PX = 2.5

function setHaloGrowth(grow: number): void {
  const root = document.documentElement
  if (grow <= 0) {
    root.style.removeProperty('--flow-halo-blur')
    root.style.removeProperty('--flow-halo-spread')
    return
  }
  root.style.setProperty('--flow-halo-blur', `${(grow * HALO_GROW_BLUR_PX).toFixed(2)}px`)
  root.style.setProperty('--flow-halo-spread', `${(grow * HALO_GROW_SPREAD_PX).toFixed(2)}px`)
}

export function useFlowFeedback(settings: FlowSettings): void {
  const { enabled, thresholdWpm, buildKeys, fadeSec, rhythm, caret, reverb, trail, trailFadeSec } = settings

  useEffect(() => {
    flowMeter.configure({ enabled, thresholdWpm, buildKeys, fadeSec, rhythm })
  }, [enabled, thresholdWpm, buildKeys, fadeSec, rhythm])

  useEffect(() => {
    flowMeter.configureTrail(trail, trailFadeSec)
  }, [trail, trailFadeSec])

  useEffect(() => {
    const unsubscribe = flowMeter.subscribe((level) => {
      setHaloGrowth(level * caret)
      typingSoundManager.setFlowReverb(level * reverb)
    })
    return () => {
      unsubscribe()
      setHaloGrowth(0)
      typingSoundManager.setFlowReverb(0)
    }
  }, [caret, reverb])
}
