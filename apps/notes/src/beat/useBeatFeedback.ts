/**
 * Hands the music's trackers (`sound/musicBeat.ts`), each block through its own mix, to the visualizer's blocks
 * (`@thockdown/look/visualizer`), each a CSS variable on the one element that
 * reads it (`shared/liveStyle.ts`, never `<html>`), already scaled by the block's
 * effect and turned over when that effect is negative, so CSS only reads it:
 *
 * - `--beat-caret`, the caret's DIP: while the flashing is matched to the
 *   music its own free cycle is held at its peak (`html[data-beat-caret]`
 *   eases `--beat-caret-hold` to 1) and the value takes that share off its
 *   opacity. It follows no band and no detected hit: it is the flashing
 *   curve run on the music's counted beat (`subscribeMusicClock`), one minus
 *   the curve. It runs only while the matching is not off, and the attribute
 *   is set only while that clock HAS a beat (music playing, a tempo found):
 *   at any other moment the caret runs its own cycle.
 * - `--beat-edge`, the opacity of the active editor's beat edge
 *   (`.editor-beat-edge`, shown and promoted under `html[data-beat-edge]`).
 * - `--beat-pane`, the opacity of the editor pane (the box outlines' copy, `.editor-beat-pane.has-grid`
 *   in the edit view and over the visualizer scene; shown and promoted under `html[data-beat-pane]`).
 * - `--beat-wash`, the opacity of the reader pane (a flat wash where there is no grid,
 *   `.editor-beat-wash.is-shown` over each pane's texture; under `html[data-beat-wash]`).
 *
 * Outside the visualizer mode they follow the grid beat (`VisualizerSettings.grid`);
 * inside it, the mode's own edge and pane.
 *
 * An inverted block (a negative effect) rests at its full effect while music plays and a hit
 * takes it away; with nothing playing every block is off either way, so an
 * inverted one does not sit over the editor in silence. A block with no
 * effect subscribes nothing and keeps its ordinary look; the `<html>`
 * attributes change once when a block is switched, never per frame. The
 * layout's colours (`VisualizerColors`) are static between edits and are set once on
 * `<html>` (`--beat-edge-color`, `--beat-edge-spread`, `--beat-edge-blur`, `--beat-pane-color`).
 */

import { setGridWaveSettings } from '../visualizer/gridWaveTurn'
import { useEffect, useRef } from 'react'
import type { VisualizerChannel, VisualizerColors, VisualizerSettings } from '@thockdown/look/visualizer'
import type { BeatSettings } from '../shared/beatSettings'
import { musicPlayerService } from '../sound/MusicPlayerService'
import { setBeatVisualDelaySec, setBeatResponseHeadroomDb, setVisualizerTrackers, subscribeMusicClock, subscribeMusicMix, type FlashClock, type MusicClockSubscription } from '../sound/musicBeat'
import { useOutputDevice } from '../sound/outputDevice'
import { setLiveStyle } from '../shared/liveStyle'

type BlockName = 'edge' | 'pane' | 'wash'

type BlockSettings = VisualizerChannel

interface BlockSubscription<T> {
  update: (settings: T) => void
  unsubscribe: () => void
}

/** `present` says whether the block is showing (its `<html>` attribute); a band's is from the start. */
type Subscribe<T> = (settings: T, listener: (response: number) => void, present: (present: boolean) => void) => BlockSubscription<T>

const subscribeMix: Subscribe<VisualizerChannel> = (channel, listener, present) => {
  present(true)
  return subscribeMusicMix(channel, listener)
}

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
      // that can change a pixel is written, and nothing finer (setLiveStyle
      // skips a value equal to the last).
      const steps = Math.round(value * 255)
      setLiveStyle(variable, steps <= 0 ? null : (steps / 255).toFixed(4))
    }, (present) => root.toggleAttribute(attribute, present))
    subscriptionRef.current = subscription
    return () => {
      subscriptionRef.current = null
      subscription.unsubscribe()
      setLiveStyle(variable, null)
      root.removeAttribute(attribute)
    }
  }, [name, active, subscribeTo])

  useEffect(() => {
    subscriptionRef.current?.update(channel)
  }, [channel])
}

/** A block that shows nothing: the reader pane while the visualizer mode is up, where there is no reader view. */
const OFF_CHANNEL: VisualizerChannel = { effect: 0, mix: { thump: 0, pierce: 0, tick: 0 }, shape: 0, fallSec: 1 }

/**
 * The caret's matched flashing (`--beat-caret`, see the header): `flash` is
 * null while the matching is off. One subscription for as long as it is on;
 * a new curve or matching retunes it in place.
 */
