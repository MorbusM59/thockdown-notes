/** false = the visualizer draws its linear glaze stacks as the old CSS layers (for comparing against GlazeStripesCanvas.tsx). */
export const USE_SHADER_GLAZE = true

export function canUseShaderGlaze(): boolean {
  if (!USE_SHADER_GLAZE || typeof document === 'undefined') return false
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}


/** false = the centre pulse is drawn as the old scaled CSS rings (for comparing against PulseRingsCanvas.tsx). */
export const USE_SHADER_PULSE = true

export function canUseShaderPulse(): boolean {
  if (!USE_SHADER_PULSE || typeof document === 'undefined') return false
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}
