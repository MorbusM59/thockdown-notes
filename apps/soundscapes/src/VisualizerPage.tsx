/**
 * The visualizer page: the desktop's visualizer scene (`@thockdown/visualizer`)
 * full screen over the app, reading the NATIVE music (mobileMusicPlayer.ts
 * installs nativeMusicListening.ts) and showing the music pool's songs.
 *
 * Opening it plays nothing by itself: music starts from a song pressed in
 * its song list, or from the dashboard. The system's back gesture leaves it
 * for the tab it was opened from (so the scene draws no exit box); the music
 * plays on.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBeatGridMirror } from '@thockdown/visualizer/beat/useBeatGridMirror'
import { liveStyleTarget } from '@thockdown/visualizer/shared/liveStyle'
import { VisualizerScene } from '@thockdown/visualizer/visualizer/VisualizerScene'
import type { OrbGestures } from '@thockdown/visualizer/visualizer/orbGestures'
import { useBeatFeedback } from '@thockdown/visualizer/beat/useBeatFeedback'
import type { BeatSettings } from '@thockdown/visualizer/shared/beatSettings'
import type { VisualizerColors, VisualizerSettings } from '@thockdown/look/visualizer'
import { setDisplayScale, setVisualizerOpen } from './display'
import { measureVisualizerFrameRate } from './visualizerFrameRate'
import { visualizerBoxPx, visualizerFontForMode, type VisualizerFont } from '@thockdown/visualizer/shared/visualizerFont'
import { monoFontFamily } from '@thockdown/visualizer/visualizer/visualizerFonts'
import { nativeSoundscape } from './backgroundAudioHost'
import { holdFrameWhileTyping } from './keyboardSteadyFrame'

export function VisualizerPage({ onExit, colors, mode, visualizer, beatSettings, font, double, orbGestures }: {
  onExit: () => void
  colors: VisualizerColors
  mode: 'light' | 'dark'
  visualizer: VisualizerSettings
  beatSettings: BeatSettings
  font: VisualizerFont
  /** Double size: boxes and letters at twice the font setting's (visualizerStore.ts). */
  double: boolean
  /** What a finger on the orb does (MobileSoundscapeApp's `orbGestures`). */
  orbGestures: OrbGestures
}) {
  // The phone's visualizer and beat settings (visualizerStore.ts) and the
  // look preset's own colors, fed exactly as the desktop feeds them.
  useBeatFeedback(true, beatSettings, visualizer, colors, null, true, mode)
  // The beat's EDGE and PANE, as the desktop's editor shell draws them over
  // its scene (SectionEditorArea.tsx): the edge reads --beat-edge, the pane
  // --beat-pane and is a copy of the scene's grid outline (useBeatGridMirror).
  const [beatEdgeRef] = useState(() => liveStyleTarget<HTMLDivElement>({ current: null }, ['--beat-edge']))
  const [beatPaneRef] = useState(() => liveStyleTarget<HTMLDivElement>({ current: null }, ['--beat-pane']))
  const { gridRef, mirrorRef, hasGrid } = useBeatGridMirror(true)
  const setBeatPaneEl = useCallback((el: HTMLDivElement | null) => {
    beatPaneRef(el)
    mirrorRef(el)
  }, [beatPaneRef, mirrorRef])
  // Double size draws the page at half the screen's resolution and scales it
  // up 2x, a quarter of the pixels (MainActivity's x n mode), as the desktop's
  // window zoom doubles its page; the font is halved inside it.
  useEffect(() => { void setDisplayScale(double ? 2 : 1) }, [double])
  useEffect(() => {
    void setVisualizerOpen(true)
    const stopMeasuring = measureVisualizerFrameRate()
    return () => {
      stopMeasuring()
      void setVisualizerOpen(false)
    }
  }, [])
  // The back gesture leaves the visualizer rather than the app.
  useEffect(() => {
    if (!nativeSoundscape) return undefined
    void nativeSoundscape.takeBack({ taken: true })
    const handle = nativeSoundscape.addListener('back', onExit)
    return () => {
      void nativeSoundscape!.takeBack({ taken: false })
      void handle.then((h) => h.remove())
    }
  }, [onExit])
  // The keyboard must not relayout the scene (keyboardSteadyFrame.ts).
  const pageRef = useRef<HTMLDivElement | null>(null)
  const pageFont = visualizerFontForMode(font, double)
  useEffect(() => holdFrameWhileTyping(pageRef.current!), [])
  return (
    <div ref={pageRef} className="visualizer-page">
      <div className="editor-stage is-visualizer">
      <VisualizerScene
        boxPx={visualizerBoxPx(pageFont)}
        fontFamily={monoFontFamily(font.style)}
        fontSizePx={pageFont.sizePx}
        pixelScale={double ? 2 : 1}
        solidMaxPixelRatio={1.5}
        sceneSeed="soundscapes"
        gridOutlineRef={gridRef}
        orbGestures={orbGestures}
      />
      </div>
      <div ref={beatEdgeRef} className="editor-beat-edge" aria-hidden="true" />
      <div ref={setBeatPaneEl} className={`editor-beat-pane${hasGrid ? ' has-grid' : ''}`} aria-hidden="true" />
    </div>
  )
}
