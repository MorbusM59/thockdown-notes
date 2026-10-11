import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { CategoryTree, type CategoryTreeCollapse } from '../components/CategoryTree'
import { IMAGE_DRAG_MIME_TYPE, type NoteImageUse, type StoredImageSummary } from '../shared/images'
import { armPointerDrag } from '../shared/pointerDrag'
import { buildTagHierarchy } from '../shared/tagHierarchy'
import { groupCardsBySection, imagesInView, imageUseCards, type ImageLibraryView, type ImageUseCard } from './imageLibraryViews'
import { purgeImage, setImageTrashed, useImageLibrary } from './imageLibraryStore'

// THE SIDEBAR IN IMAGE MODE (App.tsx, `sidebarShowsImages`): what each view
// lists is in imageLibraryViews.ts.
//
// A card is a tool for the note, not a link: a LEFT click puts its image at
// the caret (into the empty `![]()` the toolbar's image button leaves, or as
// a new reference), and HOLDING THE RIGHT BUTTON shows the image in the slot
// instead. In Images in Order a right TAP expands the card to the image's own
// proportions, and a second tap, or expanding another, folds it again. Every
// card puts its image in the trash from a button that appears on hover;
// archive is never a button, as an image no note uses is simply unused.

interface ImageLibraryListProps {
  view: ImageLibraryView
  searchQuery: string
  caseSensitive: boolean
  /** The current note's image uses (shared/images.ts's imageUsesIn). */
  uses: readonly NoteImageUse[]
  /** The image the active slot shows, if it shows one. */
  shownImageId: string | null
  /** The use the caret is in, by its offset, if any. */
  caretUseFrom: number | null
  onPlace: (id: string, alt: string) => void
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

/**
 * A card's right button: a tap calls `onTap`, a hold of HOLD_CONFIRM_MS
 * calls `onHold` instead (and the release that ends it does nothing more).
 */
function useRightPress(onTap: (() => void) | null, onHold: () => void) {
  const cancelRef = useRef<(() => void) | null>(null)
  const heldRef = useRef(false)
  const end = useCallback((tap: boolean) => {
    if (!cancelRef.current) return
    cancelRef.current()
    cancelRef.current = null
    if (tap && !heldRef.current) onTap?.()
  }, [onTap])
  return {
    onMouseDown: (event: MouseEvent) => {
      if (event.button !== 2) return
      end(false)
      heldRef.current = false
      cancelRef.current = armHold(() => {
        heldRef.current = true
        onHold()
      }, HOLD_CONFIRM_MS)
    },
    onMouseUp: (event: MouseEvent) => { if (event.button === 2) end(true) },
    onMouseLeave: () => end(false),
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
    'data-secondary-press': 'action' as const,
  }
}

function dragImage(id: string) {
  return {
    // Dragged into a note, it is referenced there (CM6Editor's and the
    // render view's drop handlers); nothing is stored again.
    'data-drag-source': '',
    onPointerDown: armPointerDrag,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData(IMAGE_DRAG_MIME_TYPE, id)
      event.dataTransfer.effectAllowed = 'copy'
    },
  }
}

