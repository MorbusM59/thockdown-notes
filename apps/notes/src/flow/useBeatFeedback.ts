/**
 * Hands the music's bands (`sound/musicBeat.ts`) to the visualizer's blocks
 * (`@thockdown/look/visualizer`), each a CSS variable on the one element that
 * reads it (`flowStyle.ts`, never `<html>`), already scaled by the block's
 * effect and turned over when that effect is negative, so CSS only reads it:
 *
 * - `--beat-caret`, the caret's DIP: while the caret follows the music its
 *   own blink is held at its peak (`html[data-beat-caret]` eases
 *   `--beat-caret-hold` to 1) and the value takes that share off its
 *   opacity. Unlike the other two it follows no band and no detected hit: it
 *   dips on every beat of a steady clock that follows the music's tempo
 *   (`subscribeMusicClock`), each dip falling on its own shape and length.
 *   It runs only while its switch is on (`VisualizerCaret.followsMusic`),
 *   and the attribute is set only while that clock HAS a beat (music
 *   playing, a tempo found): at any other moment the caret blinks.
 * - `--beat-edge`, the opacity of the active editor's beat edge
 *   (`.editor-beat-edge`, shown and promoted under `html[data-beat-edge]`).
 * - `--beat-pane`, the opacity of the pane (the box outlines' copy, or a flat wash where there is no grid)
 *   (`.editor-beat-pane`, shown and promoted under `html[data-beat-pane]`).
 *
 * An inverted block (a negative effect) rests at its full effect while music plays and a hit
 * (or, for the caret, a beat) takes it away; with nothing playing every block is off either way, so an
 * inverted one does not sit over the editor in silence. A block with no
 * effect subscribes nothing and keeps its ordinary look; the `<html>`
 * attributes change once when a block is switched, never per frame. The two
 * coloured blocks' colours are static between edits and are set once on
 * `<html>` (`--beat-edge-color`, `--beat-edge-spread`, `--beat-edge-blur`, `--beat-pane-color`).
 */

import { useEffect, useRef } from 'react'
import type { VisualizerCaret, VisualizerChannel, VisualizerSettings } from '@thockdown/look/visualizer'
import type { BeatSettings } from '../shared/beatSettings'
import { musicPlayerService } from '../sound/MusicPlayerService'
import { setBeatVisualDelaySec, subscribeMusicBand, subscribeMusicClock } from '../sound/musicBeat'
import { useOutputDevice } from '../sound/outputDevice'
import { setFlowStyle } from './flowStyle'

type BlockName = keyof VisualizerSettings

/** What a block subscribes with: a band channel for the edge and pane, the caret's two fields for the caret's clock. */
type BlockSettings = VisualizerChannel | VisualizerCaret

interface BlockSubscription<T> {
  update: (settings: T) => void
  unsubscribe: () => void
}

/** `present` says whether the block is showing (its `<html>` attribute); a band's is from the start, the caret's only while its clock has a beat. */
type Subscribe<T> = (settings: T, listener: (response: number) => void, present: (present: boolean) => void) => BlockSubscription<T>

const subscribeBand: Subscribe<VisualizerChannel> = (channel, listener, present) => {
  present(true)
  return subscribeMusicBand(channel, listener)
}

const subscribeClock: Subscribe<VisualizerCaret> = (caret, listener, present) => subscribeMusicClock(caret, listener, present)

function useBeatBlock<T extends BlockSettings>(name: BlockName, channel: T, on: boolean, subscribeTo: Subscribe<T>): void {
  const active = on && channel.effect !== 0
  // The latest channel, read by the subscription without re-creating it: a
  // slider moving retunes the band in place and keeps its measurements.
  const channelRef = useRef(channel)
  channelRef.current = channel
  const subscriptionRef = useRef<BlockSubscription<T> | null>(null)

  useEffect(() => {
    if (!active) return
    const variable = `--beat-${name}`
    const root = document.documentElement
    const attribute = `data-beat-${name}`
    const subscription = subscribeTo(channelRef.current, (response) => {
      const { effect } = channelRef.current
      const value = !musicPlayerService.isPlaying ? 0 : effect < 0 ? -effect * (1 - response) : effect * response
      // Quantized to the 1/255 an 8-bit colour channel resolves: every step
      // that can change a pixel is written, and nothing finer (setFlowStyle
      // skips a value equal to the last).
      const steps = Math.round(value * 255)
      setFlowStyle(variable, steps <= 0 ? null : (steps / 255).toFixed(4))
    }, (present) => root.toggleAttribute(attribute, present))
    subscriptionRef.current = subscription
    return () => {
      subscriptionRef.current = null
      subscription.unsubscribe()
      setFlowStyle(variable, null)
      root.removeAttribute(attribute)
    }
  }, [name, active, subscribeTo])

  useEffect(() => {
    subscriptionRef.current?.update(channel)
  }, [channel])
}

export function useBeatFeedback(enabled: boolean, settings: BeatSettings, visualizer: VisualizerSettings): void {
  useBeatBlock('caret', visualizer.caret, enabled && visualizer.caret.followsMusic, subscribeClock)
  useBeatBlock('edge', visualizer.edge, enabled, subscribeBand)
  useBeatBlock('pane', visualizer.pane, enabled, subscribeBand)
  const edgeColor = visualizer.edge.color
  const edgeSpreadPx = visualizer.edge.spreadPx
  const edgeBlurPx = visualizer.edge.blurPx
  const paneColor = visualizer.pane.color
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--beat-edge-color', edgeColor)
    root.setProperty('--beat-edge-spread', `${edgeSpreadPx}px`)
    root.setProperty('--beat-edge-blur', `${edgeBlurPx}px`)
    root.setProperty('--beat-pane-color', paneColor)
  }, [edgeColor, edgeSpreadPx, edgeBlurPx, paneColor])
  const device = useOutputDevice(enabled)
  const delayMs = settings.delayMsByDevice[device] ?? 0
  useEffect(() => setBeatVisualDelaySec(delayMs / 1000), [delayMs])
}
