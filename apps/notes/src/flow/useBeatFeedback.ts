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
import { setBeatVisualDelaySec, subscribeMusicBand, type MusicBandSubscription } from '../sound/musicBeat'
import { useOutputDevice } from '../sound/outputDevice'
import { setFlowStyle } from './flowStyle'

/**
 * Drives one element's variable from its band. `scale` is what a full
 * response writes: the caret's amount, or 1 for the shade, whose layer holds
 * two effects with intensities of their own (`--beat-shade-amount`,
 * `--beat-outline-amount`), applied as static opacities inside it so the one
 * value written per frame stays a compositor opacity.
 */
function useBeatChannel(name: 'caret' | 'shade', channel: BeatChannel, scale: number, on: boolean): void {
  const active = on && scale > 0
  const scaleRef = useRef(scale)
  scaleRef.current = scale
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
      // Quantized to the 1/255 an 8-bit colour channel resolves: every step
      // that can change a pixel is written, and nothing finer (setFlowStyle
      // skips a value equal to the last).
      const steps = Math.round(response * scaleRef.current * 255)
      setFlowStyle(variable, steps <= 0 ? null : (steps / 255).toFixed(4))
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
  useBeatChannel('caret', settings.caret, settings.caret.amount, on)
  const shadeAmount = settings.shade.amount
  const outlineAmount = settings.outlineAmount
  useBeatChannel('shade', settings.shade, shadeAmount > 0 || outlineAmount > 0 ? 1 : 0, on)
  // Static between slider moves, so set once on <html> for the one layer that reads them.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--beat-shade-amount', String(shadeAmount))
    root.setProperty('--beat-outline-amount', String(outlineAmount))
  }, [shadeAmount, outlineAmount])
  const device = useOutputDevice(on)
  const delayMs = settings.delayMsByDevice[device] ?? 0
  useEffect(() => setBeatVisualDelaySec(delayMs / 1000), [delayMs])
}