/** A card with the image behind its text: Images in Order and the trash. */
const ImageCard = memo(function ImageCard({ image, alt, isActive, isTrashView, primed, expanded, onPlace, onOpen, onPrime, onToggleExpanded }: {
  image: StoredImageSummary
  /** The alt text at this use; null outside a note's uses (the trash). */
  alt: string | null
  isActive: boolean
  isTrashView: boolean
  primed: boolean
  expanded: boolean
  onPlace: ((id: string, alt: string) => void) | null
  onOpen: (id: string) => void
  onPrime: (id: string | null) => void
  onToggleExpanded: (() => void) | null
}) {
  const rightPress = useRightPress(onToggleExpanded, () => onOpen(image.id))
  // A trashed image a note still uses cannot be deleted: that note would break.
  const isUsed = image.useCount > 0
  const inTrashLabel = isUsed
    ? `Used by ${image.useCount} note${image.useCount === 1 ? '' : 's'}: remove it there before deleting it`
    : 'Delete for good'
  const style = image.width > 0 ? { '--image-ratio': image.height / image.width } as CSSProperties : undefined
  return (
    <div
      className={`note-list-item image-list-item${isActive ? ' is-active' : ''}${primed ? ' is-primed-for-deletion' : ''}${expanded ? ' is-expanded' : ''}`}
      style={style}
      role="option"
      aria-selected={isActive}
      data-image-id={image.id}
      onClick={() => onPlace?.(image.id, alt ?? '')}
      {...dragImage(image.id)}
      {...rightPress}
      onMouseLeave={() => {
        rightPress.onMouseLeave()
        if (primed) onPrime(null)
      }}
      data-tooltip={isTrashView ? 'Hold right-click to show it' : `Click to put it at the caret. ${onToggleExpanded ? 'Right-click to see it whole, hold' : 'Hold right-click'} to show it`}
    >
      <div className="note-list-columns">
        <div className="note-list-column note-list-column-primary">
          <div className="image-list-thumbnail" style={{ backgroundImage: `url("${image.src}")` }} aria-hidden="true" />
          <div className="note-list-content">
            <div className="note-list-title">{image.id}</div>
            <div className="note-list-meta-row">
              {alt !== null
                ? <span className="note-list-meta-left">{alt}</span>
                : <span className="note-list-meta-left" data-tooltip={image.origin ?? 'Pasted from the clipboard'}>{originLabel(image)}</span>}
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

/** A card in the two trees: the note tree's own card, the id on the left and the size on the right. */
const ImageTreeCard = memo(function ImageTreeCard({ image, alt, isActive, onPlace, onOpen }: {
  image: StoredImageSummary
  alt: string
  isActive: boolean
  onPlace: (id: string, alt: string) => void
  onOpen: (id: string) => void
}) {
  const rightPress = useRightPress(null, () => onOpen(image.id))
  return (
    <div
      className={`note-list-item is-tree-card image-list-item${isActive ? ' is-active' : ''}`}
      role="option"
      aria-selected={isActive}
      data-image-id={image.id}
      onClick={() => onPlace(image.id, alt)}
      {...dragImage(image.id)}
      {...rightPress}
      data-tooltip={`${alt ? `${alt}. ` : ''}Click to put it at the caret, hold right-click to show it`}
    >
      <div className="note-list-content">
        <div className="note-list-meta-row image-tree-card-row">
          <span className="note-list-title">{image.id}</span>
          <span className="note-list-meta-right">{sizeLabel(image)}</span>
          <button
            type="button"
            className="image-tree-card-trash fa-solid fa-trash"
            aria-label="Put in the trash"
            data-tooltip="Put in the trash"
            onClick={(event) => { event.stopPropagation(); void setImageTrashed(image.id, true) }}
            data-secondary-press="none"
          />
        </div>
      </div>
    </div>
  )
})

export const ImageLibraryList = memo(function ImageLibraryList({ view, searchQuery, caseSensitive, uses, shownImageId, caretUseFrom, onPlace, onOpen }: ImageLibraryListProps) {
  const { images, loaded } = useImageLibrary()
  const [primedId, setPrimedId] = useState<string | null>(null)
  const [expandedFrom, setExpandedFrom] = useState<number | null>(null)
  const isNoteView = view === 'date' || view === 'category'
  const cards = useMemo(() => (isNoteView ? imageUseCards(uses, images, searchQuery, caseSensitive) : []), [isNoteView, uses, images, searchQuery, caseSensitive])
  const libraryImages = useMemo(() => (isNoteView ? [] : imagesInView(images, view, searchQuery, caseSensitive)), [isNoteView, images, view, searchQuery, caseSensitive])
  // A use is highlighted when the caret is in it; anything else by the image the slot shows.
  const isActiveUse = (card: ImageUseCard) => (caretUseFrom !== null ? card.use.from === caretUseFrom : card.image.id === shownImageId)

  const sectionGroups = useMemo(() => (view === 'category' ? groupCardsBySection(cards) : null), [cards, view])
  // The archive is the notes' tree: an image sits in one place, by the order of its tags.
  const tagGroups = useMemo(() => (view === 'archive' ? buildTagHierarchy(libraryImages, (image) => image.tags, 'Images') : null), [libraryImages, view])
  // What is folded is remembered per view for as long as the sidebar shows
  // images, and not across restarts.
  const [collapseByView, setCollapseByView] = useState<Partial<Record<ImageLibraryView, CategoryTreeCollapse>>>({})
  const collapse = collapseByView[view] ?? NOTHING_COLLAPSED
  const onCollapseChange = useCallback((next: CategoryTreeCollapse) => setCollapseByView((previous) => ({ ...previous, [view]: next })), [view])
  const renderUseTreeCard = useCallback((card: ImageUseCard) => (
    <ImageTreeCard
      key={card.use.from}
      image={card.image}
      alt={card.use.alt}
      isActive={caretUseFrom !== null ? card.use.from === caretUseFrom : card.image.id === shownImageId}
      onPlace={onPlace}
      onOpen={onOpen}
    />
  ), [caretUseFrom, onOpen, onPlace, shownImageId])
  const renderImageTreeCard = useCallback((image: StoredImageSummary) => (
    <ImageTreeCard key={image.id} image={image} alt="" isActive={image.id === shownImageId} onPlace={onPlace} onOpen={onOpen} />
  ), [onOpen, onPlace, shownImageId])

  if (!loaded) return null
  if ((isNoteView ? cards.length : libraryImages.length) === 0) {
    const empty = searchQuery.trim() ? 'No images match the current search.'
      : view === 'trash' ? 'No images in the trash.'
      : view === 'archive' ? 'No images yet. Drop or paste one into a note.'
      : 'This note uses no stored image.'
    return <div className="notes-empty-state">{empty}</div>
  }
  if (view === 'date') {
    return (
      <>
        {cards.map((card) => (
          <ImageCard
            key={card.use.from}
            image={card.image}
            alt={card.use.alt}
            isActive={isActiveUse(card)}
            isTrashView={false}
            primed={false}
            expanded={expandedFrom === card.use.from}
            onPlace={onPlace}
            onOpen={onOpen}
            onPrime={setPrimedId}
            onToggleExpanded={() => setExpandedFrom((previous) => (previous === card.use.from ? null : card.use.from))}
          />
        ))}
      </>
    )
  }
  if (view === 'trash') {
    return (
      <>
        {libraryImages.map((image) => (
          <ImageCard
            key={image.id}
            image={image}
            alt={null}
            isActive={image.id === shownImageId}
            isTrashView
            primed={primedId === image.id}
            expanded={false}
            onPlace={null}
            onOpen={onOpen}
            onPrime={setPrimedId}
            onToggleExpanded={null}
          />
        ))}
      </>
    )
  }
  if (sectionGroups) {
    return (
      <CategoryTree
        groups={sectionGroups}
        itemId={cardImageId}
        itemSelector={imageTreeCardSelector}
        renderItem={renderUseTreeCard}
        activeItemId={null}
        persistedCollapsedPrimary={collapse.collapsedPrimary}
        persistedCollapsedSecondary={collapse.collapsedSecondary}
        focusRequestKey={0}
        onCollapseChange={onCollapseChange}
        emptyLabel=""
        ariaLabel="Images by section"
      />
    )
  }
  return (
    <CategoryTree
      groups={tagGroups ?? []}
      itemId={imageIdOf}
      itemSelector={imageTreeCardSelector}
      renderItem={renderImageTreeCard}
      activeItemId={shownImageId}
      persistedCollapsedPrimary={collapse.collapsedPrimary}
      persistedCollapsedSecondary={collapse.collapsedSecondary}
      focusRequestKey={0}
      onCollapseChange={onCollapseChange}
      emptyLabel=""
      ariaLabel="Images by tag"
    />
  )
})

const NOTHING_COLLAPSED: CategoryTreeCollapse = { collapsedPrimary: [], collapsedSecondary: [] }
const imageIdOf = (image: StoredImageSummary) => image.id
const cardImageId = (card: ImageUseCard) => card.image.id
const imageTreeCardSelector = (id: string) => `.image-list-item.is-tree-card[data-image-id="${CSS.escape(id)}"]`
