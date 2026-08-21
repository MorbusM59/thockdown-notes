import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, DragEvent, KeyboardEvent, MouseEvent, MutableRefObject, RefObject, SetStateAction, WheelEvent as ReactWheelEvent } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { NoteTabEntry } from '../shared/tabs'
import { PROTECTED_TAGS, normalizeTagName, isProtectedTagName, isExternalTagName } from '../shared/tags'
import { NOTE_DRAG_MIME_TYPE, serializeNoteDragPayload } from '../shared/noteDrag'
import { useInlinePillEdit } from '../shared/useInlinePillEdit'

/** How long the temp tab must be held down (left mouse button) before it's promoted to a permanent pinned tab. */
export const TEMP_TAB_PIN_HOLD_MS = 500

export interface UseSectionTabsOptions {
  /** Which section this instance belongs to -- scopes both the tag bar (this section's active note) and the pinned tabs it shows. */
  sectionId: string
  activeNoteId: string | null
  /**
   * The note identity both halves of this hook treat as active -- equal to
   * `activeNoteId` except when a chapter is loaded, in which case this is
   * the chapter's parent (see EditorSection.tsx's `menuIdentityNoteId`).
   * Chapters must never appear as their own tab pill; the parent's pill
   * stays highlighted/pinnable instead. Chapters also have no tag life of
   * their own -- tags always belong to the parent note -- so the *tag bar*
   * reads/writes through this same identity, not the true `activeNoteId`.
   */
  tabIdentityNoteId: string | null
  notes: NoteSummary[]
  persistenceReady: boolean
  /** Switches which note this section is showing. Will become section-scoped itself once sections can diverge; passed straight through for now. */
  activateNote: (noteId: string) => Promise<void>
  /** Unloads this section's active note back to its blank, no-note-loaded state -- used whenever the active note's tab closes, instead of auto-selecting a neighboring tab. */
  clearActiveNote: () => Promise<void>
  /** Locates this section's active note in the (deliberately stable, non-chasing) menu -- triggered by clicking a tab that's already selected. */
  revealNoteInMenu: () => void
  flushPendingSaveNow: () => Promise<void>
  refreshNotes: (preferredId?: string | null) => Promise<string | null>
  /** Shared across every note-mutating operation in the app, not owned by this hook -- guards against overlapping note transitions. */
  noteTransitionLockRef: MutableRefObject<boolean>
  scheduleFocusEditorInEditMode: () => void
  /** Patches a note's assignedId in the shared notes list after a `$id` assignment or a lazily-generated default. */
  updateNoteAssignedId: (noteId: string, assignedId: string) => void
  /** Applied once (e.g. after the persisted app-state round-trip resolves); null/omitted leaves the default 'tags' mode. */
  initialTabBarMode?: 'tags' | 'tabs' | null
}

export interface UseSectionTabsResult {
  // ── Tag bar ──
  tagInputRef: RefObject<HTMLInputElement>
  tagInputValue: string
  setTagInputValue: Dispatch<SetStateAction<string>>
  orderedActiveTags: string[]
  suggestedTags: string[]
  deletePrimedTagName: string | null
  renamingTagName: string | null
  tagRenameDraft: string
  setTagRenameDraft: Dispatch<SetStateAction<string>>
  commitTagRename: () => void
  cancelTagRename: () => void
  isTagMutationPending: boolean
  activeNoteIsExternal: boolean
  activeNoteIsTimeless: boolean
  handleTagInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  handleAddSuggestedTag: (tagName: string) => void
  handleTagChipClick: (tagName: string) => void
  handleTagChipMouseLeave: (tagName: string) => void
  handleTagDragStart: (event: DragEvent<HTMLDivElement>, index: number) => void
  handleTagDragEnd: () => void
  handleTagDrop: (event: DragEvent<HTMLDivElement>, targetIndex: number) => void
  handleTagContainerDragOver: (event: DragEvent<HTMLDivElement>) => void
  handleTagContainerDrop: (event: DragEvent<HTMLDivElement>) => void
  handleTagContextMenu: (event: MouseEvent<HTMLDivElement>, tagName: string) => void
  /** Whether the suggested-tags row is occupying the whole tag bar (hiding the tag input and currently-assigned tags) -- toggled by clicking the identity tab while it's showing the assigned id. */
  isSuggestedTagsExpanded: boolean
  toggleSuggestedTagsExpanded: () => void
  suggestedTagsScrollerRef: RefObject<HTMLDivElement>
  suggestedTagsCanScrollLeft: boolean
  suggestedTagsCanScrollRight: boolean
  updateSuggestedTagsScrollEdges: () => void
  handleSuggestedTagsWheel: (event: ReactWheelEvent<HTMLDivElement>) => void

