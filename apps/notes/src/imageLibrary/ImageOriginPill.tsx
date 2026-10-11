import { useLibraryImage } from './imageLibraryStore'

/** Where a library image came from, for the tab bar while a slot shows it: its file path or web address, or that it was pasted. */
export function ImageOriginPill({ imageId }: { imageId: string }) {
  const { image } = useLibraryImage(imageId)
  if (!image) return null
  const origin = image.origin ?? 'Pasted from the clipboard'
  return (
    <span className="tag-pill image-origin-pill" data-tooltip={origin}>
      <span className="tag-pill-label">{origin}</span>
    </span>
  )
}
