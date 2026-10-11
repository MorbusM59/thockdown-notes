import { useSyncExternalStore } from 'react'

// WHETHER A NOTE MAY LOAD IMAGES FROM THE WEB. Off by default, because the
// app is otherwise local-only: a remote image is fetched from its server
// every time the note renders, and that server sees the request.
//
// The setting is persisted as `PersistedMenuState.allowRemoteImages`, and
// the main process enforces it independently (electron/networkIsolation.ts
// cancels every web request except, while this is on, image requests), so
// the renderer's copy decides only what the preview DRAWS.
//
// A module store rather than a prop: the preview's `img` component sits at
// the bottom of the markdown renderer, and the export renders the same
// component outside React's tree.

let allowed = false
const listeners = new Set<() => void>()

export function getRemoteImagesAllowed(): boolean {
  return allowed
}

export function setRemoteImagesAllowed(next: boolean): void {
  if (next === allowed) return
  allowed = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useRemoteImagesAllowed(): boolean {
  return useSyncExternalStore(subscribe, getRemoteImagesAllowed, getRemoteImagesAllowed)
}

/** Whether `src` is an image the setting governs: one fetched over the web. */
export function isRemoteImageSrc(src: string | undefined): boolean {
  if (!src) return false
  try {
    const { protocol } = new URL(src)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