function useFlashBeat(on: boolean, flash: FlashClock | null): void {
  const flashRef = useRef(flash)
  flashRef.current = flash
  const subscriptionRef = useRef<MusicClockSubscription | null>(null)
  const active = on && flash !== null
  useEffect(() => {
    if (!active || !flashRef.current) return
    const root = document.documentElement
    const subscription = subscribeMusicClock(flashRef.current, (response) => {
      // Quantized to the 1/255 an 8-bit colour channel resolves (as `useBeatBlock`).
      const steps = Math.round((musicPlayerService.isPlaying ? response : 0) * 255)
      setLiveStyle('--beat-caret', steps <= 0 ? null : (steps / 255).toFixed(4))
    }, (present) => root.toggleAttribute('data-beat-caret', present))
    subscriptionRef.current = subscription
    return () => {
      subscriptionRef.current = null
      subscription.unsubscribe()
      setLiveStyle('--beat-caret', null)
      root.removeAttribute('data-beat-caret')
    }
  }, [active])
  useEffect(() => {
    if (flash) subscriptionRef.current?.update(flash)
  }, [flash])
}

export function useBeatFeedback(enabled: boolean, settings: BeatSettings, visualizer: VisualizerSettings, colors: VisualizerColors, flash: FlashClock | null, isVisualizerMode: boolean, uiMode: 'light' | 'dark'): void {
  // Set before the blocks subscribe (effects run in order), so the first
  // analysis already listens to the trackers.
  const { trackers } = visualizer
  useEffect(() => setVisualizerTrackers(trackers), [trackers])
  useFlashBeat(enabled, flash)
  // The same two elements show the grid beat on the editor and the visualizer
  // mode's own edge and pane over its scene, each set of settings in its turn.
  const grid = visualizer.grid[uiMode]
  // `enabled` is the Grid Beat switch, which governs the editor's beat only:
  // the visualizer mode's edge and pane are its own and run there regardless.
  const blocksOn = enabled || isVisualizerMode
  const shownEdge = isVisualizerMode ? visualizer.edge : grid.edge
  useBeatBlock('edge', shownEdge, blocksOn, subscribeMix)
  useBeatBlock('pane', isVisualizerMode ? visualizer.pane[uiMode] : grid.editorPane, blocksOn, subscribeMix)
  useBeatBlock('wash', isVisualizerMode ? OFF_CHANNEL : grid.readerPane, blocksOn, subscribeMix)
  const edgeSpreadPx = shownEdge.spreadPx
  const edgeBlurPx = shownEdge.blurPx
  const { edge: edgeColor, pane: paneColor, wave: waveColor, pulse: pulseColor, accent: accentColor, letterbox: letterboxColor } = colors
  const { waveBoxes, waveBeats, waveTurn, pulseSpeed, pulseHalfLifeSec, pulseFadeSec, pulseSoftness, pulseBoost, cutoutRound, waveShape, waveFallSec, waveMix, glazeMix, swayPush, pulseMix } = visualizer.immersive
  const { shape: edgeShape, fallSec: edgeFallSec } = visualizer.edge
  useEffect(() => setGridWaveSettings({ waveTurn, waveBoxes, waveBeats, pulseSpeed, pulseHalfLifeSec, pulseFadeSec, waveShape, waveFallSec, waveMix, glazeMix, glazePushes: swayPush !== 0, pulseMix, edgeShape, edgeFallSec, cutoutRound, pulseColor, pulseSoftness, pulseBoost }), [waveTurn, waveBoxes, waveBeats, pulseSpeed, pulseHalfLifeSec, pulseFadeSec, waveShape, waveFallSec, waveMix, glazeMix, swayPush, pulseMix, edgeShape, edgeFallSec, cutoutRound, pulseColor, pulseSoftness, pulseBoost])
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--beat-edge-color', edgeColor)
    root.setProperty('--beat-edge-spread', `${edgeSpreadPx}px`)
    root.setProperty('--beat-edge-blur', `${edgeBlurPx}px`)
    root.setProperty('--beat-pane-color', paneColor)
    root.setProperty('--visualizer-wave-color', waveColor)
    root.setProperty('--visualizer-wave-boxes', String(waveBoxes))
    root.setProperty('--visualizer-pulse-color', pulseColor)
    // Empty means "follow the theme": the property is removed so the CSS
    // fallback (the caret, the zone colours) applies.
    if (accentColor) root.setProperty('--visualizer-accent-color', accentColor)
    else root.removeProperty('--visualizer-accent-color')
    if (letterboxColor) root.setProperty('--visualizer-letterbox-color', letterboxColor)
    else root.removeProperty('--visualizer-letterbox-color')
  }, [edgeColor, edgeSpreadPx, edgeBlurPx, paneColor, waveColor, waveBoxes, pulseColor, accentColor, letterboxColor])
  const device = useOutputDevice(blocksOn)
  const delayMs = settings.delayMsByDevice[device] ?? 0
  useEffect(() => setBeatVisualDelaySec(delayMs / 1000), [delayMs])
  useEffect(() => setBeatResponseHeadroomDb(settings.responseDb), [settings.responseDb])
}
