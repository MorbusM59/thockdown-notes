import type { NoteSummary } from '../shared/noteLifecycle'
import type { UseSectionTabsResult } from '../tabBar/useSectionTabs'
import { SectionTabBar } from '../tabBar/SectionTabBar'
import { SectionEditorArea, type SectionEditorAreaProps } from './SectionEditorArea'

export interface EditorSectionProps extends UseSectionTabsResult, Omit<SectionEditorAreaProps, 'sectionId' | 'markSectionActive' | 'activeNoteId'> {
  sectionId: string
  markSectionActive: (sectionId: string) => void
  activeNoteId: string | null
  isSidebarVisible: boolean
  toggleSidebarVisible: () => void
  persistenceReady: boolean
  notes: NoteSummary[]
  activeNoteSummary: NoteSummary | null
}

/**
 * The tabbar+viewer rectangle for one section -- the unit that repeats
 * per section in the grid ('tabbar tabbar' / 'viewer viewer'), composed
 * from SectionTabBar and SectionEditorArea. The toolbar and window
 * controls above it are separate global singletons (see EditorToolbar),
 * not part of this component. Extracted verbatim from App.tsx's JSX with
 * zero behavior change -- everything it needs is still a plain prop,
 * called once today with DEFAULT_EDITOR_SECTION_ID. Moving the
 * section-scoped hooks to live inside this component (instead of being
 * called in App.tsx and threaded down) is a later, separate step.
 */
export function EditorSection({
  sectionId,
  markSectionActive,
  activeNoteId,
  isSidebarVisible,
  toggleSidebarVisible,
  persistenceReady,
  notes,
  activeNoteSummary,
  isPreviewMode,
  spellCheckEditEnabled,
  spellCheckRenderEnabled,
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
  ...editorAreaProps
}: EditorSectionProps) {
  return (
    <>
      <SectionTabBar
        tabs={{
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
        }}
        isSidebarVisible={isSidebarVisible}
        toggleSidebarVisible={toggleSidebarVisible}
        persistenceReady={persistenceReady}
        activeNoteId={activeNoteId}
        notes={notes}
        activeNoteSummary={activeNoteSummary}
      />

      <SectionEditorArea
        sectionId={sectionId}
        markSectionActive={markSectionActive}
        isPreviewMode={isPreviewMode}
        activeNoteId={activeNoteId}
        spellCheckEditEnabled={spellCheckEditEnabled}
        spellCheckRenderEnabled={spellCheckRenderEnabled}
        {...editorAreaProps}
      />
    </>
  )
}
