import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { CategoryTree, type CategoryTreeCollapse } from '../components/CategoryTree'
import { IMAGE_DRAG_MIME_TYPE, type NoteImageUse, type StoredImageSummary } from '../shared/images'
import { parseImageTitle } from '../shared/imageLayout'
import { armPointerDrag } from '../shared/pointerDrag'
import { isRemoteImageSrc, useRemoteImagesAllowed } from '../shared/remoteImages'
import { buildTagHierarchy } from '../shared/tagHierarchy'
import { groupCardsBySection, imagesInView, imageUseCards, type ImageLibraryView, type ImageUseCard } from './imageLibraryViews'
import { purgeImage, setImageTrashed, useImageLibrary } from './imageLibraryStore'

// THE SIDEBAR IN IMAGE MODE (App.tsx, `sidebarShowsImages`): what each view
// lists is in imageLibraryViews.ts.
//
// Images in Order and Images by Section are about the CURRENT NOTE: a left
// click goes to the image there, the X takes it out of the note, and an
// external image (a URL or a file path) is listed too, under a globe, where
// holding the left button stores it in the app. The Image Archive is the
// collection: a left click puts the image at the caret (into the empty
// `![]()` the toolbar's image button leaves, or as a new reference), and its
// cards have the trash button. In every view, HOLDING THE RIGHT BUTTON shows
// a stored image in the slot; a right TAP shows the image whole instead (in
// Images in Order the card grows to the image's proportions, in a tree the
// image opens beneath the row), and a second tap, or expanding another, folds
// it again.

interface ImageLibraryListProps {
  view: ImageLibraryView
  searchQuery: string
  caseSensitive: boolean
  /** The current note's images (shared/images.ts's imageUsesIn). */
  uses: readonly NoteImageUse[]
  /** The image the active slot shows, if it shows one. */
  shownImageId: string | null
  /** The use the caret is in, by its offset, if any. */
  caretUseFrom: number | null
  /** Puts a stored image at the caret (the archive's cards). */
  onPlace: (id: string, alt: string) => void
  /** Goes to an image's place in the note. */
  onReveal: (use: NoteImageUse) => void
  /** Takes an image out of the note. */
  onRemove: (use: NoteImageUse) => void
  /** Stores an external image in the app and points the note at it. */
  onStore: (use: NoteImageUse) => void
  onOpen: (id: string) => void
}

function originLabel(image: StoredImageSummary): string {
  if (!image.origin) return 'pasted'
  const name = image.origin.split(/[\\/]/).filter(Boolean).pop()
  return name ?? image.origin
}

/** The image's size in pixels; at a use in a note, the part of it the use's crop keeps. */
function sizeLabel(image: StoredImageSummary | null, use: NoteImageUse | null = null): string {
  if (!image || image.width <= 0) return ''
  const parsed = use ? parseImageTitle(use.title) : null
  const inset = parsed?.kind === 'layout' ? parsed.layout.inset : null
  if (!inset) return `${image.width}×${image.height}`
  const width = Math.round(image.width * (100 - inset.left - inset.right) / 100)
  const height = Math.round(image.height * (100 - inset.top - inset.bottom) / 100)
  return `${width}×${height}`
}

/** A card's name: the stored image's id, or a globe and EXTERNAL. */
function CardTitle({ image }: { image: StoredImageSummary | null }) {
  return image ? <>{image.id}</> : <><span className="fa-solid fa-globe" aria-hidden="true" /> EXTERNAL</>
}

interface CardPress {
  /** A left click (not one that ended a left hold). */
  onClick: (() => void) | null
  onLeftHold: (() => void) | null
  onRightTap: (() => void) | null
  onRightHold: (() => void) | null
}

/**
 * A card's presses: a left click, or a left hold of HOLD_CONFIRM_MS instead;
 * a right tap, or a right hold instead. A hold that completed leaves its
 * release, and the click that follows a left one, doing nothing more.
 */
