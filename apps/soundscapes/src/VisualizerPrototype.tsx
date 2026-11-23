/**
 * PROTOTYPE: the desktop visualizer scene (`@thockdown/visualizer`) on the
 * phone, to measure what it costs there before the real music page is built.
 *
 * Songs are picked with the system file picker and played IN THE WEBVIEW by
 * the desktop's own Web Audio player, from blob: URLs. That is deliberate and
 * temporary: the scene is only on screen while the app is in front, so the
 * WebView's audio stall on an app switch does not touch what is measured. The
 * real page plays music natively in the service (see the design plan).
 *
 * A readout in the corner gives the frame time over the last two seconds
 * (median and 95th percentile) and how many frames took longer than 1.5x the
 * display's own frame, the units a stutter is felt in.
 */
import { runVisualizerProfile } from './visualizerProfile'
import { nextDisplayScale, readDisplay, setDisplayScale, setLandscape, setVisualizerOpen } from './display'
import { useEffect, useRef, useState } from 'react'
import { VisualizerScene } from '@thockdown/visualizer/visualizer/VisualizerScene'
import { musicPlayerService } from '@thockdown/visualizer/sound/MusicPlayerService'
import { publishNowPlaying, readNowPlaying } from '@thockdown/visualizer/sound/nowPlaying'
import type { MusicSongEntry } from '@thockdown/visualizer/shared/audioPlayer'
import '@thockdown/visualizer/visualizer/visualizer.css'
import { useBeatFeedback } from '@thockdown/visualizer/beat/useBeatFeedback'
import { DEFAULT_BEAT_SETTINGS } from '@thockdown/visualizer/shared/beatSettings'
import { DEFAULT_VISUALIZER, type VisualizerColors } from '@thockdown/look/visualizer'

type Picked = { url: string; name: string }

function entryOf(file: Picked, index: number): MusicSongEntry {
  return {
    id: index + 1, filePath: file.url, setIds: [], priority: 1, favorability: 5,
    title: file.name.replace(/\.[^.]+$/, ''), artist: '', album: '', durationSec: 0,
  }
}

function FrameReadout({ scale, setScale }: { scale: number; setScale: (scale: number) => void }) {
  const [text, setText] = useState('')
  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let times: number[] = []
    let shown = last
    const tick = (now: number) => {
      times.push(now - last)
      last = now
      if (now - shown > 2000 && times.length > 10) {
        const sorted = [...times].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        const p95 = sorted[Math.floor(sorted.length * 0.95)]
        const late = times.filter((t) => t > median * 1.5).length
        setText(`${median.toFixed(1)} | ${p95.toFixed(1)} ms | ${late}/${times.length}`)
        times = []
        shown = now
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  // A tap steps the x n mode (display.ts), so its cost can be read
  // off this readout as it changes.
  return (
    <button
      type="button"
      className="visualizer-prototype-readout"
      style={{ fontSize: 12 / scale }}
      onClick={() => {
        const next = nextDisplayScale(scale)
        setScale(next)
        void setDisplayScale(next)
      }}
    >
      {`x${scale} | ${text}`}
    </button>
  )
}

export function VisualizerPrototype({ onExit, colors, mode }: { onExit: () => void; colors: VisualizerColors; mode: 'light' | 'dark' }) {
  // The desktop's factory visualizer settings and the look preset's own
  // colours, fed exactly as the desktop feeds them.
  useBeatFeedback(true, DEFAULT_BEAT_SETTINGS, DEFAULT_VISUALIZER, colors, null, true, mode)
  const [songs, setSongs] = useState<Picked[]>([])
  const [scale, setScale] = useState(1)
  const [landscape, setLandscapeState] = useState(false)
  // The profiling run (visualizerProfile.ts): the step running, then the report.
  const [profileStep, setProfileStep] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)
  useEffect(() => {
    void setVisualizerOpen(true)
    return () => { void setVisualizerOpen(false) }
  }, [])
  useEffect(() => {
    void readDisplay().then((display) => {
      setScale(display.scale)
      setLandscapeState(display.landscape)
    })
  }, [])
  const indexRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (songs.length === 0) return
    const play = (index: number) => {
      indexRef.current = (index + songs.length) % songs.length
      const song = songs[indexRef.current]
      publishNowPlaying({ ...readNowPlaying(), song: entryOf(song, indexRef.current), jumpSong })
      void musicPlayerService.play(song.url)
    }
    const jumpSong = (direction: -1 | 1) => play(indexRef.current + direction)
    musicPlayerService.onEnded(() => play(indexRef.current + 1))
    play(0)
    return () => { musicPlayerService.stop() }
  }, [songs])

  useEffect(() => () => { for (const song of songs) URL.revokeObjectURL(song.url) }, [songs])

  return (
    <div className="visualizer-prototype">
      <div className="visualizer-prototype-stage editor-stage is-visualizer">
      {songs.length === 0 ? (
        <div className="visualizer-prototype-pick">
          <button type="button" className="btn-icon options-color-swatch options-loadout-btn" onClick={() => inputRef.current?.click()}>
            <i className="fa-solid fa-music" aria-hidden="true" />
          </button>
          <button type="button" className="btn-icon options-color-swatch options-loadout-btn" onClick={onExit}>
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              // No accept filter: with audio/* Android's picker offers only files the
              // media index has tagged as audio, which can be none at all.
              const files = [...(event.target.files ?? [])]
              setSongs(files.map((file) => ({ url: URL.createObjectURL(file), name: file.name })))
            }}
          />
        </div>
      ) : (
        <VisualizerScene
          boxPx={18}
          fontFamily="'Kode Mono', monospace"
          fontSizePx={14}
          solidMaxPixelRatio={1.5}
          pixelScale={scale}
          sceneSeed="soundscapes"
          gridOutlineRef={() => {}}
          onExit={onExit}
        />
      )}
      </div>
      <FrameReadout scale={scale} setScale={setScale} />
      {songs.length > 0 && (
        <button
          type="button"
          className="visualizer-prototype-readout visualizer-prototype-profile"
          style={{ fontSize: 12 / scale }}
          disabled={profileStep !== null}
          onClick={() => {
            setProfileStep('starting')
            void runVisualizerProfile(scale, setProfileStep).then((text) => {
              setProfileStep(null)
              setReport(text)
            })
          }}
        >
          {profileStep ?? <i className="fa-solid fa-stopwatch" aria-hidden="true" />}
        </button>
      )}
      {report !== null && (
        <div className="visualizer-prototype-report" style={{ fontSize: 12 / scale }}>
          <textarea readOnly value={report} />
          <button type="button" onClick={() => { void navigator.clipboard.writeText(report) }}>Copy</button>
          <button type="button" onClick={() => setReport(null)}>Close</button>
        </div>
      )}
      {/* The visualizer's orientation switch: it turns only when this is pressed. */}
      <button
        type="button"
        className="visualizer-prototype-readout visualizer-prototype-orientation"
        style={{ fontSize: 12 / scale }}
        onClick={() => {
          setLandscapeState(!landscape)
          void setLandscape(!landscape)
        }}
      >
        <i className={`fa-solid ${landscape ? 'fa-mobile-screen-button fa-rotate-90' : 'fa-mobile-screen-button'}`} aria-hidden="true" />
      </button>
    </div>
  )
}
