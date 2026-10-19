/**
 * Hands the music's beat (`sound/musicBeat.ts`) to its two channels, each a
 * CSS variable on the one element that reads it (`flowStyle.ts`, never
 * `<html>`): `--beat-caret` on the caret, whose `::after` pulse takes it as
 * its opacity, and `--beat-shade` on the active editor's beat shade
 * (`.editor-beat-shade`). Both already carry their strength, so CSS only
 * reads them. Nothing is subscribed while the pulse is off, so the frame loop
 * and the bass analyser do not exist.
 */

import { useEffect } from 'react'
import type { BeatSettings } from '../shared/beatSettings'
import { subscribeMusicBeat } from '../sound/musicBeat'
import { setFlowStyle } from './flowStyle'

export function useBeatFeedback(settings: BeatSettings, disabled: boolean): void {
  const { enabled, caret, shade } = settings
  useEffect(() => {
    if (!enabled || disabled || (caret <= 0 && shade <= 0)) return
    // Shows (and promotes) the shade layer only while the pulse can drive it:
    // one document-wide style pass when the pulse is turned on or off, never
    // per frame.
    document.documentElement.dataset.beatPulse = ''
    const unsubscribe = subscribeMusicBeat((pulse) => {
      setFlowStyle('--beat-caret', pulse <= 0 ? null : (pulse * caret).toFixed(3))
      setFlowStyle('--beat-shade', pulse <= 0 ? null : (pulse * shade).toFixed(3))
    })
    return () => {
      unsubscribe()
      delete document.documentElement.dataset.beatPulse
      setFlowStyle('--beat-caret', null)
      setFlowStyle('--beat-shade', null)
    }
  }, [enabled, disabled, caret, shade])
}
