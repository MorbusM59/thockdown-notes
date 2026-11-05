/**
 * Whether the visualizer's panels are shown: the song list, the bucket list,
 * the pool filter and the level bars, toggled together by Tab. The scene
 * reads it as a class (`is-panels-hidden`) that fades them (visualizer.css).
 */

let shown = true
const listeners = new Set<() => void>()

export function readPanelsShown(): boolean {
  return shown
}

export function togglePanelsShown(): void {
  shown = !shown
  for (const listener of listeners) listener()
}

export function subscribePanelsShown(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