function useCardPress({ onClick, onLeftHold, onRightTap, onRightHold }: CardPress) {
  const cancelRef = useRef<(() => void) | null>(null)
  const heldRef = useRef(false)
  const end = (button: number | null) => {
    if (!cancelRef.current) return
    cancelRef.current()
    cancelRef.current = null
    if (button === 2 && !heldRef.current) onRightTap?.()
  }
  return {
    onMouseDown: (event: MouseEvent) => {
      const onHold = event.button === 0 ? onLeftHold : event.button === 2 ? onRightHold : null
      if (event.button === 0) heldRef.current = false
      if (!onHold && !(event.button === 2 && onRightTap)) return
      end(null)
      heldRef.current = false
      cancelRef.current = armHold(() => {
        heldRef.current = true
        onHold?.()
      }, HOLD_CONFIRM_MS)
    },
    onMouseUp: (event: MouseEvent) => end(event.button),
    onMouseLeave: () => end(null),
    onClick: () => {
      if (heldRef.current) return
      onClick?.()
    },
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
    'data-secondary-press': onRightTap || onRightHold ? 'action' as const : 'none' as const,
  }
}

// A card's own buttons do nothing with a hold, so a press on one must not reach the card's.
const stopCardPress = (event: MouseEvent) => event.stopPropagation()

function dragImage(id: string) {
  return {
    // Dragged into a note, it is referenced there (CM6Editor's and the
    // render view's drop handlers); nothing is stored again.
    'data-drag-source': '',
    onPointerDown: armPointerDrag,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(IMAGE_DRAG_MIME_TYPE, id)
      event.dataTransfer.effectAllowed = 'copy'
    },
  }
}

/** `inColumn`: in a card's action column, styled as a note card's buttons there are; otherwise a bare icon in a tree row. */
function RemoveButton({ use, onRemove, inColumn = false }: { use: NoteImageUse; onRemove: (use: NoteImageUse) => void; inColumn?: boolean }) {
  return (
    <button
      type="button"
      className={`image-card-remove fa-solid fa-xmark${inColumn ? ' btn-icon note-list-action-button' : ''}`}
      aria-label="Take it out of the note"
      data-tooltip="Take it out of the note"
      onClick={(event) => { event.stopPropagation(); onRemove(use) }}
      onMouseDown={stopCardPress}
      data-secondary-press="none"
    />
  )
}

/** A card with the image behind its text: Images in Order and the trash. */
const ImageCard = memo(function ImageCard({ image, use, isActive, primed, expanded, press, actions, onPrimeEnd }: {
  image: StoredImageSummary | null
  /** The image's place in the note; null in the trash. */
  use: NoteImageUse | null
  isActive: boolean
  primed: boolean
  expanded: boolean
  press: CardPress
  /** The buttons that appear on hover; none while the card is expanded. */
  actions: ReactNode
  onPrimeEnd: () => void
}) {
  const handlers = useCardPress(press)
  const remoteAllowed = useRemoteImagesAllowed()
  const src = image ? image.src : use && remoteAllowed && isRemoteImageSrc(use.src) ? use.src : null
  const style = image && image.width > 0 ? { '--image-ratio': image.height / image.width } as CSSProperties : undefined
  const tooltip = !use ? 'Hold right-click to show it'
    : !image ? `${use.src}. Click to go to it, hold to store it in the app`
    : `Click to go to it. ${press.onRightTap ? 'Right-click to see it whole, hold' : 'Hold right-click'} to show it`
  return (
    <div
      className={`note-list-item image-list-item${isActive ? ' is-active' : ''}${primed ? ' is-primed-for-deletion' : ''}${expanded ? ' is-expanded' : ''}`}
      style={style}
      role="option"
      aria-selected={isActive}
      data-image-id={image?.id}
      {...(image ? dragImage(image.id) : {})}
      {...handlers}
      onMouseLeave={() => {
        handlers.onMouseLeave()
        if (primed) onPrimeEnd()
      }}
      data-tooltip={tooltip}
    >
      <div className="note-list-columns">
        <div className="note-list-column note-list-column-primary">
          {src ? <div className="image-list-thumbnail" style={{ backgroundImage: `url("${src}")` }} aria-hidden="true" /> : null}
          <div className="note-list-content">
            <div className="note-list-title"><CardTitle image={image} /></div>
            <div className="note-list-meta-row">
              {use
                ? <span className="note-list-meta-left">{use.alt}</span>
                : image ? <span className="note-list-meta-left" data-tooltip={image.origin ?? 'Pasted from the clipboard'}>{originLabel(image)}</span> : null}
              <span className="note-list-meta-right">{sizeLabel(image, use)}</span>
            </div>
          </div>
        </div>
        {expanded ? null : actions}
      </div>
    </div>
  )
})

