/**
 * The visualizer's smooth wave: soft bands of the layout's wave colour
 * (Options > Visualizer, `--visualizer-wave-color`), travelling left to
 * right across the box grid's LINES (the 1px lines
 * between the boxes, `.thockdown-grid-lines`), brightening them as they pass.
 *
 * It is painted ABOVE the glaze, so the bands keep their colour instead of
 * being blended by the glaze stacks: the wave is portalled to the end of
 * `.app-saturate-wrapper` (the fixed, window-sized layer that holds the glaze)
 * at a z-index just above `.glaze-overlay-stack`. Being outside the scene, it
 * places itself over the scene by measuring an anchor the scene lays out
 * (its full box), and re-measures when that box resizes or the window does.
 * The scene's centre cutout is a hole in the mask, so the image stays clean.
 *
 * A frame repaints nothing. The outer element is masked to everything but
 * the cutout; the one inside it is masked to the grid lines by the same
 * gradients that draw them, at the same tile size and position. Neither
 * moves. Inside the lines sits a square as wide as the scene's diagonal,
 * centred on it, turned with the music's beat by one transform written per
 * frame (`gridWaveTurn.ts`: three nested pivots reduced to the single
 * rotation and shift that draw the same stripes); and inside that, one
 * repeating band pattern, one wave length wider than the square, moved by a
 * CSS animation of `transform` one wave length per cycle, so the loop is
 * seamless. Nothing repaints.
 *
 * Beside the turning square, inside the same line mask, sits the centre
 * PULSE: a stack of rings, each at the rim of a layer exactly the cutout's
 * square, so at rest hidden behind the cutout. Each hit of the edge's band
 * (`pulseHits.ts`) scales the next ring at rest out until its inner edge
 * reaches the scene's farthest corner, so pulses overlap.
 *
 * The colour, wave length and travel time are the layout's, published as
 * CSS variables by `useBeatFeedback`, and the rotation step and wave length
 * through `gridWaveTurn.ts`'s settings store.
 *
 * Self-contained: it reads only the box size, the grid's origin and the
 * cutout, which the scene already has, so it can be switched off or moved
 * into a package without touching anything else.
 */

import { cutoutClosure } from './cutoutRing'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_VISUALIZER_CHANNEL, pulseRingStrength, pulseTimeToTravel, roundedSquareGauge, pulseTravelBoxes, type VisualizerChannel } from '@thockdown/look/visualizer'
import { subscribeMusicBand, subscribeMusicTempo } from '../sound/musicBeat'
import { subscribePulseHits } from './pulseHits'
import { setSwaySnare } from './parallaxSway'
import { WAVE_ANGLES_AT_REST, createTempoFollower, advanceWaveAngles, readGridWaveSettings, subscribeGridWaveSettings, waveTurnTransform } from './gridWaveTurn'

/** The centre pulse's ring, as a share of its layer's radius at the rim (`.visualizer-grid-wave-pulse`'s gradient). */
const PULSE_RING_SHARE = 0.25
/** Keyframes sampled along the pulse's travel curve; linear between them. */
const PULSE_KEYFRAMES = 24
/**
 * Prerendered rings in the pulse STACK: a hit scales the first one not
 * already travelling, so pulses overlap rather than cut each other off. With
 * every one travelling, the oldest is taken. Six covers a kick every beat at
 * 120 BPM with three seconds of travel; each is a cutout-sized layer.
 */
const PULSE_LAYERS = 6

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

interface SceneBox { left: number; top: number; width: number; height: number }

