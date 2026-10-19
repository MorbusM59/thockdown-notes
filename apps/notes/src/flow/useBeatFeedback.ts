/**
 * Hands the music's bands (`sound/musicBeat.ts`) to the elements that follow
 * them, each a CSS variable on the one element that reads it (`flowStyle.ts`,
 * never `<html>`), already scaled by the element's amount so CSS only reads
 * it:
 *
 * - `--beat-caret`, the caret's DIP: while the caret follows the music its
 *   own blink is suspended and it holds at its peak (`html[data-beat-caret]`),
 *   and a response takes that share off its opacity.
 * - `--beat-shade`, the opacity of the active editor's beat shade
 *   (`.editor-beat-shade`, shown and promoted under `html[data-beat-shade]`).
 *
 * An element with no amount subscribes nothing and keeps its ordinary look;
 * the two `<html>` attributes change once when the pulse is switched, never
 * per frame.
 */

import { useEffect } from 'react'
import type { BeatChannel, BeatSettings } from '../shared/beatSettings'
import { subscribeMusicBand } from '../sound/musicBeat'
import { setFlowStyle } from './flowStyle'

function useBeatChannel(name: 'caret' | 'shade', channel: BeatChannel, on: boolean): void {
  const { amount, frequencyHz, octaves, contrast } = channel
  useEffect(() => {
    if (!on || amount <= 0) return
    const variable = `--beat-${name}`
    const root = document.documentElement
    root.setAttribute(`data-beat-${name}`, '')
    const unsubscribe = subscribeMusicBand({ amount, frequencyHz, octaves, contrast }, (response) => {
      setFlowStyle(variable, response <= 0 ? null : (response * amount).toFixed(3))
    })
    return () => {
      unsubscribe()
      setFlowStyle(variable, null)
      root.removeAttribute(`data-beat-${name}`)
    }
  }, [name, on, amount, frequencyHz, octaves, contrast])
}

export function useBeatFeedback(settings: BeatSettings, disabled: boolean): void {
  const on = settings.enabled && !disabled
  useBeatChannel('caret', settings.caret, on)
  useBeatChannel('shade', settings.shade, on)
}
