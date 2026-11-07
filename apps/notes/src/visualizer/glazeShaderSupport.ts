/** false = the visualizer draws its linear glaze stacks as the old CSS layers (for comparing against GlazeStripesCanvas.tsx). */
export const USE_SHADER_GLAZE = true

export function canUseShaderGlaze(): boolean {
  if (!USE_SHADER_GLAZE || typeof document === 'undefined') return false
  return hasWebGL2()
}


/** false = the centre pulse is drawn as the old scaled CSS rings (for comparing against PulseRingsCanvas.tsx). */
export const USE_SHADER_PULSE = true

export function canUseShaderPulse(): boolean {
  if (!USE_SHADER_PULSE || typeof document === 'undefined') return false
  return hasWebGL2()
}

let webgl2: boolean | null = null

/**
 * Whether WebGL2 is available, probed once per page and with the probe's
 * context released at once: each probe is a GPU context of its own, kept
 * until its canvas is collected, and the visualizer asked on every mount.
 */
function hasWebGL2(): boolean {
  if (webgl2 !== null) return webgl2
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    webgl2 = gl !== null
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl2 = false
  }
  return webgl2
}
