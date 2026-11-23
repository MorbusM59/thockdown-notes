/**
 * The visualizer page: the desktop's visualizer scene (`@thockdown/visualizer`)
 * full screen over the app, reading the NATIVE music (mobileMusicPlayer.ts
 * installs nativeMusicListening.ts) and showing the music pool's songs.
 *
 * Opening it starts the music if nothing plays, from the active sets. The
 * system's back gesture leaves it for the tab it was opened from; the music
 * plays on.
 */
import { useEffect } from 'react'
import { VisualizerScene } from '@thockdown/visualizer/visualizer/VisualizerScene'
import '@thockdown/visualizer/visualizer/visualizer.css'
import { useBeatFeedback } from '@thockdown/visualizer/beat/useBeatFeedback'
import type { BeatSettings } from '@thockdown/visualizer/shared/beatSettings'
import type { VisualizerColors, VisualizerSettings } from '@thockdown/look/visualizer'
import { setDisplayScale, setVisualizerOpen } from './display'
import { startMusic } from './mobileMusicPlayer'
import { nativeSoundscape } from './backgroundAudioHost'

export function VisualizerPage({ onExit, colors, mode, visualizer, beatSettings }: {
  onExit: () => void
  colors: VisualizerColors
  mode: 'light' | 'dark'
  visualizer: VisualizerSettings
  beatSettings: BeatSettings
}) {
  // The phone's visualizer and beat settings (visualizerStore.ts) and the
  // look preset's own colors, fed exactly as the desktop feeds them.
  useBeatFeedback(true, beatSettings, visualizer, colors, null, true, mode)
  useEffect(() => {
    // Drawn at the screen's full resolution: the scene's shaders hold the frame rate there.
    void setDisplayScale(1)
    void setVisualizerOpen(true)
    void startMusic()
    return () => { void setVisualizerOpen(false) }
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
  return (
    <div className="visualizer-page editor-stage is-visualizer">
      <VisualizerScene
        boxPx={18}
        fontFamily="'Kode Mono', monospace"
        fontSizePx={14}
        solidMaxPixelRatio={1.5}
        pixelScale={1}
        sceneSeed="soundscapes"
        gridOutlineRef={() => {}}
        onExit={onExit}
      />
    </div>
  )
}
