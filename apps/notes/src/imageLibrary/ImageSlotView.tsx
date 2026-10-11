import { useLibraryImage } from './imageLibraryStore'

// AN IMAGE FROM THE LIBRARY, shown in an editor slot (the 'image' slot
// overlay, shared/slotOverlay.ts): the whole picture, as large as the slot
// allows and never larger than itself. The tab bar above names it and says
// where it came from; the chapter bar below holds its id and tags.

export function ImageSlotView({ imageId }: { imageId: string }) {
  const { image, loaded } = useLibraryImage(imageId)
  return (
    <div className="image-slot-view" aria-label={`Image ${imageId}`}>
      {image ? (
        <img
          className="image-slot-view-image"
          src={image.src}
          alt={image.id}
          width={image.width || undefined}
          height={image.height || undefined}
          draggable={false}
        />
      ) : loaded ? (
        <div className="image-slot-view-missing">{imageId} is no longer stored.</div>
      ) : null}
      {image?.trashedAt ? <div className="image-slot-view-badge">In the trash</div> : null}
    </div>
  )
}
