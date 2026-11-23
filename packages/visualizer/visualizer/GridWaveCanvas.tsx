import { forwardRef, useImperativeHandle, useRef } from 'react'
import { linkProgram, useWebGL2Canvas } from './useWebGL2Canvas'

/*
 * The grid wave and the centre pulse, drawn by ONE WebGL2 shader on one
 * canvas over the scene, in place of the masked CSS layers GridWave.tsx
 * otherwise stacks (a full-screen layer masked to the cutout's hole, inside
 * it a layer masked to the grid lines, inside that the turning band layer
 * and the pulse rings).
 *
 * Why: each CSS mask is an offscreen render surface the compositor fills and
 * then masks, over the whole screen, every frame the wave moves. On a phone
 * at a device pixel ratio of 3 that alone ran the GPU out of fill
 * (measured, 2026-11-23: Adreno 710, 21 fps with the wave, 60 without, and
 * 60 at half resolution). Here every pixel is computed once: whether it is on
 * a grid line or the ring round the cutout and not in the cutout's hole,
 * then the band's strength there and the pulses' on top of it.
 *
 * The picture is GridWave's CSS one, from the same numbers:
 * - LINES: the grid's 1px lines (`repeating-linear-gradient`, #000 from 0 to
 *   1px of every box from the grid's origin), with the cutout's hole left
 *   out, and with a rounded face the 1px grid ring round it added back
 *   (`cutoutRing.ts`: the hole is the outline ring's outer rounded square,
 *   2px outside the face; the grid ring the 1px band just outside the face).
 * - WAVE: the band layer's gradient, transparent to the wave colour at half a
 *   wave length and back, moved `share` of a wave length along, inside the
 *   turning square's transform (`waveTurnPlacement`), at the mix's opacity.
 * - PULSE: the wavefront rings below, above the wave.
 *
 * The pulse is drawn as a real WAVEFRONT. Scaling a ring of the face's shape
 * keeps its corners as sharp as the face's, which is right for a circle and
 * wrong for anything else. A wave sent out by a square is the set of points a
 * fixed distance from its edge: the sides move out straight and each corner
 * rounds off into an arc whose radius grows with the distance travelled, so
 * the front tends to a circle. The shader measures that distance per pixel
 * (the rounded box's signed distance, `roundedSquareOffsetGauge` in
 * `@thockdown/look/visualizer`) and draws each pulse's ring on it. A pulse
 * keeps GridWave's numbers: its `scale` and opacity, sampled each frame from
 * the same travel curve; the ring lies between `inner x scale` and `scale`
 * on the gauge.
 *
 * Frames are drawn only while something shows: the wave between hits is at
 * opacity 0, and with no pulse out the canvas is cleared once and left.
 */

// ---- Tuning: the parameters to adjust by eye ---------------------------------
// (The A/B switch, USE_SHADER_PULSE, is in glazeShaderSupport.ts.)
/** 1 = the ring keeps widening with distance, as the scaled ring did; 0 = it keeps its starting width. */
export const RING_WIDTH_GROWTH = 0.8
/**
 * How much dimmer a ring gets where it is a corner's arc rather than a side:
 * a side sends its energy straight out, a corner spreads it over an arc that
 * grows with distance. 0 = no dimming; 1 = the full 1/sqrt(arc radius) of a
 * cylindrical wave. Has no effect on a circle (all of it is "side" to itself).
 */
export const CORNER_DIMMING = 0.8
// -----------------------------------------------------------------------------

/** At most this many rings out at once; a hit past it takes the oldest (as GridWave's layer stack did). */
export const MAX_PULSES = 20

export interface PulseLaunch {
  /** Seconds the pulse lasts. */
  durationSec: number
  /** The scale and opacity at `t` seconds after launch (GridWave's travel curve). */
  sample: (t: number) => { scale: number; opacity: number }
}

/** Where the wave is this frame: the turn (`waveTurnPlacement`), the travel share of a wave length, and the opacity. */
export interface WaveFrame {
  angle: number
  x: number
  y: number
  share: number
  opacity: number
}

export interface GridWaveCanvasHandle {
  launch: (pulse: PulseLaunch) => void
  wave: (frame: WaveFrame) => void
}

