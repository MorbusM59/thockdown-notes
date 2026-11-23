import { linkProgram } from '../visualizer/useWebGL2Canvas'
import {
  projectSolid,
  SOLID_QUANTIZE_STEPS,
  SOLID_STRIPE_ALPHA,
  SOLID_STRIPE_PERIOD_PX,
  SOLID_VIEWBOX,
  type SolidPlacement,
} from './EmptyStateScene'

/*
 * The solid scene (`drawSolidScene`'s picture) drawn on the GPU, so a frame
 * costs the GPU a few hundred triangles and one pass over the canvas instead
 * of the main thread a 2D path, a read-back and a per-pixel quantize, and the
 * compositor a rounded clip. Measured on a phone (2026-11-23, Adreno 710 at a
 * device pixel ratio of 3): hiding the 2D solid took the visualizer from 45 to
 * 59 fps.
 *
 * Two passes, the 2D path's two steps:
 * 1. CUT: each placed solid is drawn into its own channel (R, G, B: up to
 *    three solids, the most a swap shows at once) of an offscreen texture
 *    cleared to 1, as TRANSMITTANCE: every face multiplies it by
 *    (1 - its alpha), as same-colour layers composite in any order, and
 *    every edge by (1 - its coverage). Edges are quads round each segment
 *    whose fragments measure the distance to it, so a seam is a round-capped
 *    line of the stroke's width with a one-pixel soft edge; faces are their
 *    own triangles (a projected face is convex, so a fan), unsmoothed: a
 *    face's edge is a step of at most 7.5% ink (0.5 alpha of 0.15) and the
 *    quantize steps it anyway.
 * 2. SHOW: per pixel, each channel's alpha is quantized to SOLID_QUANTIZE_STEPS
 *    levels (the 2D path's `QUANTIZE_TABLE`, the same rule), and the stripes'
 *    ink is cut by each solid in turn and by the canvas's rounded corners.
 */

/** Solids drawn at once: one per colour channel of the cut texture. */
export const MAX_SOLID_PLACEMENTS = 3

/** Floats per vertex: position, segment start and end, half width (negative for a face), alpha. */
const STRIDE = 8

const CUT_VERTEX = `#version 300 es
in vec2 pos; in vec4 seg; in vec2 shape;
uniform vec2 size;
out vec2 p; out vec4 s; out vec2 k;
void main() {
  p = pos; s = seg; k = shape;
  gl_Position = vec4(pos.x / size.x * 2.0 - 1.0, 1.0 - pos.y / size.y * 2.0, 0.0, 1.0);
}`

