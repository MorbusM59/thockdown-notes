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
import { FALL_MIN_SEC, WAVE_FALLBACK_BEAT_SEC, pulseRingStrength, pulseTimeToTravel, roundedSquareGauge, roundedSquareOffsetGauge, pulseTravelBoxes } from '@thockdown/look/visualizer'
import { canUseShaderPulse } from './glazeShaderSupport'
import { PulseRingsCanvas, type PulseRingsHandle } from './PulseRingsCanvas'
import { subscribeMusicMix, subscribeMusicTempo, type MusicMixChannel } from '../sound/musicBeat'
import { emitPulseHit, pulseAmount, subscribePulseHits } from './pulseHits'
import { setSwayReturnFall, swaySnareHit } from './parallaxSway'
import { WAVE_ANGLES_AT_REST, createTempoFollower, advanceWaveAngles, readGridWaveSettings, subscribeGridWaveSettings, waveTurnTransform } from './gridWaveTurn'

/** The centre pulse's ring, as a share of its layer's radius at the rim (`.visualizer-grid-wave-pulse`'s gradient). */
const PULSE_RING_SHARE = 0.25
/**
 * The scale a pulse sets off at: the ring's middle, its strongest line, on
 * the face's rim, so on the hit it is already showing at the rim at full
 * strength with its inner half still behind the face. Set off from the
 * resting layer (the ring wholly behind the face), the middle would only
 * reach the rim after travelling an eighth of the face's half-side, and the
 * pulse read as starting outside the face.
 */
const PULSE_START_SCALE = 1 / (1 - PULSE_RING_SHARE / 2)
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