const VERTEX = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 sizeCss;
uniform float dpr;
uniform float box;         // the grid's box, CSS px
uniform vec2 origin;       // the grid's origin, CSS px
uniform bool hasFace;
uniform float ringWidth;   // 0 for a square face: no ring, the hole is the face
uniform vec4 waveTint;     // premultiplied
uniform float waveOpacity;
uniform vec2 waveCos;      // cos and sin of the turn
uniform vec2 waveShift;    // the turn's shift, CSS px
uniform float wavePhase;   // the band's offset along the gradient, CSS px
uniform float period;      // one wave length, CSS px
uniform vec2 centre;       // the face's centre, CSS px from the canvas's top left
uniform float half_;       // the face's half-side, CSS px
uniform float round_;      // corner radius, share of the half-side
uniform float inner;       // the ring's inner edge, share of its outer
uniform float softness;
uniform float growth;
uniform float cornerDim;
uniform vec4 tint;         // premultiplied
uniform int count;   // pulses out; 0 with no face
uniform float scale[${MAX_PULSES}];
uniform float alpha[${MAX_PULSES}];
out vec4 color;
float strength(float g, float inr) {
  if (g <= inr || g >= 1.0) return 0.0;
  float u = 2.0 * (g - inr) / (1.0 - inr) - 1.0;
  float x = min(1.0, (1.0 - abs(u)) / max(softness, 1e-3));
  return x * x * (3.0 - 2.0 * x);
}
/** Signed distance from a rounded square of half-side h and corner radius r. */
float roundBox(vec2 d, float h, float r) {
  vec2 q = abs(d) - (h - r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
/** A shape's coverage of this device pixel from its signed distance in CSS px. */
float cover(float d) { return clamp(0.5 - d * dpr, 0.0, 1.0); }
void main() {
  vec2 css = vec2(gl_FragCoord.x, sizeCss.y * dpr - gl_FragCoord.y) / dpr;
  vec2 cell = mod(css - origin, box);
  float mask = (cell.x < 1.0 || cell.y < 1.0) ? 1.0 : 0.0;
  if (hasFace) {
    vec2 d = css - centre;
    float radius = round_ * half_;
    if (ringWidth > 0.0) {
      mask *= 1.0 - cover(roundBox(d, half_ + 2.0, radius + 2.0));
      float ring = roundBox(d, half_ + 1.0, radius + 1.0);
      mask = max(mask, cover(ring) - cover(ring + 1.0));
    } else if (abs(d.x) < half_ && abs(d.y) < half_) {
      mask = 0.0;
    }
  }
  if (mask <= 0.0) { color = vec4(0.0); return; }
  vec4 wave = vec4(0.0);
  if (waveOpacity > 0.0) {
    vec2 q = css - sizeCss * 0.5 - waveShift;
    float along = waveCos.x * q.x + waveCos.y * q.y + wavePhase;
    float phase = fract(along / period);
    wave = waveTint * (1.0 - abs(2.0 * phase - 1.0)) * waveOpacity;
  }
  vec2 p = (css - centre) / half_;
  vec2 q = abs(p) - (1.0 - round_);
  vec2 qo = max(q, 0.0);
  float g = 1.0 + length(qo) + min(max(q.x, q.y), 0.0) - round_;
  // In a corner region (both q > 0) the front is an arc of radius round + g - 1.
  bool corner = q.x > 0.0 && q.y > 0.0;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${MAX_PULSES}; i++) {
    if (i >= count) break;
    float s = scale[i];
    // Constant width: the ring's half-side-units width stays at its start.
    float inr = mix(1.0 - (1.0 - inner) / s, inner, growth);
    float k = strength(g / s, inr) * alpha[i];
    if (corner && cornerDim > 0.0) {
      float arc = max(round_ + g - 1.0, 1e-3);
      float base = max(round_ + (1.0 - (1.0 - inner) * 0.5) - 1.0, 0.0) + 0.05;
      // Weighted by sin(2θ) across the corner (0 where it meets a side, 1 on
      // the diagonal) so the dimming joins the sides without a seam.
      float across = 2.0 * qo.x * qo.y / max(dot(qo, qo), 1e-6);
      k *= mix(1.0, sqrt(clamp(base / arc, 0.0, 1.0)), cornerDim * across);
    }
    vec4 c = tint * k;
    acc = c + acc * (1.0 - c.a);
  }
  color = (acc + wave * (1.0 - acc.a)) * mask;
}`

/** A CSS colour as premultiplied 0..1 RGBA, read back through a 1px 2D canvas. */
function premultiplied(cssColor: string): [number, number, number, number] {
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 1
  const ctx = c.getContext('2d')
  if (!ctx) return [0, 0, 0, 0]
  ctx.fillStyle = cssColor
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  const alpha = a / 255
  return [(r / 255) * alpha, (g / 255) * alpha, (b / 255) * alpha, alpha]
}

export const GridWaveCanvas = forwardRef<GridWaveCanvasHandle, {
  /** The grid's box and origin, CSS px. */
  boxPx: number
  originXPx: number
  originYPx: number
  /** The face, in the canvas's CSS px: its left, top and side; null for none. */
  face: { left: number; top: number; size: number } | null
  round: number
  /** The ring's inner edge as a share of its outer (1 - PULSE_RING_SHARE). */
  inner: number
  pulseColor: string
  softness: number
  waveColor: string
  /** One wave length, CSS px. */
  periodPx: number
}>(function GridWaveCanvas({ boxPx, originXPx, originYPx, face, round, inner, pulseColor, softness, waveColor, periodPx }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const launchRef = useRef<(pulse: PulseLaunch) => void>(() => {})
  const waveRef = useRef<(frame: WaveFrame) => void>(() => {})
  // The wave as last told, kept across a rebuild of the program (a prop
  // change), so the bands do not blank until the next frame arrives.
  const waveFrameRef = useRef<WaveFrame>({ angle: 0, x: 0, y: 0, share: 0, opacity: 0 })
  useImperativeHandle(ref, () => ({
    launch: (pulse) => launchRef.current(pulse),
    wave: (frame) => waveRef.current(frame),
  }), [])

  const faceLeft = face?.left ?? 0
  const faceTop = face?.top ?? 0
  const faceSize = face?.size ?? 0
  useWebGL2Canvas(canvasRef, (gl, canvas) => {
    const program = linkProgram(gl, VERTEX, FRAGMENT)
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'a')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.clearColor(0, 0, 0, 0)

    const u = (name: string) => gl.getUniformLocation(program, name)
    const half = faceSize / 2
    const hasFace = faceSize > 0
    gl.uniform1f(u('box'), boxPx)
    gl.uniform2f(u('origin'), originXPx, originYPx)
    gl.uniform1i(u('hasFace'), hasFace ? 1 : 0)
    gl.uniform1f(u('ringWidth'), hasFace && round > 0 ? 1 : 0)
    gl.uniform2f(u('centre'), faceLeft + half, faceTop + half)
    gl.uniform1f(u('half_'), Math.max(half, 1e-3))
    gl.uniform1f(u('round_'), Math.max(0, Math.min(1, round)))
    gl.uniform1f(u('inner'), inner)
    gl.uniform1f(u('softness'), softness)
    gl.uniform1f(u('growth'), RING_WIDTH_GROWTH)
    gl.uniform1f(u('cornerDim'), CORNER_DIMMING)
    gl.uniform4fv(u('tint'), premultiplied(pulseColor))
    gl.uniform4fv(u('waveTint'), premultiplied(waveColor))
    gl.uniform1f(u('period'), Math.max(periodPx, 1e-3))
    const locScale = u('scale')
    const locAlpha = u('alpha')
    const locCount = u('count')
    const locWaveOpacity = u('waveOpacity')
    const locWaveCos = u('waveCos')
    const locWaveShift = u('waveShift')
    const locWavePhase = u('wavePhase')

    const live: Array<{ start: number; pulse: PulseLaunch }> = []
    const scales = new Float32Array(MAX_PULSES)
    const alphas = new Float32Array(MAX_PULSES)
    let frame = 0
    let drawn = false
    let cssW = 0
    let cssH = 0

    const draw = (now: number) => {
      frame = 0
      for (let i = live.length - 1; i >= 0; i--) {
        if ((now - live[i].start) / 1000 >= live[i].pulse.durationSec) live.splice(i, 1)
      }
      const wave = waveFrameRef.current
      if (live.length === 0 && wave.opacity <= 0) {
        if (drawn) gl.clear(gl.COLOR_BUFFER_BIT)
        drawn = false
        return
      }
      live.forEach((entry, i) => {
        const { scale, opacity } = entry.pulse.sample(Math.max(0, (now - entry.start) / 1000))
        scales[i] = scale
        alphas[i] = Math.max(0, opacity)
      })
      // The band layer: a square as wide as the scene's diagonal, centred,
      // turned about its centre, and the band one wave length to its left,
      // moved `share` of a wave length right (GridWave's CSS layers).
      const turnSide = Math.ceil(Math.hypot(cssW, cssH))
      gl.uniform1f(locWaveOpacity, Math.max(0, wave.opacity))
      gl.uniform2f(locWaveCos, Math.cos(wave.angle), Math.sin(wave.angle))
      gl.uniform2f(locWaveShift, wave.x, wave.y)
      gl.uniform1f(locWavePhase, turnSide / 2 + periodPx - wave.share * periodPx)
      gl.uniform1i(locCount, hasFace ? live.length : 0)
      gl.uniform1fv(locScale, scales)
      gl.uniform1fv(locAlpha, alphas)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      drawn = true
      // Pulses animate on their own clock; the wave is redrawn when it is told.
      if (live.length > 0) frame = requestAnimationFrame(draw)
    }
    const request = () => { if (!frame) frame = requestAnimationFrame(draw) }

    launchRef.current = (pulse) => {
      if (live.length >= MAX_PULSES) live.shift()
      live.push({ start: performance.now(), pulse })
      request()
    }
    waveRef.current = (next) => {
      const last = waveFrameRef.current
      waveFrameRef.current = next
      if (next.opacity > 0 || last.opacity > 0) request()
    }
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      cssW = canvas.clientWidth
      cssH = canvas.clientHeight
      // Assigning a canvas's size clears it, even to the size it already has,
      // and a page zoom change leaves the device size as it was (CSS halves,
      // the pixel ratio doubles), so only a real change reassigns it.
      const width = Math.max(1, Math.round(cssW * dpr))
      const height = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(u('sizeCss'), cssW, cssH)
      gl.uniform1f(u('dpr'), dpr)
      drawn = true
      request()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    return () => {
      launchRef.current = () => {}
      waveRef.current = () => {}
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [boxPx, originXPx, originYPx, faceLeft, faceTop, faceSize, round, inner, pulseColor, softness, waveColor, periodPx])

  return (
    <canvas
      ref={canvasRef}
      className="visualizer-grid-wave-canvas"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
})
