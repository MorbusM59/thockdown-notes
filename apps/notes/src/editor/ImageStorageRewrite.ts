import type { DocumentImage } from './DocumentImages'
import { parseImageMarkdown } from './MarkdownImageTransforms'
import { formatImageLayout, parseImageTitle } from '../shared/imageLayout'
import type { ImageSourceRequest, ImageSourceResult } from '../shared/images'

// THE IMAGE BUTTON'S TWO REWRITES of a note's text, pure and tested: storing
// turns every image that points somewhere (a URL or a file path) into a
// stored one, and restoring turns every stored image back into what it was
// stored from. They are each other's inverse, so a store followed by a
// restore gives back the text it started from:
//
//   ![Logo](https://e.com/l.png "&LOGO 12em right")   stored as   &LOGO
//   ![Logo](&LOGO "12em right")                        restored to the first
//
// The id moves between the title and the destination: a stored image's id IS
// its destination, and a restored one keeps it in the title so the next
// store reuses it rather than minting a new one. An image with an ordinary
// tooltip has nowhere to keep its id when restored, so it is given back
// without one. An image whose Markdown is not the plain shape is left alone.

export type ImageStorageState = 'none' | 'external' | 'stored'

function isStoredDestination(url: string): boolean {
  return url.startsWith('&')
}

/** What the button shows: nothing, a globe (something points elsewhere), or the database (all stored). */
export function imageStorageState(images: DocumentImage[]): ImageStorageState {
  if (images.length === 0) return 'none'
  return images.every((image) => isStoredDestination(image.url)) ? 'stored' : 'external'
}

/** The sources to fetch and store, with the id each one asked for in its title. */
export function imageSourcesToStore(images: DocumentImage[]): ImageSourceRequest[] {
  const requests = new Map<string, ImageSourceRequest>()
  for (const image of images) {
    if (isStoredDestination(image.url) || requests.has(image.url)) continue
    const title = parseImageTitle(image.title)
    const requestedId = title.kind === 'layout' && title.layout.id ? `&${title.layout.id}` : null
    requests.set(image.url, { source: image.url, requestedId })
  }
  return [...requests.values()]
}

/** The ids of the stored images, to ask for their origins. */
export function storedImageIds(images: DocumentImage[]): string[] {
  return [...new Set(images.filter((image) => isStoredDestination(image.url)).map((image) => image.url))]
}

export interface ImageRewrite {
  from: number
  to: number
  insert: string
  /** How many images it changed. */
  count: number
}

function destinationText(destination: string): string {
  return /[\s()<>]/.test(destination) ? `<${destination}>` : destination
}

function titleText(title: string): string {
  return title ? ` "${title}"` : ''
}

/**
 * One edit spanning every changed image, so the editor applies the whole
 * rewrite as one transaction (one undo step). Null when nothing changes.
 */
function rewrite(text: string, images: DocumentImage[], replace: (image: DocumentImage, parsed: NonNullable<ReturnType<typeof parseImageMarkdown>>) => string | null): ImageRewrite | null {
  const parts: string[] = []
  let first = -1
  let cursor = -1
  let count = 0
  for (const image of images) {
    const parsed = parseImageMarkdown(text.slice(image.from, image.to))
    const replacement = parsed ? replace(image, parsed) : null
    if (replacement === null) continue
    if (first === -1) first = image.from
    else parts.push(text.slice(cursor, image.from))
    parts.push(replacement)
    cursor = image.to
    count += 1
  }
  if (count === 0) return null
  return { from: first, to: cursor, insert: parts.join(''), count }
}

/** Points every successfully stored image at its id, moving a chosen id out of the title. */
export function rewriteToStored(text: string, images: DocumentImage[], results: Record<string, ImageSourceResult>): ImageRewrite | null {
  return rewrite(text, images, (image, parsed) => {
    const result = results[image.url]
    if (isStoredDestination(image.url) || !result?.ok) return null
    const title = parseImageTitle(parsed.title)
    const keptTitle = title.kind === 'layout' ? formatImageLayout({ ...title.layout, id: null }) : (parsed.title ?? '')
    return `![${parsed.alt}](${result.id}${titleText(keptTitle)})`
  })
}

/** Points every stored image that has an origin back at it, keeping its id in the title. */
export function rewriteToOrigins(text: string, images: DocumentImage[], origins: Record<string, string | null>): ImageRewrite | null {
  return rewrite(text, images, (image, parsed) => {
    const origin = isStoredDestination(image.url) ? origins[image.url] : null
    if (!origin) return null
    const title = parseImageTitle(parsed.title)
    const keptTitle = title.kind === 'layout'
      ? formatImageLayout({ ...title.layout, id: image.url.slice(1).toUpperCase() })
      : (parsed.title ?? '')
    return `![${parsed.alt}](${destinationText(origin)}${titleText(keptTitle)})`
  })
}
