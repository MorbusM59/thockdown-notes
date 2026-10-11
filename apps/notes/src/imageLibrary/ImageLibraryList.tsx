import { memo, useMemo, useState } from 'react'
import { IMAGE_DRAG_MIME_TYPE, type StoredImageSummary } from '../shared/images'
import { armPointerDrag } from '../shared/pointerDrag'
import { groupImagesByTag, imagesInView, type ImageLibraryView } from './imageLibraryViews'
import { purgeImage, setImageTrashed, useImageLibrary } from './imageLibraryStore'

// THE SIDEBAR'S IMAGE LIBRARY: what a view shows once a right-click on its
// selector switched the sidebar to images (App.tsx, `sidebarShowsImages`).
// The same cards as notes, each showing its image behind the id. Clicking
// one opens it in the active slot; the card's own buttons put it in the
// trash, or, in the trash, bring it back or (a second click) delete it for
// good. Archive is never a button: an image no note uses IS archived.

interface ImageLibraryListProps {
  view: ImageLibraryView
  searchQuery: string
  caseSensitive: boolean
  activeImageId: string | null
  onOpen: (id: string) => void
}

function originLabel(image: StoredImageSummary): string {
  if (!image.origin) return 'pasted'
  const name = image.origin.split(/[\\/]/).filter(Boolean).pop()
  return name ?? image.origin
}

function sizeLabel(image: StoredImageSummary): string {
  return image.width > 0 ? `${image.width}×${image.height}` : ''
}

const ImageCard = memo(function ImageCard({ image, isActive, isTrashView, primed, onOpen, onPrime }: {
  image: StoredImageSummary
  isActive: boolean
  isTrashView: boolean
  primed: boolean
  onOpen: (id: string) => void
  onPrime: (id: string | null) => void
}) {
  // A trashed image a note still uses cannot be deleted: that note would break.
  const isUsed = image.useCount > 0
  const inTrashLabel = isUsed
    ? `Used by ${image.useCount} note${image.useCount === 1 ? '' : 's'}: remove it there before deleting it`
    : 'Delete for good'
  return (
    <div
      className={`note-list-item image-list-item${isActive ? ' is-active' : ''}${primed ? ' is-primed-for-deletion' : ''}`}
      role="option"
      aria-selected={isActive}
      data-image-id={image.id}
      tabIndex={0}
      onClick={() => onOpen(image.id)}
      // Dragged into a note, it is referenced there (CM6Editor's and the
      // render view's drop handlers); nothing is stored again.
      data-drag-source=""
      onPointerDown={armPointerDrag}
      onDragStart={(event) => {
        event.dataTransfer.setData(IMAGE_DRAG_MIME_TYPE, image.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onMouseLeave={() => { if (primed) onPrime(null) }}
      data-secondary-press="none"
    >
      <div className="note-list-columns">
        <div className="note-list-column note-list-column-primary">
          <div className="image-list-thumbnail" style={{ backgroundImage: `url("${image.src}")` }} aria-hidden="true" />
          <div className="note-list-content">
            <div className="note-list-title">{image.id}</div>
            <div className="note-list-meta-row">
              <span className="note-list-meta-left" data-tooltip={image.origin ?? 'Pasted from the clipboard'}>{originLabel(image)}</span>
              <span className="note-list-meta-right">{sizeLabel(image)}</span>
            </div>
          </div>
        </div>
        {isTrashView ? (
          <div className="note-list-column note-list-column-action note-list-column-archive">
            <button
              type="button"
              className="note-list-action-button note-list-action-button-restore"
              aria-label="Take out of the trash"
              data-tooltip="Take out of the trash"
              onClick={(event) => { event.stopPropagation(); void setImageTrashed(image.id, false) }}
              data-secondary-press="none"
            >
              <span className="fa-solid fa-rotate-left" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className="note-list-column note-list-column-action note-list-column-trash">
          <button
            type="button"
            disabled={isTrashView && isUsed}
            className="note-list-action-button note-list-action-button-trash"
            aria-label={isTrashView ? (primed ? `Click again: ${inTrashLabel.toLowerCase()}` : inTrashLabel) : 'Put in the trash'}
            data-tooltip={isTrashView ? (primed ? `Click again: ${inTrashLabel.toLowerCase()}` : inTrashLabel) : 'Put in the trash'}
            onClick={(event) => {
              event.stopPropagation()
              if (!isTrashView) {
                void setImageTrashed(image.id, true)
              } else if (!primed) {
                onPrime(image.id)
              } else {
                onPrime(null)
                void purgeImage(image.id)
              }
            }}
            data-secondary-press="none"
          />
        </div>
      </div>
    </div>
  )
})

export const ImageLibraryList = memo(function ImageLibraryList({ view, searchQuery, caseSensitive, activeImageId, onOpen }: ImageLibraryListProps) {
  const { images, loaded } = useImageLibrary()
  const [primedId, setPrimedId] = useState<string | null>(null)
  const shown = useMemo(() => imagesInView(images, view, searchQuery, caseSensitive), [images, view, searchQuery, caseSensitive])
  const groups = useMemo(() => (view === 'category' || view === 'archive' ? groupImagesByTag(shown) : null), [shown, view])

  const card = (image: StoredImageSummary, key: string) => (
    <ImageCard
      key={key}
      image={image}
      isActive={image.id === activeImageId}
      isTrashView={view === 'trash'}
      primed={primedId === image.id}
      onOpen={onOpen}
      onPrime={setPrimedId}
    />
  )

  if (!loaded) return null
  if (shown.length === 0) {
    const empty = searchQuery.trim() ? 'No images match the current search.'
      : view === 'trash' ? 'No images in the trash.'
      : view === 'archive' ? 'No unused images.'
      : view === 'category' ? 'No image is used by a note yet.'
      : 'No images yet. Drop or paste one into a note.'
    return <div className="notes-empty-state">{empty}</div>
  }
  if (!groups) return <>{shown.map((image) => card(image, image.id))}</>
  return (
    <div className="category-tree-root" aria-label="Images by tag">
      {groups.map((group) => (
        <details key={group.tag} className="category-primary" open>
          <summary className="category-primary-summary">{group.tag}</summary>
          {group.images.map((image) => card(image, `${group.tag}:${image.id}`))}
        </details>
      ))}
    </div>
  )
})