export function GridWave({ boxPx, originXPx, originYPx, cutout, cutoutRound }: {
  boxPx: number
  originXPx: number
  originYPx: number
  /** The centre cutout in scene pixels, left out of the wave; null for none. */
  cutout: { left: number; top: number; size: number } | null
  /** The cutout face's corner roundness (`cutoutRing.ts`): the wave follows the grid ring round it. */
  cutoutRound: number
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [sceneBox, setSceneBox] = useState<SceneBox | null>(null)
  const [host, setHost] = useState<Element | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    setHost(anchor.closest('.app-saturate-wrapper'))
    const measure = () => {
      const rect = anchor.getBoundingClientRect()
      setSceneBox(previous => previous && previous.left === rect.left && previous.top === rect.top
        && previous.width === rect.width && previous.height === rect.height
        ? previous
        : { left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(anchor)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const turnRef = useRef<HTMLDivElement>(null)
  const { waveTurn, waveBoxes, pulseSpeed, pulseHalfLifeSec, pulseFadeSec, pulseColor, pulseSoftness, waveShape, waveFallSec } = useSyncExternalStore(subscribeGridWaveSettings, readGridWaveSettings)
  const widthPx = sceneBox?.width ?? 0
  // The rotation turns at the music's TEMPO (`subscribeMusicTempo`), one
  // transform written per frame on the beat loop's own frame: each frame
  // advances by the time heard over the beat period, so the angle never takes
  // the beat clock's phase jumps when it re-seats after a seek or a change of
  // section. The rate itself follows the period exponentially (`createTempoFollower`), so a new tempo, or a grid found at double or half the
  // last one, is eased into rather than stepped. A frame far (a seek, a stall) moves nothing. Entering
  // the visualizer starts upright; no beat holds the angle reached. Step 0
  // does not listen at all and rests upright.
  // ONE subscription for the visualizer's whole stay: the settings and the
  // scene's size are read through a ref, so moving a slider or resizing the
  // window changes the rate or the shift and never the angle reached.
  const turnInputs = useRef({ waveTurn, widthPx, periodPx: waveBoxes * boxPx })
  turnInputs.current = { waveTurn, widthPx, periodPx: waveBoxes * boxPx }
  useEffect(() => {
    const turn = turnRef.current
    if (!turn) return
    turn.style.transform = ''
    let angles = WAVE_ANGLES_AT_REST
    const follow = createTempoFollower()
    return subscribeMusicTempo((timeSec, periodSec) => {
      const beats = follow(timeSec, periodSec)
      const { waveTurn: step, widthPx: width, periodPx } = turnInputs.current
      if (step === 0) {
        if (angles !== WAVE_ANGLES_AT_REST) {
          angles = WAVE_ANGLES_AT_REST
          turn.style.transform = ''
        }
        return
      }
      if (beats <= 0 || width === 0 || reducedMotion.matches) return
      angles = advanceWaveAngles(angles, step, beats)
      turn.style.transform = waveTurnTransform(angles, width, periodPx)
    })
  }, [host])

  // The wave SHOWS ON THE SNARE, as an edge or pane block does: a band of
  // the music following the snare, its response (full on a hit, falling to
  // nothing on the layout's fall) written as the bands' opacity. Subscribed
  // here rather than with the other blocks, so the snare is followed only
  // while the visualizer is up; retuned in place when the fall changes.
  const bandsRef = useRef<HTMLDivElement>(null)
  const waveChannel: VisualizerChannel = { ...DEFAULT_VISUALIZER_CHANNEL, effect: 1, source: 'snare', shape: waveShape, fallSec: waveFallSec }
  const waveChannelRef = useRef(waveChannel)
  waveChannelRef.current = waveChannel
  const waveBandRef = useRef<{ update: (next: VisualizerChannel) => void } | null>(null)
  useEffect(() => {
    const bands = bandsRef.current
    if (!bands) return
    let shown = -1
    const show = (response: number) => {
      setSwaySnare(response)
      // Quantized to what an 8-bit alpha resolves, and written only when it changes.
      const steps = Math.round(response * 255)
      if (steps === shown) return
      shown = steps
      bands.style.opacity = String(steps / 255)
    }
    show(0)
    const band = subscribeMusicBand(waveChannelRef.current, show)
    waveBandRef.current = band
    return () => {
      waveBandRef.current = null
      band.unsubscribe()
      setSwaySnare(0)
    }
  }, [host])
  useEffect(() => {
    waveBandRef.current?.update(waveChannelRef.current)
  }, [waveShape, waveFallSec])

  // The centre pulse: a ring at the rim of a layer exactly the cutout's
  // square, so at rest it lies wholly behind the cutout. On each hit of the
  // edge's band (`pulseHits.ts`) the next ring of the stack is scaled out, its inner edge setting off at the layout's
  // starting speed and losing its decay share of that speed each second
  // (`pulseTravelBoxes`), until that edge reaches the scene's farthest corner
  // from the cutout's centre. A decay that stops it short ends it once it has
  // all but stopped. A Web
  // Animation of `transform` sampled from that curve: the compositor runs it,
  // nothing repaints.
  const pulseRefs = useRef<Array<HTMLDivElement | null>>([])
  const pulseInnerPx = cutout && cutout.size > 0 ? (cutout.size / 2) * (1 - PULSE_RING_SHARE) : 0
  // The ring is the cutout face's shape, so its inner edge clears the scene
  // when the farthest corner lies on it: that corner's gauge, in half-sides.
  const pulseExitScale = sceneBox && cutout && pulseInnerPx > 0
    ? roundedSquareGauge(
      Math.max(cutout.left + cutout.size / 2, sceneBox.width - cutout.left - cutout.size / 2) / (cutout.size / 2),
      Math.max(cutout.top + cutout.size / 2, sceneBox.height - cutout.top - cutout.size / 2) / (cutout.size / 2),
      cutoutRound,
    ) * (cutout.size / 2) / pulseInnerPx
    : 0
  // The ring itself: the face's rounded square, PULSE_RING_SHARE of its
  // half-side wide at the rim, drawn once per change of colour, softness,
  // roundness or size and then only scaled.
  const pulseRingSize = cutout?.size ?? 0
  const pulseRingImage = useMemo(
    () => (pulseRingSize > 0 ? drawPulseRing(pulseRingSize, cutoutRound, pulseColor, pulseSoftness) : 'none'),
    [pulseRingSize, cutoutRound, pulseColor, pulseSoftness],
  )
  // Read through a ref, so a resize or a slider changes the next pulse
  // without cancelling the pulses under way.
  const pulseInputs = useRef({ pulseExitScale, pulseInnerPx, boxPx, pulseSpeed, pulseHalfLifeSec, pulseFadeSec })
  pulseInputs.current = { pulseExitScale, pulseInnerPx, boxPx, pulseSpeed, pulseHalfLifeSec, pulseFadeSec }
  const hasPulse = pulseInnerPx > 0
  useEffect(() => {
    const layers = pulseRefs.current.filter((layer): layer is HTMLDivElement => layer !== null)
    if (layers.length === 0) return
    const running: Array<Animation | null> = layers.map(() => null)
    const startedAt: number[] = layers.map(() => -Infinity)
    const unsubscribe = subscribePulseHits(() => {
      const { pulseExitScale: exitScale, pulseInnerPx: innerPx, boxPx: box, pulseSpeed: speed, pulseHalfLifeSec: halfLife, pulseFadeSec: fadeSec } = pulseInputs.current
      if (reducedMotion.matches || !(exitScale > 1) || !(box > 0)) return
      const exitBoxes = ((exitScale - 1) * innerPx) / box
      // Done when it has left the screen or faded out, whichever is first;
      // a ring the half-life stops short has faded by then all the same.
      const durationSec = Math.min(pulseTimeToTravel(exitBoxes, speed, halfLife), fadeSec)
      const keyframes: Keyframe[] = []
      for (let i = 0; i <= PULSE_KEYFRAMES; i++) {
        const t = (i / PULSE_KEYFRAMES) * durationSec
        keyframes.push({ transform: `scale(${1 + (pulseTravelBoxes(t, speed, halfLife) * box) / innerPx})`, opacity: 1 - t / fadeSec })
      }
      // The first layer at rest, or else the one that set off longest ago.
      let pick = 0
      for (let i = 0; i < layers.length; i++) {
        if (running[i]?.playState !== 'running') { pick = i; break }
        if (startedAt[i] < startedAt[pick]) pick = i
      }
      running[pick]?.cancel()
      running[pick] = layers[pick].animate(keyframes, { duration: durationSec * 1000, easing: 'linear' })
      startedAt[pick] = performance.now()
    })
    return () => {
      unsubscribe()
      for (const animation of running) animation?.cancel()
    }
  }, [host, hasPulse])

  // The rotating layer is a square as wide as the scene's diagonal, centred
  // on the scene, so the bands cover every corner at every angle.
  const turnSide = sceneBox ? Math.ceil(Math.hypot(sceneBox.width, sceneBox.height)) : 0
  const lines = `repeating-linear-gradient(to right, #000 0, #000 1px, transparent 1px, transparent ${boxPx}px), `
    + `repeating-linear-gradient(to bottom, #000 0, #000 1px, transparent 1px, transparent ${boxPx}px)`
  // A mask composites each layer onto the ones BELOW it, so "two line sets
  // minus a rectangle" cannot be one element's mask (the union of the lines
  // would have to be formed before the rectangle is taken out). The cutout's
  // hole is therefore the outer element's mask and the lines the inner one's.
  // With a rounded face the grid closes round it with a ring (cutoutRing.ts),
  // which is a line too: added on top of both, so it survives the hole and
  // the line mask alike.
  const closure = cutout && cutout.size > 0 ? cutoutClosure(cutout, cutoutRound) : null
  const ring = closure?.gridRing ?? null
  const lineMask: CSSProperties = ring ? {
    maskImage: `${ring.mask}, ${lines}`,
    maskSize: `${ring.size}px ${ring.size}px, ${boxPx}px ${boxPx}px, ${boxPx}px ${boxPx}px`,
    maskPosition: `${ring.left}px ${ring.top}px, ${originXPx}px ${originYPx}px, ${originXPx}px ${originYPx}px`,
    maskRepeat: 'no-repeat, repeat, repeat',
  } : {
    maskImage: lines,
    maskSize: `${boxPx}px ${boxPx}px`,
    maskPosition: `${originXPx}px ${originYPx}px`,
  }
  const hole = closure?.hole
  const holeMask: CSSProperties = !hole ? {} : ring ? {
    maskImage: `${ring.mask}, ${hole.maskImage}`,
    maskSize: `${ring.size}px ${ring.size}px, ${hole.maskSize}`,
    maskPosition: `${ring.left}px ${ring.top}px, ${hole.maskPosition}`,
    maskRepeat: 'no-repeat',
    maskComposite: 'add, exclude',
  } : hole

  return (
    <>
      <div ref={anchorRef} className="visualizer-grid-wave-anchor" aria-hidden="true" />
      {host && sceneBox ? createPortal(
        <div
          className="visualizer-grid-wave"
          aria-hidden="true"
          style={{
            ...sceneBox,
            ...holeMask,
            '--grid-wave-box': `${boxPx}px`,
          } as CSSProperties}
        >
          <div className="visualizer-grid-wave-lines" style={lineMask}>
            <div
              ref={turnRef}
              className="visualizer-grid-wave-turn"
              style={{
                width: turnSide,
                height: turnSide,
                left: (sceneBox.width - turnSide) / 2,
                top: (sceneBox.height - turnSide) / 2,
              }}
            >
              <div ref={bandsRef} className="visualizer-grid-wave-bands" />
            </div>
            {cutout && cutout.size > 0 ? Array.from({ length: PULSE_LAYERS }, (_, i) => (
              <div
                key={i}
                ref={(layer) => { pulseRefs.current[i] = layer }}
                className="visualizer-grid-wave-pulse"
                style={{ left: cutout.left, top: cutout.top, width: cutout.size, height: cutout.size, backgroundImage: pulseRingImage }}
              />
            )) : null}
          </div>
        </div>,
        host,
      ) : null}
    </>
  )
}

/**
 * The pulse ring as an image `size` CSS px square at the device's pixel
 * ratio: the colour, its alpha scaled per pixel by `pulseRingStrength` on the
 * rounded square's gauge, so the colour's own alpha is the ring's peak.
 */
function drawPulseRing(size: number, round: number, color: string, softness: number): string {
  const side = Math.max(1, Math.min(1024, Math.round(size * (window.devicePixelRatio || 1))))
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')
  if (!context) return 'none'
  context.fillStyle = color
  context.fillRect(0, 0, side, side)
  const image = context.getImageData(0, 0, side, side)
  const data = image.data
  const half = side / 2
  for (let py = 0; py < side; py++) {
    const y = (py + 0.5 - half) / half
    for (let px = 0; px < side; px++) {
      const strength = pulseRingStrength(roundedSquareGauge((px + 0.5 - half) / half, y, round), softness, 1 - PULSE_RING_SHARE)
      const i = (py * side + px) * 4 + 3
      data[i] = Math.round(data[i] * strength)
    }
  }
  context.putImageData(image, 0, 0)
  return `url(${canvas.toDataURL()})`
}
