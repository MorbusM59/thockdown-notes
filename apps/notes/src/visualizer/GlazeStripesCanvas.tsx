import { useEffect, useRef } from 'react'
import type { GlazeStripe } from '@thockdown/look/loadoutTheme'
import { registerLinearSlide } from './parallaxSway'

/*
 * The glaze's linear stacks, drawn by ONE WebGL2 shader on ONE canvas rather
 * than as one promoted CSS layer per stack.
 *
 * Why: a CSS stack in the visualizer is an element larger than the screen,
 * rasterized whole and blended by the compositor every frame. Five of them
 * were the visualizer's largest GPU-memory cost (Chromium's "tile memory
 * limits exceeded") and its largest per-frame blending cost. A stack is a
 * one-dimensional pattern, though: lit stripes along one direction, repeating
 * every period. So each stack is stored as ONE ROW of a small texture (one
 * texel per CSS px of its period) and the shader looks every stack up per
 * screen pixel, each at its own offset: one screen of fill, no large images,
 * parallax intact.
 *
 * What differs from the CSS stacks (the thing to judge by eye): each CSS
 * stack blended onto the scene by `mix-blend-mode: luminosity` on its own.
 * A shader cannot read the page behind it, so here the stacks are composited
 * onto EACH OTHER ("over", nearest on top) and the result blends onto the
 * scene once, by `CANVAS_BLEND_MODE`. `STACK_GAIN` scales every stack's alpha
 * to compensate if that reads flatter.
 *
 * Used for the still glaze (App's `ThemeGlazeLayers` path) and the swayed one
 * (`VisualizerGlaze.tsx`) alike, so the two look the same. `USE_SHADER_GLAZE`
 * switches both back to the CSS stacks for an A/B; the CSS stacks are also
 * what runs where WebGL2 is unavailable.
 */

// ---- Tuning: the parameters to adjust by eye ---------------------------------
// (The A/B switch, USE_SHADER_GLAZE, is in glazeShaderSupport.ts.)
/** How the finished canvas blends onto the scene (any CSS mix-blend-mode). */
export const CANVAS_BLEND_MODE = 'luminosity'
/** Multiplies every stripe's alpha (1 = the stack's own alpha). */
export const STACK_GAIN = 1
/** Edge softness of a stripe in CSS px (0 = hard edges, like the CSS gradient). */
export const EDGE_SOFTNESS_PX = 0
// -----------------------------------------------------------------------------

export type ShaderStack = { stripes: GlazeStripe[]; periodPx: number; share: number }
/** Index and depth per stack (as `swayDepth` gives them) when the stacks sway; null for the still glaze. */
export type StackSway = { index: number; depth: number } | null

const MAX_STACKS = 8

