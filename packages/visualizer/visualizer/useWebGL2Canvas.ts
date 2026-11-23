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

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const onLost = (event: Event) => event.preventDefault()
    const onRestored = () => setGeneration((g) => g + 1)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      const gl = canvas.getContext('webgl2')
      if (gl && !gl.isContextLost()) loseRef.current?.loseContext()
    }
  }, [ref])

  useEffect(() => {
    const canvas = ref.current
    const gl = canvas?.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false })
    if (!canvas || !gl) return
    if (gl.isContextLost()) {
      // Released by this component's own unmount: ask for it back. A loss the
      // GPU caused is restored by the browser, and restoreContext declines it.
      loseRef.current?.restoreContext()
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
