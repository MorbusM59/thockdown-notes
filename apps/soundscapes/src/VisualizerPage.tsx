/**
 * The visualizer page: the desktop's visualizer scene (`@thockdown/visualizer`)
 * full screen over the app, reading the NATIVE music (mobileMusicPlayer.ts
 * installs nativeMusicListening.ts) and showing the music pool's songs.
 *
 * Opening it starts the music if nothing plays, from the active sets. The
 * system's back gesture leaves it for the tab it was opened from; the music
 * plays on.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBeatGridMirror } from '@thockdown/visualizer/beat/useBeatGridMirror'
import { liveStyleTarget } from '@thockdown/visualizer/shared/liveStyle'
import { VisualizerScene } from '@thockdown/visualizer/visualizer/VisualizerScene'
import '@thockdown/visualizer/visualizer/visualizer.css'
import { useBeatFeedback } from '@thockdown/visualizer/beat/useBeatFeedback'
import type { BeatSettings } from '@thockdown/visualizer/shared/beatSettings'
import type { VisualizerColors, VisualizerSettings } from '@thockdown/look/visualizer'
import { setDisplayScale, setVisualizerOpen } from './display'
import { startMusic } from './mobileMusicPlayer'
import { measureVisualizerFrameRate } from './visualizerFrameRate'
import type { PhoneVisualizerFont } from './visualizerStore'
import { nativeSoundscape } from './backgroundAudioHost'
import { holdFrameWhileTyping } from './keyboardSteadyFrame'

export function VisualizerPage({ onExit, colors, mode, visualizer, beatSettings, font }: {
  onExit: () => void
  colors: VisualizerColors
  mode: 'light' | 'dark'
  visualizer: VisualizerSettings
  beatSettings: BeatSettings
  font: PhoneVisualizerFont
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
  useEffect(() => {
    // Drawn at the screen's full resolution: the scene's shaders hold the frame rate there.
    void setDisplayScale(1)
    void setVisualizerOpen(true)
    void startMusic()
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
  useEffect(() => holdFrameWhileTyping(pageRef.current!), [])
  return (
    <div ref={pageRef} className="visualizer-page">
      <div className="editor-stage is-visualizer">
      <VisualizerScene
        boxPx={font.boxPx}
        fontFamily={font.family}
        fontSizePx={font.sizePx}
        solidMaxPixelRatio={1.5}
        pixelScale={1}
        sceneSeed="soundscapes"
        gridOutlineRef={gridRef}
        onExit={onExit}
      />
      </div>
      <div ref={beatEdgeRef} className="editor-beat-edge" aria-hidden="true" />
      <div ref={setBeatPaneEl} className={`editor-beat-pane${hasGrid ? ' has-grid' : ''}`} aria-hidden="true" />
    </div>
  )
}