  // ── Tab bar ──
  tabBarMode: 'tags' | 'tabs'
  toggleTabBarMode: () => void
  /** Imperative escape hatch for callers outside this section (App.tsx, post-swap) to force a specific bar mode -- e.g. so a section swapped in from a tab-bar-mode picker doesn't revert to its own fresh default of 'tags'. */
  setTabBarMode: Dispatch<SetStateAction<'tags' | 'tabs'>>
  pinnedTabs: NoteTabEntry[]
  unpinPrimedTabNoteId: string | null
  activeNoteIsPinned: boolean
  tempTabNoteId: string | null
  pinArmingTabNoteId: string | null
  /** Which tab pill (if any) is mid in-place id edit -- chapter-pill style, entered via a quick right-click. */
  editingTabNoteId: string | null
  tabIdDraft: string
  setTabIdDraft: Dispatch<SetStateAction<string>>
  commitTabIdEdit: () => void
  cancelTabIdEdit: () => void
  /** Which tab pill (if any) is mid held-right-click, arming for unpin -- distinct from unpinPrimedTabNoteId, which is the post-arm "click again to confirm" state. */
  unpinArmingTabNoteId: string | null
  tabsScrollerRef: RefObject<HTMLDivElement>
  tabsCanScrollLeft: boolean
  tabsCanScrollRight: boolean
  handleAddCurrentNoteToTabs: () => Promise<void>
  handleTabContextMenu: (event: MouseEvent<HTMLDivElement>) => void
  handleTabMouseLeave: (noteId: string) => void
  handleTabClick: (noteId: string) => void
  handleTabMouseDown: (event: MouseEvent<HTMLDivElement>, noteId: string) => void
  handleTabMouseUp: (event: MouseEvent<HTMLDivElement>, noteId: string) => void
  clearTabHoldTimer: () => void
  handleTempTabMouseDown: (event: MouseEvent<HTMLDivElement>, noteId: string) => void
  clearTempTabHoldTimer: () => void
  updateTabsScrollEdges: () => void
  handleTabsWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
  handleTabDragStart: (event: DragEvent<HTMLDivElement>, index: number) => void
  handleTabDragEnd: () => void
  handleTabDrop: (event: DragEvent<HTMLDivElement>, targetIndex: number) => void
  handleTabsContainerDragOver: (event: DragEvent<HTMLDivElement>) => void
  handleTabsContainerDrop: (event: DragEvent<HTMLDivElement>) => void
  /** Removes a note's pinned tab in this section, without touching activation -- used when a foreign section claims it via drag-and-drop. */
  unpinNoteTab: (noteId: string) => Promise<void>
  /** Pins `noteId` to this section (if not already pinned) and moves it to the rightmost position -- used by section-wide drop targets (cross-section tab moves, sidebar note drops). */
  pinNoteAsRightmostTab: (noteId: string) => Promise<void>
  /** Lets a caller outside this hook (EditorSection.tsx's activateNote, routed through a ref -- see its own doc comment) hand back a fresh tab list after its own out-of-band write (recording a tab's last-active chapter) so this section's locally cached pinnedTabs doesn't go stale until the next full remount. */
  applyTabsUpdate: (tabs: NoteTabEntry[]) => void
}

/**
 * Owns the tag bar / tab bar UI that sits above one editor section: tag
 * add/remove/rename/reorder for the section's active note, `$id` assignment,
 * and the pinned + temp-tab quick-access strip (including its horizontal
 * scroll). Deliberately does not know how to load, save, or activate a note
 * beyond calling the `activateNote` it's given -- that's still owned by the
 * broader note-lifecycle machinery, injected in.
 */