/** A card in the two trees: the note tree's own card, the name on the left and the size on the right. */
const ImageTreeCard = memo(function ImageTreeCard({ image, use, isActive, expanded, press, action }: {
  image: StoredImageSummary | null
  use: NoteImageUse | null
  isActive: boolean
  /** Showing the image whole beneath the row (a right tap). */
  expanded: boolean
  press: CardPress
  /** The button that takes the size's place on hover. */
  action: ReactNode
}) {
  const handlers = useCardPress(press)
  const remoteAllowed = useRemoteImagesAllowed()
  const src = image ? image.src : use && remoteAllowed && isRemoteImageSrc(use.src) ? use.src : null
  const seeWhole = src ? 'right-click to see it whole, ' : ''
  const tooltip = use
    ? `${use.alt ? `${use.alt}. ` : ''}${image ? `Click to go to it, ${seeWhole}hold right-click to show it` : `${use.src}. Click to go to it, ${seeWhole}hold to store it in the app`}`
    : `Click to put it at the caret, ${seeWhole}hold right-click to show it`
  return (
    <div
      className={`note-list-item is-tree-card image-list-item${isActive ? ' is-active' : ''}${expanded && src ? ' is-previewing' : ''}`}
      role="option"
      aria-selected={isActive}
      data-image-id={image?.id}
      {...(image ? dragImage(image.id) : {})}
      {...handlers}
      data-tooltip={tooltip}
    >
      <div className="note-list-content">
        <div className="note-list-meta-row image-tree-card-row">
          <span className="note-list-title"><CardTitle image={image} /></span>
          <span className="note-list-meta-right">{sizeLabel(image, use)}</span>
          {expanded && src ? null : action}
        </div>
        {expanded && src ? (
          <div
            className="image-tree-card-preview"
            style={{ backgroundImage: `url("${src}")`, aspectRatio: image && image.width > 0 ? `${image.width} / ${image.height}` : undefined }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  )
})

export const ImageLibraryList = memo(function ImageLibraryList({ view, searchQuery, caseSensitive, uses, shownImageId, caretUseFrom, onPlace, onReveal, onRemove, onStore, onOpen }: ImageLibraryListProps) {
  const { images, loaded } = useImageLibrary()
  const [primedId, setPrimedId] = useState<string | null>(null)
  // One card at a time is expanded, in whichever view: expanding another folds it.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const toggleExpanded = useCallback((key: string) => setExpandedKey((previous) => (previous === key ? null : key)), [])
  const isNoteView = view === 'date' || view === 'category'
  const cards = useMemo(() => (isNoteView ? imageUseCards(uses, images, searchQuery, caseSensitive) : []), [isNoteView, uses, images, searchQuery, caseSensitive])
  const libraryImages = useMemo(() => (isNoteView ? [] : imagesInView(images, view, searchQuery, caseSensitive)), [isNoteView, images, view, searchQuery, caseSensitive])
  // A use is highlighted when the caret is in it; anything else by the image the slot shows.
  const isActiveUse = useCallback((card: ImageUseCard) => (
    caretUseFrom !== null ? card.use.from === caretUseFrom : card.image !== null && card.image.id === shownImageId
  ), [caretUseFrom, shownImageId])
  const pressFor = useCallback((card: ImageUseCard, onRightTap: (() => void) | null): CardPress => ({
    onClick: () => onReveal(card.use),
    onLeftHold: card.image ? null : () => onStore(card.use),
    onRightTap,
    onRightHold: card.image ? () => onOpen(card.image!.id) : null,
  }), [onOpen, onReveal, onStore])

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
      key={card.key}
      image={card.image}
      use={card.use}
      isActive={isActiveUse(card)}
      expanded={expandedKey === card.key}
      press={pressFor(card, () => toggleExpanded(card.key))}
      action={<RemoveButton use={card.use} onRemove={onRemove} />}
    />
  ), [expandedKey, isActiveUse, onRemove, pressFor, toggleExpanded])
  const renderImageTreeCard = useCallback((image: StoredImageSummary) => (
    <ImageTreeCard
      key={image.id}
      image={image}
      use={null}
      isActive={image.id === shownImageId}
      expanded={expandedKey === image.id}
      press={{ onClick: () => onPlace(image.id, ''), onLeftHold: null, onRightTap: () => toggleExpanded(image.id), onRightHold: () => onOpen(image.id) }}
      action={(
        <button
          type="button"
          className="image-card-trash fa-solid fa-trash"
          aria-label="Put in the trash"
          data-tooltip="Put in the trash"
          onClick={(event) => { event.stopPropagation(); void setImageTrashed(image.id, true) }}
          onMouseDown={stopCardPress}
          data-secondary-press="none"
        />
      )}
    />
  ), [expandedKey, onOpen, onPlace, shownImageId, toggleExpanded])

  if (!loaded) return null
  if ((isNoteView ? cards.length : libraryImages.length) === 0) {
    const empty = searchQuery.trim() ? 'No images match the current search.'
      : view === 'trash' ? 'No images in the trash.'
      : view === 'archive' ? 'No images yet. Drop or paste one into a note.'
      : 'This note has no images.'
    return <div className="notes-empty-state">{empty}</div>
  }
  if (view === 'date') {
    return (
      <>
        {cards.map((card) => (
          <ImageCard
            key={card.key}
            image={card.image}
            use={card.use}
            isActive={isActiveUse(card)}
            primed={false}
            expanded={expandedKey === card.key}
            press={pressFor(card, () => toggleExpanded(card.key))}
            actions={(
              <div className="note-list-column note-list-column-action note-list-column-trash">
                <RemoveButton use={card.use} onRemove={onRemove} inColumn />
              </div>
            )}
            onPrimeEnd={noop}
          />
        ))}
      </>
    )
  }
  if (view === 'trash') {
    return (
      <>
        {libraryImages.map((image) => {
          const primed = primedId === image.id
          // A trashed image a note still uses cannot be deleted: that note would break.
          const isUsed = image.useCount > 0
          const purgeLabel = isUsed
            ? `Used by ${image.useCount} note${image.useCount === 1 ? '' : 's'}: remove it there before deleting it`
            : primed ? 'Click again: delete for good' : 'Delete for good'
          return (
            <ImageCard
              key={image.id}
              image={image}
              use={null}
              isActive={image.id === shownImageId}
              primed={primed}
              expanded={false}
              press={{ onClick: null, onLeftHold: null, onRightTap: null, onRightHold: () => onOpen(image.id) }}
              onPrimeEnd={() => setPrimedId(null)}
              actions={(
                <>
                  <div className="note-list-column note-list-column-action note-list-column-archive">
                    <button
                      type="button"
                      className="note-list-action-button note-list-action-button-restore"
                      aria-label="Take out of the trash"
                      data-tooltip="Take out of the trash"
                      onClick={(event) => { event.stopPropagation(); void setImageTrashed(image.id, false) }}
                      onMouseDown={stopCardPress}
                      data-secondary-press="none"
                    >
                      <span className="fa-solid fa-rotate-left" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="note-list-column note-list-column-action note-list-column-trash">
                    <button
                      type="button"
                      disabled={isUsed}
                      className="note-list-action-button note-list-action-button-trash"
                      aria-label={purgeLabel}
                      data-tooltip={purgeLabel}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (!primed) {
                          setPrimedId(image.id)
                          return
                        }
                        setPrimedId(null)
                        void purgeImage(image.id)
                      }}
                      onMouseDown={stopCardPress}
                      data-secondary-press="none"
                    />
                  </div>
                </>
              )}
            />
          )
        })}
      </>
    )
  }
  if (sectionGroups) {
    return (
      <CategoryTree
        groups={sectionGroups}
        itemId={cardKey}
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

const noop = () => {}
const NOTHING_COLLAPSED: CategoryTreeCollapse = { collapsedPrimary: [], collapsedSecondary: [] }
const imageIdOf = (image: StoredImageSummary) => image.id
const cardKey = (card: ImageUseCard) => card.key
const imageTreeCardSelector = (id: string) => `.image-list-item.is-tree-card[data-image-id="${CSS.escape(id)}"]`
