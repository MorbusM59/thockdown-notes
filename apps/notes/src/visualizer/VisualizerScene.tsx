/**
 * The visualizer mode's scene (F3), drawn over the active slot in place of
 * its note: a grid of square boxes framing the empty scene's tumbling solid,
 * the music's spectrum along the bottom and what is playing along the top.
 * Where everything goes is `visualizerLayout.ts`; what the spectrum shows is
 * `spectrumBands.ts` and `spectrumTap.ts`; the glaze's sway is
 * `parallaxSway.ts`, moved from this scene's frame loop because this is
 * where the music is read.
 *
 * Colours are the editor's own: the top strip on the top area's box
 * background, the spectrum strip on the bottom area's, the middle and every
 * letter's box on the regular one, and lit boxes (spectrum bars, peaks, the
 * progress track) in the caret's box colour. The grid lines are the editor's
 * own two layers at a square pitch, and the outline layer is what the beat
 * pane copies (`gridOutlineRef`), so the beat's grid flash lands on these
 * boxes.
 *
 * ONE FRAME LOOP, while the scene is mounted: it reads the analysers, moves
 * the bars, draws them into one canvas only when a box actually changed,
 * says when the playhead crosses into another box (the gap itself is state,
 * so React draws it and a re-render cannot leave it stale),
 * and sways the glaze. With the OS asking for reduced motion the glaze holds
 * still, and once the music is stopped and every bar has fallen the loop
 * stops altogether until the music plays again. A hidden window gets no
 * animation frames at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { musicPlayerService } from '../sound/MusicPlayerService'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'
import { songAlbumText, songArtistText, songTitleText } from '../shared/audioPlayer'
import { SpectrumBallistics, litRows } from './spectrumBands'
import { SpectrumTap } from './spectrumTap'
import { MusicBreath, applySway, breathScales, swayAmplitudePx } from './parallaxSway'
import {
  computeVisualizerLayout,
  creditsLine,
  type RowText,
  fitToRow,
  playheadColumn,
  progressPress,
  trackSpan,
  type VisualizerLayout,
} from './visualizerLayout'

/** The empty state's diameter (`--circle-diameter`, editor.css), which the cutout matches. */
const EMPTY_SCENE_DIAMETER_PX = 220
/**
 * The scene's boxes are as wide as the editor's would be with this much
 * x-box padding, whatever the reader's own x-box setting, and as tall as
 * they are wide.
 */
export const VISUALIZER_GLYPH_SIDE_GAP_PX = 4
/** The longest step a frame may take, so a frame after a stall does not drop every bar at once. */
const MAX_FRAME_SEC = 0.1

export type VisualizerSceneProps = {
  /** The scene's box: the editor's box width at the reader's font, at `VISUALIZER_GLYPH_SIDE_GAP_PX` of x-box padding; this wide and this tall. */
  boxPx: number
  fontFamily: string
  fontSizePx: number
  /** The empty scene's mask (EmptyStateScene.ts), the same image the slot's empty state shows. */
  sceneMaskUrl: string
  /** A press on the cutout rerolls the solid, as a press on the empty state does. */
  onCutoutClick: () => void
  /** The grid outline layer, for the beat pane's copy (useBeatGridMirror.ts). */
  gridOutlineRef: (element: HTMLDivElement | null) => void
}

/** The lit runs of the track: all of it, or the boxes before and after `gap`. */
function trackRuns(track: { first: number; count: number }, gap: number | null): Array<{ first: number; count: number }> {
  const end = track.first + track.count
  const runs = gap === null || gap < track.first || gap >= end
    ? [track]
    : [{ first: track.first, count: gap - track.first }, { first: gap + 1, count: end - gap - 1 }]
  return runs.filter((run) => run.count > 0)
}

function useBoxSize(element: HTMLElement | null): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return size
}

/** Boxes behind one row's runs of text: one per character, a space's included. */
function LetterBoxes({ runs, row, layout }: { runs: RowText[]; row: number; layout: VisualizerLayout }) {
  const { boxPx, originXPx, originYPx } = layout
  return (
    <>
      {runs.map((run) => (
        <div
          key={run.column}
          className="visualizer-letter-box"
          style={{ left: originXPx + run.column * boxPx, top: originYPx + row * boxPx, width: Array.from(run.text).length * boxPx, height: boxPx }}
        />
      ))}
    </>
  )
}

function Letters({ runs, row, layout }: { runs: RowText[]; row: number; layout: VisualizerLayout }) {
  const { boxPx, originXPx, originYPx } = layout
  return (
    <>
      {runs.flatMap((run) => Array.from(run.text).map((char, index) => (char === ' ' ? null : (
        <div
          key={run.column + index}
          className="visualizer-letter"
          style={{ left: originXPx + (run.column + index) * boxPx, top: originYPx + row * boxPx, width: boxPx, height: boxPx, lineHeight: `${boxPx}px` }}
        >
          {char}
        </div>
      ))))}
    </>
  )
}

