import { reportFailure } from '@thockdown/audio/healthLog'
import { useEffect, useRef, useState, type DependencyList, type RefObject } from 'react'

/**
 * Runs `setup` against a canvas's WebGL2 context and owns that context's
 * lifetime, which a component cannot leave to the browser.
 *
 * A WebGL context and its drawing buffer belong to the GPU process and are
 * freed only when the canvas element is garbage collected, which can be long
 * after it was unmounted. Every remount of a visualizer canvas therefore left
 * a full-screen drawing buffer behind, and switching layouts repeatedly ran the
 * GPU out of memory (GL_OUT_OF_MEMORY allocating a Texture2D, then the context
 * lost and the scene black). On unmount the context is released explicitly
 * through WEBGL_lose_context.
 *
 * A lost context (released here, or lost by the GPU) is recovered rather than
 * left dead: `webglcontextlost` is cancelled so the browser may restore it,
 * `webglcontextrestored` runs `setup` again on the new context, and a mount
 * that finds the context released by its own earlier unmount (React's
 * development double mount) asks for it back.
 */
export function useWebGL2Canvas(
  ref: RefObject<HTMLCanvasElement | null>,
  setup: (gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) => (() => void) | void,
  deps: DependencyList,
): void {
  const [generation, setGeneration] = useState(0)
  const loseRef = useRef<WEBGL_lose_context | null>(null)
  // A context released by this component's own unmount can be asked back
  // only once its loss has been DISPATCHED (Chromium refuses restoreContext
  // before the webglcontextlost event, which is queued, not synchronous),
  // and React's development double mount remounts before that. So a mount
  // that finds the context lost asks for it at once if the loss has been
  // seen, and otherwise when it is.
  const lossSeenRef = useRef(false)
  const restorePendingRef = useRef(false)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let releasing = false
    const onLost = (event: Event) => {
      event.preventDefault()
      lossSeenRef.current = true
      // A loss this component did not cause (the GPU process reset, the
      // driver took it back) is a failure; the browser restores it, and
      // `onRestored` sets the scene up again.
      if (!releasing) reportFailure('visualizer', `WebGL context lost on a ${canvas.width}x${canvas.height} canvas`)
      // The browser decides whether the loss may be restored once this
      // listener has RETURNED (by whether it cancelled the event), so the
      // pending restore is asked for after the dispatch, not inside it (a
      // microtask would still run inside it, at the listener's checkpoint).
      if (restorePendingRef.current) {
        restorePendingRef.current = false
        setTimeout(() => loseRef.current?.restoreContext(), 0)
      }
    }
    const onRestored = () => {
      lossSeenRef.current = false
      setGeneration((g) => g + 1)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    return () => {
      // Released while the loss listener is still attached: loseContext
      // dispatches webglcontextlost synchronously, and only a loss whose
      // event was cancelled may be restored, so releasing after removing it
      // left a remount's context dead for good.
      const gl = canvas.getContext('webgl2')
      releasing = true
      if (gl && !gl.isContextLost()) loseRef.current?.loseContext()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }
  }, [ref])

  useEffect(() => {
    const canvas = ref.current
    const gl = canvas?.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false })
    if (!canvas || !gl) return
    if (gl.isContextLost()) {
      // Released by this component's own unmount: ask for it back. A loss the
      // GPU caused is restored by the browser, and restoreContext declines it.
      if (lossSeenRef.current) loseRef.current?.restoreContext()
      else restorePendingRef.current = true
      return
    }
    loseRef.current = gl.getExtension('WEBGL_lose_context')
    return setup(gl, canvas) ?? undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, generation])
}

/** Compiles and links a program; the shaders are deleted once linked, since the program keeps what it needs. */
export function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!
  const shaders = [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]].map(([type, src]) => {
    const shader = gl.createShader(type as number)!
    gl.shaderSource(shader, src as string)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
    return shader
  })
  gl.linkProgram(program)
  for (const shader of shaders) { gl.detachShader(program, shader); gl.deleteShader(shader) }
  return program
}
