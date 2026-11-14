import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent } from 'react'
import { CategoryTree, type CategoryTreeFolds } from '../components/CategoryTree'
import { HoverActions, type HoverAction } from '../components/HoverActions'
import { IMAGE_DRAG_MIME_TYPE, type NoteImageUse, type StoredImageSummary } from '../shared/images'
import { cssInset, parseImageTitle, type ImageInset } from '../shared/imageLayout'
import { armPointerDrag } from '../shared/pointerDrag'
import { localImageSrc } from '../shared/localImages'
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
  /** The current note's images (shared/images.ts's imageUsesIn). */
  uses: readonly NoteImageUse[]
  /** The image the active slot shows, if it shows one. */
  shownImageId: string | null
  /** The use the caret is in, by its offset, if any. */
  caretUseFrom: number | null
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

/**
 * What a use shows of its image: its crop (the title's `inset(...)`), and
 * the size in pixels of the part it keeps. These views are an inventory of
 * what the note shows, so a use is seen cropped; the archive (no use) shows
 * the whole image.
 */
function shownPart(image: StoredImageSummary | null, use: NoteImageUse | null): { inset: ImageInset | null; width: number; height: number } {
  const parsed = use ? parseImageTitle(use.title) : null
  const inset = parsed?.kind === 'layout' ? parsed.layout.inset : null
  const width = image?.width ?? 0
  const height = image?.height ?? 0
  if (!inset) return { inset, width, height }
  return {
    inset,
    width: Math.round(width * (100 - inset.left - inset.right) / 100),
    height: Math.round(height * (100 - inset.top - inset.bottom) / 100),
  }
}

function sizeLabel(part: { width: number; height: number }): string {
  return part.width > 0 ? `${part.width}×${part.height}` : ''
}

/** The image drawn in a card, cropped as the use crops it. */
function CardImage({ src, inset, className }: { src: string; inset: ImageInset | null; className: string }) {
  return <img className={className} src={src} alt="" aria-hidden="true" draggable={false} style={inset ? { objectViewBox: cssInset(inset) } as CSSProperties : undefined} />
}

/** What a card for an external image shows: a file on disk always, a web image only when remote images are allowed. */
function externalCardSrc(src: string, remoteAllowed: boolean): string | null {
  return localImageSrc(src) ?? (remoteAllowed && isRemoteImageSrc(src) ? src : null)
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
function useCardPress({ onClick, onLeftHold, onRightTap, onRightHold }: CardPress, draggable: boolean) {
  const cancelRef = useRef<(() => void) | null>(null)
  const heldRef = useRef(false)
  const end = (button: number | null) => {
    if (!cancelRef.current) return
    cancelRef.current()
    cancelRef.current = null
    if (button === 2 && !heldRef.current) onRightTap?.()
  }
  return {
    // One pointerdown for the card's two uses of a press: arming a drag of the
    // image (shared/pointerDrag.ts) and timing a hold. Two props by one name
    // spread onto one element would silently keep only the second.
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (draggable) armPointerDrag(event)
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
    onPointerUp: (event: PointerEvent) => end(event.button),
    onPointerCancel: () => end(null),
    // Leaving is the hover vocabulary, not the press one: a finger lifting
    // fires pointerleave, which would end every prime the moment it was set.
    onMouseLeave: () => end(null),
    onClick: () => {
      if (heldRef.current) return
      onClick?.()
    },
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
    'data-secondary-press': onRightTap || onRightHold ? 'action' as const : 'none' as const,
  }
}

function dragImage(id: string) {
  return {
    // Dragged into a note, it is referenced there (CM6Editor's and the
    // render view's drop handlers); nothing is stored again.
    'data-drag-source': '',
    // A card is too large to carry about: the cursor shows the drag instead.
    'data-drag-picture': 'cursor',
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(IMAGE_DRAG_MIME_TYPE, id)
      event.dataTransfer.effectAllowed = 'copy'
    },
  }
}

/** Taking a use out of its note: the action of every card in a note's own image views. */
function removeAction(use: NoteImageUse, onRemove: (use: NoteImageUse) => void): HoverAction {
  return { icon: 'fa-xmark', label: 'Take it out of the note', onHold: () => onRemove(use) }
}