export function VisualizerScene({ boxPx, fontFamily, fontSizePx, sceneMaskUrl, onCutoutClick, gridOutlineRef }: VisualizerSceneProps) {
  const [scene, setScene] = useState<HTMLDivElement | null>(null)
  const { width, height } = useBoxSize(scene)
  const layout = useMemo(() => computeVisualizerLayout(width, height, boxPx, EMPTY_SCENE_DIAMETER_PX), [width, height, boxPx])
  const { columns, originXPx, originYPx, stripRows, spectrumTopRow, cutout } = layout

  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const titleText = nowPlaying.song ? fitToRow(songTitleText(nowPlaying.song), columns) : ''
  const title: RowText[] = titleText.length > 0 ? [{ column: 0, text: titleText }] : []
  const credits = nowPlaying.song ? creditsLine(songArtistText(nowPlaying.song), songAlbumText(nowPlaying.song), columns) : []

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [gapColumn, setGapColumn] = useState<number | null>(null)

  // The frame loop. Rebuilt when the layout changes, since the number of
  // bands is the number of columns and the canvas is sized to the strip.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!scene || columns <= 0) return
    const tap = stripRows > 0 ? new SpectrumTap(columns) : null
    tap?.start()
    const meter = new SpectrumBallistics(columns)
    const levels = new Float32Array(columns)
    const drawnLit = new Int16Array(columns).fill(-1)
    const drawnPeak = new Int16Array(columns).fill(-1)
    const breath = new MusicBreath()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const context = canvas?.getContext('2d') ?? null
    const dpr = window.devicePixelRatio || 1
    if (canvas) {
      canvas.width = Math.round(columns * boxPx * dpr)
      canvas.height = Math.round(stripRows * boxPx * dpr)
    }

    // The caret's colour, read off the shell and again whenever the shell's
    // variables are rewritten (a layout change), never per frame.
    const shell = scene.closest<HTMLElement>('.app-shell') ?? scene
    let caretColor = ''
    const readColor = () => {
      caretColor = getComputedStyle(scene).getPropertyValue('--color-caret').trim()
      drawnLit.fill(-1)
    }
    readColor()
    const restyle = new MutationObserver(readColor)
    restyle.observe(shell, { attributes: true, attributeFilter: ['style'] })

    let amplitudePx = swayAmplitudePx(window.innerWidth, window.innerHeight)
    const onResize = () => { amplitudePx = swayAmplitudePx(window.innerWidth, window.innerHeight) }
    window.addEventListener('resize', onResize)

    // The gap is React's to draw (`gapColumn`); the loop only says when the
    // playhead has crossed into another box, which is seconds apart.
    const moveGap = () => {
      const duration = musicPlayerService.currentDurationSec
      setGapColumn(readNowPlaying().song ? playheadColumn(columns, musicPlayerService.currentTime, duration) : null)
    }

    const draw = () => {
      if (!context || !canvas) return
      let changed = false
      for (let band = 0; band < columns; band += 1) {
        const lit = litRows(meter.levels[band], stripRows)
        const peak = litRows(meter.peaks[band], stripRows)
        if (lit !== drawnLit[band] || peak !== drawnPeak[band]) {
          changed = true
          drawnLit[band] = lit
          drawnPeak[band] = peak
        }
      }
      if (!changed) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, columns * boxPx, stripRows * boxPx)
      context.fillStyle = caretColor
      for (let band = 0; band < columns; band += 1) {
        const lit = drawnLit[band]
        const x = band * boxPx
        if (lit > 0) context.fillRect(x, (stripRows - lit) * boxPx, boxPx, lit * boxPx)
        // The peak box, where it stands above the bar.
        const peak = drawnPeak[band]
        if (peak > lit) context.fillRect(x, (stripRows - peak) * boxPx, boxPx, boxPx)
      }
    }

    let frame: number | null = null
    let lastMs = NaN
    let phaseSec = 0
    const tick = (nowMs: number) => {
      frame = null
      const dt = Number.isNaN(lastMs) ? 0 : Math.min(MAX_FRAME_SEC, (nowMs - lastMs) / 1000)
      lastMs = nowMs
      if (tap) {
        tap.sample(nowMs / 1000, levels)
        meter.step(levels, dt)
        draw()
      }
      moveGap()
      const still = reducedMotion.matches
      const { amplitude, speed } = breathScales(breath.step(tap ? tap.bassPower(levels) : 0, dt))
      if (!still) {
        phaseSec += dt * speed
        applySway(phaseSec, amplitudePx * amplitude)
      }
      // Nothing left to move: the music is stopped, the bars have fallen and
      // the glaze holds still. Woken again by the music or the motion setting.
      if (still && !musicPlayerService.isPlaying && meter.isAtRest()) {
        lastMs = NaN
        return
      }
      frame = requestAnimationFrame(tick)
    }
    const wake = () => {
      if (frame === null) frame = requestAnimationFrame(tick)
    }
    wake()
    const unsubscribePlaying = musicPlayerService.subscribePlaying(wake)
    const unsubscribeSong = subscribeNowPlaying(wake)
    reducedMotion.addEventListener('change', wake)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      tap?.stop()
      restyle.disconnect()
      window.removeEventListener('resize', onResize)
      unsubscribePlaying()
      unsubscribeSong()
      reducedMotion.removeEventListener('change', wake)
    }
  }, [scene, columns, stripRows, boxPx])

  const handleProgressPress = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const column = Math.floor((event.clientX - rect.left) / boxPx)
    const press = progressPress(columns, column)
    if (press.kind === 'previous') readNowPlaying().jumpSong(-1)
    else if (press.kind === 'next') readNowPlaying().jumpSong(1)
    else if (press.kind === 'seek') void musicPlayerService.setCurrentTimeFraction(press.fraction)
  }, [boxPx, columns])

  const box = boxPx
  // The cutout covers the inside of its boxes: a box's first pixel row and
  // column are the grid line it shares with the box before, so the cutout
  // starts one pixel in and is one pixel smaller, leaving that line drawn.
  const cutoutRect = {
    left: originXPx + cutout.column * box + 1,
    top: originYPx + cutout.row * box + 1,
    size: Math.max(0, cutout.size * box - 1),
  }
  // The outline grid has a hole where the cutout is, so the beat pane's
  // copy of it (useBeatGridMirror.ts, drawn above the scene) leaves the
  // cutout alone.
  const cutoutHole: CSSProperties = cutout.size > 0 ? {
    maskImage: 'linear-gradient(#000, #000), linear-gradient(#000, #000)',
    maskSize: `100% 100%, ${cutoutRect.size}px ${cutoutRect.size}px`,
    maskPosition: `0 0, ${cutoutRect.left}px ${cutoutRect.top}px`,
    maskRepeat: 'no-repeat',
    maskComposite: 'exclude',
  } : {}
  const track = trackSpan(columns)
  const rowTop = (row: number) => originYPx + row * box
  const style = {
    '--editor-cell-width': `${box}px`,
    '--editor-line-height': `${box}px`,
    '--visualizer-font': fontFamily,
    '--visualizer-font-size': `${fontSizePx}px`,
  } as CSSProperties

  return (
    <div ref={setScene} className="visualizer-scene" tabIndex={-1} data-visualizer-scene="" style={style}>
      {width > 0 && (
        <>
          <div className="visualizer-strip is-top" style={{ height: rowTop(stripRows) }} />
          <div className="visualizer-strip is-middle" style={{ top: rowTop(stripRows), height: rowTop(spectrumTopRow) - rowTop(stripRows) }} />
          <div className="visualizer-strip is-bottom" style={{ top: rowTop(spectrumTopRow) }} />

          {layout.progressRow !== null && columns >= 2 && (
            <>
              <div className="visualizer-lit" style={{ left: originXPx, top: rowTop(layout.progressRow), width: box, height: box }} />
              {/* The track is drawn as the lit runs either side of the
                  playhead's box, so that box is truly missing: painting the
                  strip's colour over a lit track let the caret colour show
                  through wherever the strip's colour is translucent. */}
              {trackRuns(track, gapColumn).map((run) => (
                <div key={run.first} className="visualizer-lit" style={{ left: originXPx + run.first * box, top: rowTop(layout.progressRow!), width: run.count * box, height: box }} />
              ))}
              <div className="visualizer-lit" style={{ left: originXPx + (columns - 1) * box, top: rowTop(layout.progressRow), width: box, height: box }} />
            </>
          )}
          {layout.titleRow !== null && <LetterBoxes runs={title} row={layout.titleRow} layout={layout} />}
          {layout.creditsRow !== null && <LetterBoxes runs={credits} row={layout.creditsRow} layout={layout} />}

          {stripRows > 0 && (
            <canvas
              ref={canvasRef}
              className="visualizer-spectrum"
              style={{ left: originXPx, top: rowTop(spectrumTopRow), width: columns * box, height: stripRows * box }}
            />
          )}

          <div
            ref={gridOutlineRef}
            className="visualizer-grid thockdown-grid-outline-lines"
            style={{ backgroundPosition: `${originXPx - 1}px ${originYPx - 1}px`, ...cutoutHole }}
          />
          <div className="visualizer-grid thockdown-grid-lines" style={{ backgroundPosition: `${originXPx}px ${originYPx}px`, zIndex: 4 }} />

          {layout.titleRow !== null && <Letters runs={title} row={layout.titleRow} layout={layout} />}
          {layout.creditsRow !== null && <Letters runs={credits} row={layout.creditsRow} layout={layout} />}

          {layout.progressRow !== null && (
            <div
              className="visualizer-progress-hit"
              style={{ left: originXPx, top: rowTop(layout.progressRow), width: columns * box, height: box }}
              onPointerDown={handleProgressPress}
            />
          )}

          {cutout.size > 0 && (
            <div
              className="visualizer-cutout"
              style={{
                left: cutoutRect.left,
                top: cutoutRect.top,
                width: cutoutRect.size,
                height: cutoutRect.size,
                '--empty-state-scene-mask': sceneMaskUrl,
              } as CSSProperties}
              onClick={onCutoutClick}
            />
          )}
        </>
      )}
    </div>
  )
}
