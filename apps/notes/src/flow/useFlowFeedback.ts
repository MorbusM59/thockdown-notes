/**
 * Hands the reader's flow settings to the meter, and the meter's level to the
 * two channels that need no React: the caret's glow (see setCaretGlow) and
 * the reverb send. The look is the third channel and lives in `FlowScene`,
 * because it has to go through the theme.
 */

import { useEffect } from 'react'
import type { FlowSettings } from '../shared/flowSettings'
import { flowMeter } from './flowMeter'
import { typingSoundManager } from '../sound/TypingSoundManager'

/**
 * The caret glow at full flow and full strength: a tight shadow that reads as
 * the caret thickening and a wide one that reads as light around it, both in
 * the caret's own colour.
 */
const CARET_GLOW_NEAR_PX = 2.5
const CARET_GLOW_FAR_PX = 12
const CARET_GLOW_ALPHA_PERCENT = 85

const CARET_GLOW_VARIABLES = ['--flow-caret-near', '--flow-caret-far', '--flow-caret-alpha'] as const

/**
 * The glow is drawn by a rule in index.css that applies only while the
 * document carries `data-flow-glow`, so at rest the caret has no filter at
 * all. Its sizes are plain values here, and its colour is mixed in the rule
 * itself, because `--color-caret` belongs to the app root rather than to the
 * document, and a variable resolves where it is declared.
 */
function setCaretGlow(glow: number): void {
  const root = document.documentElement
  if (glow <= 0) {
    root.removeAttribute('data-flow-glow')
    for (const name of CARET_GLOW_VARIABLES) root.style.removeProperty(name)
    return
  }
  root.style.setProperty('--flow-caret-near', `${(glow * CARET_GLOW_NEAR_PX).toFixed(2)}px`)
  root.style.setProperty('--flow-caret-far', `${(glow * CARET_GLOW_FAR_PX).toFixed(2)}px`)
  root.style.setProperty('--flow-caret-alpha', `${(glow * CARET_GLOW_ALPHA_PERCENT).toFixed(1)}%`)
  root.setAttribute('data-flow-glow', '')
}

export function useFlowFeedback(settings: FlowSettings): void {
  const { enabled, thresholdWpm, buildKeys, fadeSec, rhythm, caret, reverb } = settings

  useEffect(() => {
    flowMeter.configure({ enabled, thresholdWpm, buildKeys, fadeSec, rhythm })
  }, [enabled, thresholdWpm, buildKeys, fadeSec, rhythm])

  useEffect(() => {
    const unsubscribe = flowMeter.subscribe((level) => {
      setCaretGlow(level * caret)
      typingSoundManager.setFlowReverb(level * reverb)
    })
    return () => {
      unsubscribe()
      setCaretGlow(0)
      typingSoundManager.setFlowReverb(0)
    }
  }, [caret, reverb])
}
