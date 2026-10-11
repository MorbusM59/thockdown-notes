import { useEffect, useSyncExternalStore } from 'react'
import { imageReferenceRenameEdits, normalizeImageId, type ImageRenameResult, type StoredImageSummary } from '../shared/images'
import { invalidateStoredImage, onStoredImagesChanged } from '../shared/storedImages'

// THE IMAGE LIBRARY'S LIST: every stored image, as the main process answers
// (listImages), held in one module store. It is re-asked whenever something
// that could change it happens -- an image stored, tagged, trashed, restored
// or purged (each of which calls invalidateImageLibrary), or the library
// coming into view, since saving a note changes which images are in use and
// that is answered by the reference index rather than told to anyone.

let images: readonly StoredImageSummary[] = []
let loaded = false
let generation = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Asks the main process for the list again; the answer of the newest ask wins. */
export function invalidateImageLibrary(): void {
  const api = window.thockdownImages
  if (!api) return
  const ask = ++generation
  void api.listImages().then((next) => {
    if (ask !== generation) return
    images = next
    loaded = true
    notify()
  }, () => {
    // Left as it was; the next change or the library coming into view asks again.
  })
}

onStoredImagesChanged(invalidateImageLibrary)

const snapshot = () => images
const loadedSnapshot = () => loaded

/** Every stored image, newest first, and whether the first answer has arrived; re-asked when the caller mounts. */
export function useImageLibrary(): { images: readonly StoredImageSummary[]; loaded: boolean } {
  useEffect(() => { invalidateImageLibrary() }, [])
  return {
    images: useSyncExternalStore(subscribe, snapshot, snapshot),
    loaded: useSyncExternalStore(subscribe, loadedSnapshot, loadedSnapshot),
  }
}

/** One image of the library by id: null when it is not (or no longer) stored. */
export function useLibraryImage(imageId: string | null): { image: StoredImageSummary | null; loaded: boolean } {
  const { images, loaded } = useImageLibrary()
  return { image: imageId ? images.find((each) => each.id === imageId) ?? null : null, loaded }
}

export async function setImageTags(id: string, tags: string[]): Promise<string[]> {
  const kept = (await window.thockdownImages?.setImageTags(id, tags)) ?? []
  invalidateImageLibrary()
  return kept
}

export async function setImageTrashed(id: string, trashed: boolean): Promise<void> {
  await window.thockdownImages?.setImageTrashed(id, trashed)
  invalidateStoredImage(id)
  invalidateImageLibrary()
}

export async function purgeImage(id: string): Promise<boolean> {
  const purged = (await window.thockdownImages?.purgeImage(id)) ?? false
  invalidateStoredImage(id)
  invalidateImageLibrary()
  return purged
}

/** A note open in an editor, as a rename needs it: its text, and a way to edit it like typing. */
export interface OpenNoteEditor {
  noteId: string
  readText: () => string
  applyEdit: (changes: Array<{ from: number; to: number; insert: string }>, expectedText: string) => boolean
}

/** What a rename needs from App: which notes editors hold, and where else the old id is held (the slot overlay). */
export interface ImageLibraryHost {
  openNoteEditors: () => OpenNoteEditor[]
  onImageRenamed: (fromId: string, toId: string) => void
}

// Both are App's to know (its section registry, its overlay record); it
// registers them once, so a rename asked from the image tag bar does not
// need the sections threaded down to it.
let host: ImageLibraryHost = { openNoteEditors: () => [], onImageRenamed: () => {} }
export function registerImageLibraryHost(next: ImageLibraryHost): void {
  host = next
}

/**
 * Renames an image everywhere its name is written in a current note. The main
 * process rewrites the notes no editor holds; each one an editor holds gets
 * the change as an edit there, one undo step, saved like typing -- so neither
 * its undo history nor an unsaved change is written over from behind.
 */
export async function renameImage(id: string, rawNewId: string): Promise<ImageRenameResult> {
  const api = window.thockdownImages
  const newId = normalizeImageId(rawNewId.startsWith('&') ? rawNewId : `&${rawNewId}`)
  if (!api || !newId) return { ok: false, reason: 'invalid' }
  const editors = host.openNoteEditors()
  const result = await api.renameImage({ id, newId, openNoteIds: editors.map((editor) => editor.noteId) })
  if (!result.ok) return result
  for (const editor of editors) {
    const text = editor.readText()
    const edits = imageReferenceRenameEdits(text, id, result.id)
    if (edits.length > 0) editor.applyEdit(edits, text)
  }
  host.onImageRenamed(id, result.id)
  invalidateStoredImage(id)
  invalidateStoredImage(result.id)
  invalidateImageLibrary()
  return result
}
