import { useSyncExternalStore } from 'react'
import { beginBackgroundWork } from './backgroundWork'
import { normalizeImageId, type ImageImportRequest, type ImageImportResult, type ImageSourceRequest, type ImageSourceResult, type ResolvedImage } from './images'

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
      // The main process could not answer; shown as not found rather than
      // re-asked on a timer. Importing under one of these ids, or a reload,
      // asks again.
      for (const each of ids) resolved.set(each, null)
      notify()
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

function forget(id: string): void {
  resolved.delete(id)
  requested.delete(id)
}

/** What a set of ids shows, asked directly (the image button needs origins, not a render). */
export async function resolveStoredImages(ids: string[]): Promise<Record<string, ResolvedImage | null>> {
  const api = window.thockdownImages
  if (!api || ids.length === 0) return {}
  return api.resolveImages(ids)
}

/** Fetches and stores what notes point at, so the next lookup of each new id sees it. */
export async function storeImageSources(requests: ImageSourceRequest[]): Promise<Record<string, ImageSourceResult>> {
  const api = window.thockdownImages
  if (!api || requests.length === 0) return {}
  // Downloads can take a while; the work indicator says the app is on it.
  const work = beginBackgroundWork('image-store')
  const results = await api.storeImageSources(requests).finally(() => work.done())
  for (const result of Object.values(results)) if (result.ok) forget(result.id)
  notify()
  return results
}

/** Stores an image through the main process, so the next lookup of its id sees it. */
export async function importStoredImage(importRequest: ImageImportRequest): Promise<ImageImportResult> {
  const api = window.thockdownImages
  if (!api) return { ok: false, reason: 'not-an-image' }
  const result = await api.importImage(importRequest)
  if (result.ok) {
    forget(result.id)
    notify()
  }
  return result
}
