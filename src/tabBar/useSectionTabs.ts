import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, DragEvent, KeyboardEvent, MouseEvent, MutableRefObject, RefObject, SetStateAction, WheelEvent as ReactWheelEvent } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import type { NoteTabEntry } from '../shared/tabs'
import { PROTECTED_TAGS, normalizeTagName, isProtectedTagName, isExternalTagName } from '../shared/tags'

/** How long the temp tab must be held down (left mouse button) before it's promoted to a permanent pinned tab. */
export const TEMP_TAB_PIN_HOLD_MS = 500

export interface UseSectionTabsOptions {
  /** Which section this instance belongs to -- scopes both the tag bar (this section's active note) and the pinned tabs it shows. */
  sectionId: string
  activeNoteId: string | null
  notes: NoteSummary[]
  persistenceReady: boolean
  /** Switches which note this section is showing. Will become section-scoped itself once sections can diverge; passed straight through for now. */
  activateNote: (noteId: string) => Promise<void>
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
  isTagMutationPending: boolean
  activeNoteIsExternal: boolean
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

  // ── Tab bar ──
  tabBarMode: 'tags' | 'tabs'
  toggleTabBarMode: () => void
  pinnedTabs: NoteTabEntry[]
  unpinPrimedTabNoteId: string | null
  activeNoteIsPinned: boolean
  tempTabNoteId: string | null
  pinArmingTabNoteId: string | null
  tabsScrollerRef: RefObject<HTMLDivElement>
  tabsCanScrollLeft: boolean
  tabsCanScrollRight: boolean
  handleAddCurrentNoteToTabs: () => Promise<void>
  handleTabContextMenu: (event: MouseEvent<HTMLDivElement>, noteId: string) => void
  handleTabMouseLeave: (noteId: string) => void
  handleTabClick: (noteId: string) => void
  handleTempTabMouseDown: (event: MouseEvent<HTMLDivElement>, noteId: string) => void
  clearTempTabHoldTimer: () => void
  updateTabsScrollEdges: () => void
  handleTabsWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
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
    notes,
    persistenceReady,
    activateNote,
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
  const [renamingTagName, setRenamingTagName] = useState<string | null>(null)
  const [draggedTagIndex, setDraggedTagIndex] = useState<number | null>(null)

  const activeNoteSummary = useMemo(() => {
    if (!activeNoteId) return null
    return notes.find((note) => note.id === activeNoteId) ?? null
  }, [activeNoteId, notes])

  const orderedActiveTags = useMemo(() => activeNoteSummary?.tags ?? [], [activeNoteSummary])
  const activeNoteIsExternal = orderedActiveTags.some((tag) => isExternalTagName(tag))

