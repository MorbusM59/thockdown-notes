/**
 * Whether the visualizer's panels are shown: the song list, the bucket list,
 * the pool filter and the level bars, shown together. Typing into the scene
 * shows them (App.tsx, `PoolFilter.tsx`) and Escape toggles them. The scene
 * reads it as a class (`is-panels-hidden`) that fades them (visualizer.css).
 */

let shown = true
const listeners = new Set<() => void>()

export function readPanelsShown(): boolean {
  return shown
}

export function setPanelsShown(next: boolean): void {
  if (next === shown) return
  shown = next
  for (const listener of listeners) listener()
}

export function subscribePanelsShown(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
