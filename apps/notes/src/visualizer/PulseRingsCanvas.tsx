import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/*
 * The centre pulse drawn as a real WAVEFRONT by one WebGL2 shader, in place of
 * the stack of prerendered rings GridWave.tsx otherwise scales.
 *
 * Why: scaling a ring of the face's shape keeps its corners as sharp as the
 * face's, which is right for a circle and wrong for anything else. A wave sent
 * out by a square is the set of points a fixed distance from its edge: the
 * sides move out straight and each corner rounds off into an arc whose radius
 * grows with the distance travelled, so the front tends to a circle. The
 * shader measures that distance per pixel (the rounded box's signed distance,
 * `roundedSquareOffsetGauge` in `@thockdown/look/visualizer`) and draws each
 * pulse's ring on it. For a circular face it is pixel for pixel the scaled
 * ring, so the round case looks as it did.
 *
 * A pulse keeps GridWave's numbers: its `scale` (where the old layer would
 * have been scaled to) and opacity, sampled each frame from the same travel
 * curve. The ring lies between `inner × scale` and `scale` on the gauge, so
 * it widens as it travels, as before. The canvas covers the scene inside the
 * grid-line mask, draws only while a pulse is out (scissored to the square
 * the outermost ring can reach), and clears once when the last one ends.
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

export interface PulseRingsHandle { launch: (pulse: PulseLaunch) => void }

const VERTEX = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 sizeCss;
uniform float dpr;
uniform vec2 centre;       // the face's centre, CSS px from the canvas's top left
uniform float half_;       // the face's half-side, CSS px
uniform float round_;      // corner radius, share of the half-side
uniform float inner;       // the ring's inner edge, share of its outer
uniform float softness;
uniform float growth;
uniform float cornerDim;
uniform vec4 tint;         // premultiplied
uniform int count;
uniform float scale[${MAX_PULSES}];
uniform float alpha[${MAX_PULSES}];
out vec4 color;
float strength(float g, float inr) {
  if (g <= inr || g >= 1.0) return 0.0;
  float u = 2.0 * (g - inr) / (1.0 - inr) - 1.0;
  float x = min(1.0, (1.0 - abs(u)) / max(softness, 1e-3));
  return x * x * (3.0 - 2.0 * x);
}
void main() {
  vec2 p = (vec2(gl_FragCoord.x, sizeCss.y * dpr - gl_FragCoord.y) / dpr - centre) / half_;
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
  color = acc;
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

export const PulseRingsCanvas = forwardRef<PulseRingsHandle, {
  /** The face, in the canvas's CSS px: its left, top and side. */
  face: { left: number; top: number; size: number }
  round: number
  /** The ring's inner edge as a share of its outer (1 - PULSE_RING_SHARE). */
  inner: number
  color: string
  softness: number
}>(function PulseRingsCanvas({ face, round, inner, color, softness }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const launchRef = useRef<(pulse: PulseLaunch) => void>(() => {})
  useImperativeHandle(ref, () => ({ launch: (pulse) => launchRef.current(pulse) }), [])

  useEffect(() => {
    const canvas = canvasRef.current
    const gl = canvas?.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false })
    if (!canvas || !gl) return
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      return shader
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'a')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.clearColor(0, 0, 0, 0)

    const u = (name: string) => gl.getUniformLocation(program, name)
    const half = face.size / 2
    gl.uniform2f(u('centre'), face.left + half, face.top + half)
    gl.uniform1f(u('half_'), half)
    gl.uniform1f(u('round_'), Math.max(0, Math.min(1, round)))
    gl.uniform1f(u('inner'), inner)
    gl.uniform1f(u('softness'), softness)
    gl.uniform1f(u('growth'), RING_WIDTH_GROWTH)
    gl.uniform1f(u('cornerDim'), CORNER_DIMMING)
    gl.uniform4fv(u('tint'), premultiplied(color))
    const locScale = u('scale')
    const locAlpha = u('alpha')
    const locCount = u('count')

    const live: Array<{ start: number; pulse: PulseLaunch }> = []
    const scales = new Float32Array(MAX_PULSES)
    const alphas = new Float32Array(MAX_PULSES)
    let dpr = 1
    let frame = 0
    let drawn = false

    const draw = (now: number) => {
      frame = 0
      for (let i = live.length - 1; i >= 0; i--) {
        if ((now - live[i].start) / 1000 >= live[i].pulse.durationSec) live.splice(i, 1)
      }
      gl.disable(gl.SCISSOR_TEST)
      if (live.length === 0) {
        if (drawn) gl.clear(gl.COLOR_BUFFER_BIT)
        drawn = false
        return
      }
      let reach = 0
      live.forEach((entry, i) => {
        const { scale, opacity } = entry.pulse.sample(Math.max(0, (now - entry.start) / 1000))
        scales[i] = scale
        alphas[i] = Math.max(0, opacity)
        reach = Math.max(reach, scale)
      })
      // The outermost ring lies within `reach` half-sides of the centre on
      // the gauge, so within a square of that half-side (the gauge is at least
      // the larger coordinate): nothing outside it is drawn.
      const cx = (face.left + half) * dpr
      const cy = canvas.height - (face.top + half) * dpr
      const r = Math.ceil(reach * half * dpr) + 2
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(Math.floor(cx - r), Math.floor(cy - r), 2 * r, 2 * r)
      gl.uniform1i(locCount, live.length)
      gl.uniform1fv(locScale, scales)
      gl.uniform1fv(locAlpha, alphas)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      drawn = true
      frame = requestAnimationFrame(draw)
    }
    const request = () => { if (!frame) frame = requestAnimationFrame(draw) }

    launchRef.current = (pulse) => {
      if (live.length >= MAX_PULSES) live.shift()
      live.push({ start: performance.now(), pulse })
      request()
    }
    const resize = () => {
      dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(cssW * dpr))
      canvas.height = Math.max(1, Math.round(cssH * dpr))
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
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [face.left, face.top, face.size, round, inner, color, softness])

  return (
    <canvas
      ref={canvasRef}
      className="visualizer-grid-wave-pulse-canvas"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }}
    />
  )
})
