/**
 * The visualizer mode's scene (F3), drawn over the active slot in place of
 * its note: a grid of square boxes framing the empty scene's tumbling solid,
 * the music's spectrum along the bottom, its estimated semitone notes above it and
 * what is playing along the top. Where everything goes is
 * `visualizerLayout.ts`; the spectrum reads `spectrumBands.ts` and
 * `spectrumTap.ts`, while the time-indexed semitone score is prepared by
 * `musicSemitoneScore.ts`; the glaze's sway is
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
 * ONE FRAME LOOP, while the scene is mounted: it reads the spectrum
 * analysers and latest semitone score, moves the bars and key lights, draws
 * them into canvases only when a box actually changed,
 * says when the playhead crosses into another box (the gap itself is state,
 * so React draws it and a re-render cannot leave it stale),
 * and sways the glaze. With the OS asking for reduced motion the glaze holds
 * still, and once the music is stopped and every bar has fallen the loop
 * stops altogether until the music plays again. A hidden window gets no
 * animation frames at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { musicPlayerService } from '../sound/MusicPlayerService'
import { subscribeMusicMix, subscribeMusicSemitoneScore } from '../sound/musicBeat'
import { MUSIC_SEMITONE_CONFIRM_SEC } from '../sound/musicSemitoneScore'
import { readNowPlaying, subscribeNowPlaying } from '../sound/nowPlaying'
import { songAlbumText, songArtistText, songTitleText } from '../shared/audioPlayer'
import {
  SemitoneActivityFilter,
  SemitoneFade,
  SpectrumBallistics,
  litRows,
  semitoneLoudnessOffsetDb,
  semitoneShare,
} from './spectrumBands'
import { SpectrumTap } from './spectrumTap'
import { GridWave } from './GridWave'
import { SongList } from './SongList'
import { readPanelsShown, subscribePanelsShown } from './panelsShown'
import { readMusicEqPreset, stepMusicEqPreset, subscribeMusicEqPreset } from '../sound/musicEqPreset'
import { MUSIC_EQ_PRESETS } from '../shared/musicEqPresets'
import { solidSeed } from '../editor/EmptyStateScene'
import { BucketList } from './BucketList'
import { PoolFilter } from './PoolFilter'
import { LevelBars } from './LevelBars'
import { ThemeArrows } from './ThemeArrows'
import { TabHint } from './TabHint'
import { CursorIdle } from './CursorIdle'
import { dropWideGlyphs } from './cellGlyphs'
import { pulseAmount, subscribePulseHits } from './pulseHits'
import { SolidCanvas, type SolidThump } from '../editor/SolidCanvas'
import { readGridWaveSettings, subscribeGridWaveSettings } from './gridWaveTurn'
import { useBoxBevelImages } from '../shared/boxBevelStore'
import { cutoutClosure, gridOutlineMask, type CutoutRing } from './cutoutRing'
import { MusicBreath, applySway, breathScales } from './parallaxSway'
import {
  computeVisualizerLayout,
  creditsLine,
  type RowText,
  fitToRow,
  playheadColumn,
  progressPress,
  songListArea,
  bucketListArea,
  poolFilterArea,
  levelBarsArea,
  trackSpan,
  type VisualizerLayout,
} from './visualizerLayout'

/** The empty state's diameter (`--circle-diameter`, editor.css), which the cutout matches. */
const EMPTY_SCENE_DIAMETER_PX = 220
/** Empty boxes between the screen edge and the top strip's rows, on each side. */
const TOP_ROW_INSET_BOXES = 1

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
  /** The empty scene's seed (EmptyStateScene.ts), whose tumble the cutout's solid takes; the solid itself names the music's EQ preset. */
  sceneSeed: string
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

/** How much the centre solid grows on a hit: from 100% to 110%. */
const THUMP_SCALE = 0.1
/**
 * The solid's thump: on each hit the centre pulse sets off on (the edge's
 * band, `pulseHits.ts`), the solid grows by THUMP_SCALE and falls back on
 * the edge's own fall, so the solid's beat and the ring leaving it are one
 * event. Only the solid grows, inside its canvas (`SolidCanvas.tsx`); the
 * stripes keep their scale.
 */
function subscribeSolidThump(listener: (thump: SolidThump) => void): () => void {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  return subscribePulseHits((strength) => {
    if (reducedMotion.matches) return
    const { edgeShape, edgeFallSec, pulseBoost } = readGridWaveSettings()
    listener({ growth: pulseAmount(strength, pulseBoost) * THUMP_SCALE, fallSec: edgeFallSec, shape: edgeShape })
  })
}