/** The pulse's mix is followed for its hits alone. */
function ignoreResponse(): void {}

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
  const { waveTurn, waveBoxes, waveBeats, pulseSpeed, pulseHalfLifeSec, pulseFadeSec, pulseColor, pulseSoftness, waveShape, waveFallSec, waveMix, glazeMix, glazePushes, pulseMix } = useSyncExternalStore(subscribeGridWaveSettings, readGridWaveSettings)
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

  // The bands TRAVEL one wave length every `waveBeats` beats, at the same
  // eased tempo the turn follows (`createTempoFollower`), so a seek's phase
  // jump never moves them. While the beat map has no beat (its warm-up, or a
  // passage it cannot follow) they keep travelling at WAVE_FALLBACK_BEAT_SEC,
  // eased into and out of like any change of tempo, so the wave never freezes
  // under a hit. Frames run only while music plays; a pause holds the place
  // reached. The place is a share of one wave length, so a change of length
  // or of beats changes the speed and never jumps the bands.
  const bandsRef = useRef<HTMLDivElement>(null)
  const travelInputs = useRef({ waveBeats, periodPx: waveBoxes * boxPx })
  travelInputs.current = { waveBeats, periodPx: waveBoxes * boxPx }
  useEffect(() => {
    const bands = bandsRef.current
    if (!bands) return
    bands.style.transform = ''
    let share = 0
    const follow = createTempoFollower()
    return subscribeMusicTempo((timeSec, periodSec) => {
      const beats = follow(timeSec, periodSec > 0 ? periodSec : (Number.isFinite(timeSec) ? WAVE_FALLBACK_BEAT_SEC : NaN))
      const { waveBeats: perLength, periodPx } = travelInputs.current
      if (beats <= 0 || reducedMotion.matches) return
      share = (share + beats / perLength) % 1
      bands.style.transform = `translateX(${(share * periodPx).toFixed(2)}px)`
    })
  }, [host])

  // The wave SHOWS ON ITS MIX's hits (the layout's `waveMix` of the
  // trackers, the snare's hits by default), as an edge or pane block does:
  // its response (full on a hit, falling to nothing on the layout's fall)
  // written as the bands' opacity. Subscribed here rather than with the other
  // blocks, so the trackers are followed only while the visualizer is up;
  // retuned in place when the mix or the fall changes.
  const waveChannel = useMemo<MusicMixChannel>(() => ({ mix: waveMix, shape: waveShape, fallSec: waveFallSec }), [waveMix, waveShape, waveFallSec])
  const waveChannelRef = useRef(waveChannel)
  waveChannelRef.current = waveChannel
  const waveBandRef = useRef<{ update: (next: MusicMixChannel) => void } | null>(null)
  useEffect(() => {
    const bands = bandsRef.current
    if (!bands) return
    let shown = -1
    const show = (response: number) => {
      // Quantized to what an 8-bit alpha resolves, and written only when it changes.
      const steps = Math.round(response * 255)
      if (steps === shown) return
      shown = steps
      bands.style.opacity = String(steps / 255)
    }
    show(0)
    const band = subscribeMusicMix(waveChannelRef.current, show)
    waveBandRef.current = band
    return () => {
      waveBandRef.current = null
      band.unsubscribe()
    }
  }, [host])
  useEffect(() => {
    waveBandRef.current?.update(waveChannel)
    setSwayReturnFall(waveFallSec, waveShape)
  }, [waveChannel, waveFallSec, waveShape])

  // What pushes the glaze's linear stacks: the hits of the layout's own
  // `glazeMix` (`parallaxSway.ts`'s `swaySnareHit`). Only the hits are read;
  // the push slides back on the wave's fall, set just above. The channel's
  // fall is the shortest, so each hit is told apart from the next.
  const glazeChannel = useMemo<MusicMixChannel>(() => ({ mix: glazeMix, shape: 0, fallSec: FALL_MIN_SEC }), [glazeMix])
  const glazeChannelRef = useRef(glazeChannel)
  glazeChannelRef.current = glazeChannel
  const glazeBandRef = useRef<{ update: (next: MusicMixChannel) => void } | null>(null)
  useEffect(() => {
    if (!glazePushes) return
    const band = subscribeMusicMix(glazeChannelRef.current, () => {}, () => swaySnareHit())
    glazeBandRef.current = band
    return () => {
      glazeBandRef.current = null
      band.unsubscribe()
    }
  }, [host, glazePushes])
  useEffect(() => {
    glazeBandRef.current?.update(glazeChannel)
  }, [glazeChannel])

  // What sets the centre pulse off: the hits of the layout's `pulseMix` (the
  // kick and snare trackers only), one pulse per hit (`pulseHits.ts`). Its
  // response is drawn nowhere, so its fall is only the shortest a block has,
  // which keeps two hits a frame or two apart (a kick and a snare together)
  // from setting off two rings.
  const pulseChannel = useMemo<MusicMixChannel>(() => ({ mix: pulseMix, shape: 0, fallSec: FALL_MIN_SEC }), [pulseMix])
  const pulseChannelRef = useRef(pulseChannel)
  pulseChannelRef.current = pulseChannel
  const pulseBandRef = useRef<{ update: (next: MusicMixChannel) => void } | null>(null)
  useEffect(() => {
    const band = subscribeMusicMix(pulseChannelRef.current, ignoreResponse, emitPulseHit)
    pulseBandRef.current = band
    return () => {
      pulseBandRef.current = null
      band.unsubscribe()
    }
  }, [host])
  useEffect(() => {
    pulseBandRef.current?.update(pulseChannel)
  }, [pulseChannel])

  // The centre pulse: a ring at the rim of a layer exactly the cutout's
  // square, invisible at rest. On each hit of the pulse's mix
  // (`pulseHits.ts`) the next ring of the stack sets off with its middle on
  // the face's rim (PULSE_START_SCALE) and is scaled out, its inner edge travelling at the layout's
  // starting speed and losing its decay share of that speed each second
  // (`pulseTravelBoxes`), until that edge reaches the scene's farthest corner
  // from the cutout's centre. A decay that stops it short ends it once it has
  // all but stopped. A Web
  // Animation of `transform` sampled from that curve: the compositor runs it,
  // nothing repaints.
  const pulseRefs = useRef<Array<HTMLDivElement | null>>([])
  // With WebGL2 the rings are a real wavefront (PulseRingsCanvas.tsx): the
  // face's offset curves rather than its scaled copies, so the gauge the
  // exit is measured on is the offset one too.
  const shaderPulse = useMemo(() => canUseShaderPulse(), [])
  const pulseCanvasRef = useRef<PulseRingsHandle>(null)
  const exitGauge = shaderPulse ? roundedSquareOffsetGauge : roundedSquareGauge
  const pulseInnerPx = cutout && cutout.size > 0 ? (cutout.size / 2) * (1 - PULSE_RING_SHARE) : 0
  // The ring is the cutout face's shape, so its inner edge clears the scene
  // when the farthest corner lies on it: that corner's gauge, in half-sides.
  const pulseExitScale = sceneBox && cutout && pulseInnerPx > 0
    ? exitGauge(
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
    () => (pulseRingSize > 0 && !shaderPulse ? drawPulseRing(pulseRingSize, cutoutRound, pulseColor, pulseSoftness) : 'none'),
    [pulseRingSize, cutoutRound, pulseColor, pulseSoftness, shaderPulse],
  )
  // Read through a ref, so a resize or a slider changes the next pulse
  // without cancelling the pulses under way.
  const pulseInputs = useRef({ pulseExitScale, pulseInnerPx, boxPx, pulseSpeed, pulseHalfLifeSec, pulseFadeSec })
  pulseInputs.current = { pulseExitScale, pulseInnerPx, boxPx, pulseSpeed, pulseHalfLifeSec, pulseFadeSec }
  const hasPulse = pulseInnerPx > 0
  useEffect(() => {
    const layers = pulseRefs.current.filter((layer): layer is HTMLDivElement => layer !== null)
    if (layers.length === 0 && !shaderPulse) return
    const running: Array<Animation | null> = layers.map(() => null)
    const startedAt: number[] = layers.map(() => -Infinity)
    const unsubscribe = subscribePulseHits((strength) => {
      const amount = pulseAmount(strength, readGridWaveSettings().pulseBoost)
      const { pulseExitScale: exitScale, pulseInnerPx: innerPx, boxPx: box, pulseSpeed: speed, pulseHalfLifeSec: halfLife, pulseFadeSec: fadeSec } = pulseInputs.current
      if (reducedMotion.matches || !(exitScale > PULSE_START_SCALE) || !(box > 0)) return
      const exitBoxes = ((exitScale - PULSE_START_SCALE) * innerPx) / box
      // Done when it has left the screen or faded out, whichever is first;
      // a ring the half-life stops short has faded by then all the same.
      const durationSec = Math.min(pulseTimeToTravel(exitBoxes, speed, halfLife), fadeSec)
      if (shaderPulse) {
        pulseCanvasRef.current?.launch({
          durationSec,
          sample: (t) => ({ scale: PULSE_START_SCALE + (pulseTravelBoxes(t, speed, halfLife) * box) / innerPx, opacity: amount * (1 - t / fadeSec) }),
        })
        return
      }
      const keyframes: Keyframe[] = []
      for (let i = 0; i <= PULSE_KEYFRAMES; i++) {
        const t = (i / PULSE_KEYFRAMES) * durationSec
        keyframes.push({ transform: `scale(${PULSE_START_SCALE + (pulseTravelBoxes(t, speed, halfLife) * box) / innerPx})`, opacity: amount * (1 - t / fadeSec) })
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
  }, [host, hasPulse, shaderPulse])

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
            {cutout && cutout.size > 0 && shaderPulse ? (
              <PulseRingsCanvas
                ref={pulseCanvasRef}
                face={cutout}
                round={cutoutRound}
                inner={1 - PULSE_RING_SHARE}
                color={pulseColor}
                softness={pulseSoftness}
              />
            ) : cutout && cutout.size > 0 ? Array.from({ length: PULSE_LAYERS }, (_, i) => (
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