export function useSectionTabs(options: UseSectionTabsOptions): UseSectionTabsResult {
  const {
    sectionId,
    activeNoteId,
    tabIdentityNoteId,
    notes,
    persistenceReady,
    activateNote,
    clearActiveNote,
    revealNoteInMenu,
    flushPendingSaveNow,
    refreshNotes,
    noteTransitionLockRef,
    scheduleFocusEditorInEditMode,
    updateNoteAssignedId,
    initialTabBarMode,
  } = options

  // ── Tag bar state ──────────────────────────────────────────────────────

  const tagInputRef = useRef<HTMLInputElement | null>(null)
  const [tagInputValue, setTagInputValue] = useState('')
  const [isTagMutationPending, setIsTagMutationPending] = useState(false)
  const [deletePrimedTagName, setDeletePrimedTagName] = useState<string | null>(null)
  const [draggedTagIndex, setDraggedTagIndex] = useState<number | null>(null)

  // Tags always belong to `tabIdentityNoteId` (the parent, when a chapter is
  // loaded) -- see this hook's own doc comment on that option.
  const tagIdentityNoteSummary = useMemo(() => {
    if (!tabIdentityNoteId) return null
    return notes.find((note) => note.id === tabIdentityNoteId) ?? null
  }, [tabIdentityNoteId, notes])

  const orderedActiveTags = useMemo(() => tagIdentityNoteSummary?.tags ?? [], [tagIdentityNoteSummary])
  const activeNoteIsExternal = orderedActiveTags.some((tag) => isExternalTagName(tag))
  // A timeless note is frozen at the database layer (databaseService.ts's
  // assertNotTimeless) -- every tag mutation below would just reject
  // anyway, so this blocks the affordance the same way activeNoteIsExternal
  // already does for an external note's tag bar.
  const activeNoteIsTimeless = Boolean(tagIdentityNoteSummary?.isTimeless)

  // Switching notes (or the tag-owning note's own tags changing) both
  // invalidate any in-progress "click again to delete" arm.
  useEffect(() => {
    setDeletePrimedTagName(null)
  }, [tabIdentityNoteId, orderedActiveTags])

  const suggestedTags = useMemo(() => {
    const usageByName = new Map<string, number>()

    for (const note of notes) {
      for (const tag of note.tags) {
        usageByName.set(tag, (usageByName.get(tag) ?? 0) + 1)
      }
    }

    const activeTagSet = new Set(orderedActiveTags)

    return [...usageByName.entries()]
      .filter(([name]) => !PROTECTED_TAGS.has(normalizeTagName(name)) && !activeTagSet.has(name))
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1]
        }
        return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
      })
      .map(([name]) => name)
      .slice(0, 15)
  }, [notes, orderedActiveTags])

  const runActiveNoteTagMutation = useCallback(async (mutate: (noteId: string) => Promise<void>) => {
    if (!window.thockdownNotes) return
    if (!persistenceReady) return
    if (!tabIdentityNoteId || !activeNoteId) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    setIsTagMutationPending(true)
    try {
      await flushPendingSaveNow()
      await mutate(tabIdentityNoteId)
      await refreshNotes(activeNoteId)
      await activateNote(activeNoteId)
    } catch (error) {
      console.error('Failed to mutate active note tags', error)
    } finally {
      setIsTagMutationPending(false)
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, tabIdentityNoteId, activateNote, flushPendingSaveNow, noteTransitionLockRef, persistenceReady, refreshNotes])

  const handleAddSuggestedTag = useCallback((tagName: string) => {
    if (activeNoteIsExternal || activeNoteIsTimeless) return
    if (orderedActiveTags.includes(tagName)) return

    void runActiveNoteTagMutation(async (noteId) => {
      await window.thockdownNotes!.addTagToNote({
        id: noteId,
        tagName,
        position: orderedActiveTags.length,
      })
    })
  }, [activeNoteIsExternal, activeNoteIsTimeless, orderedActiveTags, runActiveNoteTagMutation])

  const handleTagInputEnter = useCallback(() => {
    if (!activeNoteId || !persistenceReady) return
    if (activeNoteIsExternal || activeNoteIsTimeless) return

    const rawInput = tagInputValue.trim()
    if (rawInput.startsWith('$')) {
      const requestedId = rawInput.slice(1)
      setTagInputValue('')
      if (!window.thockdownNotes) return

      const noteId = activeNoteId
      void (async () => {
        try {
          const updated = await window.thockdownNotes!.setNoteAssignedId({ id: noteId, requestedId })
          if (updated?.assignedId) {
            updateNoteAssignedId(noteId, updated.assignedId)
          }
        } catch (error) {
          console.error('Failed to set note internal ID', error)
        }
      })()
      return
    }

    const normalized = normalizeTagName(tagInputValue)
    if (!normalized) return

    if (isProtectedTagName(normalized)) {
      setTagInputValue('')
      return
    }

    if (orderedActiveTags.map(normalizeTagName).includes(normalized)) {
      setTagInputValue('')
      return
    }

    void runActiveNoteTagMutation(async (noteId) => {
      await window.thockdownNotes!.addTagToNote({
        id: noteId,
        tagName: normalized,
        position: orderedActiveTags.length,
      })
    })
    setTagInputValue('')
  }, [
    activeNoteId,
    orderedActiveTags,
    persistenceReady,
    runActiveNoteTagMutation,
    tagInputValue,
    activeNoteIsExternal,
    activeNoteIsTimeless,
    updateNoteAssignedId,
  ])

  const handleTagInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleTagInputEnter()
      scheduleFocusEditorInEditMode()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      scheduleFocusEditorInEditMode()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      scheduleFocusEditorInEditMode()
    }
  }, [handleTagInputEnter, scheduleFocusEditorInEditMode])

  const handleTagChipClick = useCallback((tagName: string) => {
    if (activeNoteIsTimeless) return
    if (deletePrimedTagName === tagName) {
      setDeletePrimedTagName(null)
      void runActiveNoteTagMutation(async (noteId) => {
        await window.thockdownNotes!.removeTagFromNote({ id: noteId, tagName })
      })
      return
    }

    setDeletePrimedTagName(tagName)
  }, [activeNoteIsTimeless, deletePrimedTagName, runActiveNoteTagMutation])

  const handleTagChipMouseLeave = useCallback((tagName: string) => {
    if (deletePrimedTagName === tagName) {
      setDeletePrimedTagName(null)
    }
  }, [deletePrimedTagName])

  const handleTagDragStart = useCallback((event: DragEvent<HTMLDivElement>, index: number) => {
    const tagName = orderedActiveTags[index] ?? ''
    if (isProtectedTagName(tagName) || activeNoteIsTimeless) return

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tagName)
    setDraggedTagIndex(index)
  }, [activeNoteIsTimeless, orderedActiveTags])

  const handleTagDragEnd = useCallback(() => {
    setDraggedTagIndex(null)
  }, [])

  const handleTagDrop = useCallback((event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    event.preventDefault()
    event.stopPropagation()

    if (draggedTagIndex === null || draggedTagIndex === targetIndex) {
      setDraggedTagIndex(null)
      return
    }

    const targetTag = orderedActiveTags[targetIndex] ?? ''
    if (isProtectedTagName(targetTag)) {
      setDraggedTagIndex(null)
      return
    }

    const reordered = [...orderedActiveTags]
    const [moved] = reordered.splice(draggedTagIndex, 1)
    if (!moved) {
      setDraggedTagIndex(null)
      return
    }
    reordered.splice(targetIndex, 0, moved)
    setDraggedTagIndex(null)

    void runActiveNoteTagMutation(async (noteId) => {
      await window.thockdownNotes!.reorderNoteTags({ id: noteId, tagNames: reordered })
    })
  }, [draggedTagIndex, orderedActiveTags, runActiveNoteTagMutation])

  const handleTagContainerDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (draggedTagIndex === null) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
  }, [draggedTagIndex])

  const handleTagContainerDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (draggedTagIndex === null) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const reordered = [...orderedActiveTags]
    const [moved] = reordered.splice(draggedTagIndex, 1)
    if (!moved) {
      setDraggedTagIndex(null)
      return
    }

    reordered.push(moved)
    setDraggedTagIndex(null)

    void runActiveNoteTagMutation(async (noteId) => {
      await window.thockdownNotes!.reorderNoteTags({ id: noteId, tagNames: reordered })
    })
  }, [draggedTagIndex, orderedActiveTags, runActiveNoteTagMutation])

  // Ported from the old handleTagInputEnter rename branch, now keyed off
  // the pill's own draft instead of the shared add-tag input's value.
  const commitTagRenameValue = useCallback(async (fromName: string, draft: string) => {
    if (!activeNoteId) return

    const normalizedFrom = normalizeTagName(fromName)
    const toName = normalizeTagName(draft)
    if (!toName || normalizedFrom === toName) return
    if (isProtectedTagName(normalizedFrom)) return
    if (activeNoteIsTimeless) return
    if (!window.thockdownNotes) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    setIsTagMutationPending(true)
    try {
      await flushPendingSaveNow()
      await window.thockdownNotes.renameTag({ fromName: normalizedFrom, toName })
      await refreshNotes(activeNoteId)
      await activateNote(activeNoteId)
    } catch (error) {
      console.error('Failed to rename tag', error)
    } finally {
      setIsTagMutationPending(false)
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, activeNoteIsTimeless, activateNote, flushPendingSaveNow, noteTransitionLockRef, refreshNotes])

  const tagRenameKeyExists = useCallback((tagName: string) => (
    orderedActiveTags.includes(tagName)
  ), [orderedActiveTags])

  const {
    editingKey: renamingTagName,
    draft: tagRenameDraft,
    setDraft: setTagRenameDraft,
    start: startRenamingTag,
    cancel: cancelTagRename,
    commit: commitTagRename,
  } = useInlinePillEdit<string>({ commit: commitTagRenameValue, keyExists: tagRenameKeyExists })

  const handleTagContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, tagName: string) => {
    event.preventDefault()
    if (isProtectedTagName(tagName) || activeNoteIsTimeless) return
    startRenamingTag(tagName, tagName)
  }, [activeNoteIsTimeless, startRenamingTag])

  // ── Tab bar state ──────────────────────────────────────────────────────

  const [tabBarMode, setTabBarMode] = useState<'tags' | 'tabs'>('tabs')

  useEffect(() => {
    if (initialTabBarMode) setTabBarMode(initialTabBarMode)
    // Deliberately only reacting to the restored value arriving, not every
    // render -- this is a one-time hand-off from persisted app state, not a
    // controlled prop.
  }, [initialTabBarMode])

  const [pinnedTabs, setPinnedTabs] = useState<NoteTabEntry[]>([])
  const [unpinPrimedTabNoteId, setUnpinPrimedTabNoteId] = useState<string | null>(null)
  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!persistenceReady) return
    if (!window.thockdownTabs) return
    let cancelled = false
    void window.thockdownTabs.listTabs().then((tabs) => {
      if (!cancelled) setPinnedTabs(tabs.filter((tab) => tab.sectionId === sectionId))
    })
    return () => {
      cancelled = true
    }
  }, [persistenceReady, sectionId])

  // Permanently deleting a note cascade-removes its note_tabs row in SQLite,
  // but this section's own in-memory pinnedTabs was fetched once above and
  // has no way to hear about that -- prune it here whenever a pinned note
  // drops out of the shared notes list (soft-deleted/archived notes stay in
  // that list, so they're untouched; only a true `deleteNote` makes a note
  // vanish from it). Gated on persistenceReady since `notes` starts empty
  // before the initial load resolves.
  //
  // Also nulls out any tab's lastActiveChapterNoteId that's gone the same
  // way -- e.g. a *different* section collapsed/merged that chapter out from
  // under a note pinned in both. The backend already re-validates this on
  // every fresh listTabs() fetch, but this section's local pinnedTabs is
  // otherwise never told about a deletion that happened elsewhere, so
  // without this it would keep offering a dead chapter id to handleTabClick
  // below until the next full refetch (e.g. a remount).
  useEffect(() => {
    if (!persistenceReady) return
    const noteIds = new Set(notes.map((note) => note.id))
    setPinnedTabs((previous) => {
      const next = previous
        .filter((tab) => noteIds.has(tab.noteId))
        .map((tab) => (
          tab.lastActiveChapterNoteId && !noteIds.has(tab.lastActiveChapterNoteId)
            ? { ...tab, lastActiveChapterNoteId: null }
            : tab
        ))
      const unchanged = next.length === previous.length && next.every((tab, index) => tab === previous[index])
      return unchanged ? previous : next
    })
    if (tabIdentityNoteId && !noteIds.has(tabIdentityNoteId)) {
      void clearActiveNote()
    }
  }, [persistenceReady, notes, tabIdentityNoteId, clearActiveNote])

  const toggleTabBarMode = useCallback(() => {
    setTabBarMode((previous) => (previous === 'tags' ? 'tabs' : 'tags'))
    setUnpinPrimedTabNoteId(null)
  }, [])

  // ── Suggested tags, expanded to fill the whole bar ──────────────────────
  // Toggled by clicking the identity tab while it's showing the assigned id
  // (tag-bar mode); hides the tag input and currently-assigned tags so the
  // full suggestion list gets the whole width, wheel-scrollable exactly like
  // the tab bar's own horizontal scroll below.

  const [isSuggestedTagsExpanded, setIsSuggestedTagsExpanded] = useState(false)

  const toggleSuggestedTagsExpanded = useCallback(() => {
    setIsSuggestedTagsExpanded((previous) => !previous)
  }, [])

  // Leaving tag-bar mode (or switching notes) collapses it back -- it's
  // transient chrome for the note currently showing, not a sticky preference.
  useEffect(() => {
    setIsSuggestedTagsExpanded(false)
  }, [tabBarMode, activeNoteId])

  const suggestedTagsScrollerRef = useRef<HTMLDivElement | null>(null)
  const [suggestedTagsCanScrollLeft, setSuggestedTagsCanScrollLeft] = useState(false)
  const [suggestedTagsCanScrollRight, setSuggestedTagsCanScrollRight] = useState(false)

  const updateSuggestedTagsScrollEdges = useCallback(() => {
    const el = suggestedTagsScrollerRef.current
    if (!el) return
    setSuggestedTagsCanScrollLeft(el.scrollLeft > 1)
    setSuggestedTagsCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
  }, [])

  useEffect(() => {
    updateSuggestedTagsScrollEdges()
  }, [suggestedTags, isSuggestedTagsExpanded, updateSuggestedTagsScrollEdges])

  useEffect(() => {
    if (!isSuggestedTagsExpanded) return
    window.addEventListener('resize', updateSuggestedTagsScrollEdges)
    return () => window.removeEventListener('resize', updateSuggestedTagsScrollEdges)
  }, [isSuggestedTagsExpanded, updateSuggestedTagsScrollEdges])

  const handleSuggestedTagsWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return
    event.preventDefault()
    event.currentTarget.scrollLeft += event.deltaY
  }, [])

  // The currently open note gets a temporary, unsaved "preview" tab at the
  // leftmost position whenever it isn't already pinned. It tracks whichever
  // unpinned note is active — it isn't a real entry in note_tabs until the
  // user holds it long enough to promote it (see handleTempTabMouseDown).
  const activeNoteIsPinned = tabIdentityNoteId ? pinnedTabs.some((tab) => tab.noteId === tabIdentityNoteId) : false
  const tempTabNoteId = tabIdentityNoteId && !activeNoteIsPinned ? tabIdentityNoteId : null

  // A tab mid in-place id edit can vanish out from under the input (hard
  // delete, or the pruning effect above dropping it) -- the input just
  // unmounts, no blur fires, so this is passed as useInlinePillEdit's
  // keyExists below rather than left to dangle forever.
  const editingTabNoteIdExists = useCallback((noteId: string) => (
    noteId === tempTabNoteId || pinnedTabs.some((tab) => tab.noteId === noteId)
  ), [pinnedTabs, tempTabNoteId])

  const pinNoteToTabs = useCallback(async (noteId: string) => {
    if (!window.thockdownTabs) return

    // No id is ever auto-assigned here -- pinning is not the same thing as
    // the user explicitly typing a `$id`. An unpinned note's tab already
    // shows a live-derived label (resolveIdentityLabel) when it has no
    // assigned id; pinning doesn't change that, it just keeps the tab around.
    const updatedTabs = await window.thockdownTabs.addTab(sectionId, noteId).catch(() => null)
    if (updatedTabs) {
      setPinnedTabs(updatedTabs.filter((tab) => tab.sectionId === sectionId))
    }
  }, [sectionId])

  // Removes a note's pinned tab. If that tab belonged to the currently
  // active note, the editor blanks out rather than jumping to a neighboring
  // tab -- notes only ever get loaded by an explicit user action now, never
  // as an automatic fallback when one closes.
  const unpinNoteTab = useCallback(async (noteId: string) => {
    if (!window.thockdownTabs) return

    const wasActiveTab = noteId === tabIdentityNoteId

    const allUpdatedTabs = await window.thockdownTabs.removeTab(sectionId, noteId).catch(() => null)
    if (!allUpdatedTabs) return
    setPinnedTabs(allUpdatedTabs.filter((tab) => tab.sectionId === sectionId))

    if (wasActiveTab) {
      await clearActiveNote()
    }
  }, [tabIdentityNoteId, sectionId, clearActiveNote])

  // Pins `noteId` to this section if it isn't already, then moves it to the
  // rightmost slot -- idempotent either way, so it's safe to call whether
  // the note is new to this section (a cross-section tab move, or a
  // sidebar-note drop) or already pinned here (dropped elsewhere in its own
  // bar). Re-derives the current order from addTab's own response rather
  // than the possibly-stale `pinnedTabs` closure, since this can race with
  // other tab mutations.
  const pinNoteAsRightmostTab = useCallback(async (noteId: string) => {
    if (!window.thockdownTabs) return

    // Same as pinNoteToTabs -- no id auto-assigned just because this note
    // got pinned.
    const afterAdd = await window.thockdownTabs.addTab(sectionId, noteId).catch(() => null)
    if (!afterAdd) return
    const currentOrder = afterAdd.filter((tab) => tab.sectionId === sectionId)
    const orderedNoteIds = [
      ...currentOrder.filter((tab) => tab.noteId !== noteId).map((tab) => tab.noteId),
      noteId,
    ]

    const afterReorder = await window.thockdownTabs.reorderTabs(sectionId, orderedNoteIds).catch(() => null)
    if (afterReorder) {
      setPinnedTabs(afterReorder.filter((tab) => tab.sectionId === sectionId))
    }
  }, [sectionId])

  // Dismissing the temp tab has nothing to persist-remove (it was never a
  // real note_tabs row) -- just blanks the editor, same as unpinning the
  // active pinned tab does.
  const dismissTempTab = useCallback((noteId: string) => {
    if (noteId !== tabIdentityNoteId) return
    void clearActiveNote()
  }, [tabIdentityNoteId, clearActiveNote])

  const handleAddCurrentNoteToTabs = useCallback(async () => {
    if (!tabIdentityNoteId || !persistenceReady) return

    // Ctrl+T toggles: pin if not already pinned, unpin if it is.
    if (activeNoteIsPinned) {
      void unpinNoteTab(tabIdentityNoteId)
    } else {
      void pinNoteToTabs(tabIdentityNoteId)
    }
  }, [tabIdentityNoteId, persistenceReady, activeNoteIsPinned, unpinNoteTab, pinNoteToTabs])

  // Holding the RIGHT mouse button on any tab (temp or pinned) for
  // TEMP_TAB_PIN_HOLD_MS arms it for unpin, same end state as the old
  // immediate-right-click behavior. Released early -- a quick right-click --
  // it starts an in-place id edit instead (startEditingTabId below). Kept
  // as its own ref/state pair, separate from the left-button pin-hold
  // (tempTabHoldTimerRef/pinArmingTabNoteId, further down), since the temp
  // tab can have both gestures live on it at once.
  const tabHoldTimerRef = useRef<number | null>(null)
  const [unpinArmingTabNoteId, setUnpinArmingTabNoteId] = useState<string | null>(null)

  const clearTabHoldTimer = useCallback(() => {
    if (tabHoldTimerRef.current !== null) {
      window.clearTimeout(tabHoldTimerRef.current)
      tabHoldTimerRef.current = null
    }
    setUnpinArmingTabNoteId(null)
  }, [])

  useEffect(() => () => clearTabHoldTimer(), [clearTabHoldTimer])

  // A quick right-click starts an in-place id edit (chapter-pill style); a
  // held right-click instead primes the tab for unpinning -- the tab-bar
  // equivalent of closing it (same end result as Ctrl+T on an already-
  // pinned note). See handleTabMouseDown/handleTabMouseUp below for the
  // hold-vs-quick-click split. A left-click while primed confirms the
  // close; anything else (mouse leaving, clicking a different tab) cancels
  // the priming. Works the same way for the temp tab, which just has
  // nothing to persist-remove.
  const handleTabContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
  }, [])

  const handleTabMouseLeave = useCallback((noteId: string) => {
    setUnpinPrimedTabNoteId((previous) => (previous === noteId ? null : previous))
    clearTabHoldTimer()
  }, [clearTabHoldTimer])

  const commitTabIdEditValue = useCallback(async (noteId: string, draft: string) => {
    if (!window.thockdownNotes) return
    const trimmed = draft.trim()
    const note = notes.find((entry) => entry.id === noteId)
    if (trimmed === (note?.assignedId ?? '')) return
    // Per-tab, not activeNoteIsTimeless -- a pinned tab being renamed isn't
    // necessarily the active note.
    if (note?.isTimeless) return

    try {
      const updated = await window.thockdownNotes.setNoteAssignedId({ id: noteId, requestedId: trimmed })
      if (updated?.assignedId) {
        updateNoteAssignedId(noteId, updated.assignedId)
      }
    } catch (error) {
      console.error('Failed to set note internal ID', error)
    }
  }, [notes, updateNoteAssignedId])

  const {
    editingKey: editingTabNoteId,
    draft: tabIdDraft,
    setDraft: setTabIdDraft,
    start: startTabIdEdit,
    cancel: cancelTabIdEdit,
    commit: commitTabIdEdit,
  } = useInlinePillEdit<string>({ commit: commitTabIdEditValue, keyExists: editingTabNoteIdExists })

  const startEditingTabId = useCallback((noteId: string) => {
    const note = notes.find((entry) => entry.id === noteId)
    startTabIdEdit(noteId, note?.assignedId ?? '')
    // Defensive: a tab already primed for unpin (from a previous hold)
    // shouldn't resurface that styling/confirm-click right after a rename.
    setUnpinPrimedTabNoteId((previous) => (previous === noteId ? null : previous))
  }, [notes, startTabIdEdit])

  const handleTabClick = useCallback((noteId: string) => {
    const wasPrimed = unpinPrimedTabNoteId === noteId
    setUnpinPrimedTabNoteId(null)

    if (wasPrimed) {
      const isPinned = pinnedTabs.some((tab) => tab.noteId === noteId)
      if (isPinned) {
        void unpinNoteTab(noteId)
      } else {
        dismissTempTab(noteId)
      }
      return
    }

    // A second click on the tab that's already selected doesn't reload it --
    // the menu is deliberately stable and doesn't otherwise know or care
    // which note is active, so this is the one explicit way to locate it.
    if (noteId === activeNoteId) {
      revealNoteInMenu()
      return
    }

    // Resume whichever chapter this tab last showed, not always its base
    // note -- but only if it's still live in `notes` (belt-and-suspenders on
    // top of the backend's own re-validation on every fetch; see the pruning
    // effect above for why a locally-cached stale id can otherwise persist
    // between refetches).
    const tab = pinnedTabs.find((entry) => entry.noteId === noteId)
    const targetNoteId = tab?.lastActiveChapterNoteId && notes.some((note) => note.id === tab.lastActiveChapterNoteId)
      ? tab.lastActiveChapterNoteId
      : noteId
    void activateNote(targetNoteId)
  }, [unpinPrimedTabNoteId, pinnedTabs, unpinNoteTab, dismissTempTab, activeNoteId, revealNoteInMenu, activateNote, notes])

  // Holding the left mouse button on the temp tab for TEMP_TAB_PIN_HOLD_MS
  // promotes it to a real, permanent pinned tab.
  const tempTabHoldTimerRef = useRef<number | null>(null)
  const [pinArmingTabNoteId, setPinArmingTabNoteId] = useState<string | null>(null)

  const clearTempTabHoldTimer = useCallback(() => {
    if (tempTabHoldTimerRef.current !== null) {
      window.clearTimeout(tempTabHoldTimerRef.current)
      tempTabHoldTimerRef.current = null
    }
    setPinArmingTabNoteId(null)
  }, [])

  const handleTempTabMouseDown = useCallback((event: MouseEvent<HTMLDivElement>, noteId: string) => {
    if (event.button !== 0) return
    clearTempTabHoldTimer()
    setPinArmingTabNoteId(noteId)
    tempTabHoldTimerRef.current = window.setTimeout(() => {
      tempTabHoldTimerRef.current = null
      setPinArmingTabNoteId(null)
      void pinNoteToTabs(noteId)
    }, TEMP_TAB_PIN_HOLD_MS)
  }, [clearTempTabHoldTimer, pinNoteToTabs])

  useEffect(() => () => clearTempTabHoldTimer(), [clearTempTabHoldTimer])

  // Held-right-click state/timer (see the block above handleTabContextMenu
  // for tabHoldTimerRef/unpinArmingTabNoteId/clearTabHoldTimer themselves).
  const handleTabMouseDown = useCallback((event: MouseEvent<HTMLDivElement>, noteId: string) => {
    if (event.button !== 2) return
    clearTabHoldTimer()
    setUnpinArmingTabNoteId(noteId)
    tabHoldTimerRef.current = window.setTimeout(() => {
      tabHoldTimerRef.current = null
      setUnpinArmingTabNoteId(null)
      setUnpinPrimedTabNoteId(noteId)
    }, TEMP_TAB_PIN_HOLD_MS)
  }, [clearTabHoldTimer])

  const handleTabMouseUp = useCallback((event: MouseEvent<HTMLDivElement>, noteId: string) => {
    if (event.button !== 2) return
    const wasQuickClick = tabHoldTimerRef.current !== null
    clearTabHoldTimer()
    if (wasQuickClick) {
      startEditingTabId(noteId)
    }
  }, [clearTabHoldTimer, startEditingTabId])

  // ── Tab bar horizontal scrolling (fixed-width tabs, wheel-scroll, edge fades) ──

  const tabsScrollerRef = useRef<HTMLDivElement | null>(null)
  const [tabsCanScrollLeft, setTabsCanScrollLeft] = useState(false)
  const [tabsCanScrollRight, setTabsCanScrollRight] = useState(false)

  const updateTabsScrollEdges = useCallback(() => {
    const el = tabsScrollerRef.current
    if (!el) return
    setTabsCanScrollLeft(el.scrollLeft > 1)
    setTabsCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
  }, [])

  useEffect(() => {
    updateTabsScrollEdges()
  }, [pinnedTabs, tempTabNoteId, tabBarMode, updateTabsScrollEdges])

  useEffect(() => {
    if (tabBarMode !== 'tabs') return
    window.addEventListener('resize', updateTabsScrollEdges)
    return () => window.removeEventListener('resize', updateTabsScrollEdges)
  }, [tabBarMode, updateTabsScrollEdges])

  // Vertical wheel input scrolls the bar horizontally, regardless of
  // browser/OS default wheel-axis behavior.
  const handleTabsWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return
    event.preventDefault()
    event.currentTarget.scrollLeft += event.deltaY
  }, [])

  // ── Tab drag-and-drop: reorder within this bar, or hand off to a
  //    section-wide drop target (a different section, or nothing at all if
  //    it's just an aborted drag). Mirrors the tag-pill drag-reorder pattern
  //    (a plain useState index, not dataTransfer-borne data, drives the
  //    reorder), but also stamps the cross-component NOTE_DRAG_MIME_TYPE
  //    payload so a *different* section's drop handler -- which doesn't
  //    share this closure -- can pick up the note if the drop lands there
  //    instead of back in this bar.
  const reorderPinnedTabsTo = useCallback(async (reordered: NoteTabEntry[]) => {
    if (!window.thockdownTabs) return
    const orderedNoteIds = reordered.map((tab) => tab.noteId)
    const allUpdatedTabs = await window.thockdownTabs.reorderTabs(sectionId, orderedNoteIds).catch(() => null)
    if (allUpdatedTabs) {
      setPinnedTabs(allUpdatedTabs.filter((tab) => tab.sectionId === sectionId))
    }
  }, [sectionId])

  const handleTabDragStart = useCallback((event: DragEvent<HTMLDivElement>, index: number) => {
    const tab = pinnedTabs[index]
    if (!tab) return

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(NOTE_DRAG_MIME_TYPE, serializeNoteDragPayload({ noteId: tab.noteId, sourceSectionId: sectionId }))
    setDraggedTabIndex(index)
  }, [pinnedTabs, sectionId])

  const handleTabDragEnd = useCallback(() => {
    setDraggedTabIndex(null)
  }, [])

  const handleTabDrop = useCallback((event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    // Not a drag that started in this bar -- leave the event alone so it
    // keeps bubbling up to a section-wide drop target instead.
    if (draggedTabIndex === null) return

    event.preventDefault()
    event.stopPropagation()

    if (draggedTabIndex === targetIndex) {
      setDraggedTabIndex(null)
      return
    }

    const reordered = [...pinnedTabs]
    const [moved] = reordered.splice(draggedTabIndex, 1)
    if (!moved) {
      setDraggedTabIndex(null)
      return
    }
    reordered.splice(targetIndex, 0, moved)
    setDraggedTabIndex(null)

    void reorderPinnedTabsTo(reordered)
  }, [draggedTabIndex, pinnedTabs, reorderPinnedTabsTo])

  const handleTabsContainerDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (draggedTabIndex === null) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
  }, [draggedTabIndex])

  const handleTabsContainerDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (draggedTabIndex === null) return
    event.preventDefault()
    event.stopPropagation()

    const reordered = [...pinnedTabs]
    const [moved] = reordered.splice(draggedTabIndex, 1)
    if (!moved) {
      setDraggedTabIndex(null)
      return
    }
    reordered.push(moved)
    setDraggedTabIndex(null)

    void reorderPinnedTabsTo(reordered)
  }, [draggedTabIndex, pinnedTabs, reorderPinnedTabsTo])

  const applyTabsUpdate = useCallback((tabs: NoteTabEntry[]) => {
    setPinnedTabs(tabs.filter((tab) => tab.sectionId === sectionId))
  }, [sectionId])

  return {
    tagInputRef,
    tagInputValue,
    setTagInputValue,
    orderedActiveTags,
    suggestedTags,
    deletePrimedTagName,
    renamingTagName,
    tagRenameDraft,
    setTagRenameDraft,
    commitTagRename,
    cancelTagRename,
    isTagMutationPending,
    activeNoteIsExternal,
    activeNoteIsTimeless,
    handleTagInputKeyDown,
    handleAddSuggestedTag,
    handleTagChipClick,
    handleTagChipMouseLeave,
    handleTagDragStart,
    handleTagDragEnd,
    handleTagDrop,
    handleTagContainerDragOver,
    handleTagContainerDrop,
    handleTagContextMenu,
    isSuggestedTagsExpanded,
    toggleSuggestedTagsExpanded,
    suggestedTagsScrollerRef,
    suggestedTagsCanScrollLeft,
    suggestedTagsCanScrollRight,
    updateSuggestedTagsScrollEdges,
    handleSuggestedTagsWheel,

    tabBarMode,
    toggleTabBarMode,
    setTabBarMode,
    pinnedTabs,
    unpinPrimedTabNoteId,
    activeNoteIsPinned,
    tempTabNoteId,
    pinArmingTabNoteId,
    editingTabNoteId,
    tabIdDraft,
    setTabIdDraft,
    commitTabIdEdit,
    cancelTabIdEdit,
    unpinArmingTabNoteId,
    tabsScrollerRef,
    tabsCanScrollLeft,
    tabsCanScrollRight,
    handleAddCurrentNoteToTabs,
    handleTabContextMenu,
    handleTabMouseLeave,
    handleTabClick,
    handleTabMouseDown,
    handleTabMouseUp,
    clearTabHoldTimer,
    handleTempTabMouseDown,
    clearTempTabHoldTimer,
    updateTabsScrollEdges,
    handleTabsWheel,
    handleTabDragStart,
    handleTabDragEnd,
    handleTabDrop,
    handleTabsContainerDragOver,
    handleTabsContainerDrop,
    unpinNoteTab,
    pinNoteAsRightmostTab,
    applyTabsUpdate,
  }
}
