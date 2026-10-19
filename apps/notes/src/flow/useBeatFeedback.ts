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

import { useEffect, useRef } from 'react'
import type { BeatChannel, BeatSettings } from '../shared/beatSettings'
import { subscribeMusicBand, type MusicBandSubscription } from '../sound/musicBeat'
import { setFlowStyle } from './flowStyle'

function useBeatChannel(name: 'caret' | 'shade', channel: BeatChannel, on: boolean): void {
  const active = on && channel.amount > 0
  // The latest channel, read by the subscription without re-creating it: a
  // slider moving retunes the band in place and keeps its measurements.
  const channelRef = useRef(channel)
  channelRef.current = channel
  const subscriptionRef = useRef<MusicBandSubscription | null>(null)

  useEffect(() => {
    if (!active) return
    const variable = `--beat-${name}`
    const root = document.documentElement
    root.setAttribute(`data-beat-${name}`, '')
    const subscription = subscribeMusicBand(channelRef.current, (response) => {
      setFlowStyle(variable, response <= 0 ? null : (response * channelRef.current.amount).toFixed(3))
    })
    subscriptionRef.current = subscription
    return () => {
      subscriptionRef.current = null
      subscription.unsubscribe()
      setFlowStyle(variable, null)
      root.removeAttribute(`data-beat-${name}`)
    }
  }, [name, active])

  useEffect(() => {
    subscriptionRef.current?.update(channel)
  }, [channel])
}

export function useBeatFeedback(settings: BeatSettings, disabled: boolean): void {
  const on = settings.enabled && !disabled
  useBeatChannel('caret', settings.caret, on)
  useBeatChannel('shade', settings.shade, on)
}
