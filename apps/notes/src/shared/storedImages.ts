import { useSyncExternalStore } from 'react'
import { normalizeImageId, type ImageImportRequest, type ImageImportResult, type ResolvedImage } from './images'

// What each stored image id shows, as the renderer knows it: one module store
// (like remoteImages.ts) because the preview's `img` component sits at the
// bottom of the markdown renderer and every image on screen asks for its own
// id. Lookups made in the same tick go to the main process as one request.
//
// An entry is `undefined` until its answer arrives, `null` when no image has
// that id. An id's answer only changes when an image is imported under it,
// which goes through importStoredImage below and so forgets the old answer.

const resolved = new Map<string, ResolvedImage | null>()
const requested = new Set<string>()
const listeners = new Set<() => void>()
let batch: string[] | null = null

function notify(): void {
  for (const listener of listeners) listener()
}

function request(id: string): void {
  if (requested.has(id)) return
  requested.add(id)
  if (batch) {
    batch.push(id)
    return
  }
  batch = [id]
  queueMicrotask(() => {
    const ids = batch ?? []
    batch = null
    const api = window.thockdownImages
    if (!api) {
      for (const each of ids) resolved.set(each, null)
      notify()
      return
    }
    void api.resolveImages(ids).then((answers) => {
      for (const each of ids) resolved.set(each, answers[each] ?? null)
      notify()
    }, () => {
      // Not cached as missing: asking again on the next render is right.
      for (const each of ids) requested.delete(each)
    })
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** What `src` (an `&ID`) shows: undefined while asking, null when nothing is stored under it. */
export function useStoredImage(src: string): ResolvedImage | null | undefined {
  const id = normalizeImageId(src)
  const read = () => (id ? resolved.get(id) : null)
  const value = useSyncExternalStore(subscribe, read, read)
  if (id && value === undefined) request(id)
  return value
}

/** Stores an image through the main process, so the next lookup of its id sees it. */
export async function importStoredImage(importRequest: ImageImportRequest): Promise<ImageImportResult> {
  const api = window.thockdownImages
  if (!api) return { ok: false, reason: 'not-an-image' }
  const result = await api.importImage(importRequest)
  if (result.ok) {
    resolved.delete(result.id)
    requested.delete(result.id)
    notify()
  }
  return result
}