export function VisualizerScene({ boxPx, fontFamily, fontSizePx, sceneSeed, gridOutlineRef }: VisualizerSceneProps) {
  const [scene, setScene] = useState<HTMLDivElement | null>(null)
  const bevel = useBoxBevelImages(boxPx, boxPx)
  const { width, height } = useBoxSize(scene)
  const layout = useMemo(() => computeVisualizerLayout(width, height, boxPx, EMPTY_SCENE_DIAMETER_PX), [width, height, boxPx])
  const { columns, originXPx, originYPx, stripRows, spectrumTopRow, chromaRow, cutout } = layout
  const cutoutRound = useSyncExternalStore(subscribeGridWaveSettings, readCutoutRound)
  const songArea = useMemo(() => songListArea(layout), [layout])
  const bucketArea = useMemo(() => bucketListArea(layout), [layout])
  const filterArea = useMemo(() => poolFilterArea(layout), [layout])
  const levelArea = useMemo(() => levelBarsArea(layout), [layout])

  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const glyphFont = `${fontSizePx}px ${fontFamily}`
  // The top strip's rows (credits, progress track, title) keep one empty box
  // from each screen edge: they span the columns between, from column 1.
  const rowColumns = Math.max(0, columns - 2 * TOP_ROW_INSET_BOXES)
  const titleText = nowPlaying.song ? fitToRow(dropWideGlyphs(songTitleText(nowPlaying.song), glyphFont), rowColumns) : ''
  const title: RowText[] = titleText.length > 0 ? [{ column: TOP_ROW_INSET_BOXES, text: titleText }] : []
  const credits = (nowPlaying.song ? creditsLine(dropWideGlyphs(songArtistText(nowPlaying.song), glyphFont), dropWideGlyphs(songAlbumText(nowPlaying.song), glyphFont), rowColumns) : [])
    .map((run) => ({ ...run, column: run.column + TOP_ROW_INSET_BOXES }))

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const chromaCanvasRef = useRef<HTMLCanvasElement | null>(null)
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
    const chromaCanvas = chromaCanvasRef.current
    const chromaContext = chromaCanvas?.getContext('2d') ?? null
    const semitoneMeter = chromaContext ? new SemitoneFade(columns) : null
    const semitoneTargets = semitoneMeter ? new Float32Array(columns) : null
    const normalizedSemitoneLevels = semitoneMeter ? new Float32Array(columns) : null
    const normalizedSemitoneAfterLevels = semitoneMeter ? new Float32Array(columns) : null
    const semitoneActivity = semitoneMeter ? new SemitoneActivityFilter(columns, MUSIC_SEMITONE_CONFIRM_SEC) : null
    const drawnSemitones = new Int16Array(columns).fill(-1)
    const breath = new MusicBreath()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const context = canvas?.getContext('2d') ?? null
    const dpr = window.devicePixelRatio || 1
    let semitoneTime = NaN
    let semitoneAt: Float32Array | null = null
    let semitoneAfter: Float32Array | null = null
    let semitonePeak = 1
    const unsubscribeSemitoneScore = semitoneActivity
      ? subscribeMusicSemitoneScore(columns, (timeSec, at, after, peak) => {
          semitonePeak = peak
          if (!Number.isFinite(timeSec) || !at || !after) {
            semitoneTime = NaN
            semitoneAt = null
            semitoneAfter = null
            semitoneActivity.reset()
            return
          }
          if (Number.isFinite(semitoneTime) && (timeSec <= semitoneTime || timeSec - semitoneTime > 0.1)) {
            semitoneActivity.reset()
          }
          semitoneTime = timeSec
          semitoneAt = at
          semitoneAfter = after
        })
      : null
    const transientBand = semitoneActivity
      ? subscribeMusicMix(
          { mix: { thump: 1, pierce: 1, tick: 0 }, shape: 1, fallSec: 0 },
          () => {},
          (strength, timeSec) => semitoneActivity.recordTransient(timeSec, strength),
        )
      : null
    let activityTrackUrl = musicPlayerService.trackUrl
    if (canvas) {
      canvas.width = Math.round(columns * boxPx * dpr)
      canvas.height = Math.round(stripRows * boxPx * dpr)
    }
    if (chromaCanvas) {
      chromaCanvas.width = Math.round(columns * boxPx * dpr)
      chromaCanvas.height = Math.round(boxPx * dpr)
    }

    // The accent colour (the layout's own, or the caret's when it has none, as
    // `.visualizer-lit` does in CSS), read off the scene and again whenever
    // the shell's or the root's variables are rewritten (a layout or a
    // settings change), never per frame.
    const shell = scene.closest<HTMLElement>('.app-shell') ?? scene
    let accentColor = ''
    const readColor = () => {
      const style = getComputedStyle(scene)
      accentColor = style.getPropertyValue('--visualizer-accent-color').trim() || style.getPropertyValue('--color-caret').trim()
      drawnLit.fill(-1)
      drawnSemitones.fill(-1)
    }
    readColor()
    const restyle = new MutationObserver(readColor)
    restyle.observe(shell, { attributes: true, attributeFilter: ['style'] })
    restyle.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })

    // The gap is React's to draw (`gapColumn`); the loop only says when the
    // playhead has crossed into another box, which is seconds apart.
    const moveGap = () => {
      const duration = musicPlayerService.currentDurationSec
      setGapColumn(readNowPlaying().song ? playheadColumn(rowColumns, musicPlayerService.currentTime, duration) : null)
    }

    const draw = () => {
      if (context && canvas) {
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
        if (changed) {
          context.setTransform(dpr, 0, 0, dpr, 0, 0)
          context.clearRect(0, 0, columns * boxPx, stripRows * boxPx)
          context.fillStyle = accentColor
          // Row k from the bottom (0-based) of a strip n rows tall is drawn
          // at 1 - k/(n+1), so a bar fades towards the top; the peak, the box
          // that lingers, is drawn whole. Each row at that row's alpha.
          for (let row = 0; row < stripRows; row += 1) {
            context.globalAlpha = 0.5 - row / (2 * stripRows)
            const y = (stripRows - 1 - row) * boxPx
            // Adjacent lit boxes of a row are one rectangle, so a row costs
            // one fill per run of bars rather than one per box.
            let runStart = -1
            for (let band = 0; band <= columns; band += 1) {
              const lit = band < columns && row < drawnLit[band] && row !== Math.max(drawnLit[band], drawnPeak[band]) - 1
              if (lit && runStart < 0) runStart = band
              else if (!lit && runStart >= 0) {
                context.fillRect(runStart * boxPx, y, (band - runStart) * boxPx, boxPx)
                runStart = -1
              }
            }
          }
          context.globalAlpha = 1
          for (let band = 0; band < columns; band += 1) {
            const top = Math.max(drawnLit[band], drawnPeak[band])
            if (top > 0) context.fillRect(band * boxPx, (stripRows - top) * boxPx, boxPx, boxPx)
          }
        }
      }

      if (chromaContext && semitoneMeter && chromaCanvas) {
        let changed = false
        for (let boxIndex = 0; boxIndex < columns; boxIndex += 1) {
          const alpha = Math.round(semitoneMeter.levels[boxIndex] * 255)
          if (alpha !== drawnSemitones[boxIndex]) {
            changed = true
            drawnSemitones[boxIndex] = alpha
          }
        }
        if (!changed) return
        chromaContext.setTransform(dpr, 0, 0, dpr, 0, 0)
        chromaContext.clearRect(0, 0, columns * boxPx, boxPx)
        chromaContext.fillStyle = accentColor
        for (let boxIndex = 0; boxIndex < columns; boxIndex += 1) {
          const alpha = drawnSemitones[boxIndex]
          if (alpha === 0) continue
          chromaContext.globalAlpha = alpha / 255
          chromaContext.fillRect(boxIndex * boxPx, 0, boxPx, boxPx)
        }
        chromaContext.globalAlpha = 1
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
      }
      const trackUrl = musicPlayerService.trackUrl
      if (trackUrl !== activityTrackUrl) {
        activityTrackUrl = trackUrl
        semitoneTime = NaN
        semitoneAt = null
        semitoneAfter = null
        semitoneActivity?.reset()
      }
      if (semitoneAt && semitoneAfter && Number.isFinite(semitoneTime) && semitoneMeter && semitoneTargets) {
        if (
          !normalizedSemitoneLevels ||
          !normalizedSemitoneAfterLevels
        ) {
          throw new Error('Semitone rendering started without its score buffers')
        }
        const normalizationDb = Number.isFinite(semitonePeak) ? semitoneLoudnessOffsetDb(semitonePeak) : 0
        for (let boxIndex = 0; boxIndex < columns; boxIndex += 1) {
          normalizedSemitoneLevels[boxIndex] = semitoneAt[boxIndex] + normalizationDb
          normalizedSemitoneAfterLevels[boxIndex] = semitoneAfter[boxIndex] + normalizationDb
        }
        const activeLevels =
          semitoneActivity?.step(normalizedSemitoneLevels, normalizedSemitoneAfterLevels, semitoneTime) ??
          normalizedSemitoneLevels
        for (let boxIndex = 0; boxIndex < columns; boxIndex += 1) {
          semitoneTargets[boxIndex] = semitoneShare(activeLevels[boxIndex])
        }
      } else {
        semitoneTargets?.fill(0)
      }
      if (semitoneMeter && semitoneTargets) semitoneMeter.step(semitoneTargets, dt)
      draw()
      moveGap()
      const still = reducedMotion.matches
      const { amplitude, speed } = breathScales(breath.step(tap ? tap.bassPower(levels) : 0, dt))
      if (!still) {
        phaseSec += dt * speed
        applySway(phaseSec, amplitude)
      }
      // Nothing left to move: the music is stopped, the bars have fallen and
      // the glaze holds still. Woken again by the music or the motion setting.
      if (still && !musicPlayerService.isPlaying && meter.isAtRest() && (!semitoneMeter || semitoneMeter.isAtRest())) {
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
      unsubscribePlaying()
      unsubscribeSong()
      unsubscribeSemitoneScore?.unsubscribe()
      transientBand?.unsubscribe()
      reducedMotion.removeEventListener('change', wake)
    }
  }, [scene, columns, rowColumns, stripRows, boxPx, chromaRow])

  const handleProgressPress = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const column = Math.floor((event.clientX - rect.left) / boxPx)
    const press = progressPress(rowColumns, column)
    if (press.kind === 'previous') readNowPlaying().jumpSong(-1)
    else if (press.kind === 'next') readNowPlaying().jumpSong(1)
    else if (press.kind === 'seek') void musicPlayerService.setCurrentTimeFraction(press.fraction)
  }, [boxPx, rowColumns])

  const box = boxPx
  // The cutout covers the inside of its boxes: a box's first pixel row and
  // column are the grid line it shares with the box before, so the cutout
  // starts one pixel in and is one pixel smaller, leaving that line drawn.
  const cutoutRect = {
    left: originXPx + cutout.column * box + 1,
    top: originYPx + cutout.row * box + 1,
    size: Math.max(0, cutout.size * box - 1),
  }
  // The grid closes around the cutout (cutoutRing.ts): every grid layer
  // has a hole there, and with a rounded face the two line kinds bend round
  // it as rings. The outline grid's hole and ring are also on its inline
  // style, so the beat pane's copy of it (useBeatGridMirror.ts, drawn above
  // the scene) leaves the cutout alone and draws the same ring.
  const closure = cutout.size > 0 ? cutoutClosure(cutoutRect, cutoutRound) : null
  const outlineRing = closure?.outlineRing ?? null
  const outlineGridStyle: CSSProperties = {
    '--grid-outline-tile': bevel.tile,
    '--box-shading': bevel.shading,
    backgroundPosition: `${originXPx + 1}px ${originYPx + 1}px`,
    ...gridOutlineMask(`${box}px ${box}px`, `${originXPx + 1}px ${originYPx + 1}px`, closure?.holeShape ?? null),
    ...(outlineRing ? {
      '--grid-ring-mask': outlineRing.mask,
      '--grid-ring-left': `${outlineRing.left}px`,
      '--grid-ring-top': `${outlineRing.top}px`,
      '--grid-ring-size': `${outlineRing.size}px`,
    } : {}),
  } as CSSProperties
  // The grid-line layer needs the hole only when the rings replace the
  // straight lines; at roundness 0 the cutout covers it, as it always did.
  const gridLinesHole: CSSProperties = closure?.gridRing ? closure.hole : {}
  const track = trackSpan(rowColumns)
  const rowLeftPx = originXPx + TOP_ROW_INSET_BOXES * box
  const rowTop = (row: number) => originYPx + row * box
  const style = {
    '--editor-cell-width': `${box}px`,
    '--editor-line-height': `${box}px`,
    '--visualizer-font': fontFamily,
    '--visualizer-font-size': `${fontSizePx}px`,
  } as CSSProperties

  const panelsShown = useSyncExternalStore(subscribePanelsShown, readPanelsShown)
  // The solid in the cutout is the music's EQ preset: a left press steps to
  // the solid with more faces, a right press back (musicEqPreset.ts).
  const eqPreset = useSyncExternalStore(subscribeMusicEqPreset, readMusicEqPreset)
  const solid = solidSeed(sceneSeed, MUSIC_EQ_PRESETS.indexOf(eqPreset))
  return (
    <div ref={setScene} className={panelsShown ? 'visualizer-scene' : 'visualizer-scene is-panels-hidden'} tabIndex={-1} data-visualizer-scene="" style={style}>
      {width > 0 && (
        <>
          <div className="visualizer-strip is-top" style={{ height: rowTop(stripRows) }} />
          <div className="visualizer-strip is-hole-fill" style={{ top: rowTop(stripRows), height: rowTop(spectrumTopRow) - rowTop(stripRows) }} />
          <div className="visualizer-strip is-middle" style={{ top: rowTop(stripRows), height: rowTop(spectrumTopRow) - rowTop(stripRows) }} />
          <div className="visualizer-strip is-bottom" style={{ top: rowTop(spectrumTopRow) }} />

          {layout.progressRow !== null && rowColumns >= 2 && (
            <>
              <div className="visualizer-lit" style={{ left: rowLeftPx, top: rowTop(layout.progressRow), width: box, height: box }} />
              {/* The track is drawn as the lit runs either side of the
                  playhead's box, so that box is truly missing: painting the
                  strip's colour over a lit track let the caret colour show
                  through wherever the strip's colour is translucent. */}
              {trackRuns(track, gapColumn).map((run) => (
                <div key={run.first} className="visualizer-lit" style={{ left: rowLeftPx + run.first * box, top: rowTop(layout.progressRow!), width: run.count * box, height: box }} />
              ))}
              <div className="visualizer-lit" style={{ left: rowLeftPx + (rowColumns - 1) * box, top: rowTop(layout.progressRow), width: box, height: box }} />
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
          {chromaRow !== null && (
            <canvas
              ref={chromaCanvasRef}
              className="visualizer-chroma"
              style={{
                left: originXPx,
                top: rowTop(chromaRow),
                width: columns * box,
                height: box,
              }}
            />
          )}

          {/* The edit view's own texture, the one thing the scene shares with
              the editor besides its grid: a still masked layer under the
              surfaces, as in the editor, never repainted per frame. */}
          <div className="markdown-editor-texture visualizer-texture" />
          <div
            ref={gridOutlineRef}
            className="visualizer-grid thockdown-grid-outline-lines"
            style={outlineGridStyle}
          />
          <div className="visualizer-grid thockdown-grid-lines" style={{ backgroundPosition: `${originXPx}px ${originYPx}px`, zIndex: 4, ...gridLinesHole }} />
          {outlineRing && <CutoutRingLayer ring={outlineRing} className="is-outline" />}
          <GridWave boxPx={box} originXPx={originXPx} originYPx={originYPx} cutout={cutout.size > 0 ? cutoutRect : null} cutoutRound={cutoutRound} />

          {layout.titleRow !== null && <Letters runs={title} row={layout.titleRow} layout={layout} />}
          {layout.creditsRow !== null && <Letters runs={credits} row={layout.creditsRow} layout={layout} />}

          {songArea && <SongList layout={layout} area={songArea} glyphFont={glyphFont} />}
          {bucketArea && <BucketList layout={layout} area={bucketArea} glyphFont={glyphFont} />}
          {filterArea && <PoolFilter layout={layout} area={filterArea} glyphFont={glyphFont} />}
          {levelArea && <LevelBars layout={layout} area={levelArea} />}
          <ThemeArrows layout={layout} />
          <TabHint layout={layout} />
          <CursorIdle />

          {layout.progressRow !== null && (
            <div
              className="visualizer-progress-hit"
              style={{ left: rowLeftPx, top: rowTop(layout.progressRow), width: rowColumns * box, height: box }}
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
                '--visualizer-face-radius': `${closure?.faceRadiusPx ?? 0}px`,
              } as CSSProperties}
              onClick={() => stepMusicEqPreset(1)}
              onContextMenu={(event: ReactMouseEvent) => {
                event.preventDefault()
                stepMusicEqPreset(-1)
              }}
              data-secondary-press="action"
            >
              <div className="visualizer-cutout-face">
                <SolidCanvas className="empty-state-solid" seed={solid} animateTo={solid} active subscribeThump={subscribeSolidThump} />
              </div>
              <div className="visualizer-cutout-orb" />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function readCutoutRound(): number {
  return readGridWaveSettings().cutoutRound
}

/** The outline ring the grid closes round a rounded cutout with: the line's own colour, masked to the ring. */
function CutoutRingLayer({ ring, className }: { ring: CutoutRing; className: string }) {
  return (
    <div
      className={`visualizer-cutout-ring ${className}`}
      style={{ left: ring.left, top: ring.top, width: ring.size, height: ring.size, maskImage: ring.mask, WebkitMaskImage: ring.mask }}
    />
  )
}
