/**
 * Hands the music's bands (`sound/musicBeat.ts`) to the visualizer's blocks
 * (`@thockdown/look/visualizer`), each a CSS variable on the one element that
 * reads it (`flowStyle.ts`, never `<html>`), already scaled by the block's
 * amount and turned over when the block is inverted, so CSS only reads it:
 *
 * - `--beat-caret`, the caret's DIP: while the caret follows the music its
 *   own blink is suspended and it holds at its peak (`html[data-beat-caret]`),
 *   and the value takes that share off its opacity.
 * - `--beat-shade`, the opacity of the active editor's beat shade
 *   (`.editor-beat-shade`, shown and promoted under `html[data-beat-shade]`).
 * - `--beat-outline`, the opacity of the box outlines' copy
 *   (`.editor-beat-outline`, shown and promoted under `html[data-beat-outline]`).
 *
 * An inverted block rests at its full amount while music plays and a hit
 * takes it away; with nothing playing every block is off either way, so an
 * inverted one does not sit over the editor in silence. A block with no
 * amount subscribes nothing and keeps its ordinary look; the `<html>`
 * attributes change once when a block is switched, never per frame. The two
 * coloured blocks' colours are static between edits and are set once on
 * `<html>` (`--beat-shade-color`, `--beat-outline-color`).
 */

import { useEffect, useRef } from 'react'
import type { VisualizerChannel, VisualizerSettings } from '@thockdown/look/visualizer'
import type { BeatSettings } from '../shared/beatSettings'
import { musicPlayerService } from '../sound/MusicPlayerService'
import { setBeatVisualDelaySec, subscribeMusicBand, type MusicBandSubscription } from '../sound/musicBeat'
import { useOutputDevice } from '../sound/outputDevice'
import { setFlowStyle } from './flowStyle'

type BlockName = keyof VisualizerSettings

function useBeatBlock(name: BlockName, channel: VisualizerChannel, on: boolean): void {
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
      const { amount, invert } = channelRef.current
      const value = !musicPlayerService.isPlaying ? 0 : amount * (invert ? 1 - response : response)
      // Quantized to the 1/255 an 8-bit colour channel resolves: every step
      // that can change a pixel is written, and nothing finer (setFlowStyle
      // skips a value equal to the last).
      const steps = Math.round(value * 255)
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

export function useBeatFeedback(settings: BeatSettings, visualizer: VisualizerSettings, disabled: boolean): void {
  const on = settings.enabled && !disabled
  useBeatBlock('caret', visualizer.caret, on)
  useBeatBlock('shade', visualizer.shade, on)
  useBeatBlock('outline', visualizer.outline, on)
  const shadeColor = visualizer.shade.color
  const outlineColor = visualizer.outline.color
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--beat-shade-color', shadeColor)
    root.setProperty('--beat-outline-color', outlineColor)
  }, [shadeColor, outlineColor])
  const device = useOutputDevice(on)
  const delayMs = settings.delayMsByDevice[device] ?? 0
  useEffect(() => setBeatVisualDelaySec(delayMs / 1000), [delayMs])
}