/** A card with the image behind its text: Images in Order and the trash. */
const ImageCard = memo(function ImageCard({ image, use, isActive, expanded, press, actions, nameFirst = false }: {
  image: StoredImageSummary | null
  /** The image's place in the note; null in the trash. */
  use: NoteImageUse | null
  isActive: boolean
  expanded: boolean
  press: CardPress
  /** Shown at the end of the title row on hover; none while the card is expanded. */
  actions: readonly HoverAction[]
  /** The trash: the file's name on top and the id below it, as a note card names a note above its id. */
  nameFirst?: boolean
}) {
  const handlers = useCardPress(press, image !== null)
  const remoteAllowed = useRemoteImagesAllowed()
  const src = image ? image.src : use ? externalCardSrc(use.src, remoteAllowed) : null
  const part = shownPart(image, use)
  const style = part.width > 0 ? { '--image-ratio': part.height / part.width } as CSSProperties : undefined
  const tooltip = !use ? `Click to see it, drag it into a note to put it there. Hold right-click to show it`
    : !image ? `${use.src}. Click to see it, right-click to go to it, hold to store it in the app`
    : `Click to see it, right-click to go to it. Hold right-click to show it`
  const title = nameFirst && image ? <span data-tooltip={image.origin ?? 'Pasted from the clipboard'}>{originLabel(image)}</span> : <CardTitle image={image} />
  const metaLeft = nameFirst && image ? <span className="note-list-meta-left">{image.id}</span>
    : use ? <span className="note-list-meta-left">{use.alt}</span>
    : image ? <span className="note-list-meta-left" data-tooltip={image.origin ?? 'Pasted from the clipboard'}>{originLabel(image)}</span> : null
  return (
    <div
      className={`note-list-item image-list-item${isActive ? ' is-active' : ''}${expanded ? ' is-expanded' : ''}`}
      style={style}
      role="option"
      aria-selected={isActive}
      data-image-id={image?.id}
      data-hover-host=""
      {...(image ? dragImage(image.id) : {})}
      {...handlers}
      data-tooltip={tooltip}
    >
      <div className="note-list-columns">
        <div className="note-list-column note-list-column-primary">
          {src ? <CardImage className="image-list-thumbnail" src={src} inset={part.inset} /> : null}
          <div className="note-list-content">
            <div className="note-list-title-row">
              <div className="note-list-title">{title}</div>
              <HoverActions rest={null} actions={expanded ? [] : actions} />
            </div>
            <div className="note-list-meta-row">
              {metaLeft}
              <span className="note-list-meta-right">{sizeLabel(part)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

/** A card in the two trees: the note tree's own card, the name on the left and the size on the right. */
const ImageTreeCard = memo(function ImageTreeCard({ image, use, isActive, expanded, press, actions }: {
  image: StoredImageSummary | null
  use: NoteImageUse | null
  isActive: boolean
  /** Showing the image whole beneath the row (a click). */
  expanded: boolean
  press: CardPress
  /** What takes the size's place on hover; none while the image is shown beneath the row. */
  actions: readonly HoverAction[]
}) {
  const handlers = useCardPress(press, image !== null)
  const remoteAllowed = useRemoteImagesAllowed()
  const src = image ? image.src : use ? externalCardSrc(use.src, remoteAllowed) : null
  const part = shownPart(image, use)
  const previewing = expanded && src !== null
  const tooltip = use
    ? `${use.alt ? `${use.alt}. ` : ''}${image ? 'Click to see it, right-click to go to it, hold right-click to show it' : `${use.src}. Click to see it, right-click to go to it, hold to store it in the app`}`
    : 'Click to see it, drag it into a note to put it there. Hold right-click to show it'
  return (
    <div
      className={`note-list-item is-tree-card image-list-item${isActive ? ' is-active' : ''}${previewing ? ' is-previewing' : ''}`}
      role="option"
      aria-selected={isActive}
      data-image-id={image?.id}
      data-hover-host=""
      {...(image ? dragImage(image.id) : {})}
      {...handlers}
      data-tooltip={tooltip}
    >
      <div className="note-list-content">
        <div className="note-list-meta-row image-tree-card-row">
          <span className="note-list-title"><CardTitle image={image} /></span>
          <span className="note-list-meta-right"><HoverActions rest={sizeLabel(part)} actions={previewing ? [] : actions} /></span>
        </div>
        {previewing ? (
          <CardImage className="image-tree-card-preview" src={src} inset={part.inset} />
        ) : null}
      </div>
    </div>
  )
})

export const ImageLibraryList = memo(function ImageLibraryList({ view, searchQuery, uses, shownImageId, caretUseFrom, onReveal, onRemove, onStore, onOpen }: ImageLibraryListProps) {
  const { images, loaded } = useImageLibrary()
  // One card at a time is expanded, in whichever view: expanding another folds it.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const toggleExpanded = useCallback((key: string) => setExpandedKey((previous) => (previous === key ? null : key)), [])
  const isNoteView = view === 'date' || view === 'category'
  const cards = useMemo(() => (isNoteView ? imageUseCards(uses, images, searchQuery) : []), [isNoteView, uses, images, searchQuery])
  const libraryImages = useMemo(() => (isNoteView ? [] : imagesInView(images, view, searchQuery)), [isNoteView, images, view, searchQuery])
  // A use is highlighted when the caret is in it; anything else by the image the slot shows.
  const isActiveUse = useCallback((card: ImageUseCard) => (
    caretUseFrom !== null ? card.use.from === caretUseFrom : card.image !== null && card.image.id === shownImageId
  ), [caretUseFrom, shownImageId])
  // In every section a click shows the image whole in the card, and a second
  // folds it again; an image goes into a note only by being dragged there
  // (dragImage). A card of the note's own images goes to the image's place
  // in the note on a right-click.
  const pressFor = useCallback((card: ImageUseCard): CardPress => ({
    onClick: () => toggleExpanded(card.key),
    onLeftHold: card.image ? null : () => onStore(card.use),
    onRightTap: () => onReveal(card.use),
    onRightHold: card.image ? () => onOpen(card.image!.id) : null,
  }), [onOpen, onReveal, onStore, toggleExpanded])

  const sectionGroups = useMemo(() => (view === 'category' ? groupCardsBySection(cards) : null), [cards, view])
  // The archive is the notes' tree: an image sits in one place, by the order of its tags.
  const tagGroups = useMemo(() => (view === 'archive' ? buildTagHierarchy(libraryImages, (image) => image.tags) : null), [libraryImages, view])
  // What is folded is remembered per view for as long as the sidebar shows
  // images, and not across restarts.
  const [collapseByView, setCollapseByView] = useState<Partial<Record<ImageLibraryView, CategoryTreeFolds>>>({})
  const collapse = collapseByView[view] ?? NOTHING_FLIPPED
  const onCollapseChange = useCallback((next: CategoryTreeFolds) => setCollapseByView((previous) => ({ ...previous, [view]: next })), [view])
  const renderUseTreeCard = useCallback((card: ImageUseCard) => (
    <ImageTreeCard
      key={card.key}
      image={card.image}
      use={card.use}
      isActive={isActiveUse(card)}
      expanded={expandedKey === card.key}
      press={pressFor(card)}
      actions={[removeAction(card.use, onRemove)]}
    />
  ), [expandedKey, isActiveUse, onRemove, pressFor])
  const renderImageTreeCard = useCallback((image: StoredImageSummary) => (
    <ImageTreeCard
      key={image.id}
      image={image}
      use={null}
      isActive={image.id === shownImageId}
      expanded={expandedKey === image.id}
      press={{ onClick: () => toggleExpanded(image.id), onLeftHold: null, onRightTap: null, onRightHold: () => onOpen(image.id) }}
      actions={[{ icon: 'fa-trash-can', label: 'Put in the trash', onHold: () => { void setImageTrashed(image.id, true) } }]}
    />
  ), [expandedKey, onOpen, shownImageId, toggleExpanded])

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
            expanded={expandedKey === card.key}
            press={pressFor(card)}
            actions={[removeAction(card.use, onRemove)]}
          />
        ))}
      </>
    )
  }
  if (view === 'trash') {
    return (
      <>
        {libraryImages.map((image) => {
          // A trashed image a note still uses cannot be deleted: that note would break.
          const isUsed = image.useCount > 0
          const actions: HoverAction[] = [
            { icon: 'fa-rotate-left', label: 'Take out of the trash', onHold: () => { void setImageTrashed(image.id, false) } },
            ...(isUsed ? [] : [{ icon: 'fa-trash-can', label: 'Delete for good', onHold: () => { void purgeImage(image.id) } }]),
          ]
          return (
            <ImageCard
              key={image.id}
              image={image}
              use={null}
              isActive={image.id === shownImageId}
              expanded={expandedKey === image.id}
              press={{ onClick: () => toggleExpanded(image.id), onLeftHold: null, onRightTap: null, onRightHold: () => onOpen(image.id) }}
              actions={actions}
              nameFirst
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
        renderItem={renderUseTreeCard}
        startsFolded={false}
        folds={collapse}
        onFoldsChange={onCollapseChange}
        emptyLabel=""
        ariaLabel="Images by section"
      />
    )
  }
  return (
    <CategoryTree
      groups={tagGroups ?? []}
      renderItem={renderImageTreeCard}
      startsFolded={false}
      folds={collapse}
      onFoldsChange={onCollapseChange}
      emptyLabel=""
      ariaLabel="Images by tag"
    />
  )
})

const NOTHING_FLIPPED: CategoryTreeFolds = { primary: [], secondary: [] }