  // Switching notes or the active note's own tags changing both invalidate
  // any in-progress "click again to delete" arm.
  useEffect(() => {
    setDeletePrimedTagName(null)
  }, [activeNoteId, orderedActiveTags])

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
    if (!activeNoteId) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    setIsTagMutationPending(true)
    try {
      await flushPendingSaveNow()
      await mutate(activeNoteId)
      await refreshNotes(activeNoteId)
      await activateNote(activeNoteId)
    } catch (error) {
      console.error('Failed to mutate active note tags', error)
    } finally {
      setIsTagMutationPending(false)
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, activateNote, flushPendingSaveNow, noteTransitionLockRef, persistenceReady, refreshNotes])

  const handleAddSuggestedTag = useCallback((tagName: string) => {
    if (activeNoteIsExternal) return
    if (orderedActiveTags.includes(tagName)) return

    void runActiveNoteTagMutation(async (noteId) => {
      await window.thockdownNotes!.addTagToNote({
        id: noteId,
        tagName,
        position: orderedActiveTags.length,
      })
    })
  }, [activeNoteIsExternal, orderedActiveTags, runActiveNoteTagMutation])

  const handleTagInputEnter = useCallback(() => {
    if (!activeNoteId || !persistenceReady) return
    if (activeNoteIsExternal) return

    const rawInput = tagInputValue.trim()
    if (rawInput.startsWith('$')) {
      const requestedId = rawInput.slice(1)
      setRenamingTagName(null)
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

    if (renamingTagName) {
      const fromName = normalizeTagName(renamingTagName)
      const toName = normalized
      setRenamingTagName(null)
      setTagInputValue('')

      if (fromName === toName) {
        return
      }

      if (isProtectedTagName(fromName)) {
        return
      }

      if (!window.thockdownNotes) return
      if (noteTransitionLockRef.current) return

      noteTransitionLockRef.current = true
      setIsTagMutationPending(true)
      void (async () => {
        try {
          await flushPendingSaveNow()
          await window.thockdownNotes!.renameTag({ fromName, toName })
          await refreshNotes(activeNoteId)
          await activateNote(activeNoteId)
        } catch (error) {
          console.error('Failed to rename tag', error)
        } finally {
          setIsTagMutationPending(false)
          noteTransitionLockRef.current = false
        }
      })()
      return
    }

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
    activateNote,
    flushPendingSaveNow,
    noteTransitionLockRef,
    orderedActiveTags,
    persistenceReady,
    refreshNotes,
    renamingTagName,
    runActiveNoteTagMutation,
    tagInputValue,
    activeNoteIsExternal,
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
      if (renamingTagName) {
        setRenamingTagName(null)
        setTagInputValue('')
      }
      scheduleFocusEditorInEditMode()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (renamingTagName) {
        setRenamingTagName(null)
        setTagInputValue('')
      }
      scheduleFocusEditorInEditMode()
    }
  }, [handleTagInputEnter, renamingTagName, scheduleFocusEditorInEditMode])

  const handleTagChipClick = useCallback((tagName: string) => {
    if (deletePrimedTagName === tagName) {
      setDeletePrimedTagName(null)
      void runActiveNoteTagMutation(async (noteId) => {
        await window.thockdownNotes!.removeTagFromNote({ id: noteId, tagName })
      })
      return
    }

    setDeletePrimedTagName(tagName)
  }, [deletePrimedTagName, runActiveNoteTagMutation])

  const handleTagChipMouseLeave = useCallback((tagName: string) => {
    if (deletePrimedTagName === tagName) {
      setDeletePrimedTagName(null)
    }
  }, [deletePrimedTagName])

  const handleTagDragStart = useCallback((event: DragEvent<HTMLDivElement>, index: number) => {
    const tagName = orderedActiveTags[index] ?? ''
    if (isProtectedTagName(tagName)) return

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tagName)
    setDraggedTagIndex(index)
  }, [orderedActiveTags])

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

  const handleTagContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, tagName: string) => {
    event.preventDefault()
    if (isProtectedTagName(tagName)) return

    setRenamingTagName(tagName)
    setTagInputValue(tagName)
  }, [])

  // ── Tab bar state ──────────────────────────────────────────────────────

  const [tabBarMode, setTabBarMode] = useState<'tags' | 'tabs'>('tags')

  useEffect(() => {
    if (initialTabBarMode) setTabBarMode(initialTabBarMode)
    // Deliberately only reacting to the restored value arriving, not every
    // render -- this is a one-time hand-off from persisted app state, not a
    // controlled prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTabBarMode])

  const [pinnedTabs, setPinnedTabs] = useState<NoteTabEntry[]>([])
  const [unpinPrimedTabNoteId, setUnpinPrimedTabNoteId] = useState<string | null>(null)

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

  const toggleTabBarMode = useCallback(() => {
    setTabBarMode((previous) => (previous === 'tags' ? 'tabs' : 'tags'))
    setUnpinPrimedTabNoteId(null)
  }, [])

  // The currently open note gets a temporary, unsaved "preview" tab at the
  // leftmost position whenever it isn't already pinned. It tracks whichever
  // unpinned note is active — it isn't a real entry in note_tabs until the
  // user holds it long enough to promote it (see handleTempTabMouseDown).
  const activeNoteIsPinned = activeNoteId ? pinnedTabs.some((tab) => tab.noteId === activeNoteId) : false
  const tempTabNoteId = activeNoteId && !activeNoteIsPinned ? activeNoteId : null

  const pinNoteToTabs = useCallback(async (noteId: string) => {
    if (!window.thockdownTabs) return

    // Make sure the tab has a label to show immediately, assigning the
    // default (first 8 chars of the title) if the note doesn't have a
    // custom $id yet.
    if (window.thockdownNotes) {
      const assignedId = await window.thockdownNotes.ensureNoteAssignedId({ id: noteId }).catch(() => null)
      if (assignedId) {
        updateNoteAssignedId(noteId, assignedId)
      }
    }

    const updatedTabs = await window.thockdownTabs.addTab(sectionId, noteId).catch(() => null)
    if (updatedTabs) {
      setPinnedTabs(updatedTabs.filter((tab) => tab.sectionId === sectionId))
    }
  }, [sectionId, updateNoteAssignedId])

  // Removes a note's pinned tab. If that tab belonged to the currently
  // active note, activation moves to whichever tab slides into its old
  // position (i.e. the tab that was to its right) — falling back to the
  // new rightmost tab if it was the last one, or staying put if no tabs
  // remain.
  const unpinNoteTab = useCallback(async (noteId: string) => {
    if (!window.thockdownTabs) return

    const wasActiveTab = noteId === activeNoteId
    const removedIndex = pinnedTabs.findIndex((tab) => tab.noteId === noteId)

    const allUpdatedTabs = await window.thockdownTabs.removeTab(sectionId, noteId).catch(() => null)
    if (!allUpdatedTabs) return
    const updatedTabs = allUpdatedTabs.filter((tab) => tab.sectionId === sectionId)
    setPinnedTabs(updatedTabs)

    if (wasActiveTab && removedIndex !== -1) {
      const nextTab = updatedTabs[removedIndex] ?? updatedTabs[removedIndex - 1]
      if (nextTab) {
        void activateNote(nextTab.noteId)
      }
    }
  }, [activeNoteId, pinnedTabs, activateNote, sectionId])

  // Dismissing the temp tab has nothing to persist-remove (it was never a
  // real note_tabs row) — it just hands activation over to the leftmost
  // pinned tab, same as closing the leftmost real tab would. If there are
  // no pinned tabs left to fall back to, there's nowhere else to go, so it
  // stays put.
  const dismissTempTab = useCallback((noteId: string) => {
    if (noteId !== activeNoteId) return
    const nextTab = pinnedTabs[0]
    if (nextTab) {
      void activateNote(nextTab.noteId)
    }
  }, [activeNoteId, pinnedTabs, activateNote])

  const handleAddCurrentNoteToTabs = useCallback(async () => {
    if (!activeNoteId || !persistenceReady) return

    // Ctrl+T toggles: pin if not already pinned, unpin if it is.
    if (activeNoteIsPinned) {
      void unpinNoteTab(activeNoteId)
    } else {
      void pinNoteToTabs(activeNoteId)
    }
  }, [activeNoteId, persistenceReady, activeNoteIsPinned, unpinNoteTab, pinNoteToTabs])

  // Right-click primes a tab for unpinning — the tab-bar equivalent of
  // closing it (same end result as Ctrl+T on an already-pinned note). A
  // left-click while primed confirms the close; anything else (mouse
  // leaving, clicking a different tab) cancels the priming. Works the same
  // way for the temp tab, which just has nothing to persist-remove.
  const handleTabContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, noteId: string) => {
    event.preventDefault()
    setUnpinPrimedTabNoteId(noteId)
  }, [])

  const handleTabMouseLeave = useCallback((noteId: string) => {
    setUnpinPrimedTabNoteId((previous) => (previous === noteId ? null : previous))
  }, [])

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

    void activateNote(noteId)
  }, [unpinPrimedTabNoteId, pinnedTabs, unpinNoteTab, dismissTempTab, activateNote])

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

  return {
    tagInputRef,
    tagInputValue,
    setTagInputValue,
    orderedActiveTags,
    suggestedTags,
    deletePrimedTagName,
    renamingTagName,
    isTagMutationPending,
    activeNoteIsExternal,
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

    tabBarMode,
    toggleTabBarMode,
    pinnedTabs,
    unpinPrimedTabNoteId,
    activeNoteIsPinned,
    tempTabNoteId,
    pinArmingTabNoteId,
    tabsScrollerRef,
    tabsCanScrollLeft,
    tabsCanScrollRight,
    handleAddCurrentNoteToTabs,
    handleTabContextMenu,
    handleTabMouseLeave,
    handleTabClick,
    handleTempTabMouseDown,
    clearTempTabHoldTimer,
    updateTabsScrollEdges,
    handleTabsWheel,
  }
}
