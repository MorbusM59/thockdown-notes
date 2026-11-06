/**
 * The theme controls the visualizer's arrow boxes reach (`ThemeArrows.tsx`):
 * App publishes them (stepping the layout presets, switching light and dark)
 * and whether the mode is dark, so the scene needs no props for them.
 */

export type ThemeControls = {
  isDark: boolean
  stepLayout: (direction: 1 | -1) => void
  toggleUiMode: () => void
}

let controls: ThemeControls = { isDark: false, stepLayout: () => {}, toggleUiMode: () => {} }
const listeners = new Set<() => void>()

export function publishThemeControls(next: ThemeControls): void {
  controls = next
  for (const listener of listeners) listener()
}

export function readThemeControls(): ThemeControls {
  return controls
}

export function subscribeThemeControls(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