const CUT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 p; in vec4 s; in vec2 k;
out vec4 color;
void main() {
  if (k.x < 0.0) { color = vec4(k.y); return; }
  vec2 ab = s.zw - s.xy;
  float t = clamp(dot(p - s.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float d = length(p - s.xy - ab * t) - k.x;
  color = vec4(clamp(0.5 - d, 0.0, 1.0));
}`

const SHOW_VERTEX = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`

const SHOW_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D cut;
uniform vec2 size;      // device px
uniform float radius;   // device px
uniform float period;   // the stripes' horizontal period, device px
uniform float band;     // the stripe's horizontal width, device px
uniform float ink;
out vec4 color;
float quantized(float transmittance) {
  float v = floor((1.0 - transmittance) * 255.0 + 0.5);
  return min(${SOLID_QUANTIZE_STEPS - 1}.0, floor(v * ${SOLID_QUANTIZE_STEPS}.0 / 255.0)) / ${SOLID_QUANTIZE_STEPS - 1}.0;
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  vec2 q = abs(px - size * 0.5) - (size * 0.5 - radius);
  float corner = clamp(0.5 - (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius), 0.0, 1.0);
  // The 45deg stripes run from top left to bottom right: x - y constant.
  float t = mod(px.x - px.y, period);
  float d = min(max(-t, t - band), period - t);
  float stripe = clamp(0.5 - d * 0.70710678, 0.0, 1.0);
  vec3 c = texelFetch(cut, ivec2(gl_FragCoord.xy), 0).rgb;
  float keep = (1.0 - quantized(c.r)) * (1.0 - quantized(c.g)) * (1.0 - quantized(c.b));
  color = vec4(0.0, 0.0, 0.0, ink * stripe * corner * keep);
}`

export interface SolidShader {
  /** The canvas's drawing buffer size, device px, and its device pixel ratio. */
  resize: (width: number, height: number, dpr: number) => void
  /** Draws the scene: the first MAX_SOLID_PLACEMENTS placements, corners rounded by `cornerRadiusPx` (CSS px). */
  draw: (placements: readonly SolidPlacement[], cornerRadiusPx: number) => void
  dispose: () => void
}

/** Largest vertex count a placement can take: 36 face triangles (the dodecahedron) and 30 edge quads. */
const MAX_VERTICES = MAX_SOLID_PLACEMENTS * (36 * 3 + 30 * 6)

export function createSolidShader(gl: WebGL2RenderingContext): SolidShader {
  const cut = linkProgram(gl, CUT_VERTEX, CUT_FRAGMENT)
  const show = linkProgram(gl, SHOW_VERTEX, SHOW_FRAGMENT)

  const cutVao = gl.createVertexArray()!
  gl.bindVertexArray(cutVao)
  const cutBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, cutBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, MAX_VERTICES * STRIDE * 4, gl.DYNAMIC_DRAW)
  const attribute = (name: string, count: number, offset: number) => {
    const loc = gl.getAttribLocation(cut, name)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, count, gl.FLOAT, false, STRIDE * 4, offset * 4)
  }
  attribute('pos', 2, 0)
  attribute('seg', 4, 2)
  attribute('shape', 2, 6)

  const showVao = gl.createVertexArray()!
  gl.bindVertexArray(showVao)
  const showBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, showBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const showLoc = gl.getAttribLocation(show, 'a')
  gl.enableVertexAttribArray(showLoc)
  gl.vertexAttribPointer(showLoc, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)

  const texture = gl.createTexture()
  const framebuffer = gl.createFramebuffer()
  const cutSize = gl.getUniformLocation(cut, 'size')
  const showSize = gl.getUniformLocation(show, 'size')
  const showRadius = gl.getUniformLocation(show, 'radius')
  const showPeriod = gl.getUniformLocation(show, 'period')
  const showBand = gl.getUniformLocation(show, 'band')
  gl.useProgram(show)
  gl.uniform1i(gl.getUniformLocation(show, 'cut'), 0)
  gl.uniform1f(gl.getUniformLocation(show, 'ink'), SOLID_STRIPE_ALPHA)

  const vertices = new Float32Array(MAX_VERTICES * STRIDE)
  let width = 1
  let height = 1
  let dpr = 1

  const resize = (nextWidth: number, nextHeight: number, nextDpr: number) => {
    width = nextWidth
    height = nextHeight
    dpr = nextDpr
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(cut)
    gl.uniform2f(cutSize, width, height)
    gl.useProgram(show)
    gl.uniform2f(showSize, width, height)
    // The 2D path's stripe tile: one period rounded to whole device pixels, the band not.
    gl.uniform1f(showPeriod, Math.max(1, Math.round(SOLID_STRIPE_PERIOD_PX * Math.SQRT2 * dpr)))
    gl.uniform1f(showBand, (SOLID_STRIPE_PERIOD_PX / 2) * Math.SQRT2 * dpr)
  }

  let used = 0
  const push = (x: number, y: number, ax: number, ay: number, bx: number, by: number, halfWidth: number, alpha: number) => {
    const o = used * STRIDE
    vertices[o] = x
    vertices[o + 1] = y
    vertices[o + 2] = ax
    vertices[o + 3] = ay
    vertices[o + 4] = bx
    vertices[o + 5] = by
    vertices[o + 6] = halfWidth
    vertices[o + 7] = alpha
    used += 1
  }

  /** Appends one placement's triangles; returns false when it is wholly outside the canvas. */
  const build = ({ scene, timeSec, scale, offsetY }: SolidPlacement): boolean => {
    const restSide = Math.min(width, height)
    const side = restSide * scale
    const top = (height - side) / 2 + offsetY * restSide
    if (top >= height || top + side <= 0) return false
    const left = (width - side) / 2
    const unit = side / SOLID_VIEWBOX
    const projected = projectSolid(scene, timeSec).map(([x, y]) => [left + x * unit, top + y * unit] as const)
    scene.faces.forEach((face, faceIndex) => {
      const alpha = scene.faceAlphas[faceIndex]
      const [x0, y0] = projected[face[0]]
      for (let i = 1; i + 1 < face.length; i += 1) {
        const [x1, y1] = projected[face[i]]
        const [x2, y2] = projected[face[i + 1]]
        push(x0, y0, 0, 0, 0, 0, -1, alpha)
        push(x1, y1, 0, 0, 0, 0, -1, alpha)
        push(x2, y2, 0, 0, 0, 0, -1, alpha)
      }
    })
    const half = (scene.strokeWidth * unit) / 2
    // The quad reaches a pixel past the cap, where the soft edge ends.
    const reach = half + 1
    for (const [from, to] of scene.edges) {
      const [ax, ay] = projected[from]
      const [bx, by] = projected[to]
      const length = Math.hypot(bx - ax, by - ay)
      const dx = length > 1e-6 ? (bx - ax) / length : 1
      const dy = length > 1e-6 ? (by - ay) / length : 0
      const ex = dx * reach
      const ey = dy * reach
      const p0x = ax - ex - ey, p0y = ay - ey + ex
      const p1x = ax - ex + ey, p1y = ay - ey - ex
      const p2x = bx + ex - ey, p2y = by + ey + ex
      const p3x = bx + ex + ey, p3y = by + ey - ex
      push(p0x, p0y, ax, ay, bx, by, half, 1)
      push(p1x, p1y, ax, ay, bx, by, half, 1)
      push(p2x, p2y, ax, ay, bx, by, half, 1)
      push(p1x, p1y, ax, ay, bx, by, half, 1)
      push(p3x, p3y, ax, ay, bx, by, half, 1)
      push(p2x, p2y, ax, ay, bx, by, half, 1)
    }
    return true
  }

  const ranges: Array<[number, number]> = []
  const draw = (placements: readonly SolidPlacement[], cornerRadiusPx: number) => {
    used = 0
    ranges.length = 0
    // The newest placements: in a swap the arriving solid is last and the
    // oldest fallers have dropped furthest.
    for (const placement of placements.slice(-MAX_SOLID_PLACEMENTS)) {
      const start = used
      if (build(placement)) ranges.push([start, used - start])
    }

    gl.viewport(0, 0, width, height)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.colorMask(true, true, true, true)
    gl.clearColor(1, 1, 1, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (ranges.length > 0) {
      gl.useProgram(cut)
      gl.bindVertexArray(cutVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, cutBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, used * STRIDE)
      gl.enable(gl.BLEND)
      // dst = dst x (1 - src.a): transmittance, in any order.
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA)
      ranges.forEach(([first, count], channel) => {
        gl.colorMask(channel === 0, channel === 1, channel === 2, false)
        gl.drawArrays(gl.TRIANGLES, first, count)
      })
      gl.disable(gl.BLEND)
      gl.colorMask(true, true, true, true)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(show)
    gl.uniform1f(showRadius, Math.max(0, Math.min(cornerRadiusPx * dpr, width / 2, height / 2)))
    gl.bindVertexArray(showVao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  const dispose = () => {
    gl.deleteFramebuffer(framebuffer)
    gl.deleteTexture(texture)
    gl.deleteBuffer(cutBuffer)
    gl.deleteBuffer(showBuffer)
    gl.deleteVertexArray(cutVao)
    gl.deleteVertexArray(showVao)
    gl.deleteProgram(cut)
    gl.deleteProgram(show)
  }

  return { resize, draw, dispose }
}