const VERTEX = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D rows;         // one row per stack, premultiplied RGBA, 1 texel per CSS px
uniform int count;
uniform float period[${MAX_STACKS}];   // CSS px
uniform float offset[${MAX_STACKS}];   // CSS px along the gradient (the sway)
uniform float share[${MAX_STACKS}];    // each stack's opacity
uniform vec2 dir;               // the gradient's direction on screen (y down)
uniform vec2 sizeCss;
uniform float dpr;
out vec4 color;
vec4 rowAt(int i, float u) {
  float t = u - period[i] * floor(u / period[i]);
  float x0 = floor(t - 0.5);
  float f = t - 0.5 - x0;
  int w = int(ceil(period[i]));
  int a = int(x0); if (a < 0) a += w;
  int b = a + 1; if (b >= w) b -= w;
  return mix(texelFetch(rows, ivec2(a, i), 0), texelFetch(rows, ivec2(b, i), 0), f);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, sizeCss.y * dpr - gl_FragCoord.y) / dpr - sizeCss * 0.5;
  float along = dot(p, dir);
  vec4 acc = vec4(0.0);
  // Farthest (last) first, so the nearest ends on top.
  for (int i = ${MAX_STACKS - 1}; i >= 0; i--) {
    if (i >= count) continue;
    vec4 c = rowAt(i, along - offset[i]) * share[i];
    acc = c + acc * (1.0 - c.a);
  }
  color = acc;
}`

/** One row of premultiplied RGBA per stack, a texel per CSS px, with each pixel's coverage of a stripe as its weight. */
function buildRows(stacks: ShaderStack[]): { data: Uint8Array; width: number } {
  const width = Math.max(1, ...stacks.map((s) => Math.ceil(s.periodPx)))
  const data = new Uint8Array(width * stacks.length * 4)
  const soft = Math.max(0, EDGE_SOFTNESS_PX)
  stacks.forEach((stack, row) => {
    const w = Math.ceil(stack.periodPx)
    for (const stripe of stack.stripes) {
      const [r, g, b, alpha] = stripe.rgba
      const a = Math.min(1, alpha * STACK_GAIN)
      for (let x = Math.floor(stripe.startPx - soft); x < Math.ceil(stripe.endPx + soft); x += 1) {
        // Coverage of [x, x+1) by the stripe, its edges ramped over `soft`.
        const lo = Math.max(x, stripe.startPx - soft / 2)
        const hi = Math.min(x + 1, stripe.endPx + soft / 2)
        const cover = Math.max(0, hi - lo)
        if (cover <= 0) continue
        const xi = ((x % w) + w) % w
        const k = (row * width + xi) * 4
        const add = a * cover
        const keep = 1 - add
        data[k] = Math.round(r * add + data[k] * keep)
        data[k + 1] = Math.round(g * add + data[k + 1] * keep)
        data[k + 2] = Math.round(b * add + data[k + 2] * keep)
        data[k + 3] = Math.round(255 * add + data[k + 3] * keep)
      }
    }
  })
  return { data, width }
}

export function GlazeStripesCanvas({ stacks, sway, angleDeg, className }: {
  stacks: ShaderStack[]
  /** Per stack, in the same order; omit for the still glaze. */
  sway?: StackSway[]
  /** The gradient's CSS angle (clockwise from up). */
  angleDeg: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    const gl = canvas?.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false })
    if (!canvas || !gl) return
    const used = stacks.slice(0, MAX_STACKS)
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

    const { data, width } = buildRows(used)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, Math.max(1, used.length), 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    const u = (name: string) => gl.getUniformLocation(program, name)
    const radians = (angleDeg * Math.PI) / 180
    gl.uniform2f(u('dir'), Math.sin(radians), -Math.cos(radians))
    gl.uniform1i(u('count'), used.length)
    const pad = (values: number[]) => { const out = new Float32Array(MAX_STACKS); out.set(values); return out }
    gl.uniform1fv(u('period'), pad(used.map((s) => s.periodPx)))
    gl.uniform1fv(u('share'), pad(used.map((s) => s.share)))
    const offsets = new Float32Array(MAX_STACKS)

    let frame = 0
    const draw = () => {
      frame = 0
      gl.uniform1fv(u('offset'), offsets)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const request = () => { if (!frame) frame = requestAnimationFrame(draw) }
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
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
      // Drawn now rather than on the next frame: a ResizeObserver runs before
      // the frame paints, so the stripes at the new size land in the same
      // frame as the layout that resized them.
      if (frame) cancelAnimationFrame(frame)
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    // The sway hands each stack its offset once a frame; the redraw waits for the frame.
    const unregister = (sway ?? []).slice(0, used.length).map((entry, i) => entry
      ? registerLinearSlide(entry.index, entry.depth, angleDeg, (along) => { offsets[i] = along; request() })
      : () => {})
    return () => {
      for (const off of unregister) off()
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      gl.deleteTexture(texture)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [stacks, sway, angleDeg])
  return (
    <canvas
      ref={ref}
      className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', mixBlendMode: CANVAS_BLEND_MODE as never }}
    />
  )
}
