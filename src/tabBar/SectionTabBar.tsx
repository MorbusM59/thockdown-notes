import type { CSSProperties, MouseEvent, RefObject } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isArchivedNote, isDeletedNote } from '../shared/noteLifecycle'
import { normalizeTagName, isProtectedTagName } from '../shared/tags'
import { resolveIdentityLabel } from '../shared/tabLabels'
import { InlinePillOrInput } from '../shared/InlinePillOrInput'
import { TEMP_TAB_PIN_HOLD_MS, type UseSectionTabsResult } from './useSectionTabs'

export interface SectionTabBarProps {
  tabs: UseSectionTabsResult
  /** This section's own tab-bar strip element -- scopes the "click outside drops the tag bar back to the tab bar" listener to this section only. */
  tabbarGridRef: RefObject<HTMLElement>
  /** Only the leftmost section shows this button at all; every other section shows a close button here instead. */
  isSidebarVisible: boolean
  toggleSidebarVisible: () => void
  persistenceReady: boolean
  activeNoteId: string | null
  /** Which pinned-tab pill to highlight as active -- the chapter-aware identity (see useSectionTabs.ts's `tabIdentityNoteId`), not necessarily `activeNoteId` itself. */
  tabIdentityNoteId: string | null
  notes: NoteSummary[]
  /** The leftmost section keeps the sidebar toggle at the left edge; every other section shows a close button there instead. */
  isLeftmostSection: boolean
  /** Whether there's room for one more 300px-minimum section -- hides the "+" button when there isn't. */
  canCreateSection: boolean
  /** This slot's current view -- drives the edit/render toggle left of the add-slot "+" (active == edit mode). */
  isPreviewMode: boolean
  /** True while what's loaded is hard-locked to render view (auto-TOC, Open Items, or a timeless note -- EditorSection.tsx's isForcedPreviewNote). The toggle shows inactive and disabled then, rather than claiming a mode the note can't leave. */
  isForcedPreviewNote: boolean
  /** Flips this slot between edit and render view. */
  onToggleRenderViewMode: () => void
  /** Creates a new section immediately to the right of this one. */
  onCreateSection: () => void
  /** Closes this section's slot (only ever called for non-leftmost sections). */
  onCloseSection: () => void
  /** The tab strip's own leading "+" pill: creates a brand-new note and pins it as this section's rightmost tab. Always rendered in tabs mode, even with zero tabs currently pinned. */
  onCreateNote: () => void | Promise<void>

  /** This section's own name -- null until the user names it via the identity tab. */
  sectionName: string | null
  isEditingSectionName: boolean
  sectionNameDraft: string
  setSectionNameDraft: (value: string) => void
  onCommitSectionRename: () => void
  onCancelSectionRename: () => void

  /** Left-click: opens (or closes) the section picker. Right-click: rename this section. Tab-bar mode only -- the identity tab doesn't render in tag-bar mode (note renaming happens by right-clicking the note's own tab now, and the suggested-tags-expand toggle moved to the tag input). */
  onIdentityClick: () => void
  onIdentityContextMenu: (event: MouseEvent<HTMLButtonElement>) => void

  /** A held left-click on the identity tab (tab-bar mode only) takes over the tab bar's own pill area with this slot's swap targets -- every other named section, offered to swap in. */
  isSectionPickerOpen: boolean
  swapCandidates: { id: string; name: string }[]
  /** Left-click swaps the candidate in, unless it's the currently deletion-primed one -- see deletionPrimedSectionId. */
  onSectionPickerCandidateClick: (candidateId: string) => void
  /** Which candidate pill (if any) is armed for permanent deletion via right-click. */
  deletionPrimedSectionId: string | null
  onSectionPickerCandidateContextMenu: (event: MouseEvent<HTMLButtonElement>, candidateId: string) => void
  onSectionPickerCandidateMouseLeave: (candidateId: string) => void
  /** Leading pill in the open picker -- resets this slot back to its blank, freshly-created state: no active note, no pinned tabs, no name. Hidden when the slot is already empty. */
  onSectionPickerClearClick: () => void
}

/**
 * The tag bar / tab bar strip above one editor section -- extracted
 * verbatim from App.tsx's JSX with zero behavior change, as the first slice
 * of turning the section chrome into a real per-section component. Still
 * entirely prop-driven (the hooks it depends on are called in App.tsx and
 * handed down as `tabs`); becoming section-scoped internally is a later step.
 */
export function SectionTabBar({
  tabs,
  tabbarGridRef,
  isSidebarVisible,
  toggleSidebarVisible,
  persistenceReady,
  activeNoteId,
  tabIdentityNoteId,
  notes,
  isLeftmostSection,
  canCreateSection,
  isPreviewMode,
  isForcedPreviewNote,
  onToggleRenderViewMode,
  onCreateSection,
  onCloseSection,
  onCreateNote,
  sectionName,
  isEditingSectionName,
  sectionNameDraft,
  setSectionNameDraft,
  onCommitSectionRename,
  onCancelSectionRename,
  onIdentityClick,
  onIdentityContextMenu,
  isSectionPickerOpen,
  swapCandidates,
  onSectionPickerCandidateClick,
  deletionPrimedSectionId,
  onSectionPickerCandidateContextMenu,
  onSectionPickerCandidateMouseLeave,
  onSectionPickerClearClick,
}: SectionTabBarProps) {
  const {
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
    pinnedTabs,
    unpinPrimedTabNoteId,
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
    handleTabContextMenu,
    handleTabMouseLeave,
    handleTabClick,
    handleTabMouseDown,
    handleTabMouseUp,
    handleTempTabMouseDown,
    clearTempTabHoldTimer,
    updateTabsScrollEdges,
    handleTabsWheel,
    handleTabDragStart,
    handleTabDragEnd,
    handleTabDrop,
    handleTabsContainerDragOver,
    handleTabsContainerDrop,
  } = tabs

  return (
    <section
      ref={tabbarGridRef}
      className="tabbar-grid"
      aria-label="Tab bar"
    >
      {isLeftmostSection ? (
        <button
          type="button"
          className={`btn-icon sidebar-toggle${isSidebarVisible ? ' is-active' : ''}`}
          data-tooltip={isSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          aria-label={isSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          onClick={toggleSidebarVisible}
        >
          <span className="fa-solid fa-bars" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="btn-icon section-close-toggle"
          data-tooltip="Close this section"
          aria-label="Close this section"
          onClick={onCloseSection}
        >
          <span className="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        className={`btn-icon tagbar-toggle${tabBarMode === 'tags' ? ' is-active' : ''}`}
        data-tooltip={tabBarMode === 'tags' ? 'Show tabs' : 'Show tags'}
        aria-label={tabBarMode === 'tags' ? 'Show tabs' : 'Show tags'}
        onClick={toggleTabBarMode}
      >
        <span className="fa-solid fa-tags" aria-hidden="true" />
      </button>

      {tabBarMode === 'tabs' ? (
        <div className="section-identity-tab-shell">
          {isEditingSectionName ? (
            <input
              className="tag-pill section-identity-input"
              value={sectionNameDraft}
              autoFocus
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(event) => setSectionNameDraft(event.target.value)}
              onBlur={onCommitSectionRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onCommitSectionRename()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancelSectionRename()
                }
              }}
              aria-label="Section name"
            />
          ) : (
            <button
              type="button"
              className={`tag-pill section-identity-tab${isSectionPickerOpen ? ' is-active' : ''}`}
              onClick={onIdentityClick}
              onContextMenu={onIdentityContextMenu}
              data-tooltip={
                sectionName
                  ? `Section: ${sectionName} -- click to swap in another named section, right-click to rename`
                  : 'Unnamed section -- click to swap in a named section, right-click to name this section'
              }
            >
              <span className="tag-pill-label">{sectionName ?? '···'}</span>
            </button>
          )}
        </div>
      ) : null}

      {tabBarMode === 'tabs' ? (
        <div className="tab-mode-shell tabs-mode" role="group" aria-label="Note tabs">
          <div className={`tabbar-tabs-scroll-shell${tabsCanScrollLeft ? ' fade-left' : ''}${tabsCanScrollRight ? ' fade-right' : ''}`}>
            <div
              className="tabbar-tabs-display"
              aria-live="polite"
              ref={tabsScrollerRef}
              onScroll={updateTabsScrollEdges}
              onWheel={handleTabsWheel}
              onDragOver={handleTabsContainerDragOver}
              onDrop={handleTabsContainerDrop}
            >
              {isSectionPickerOpen ? (
                <div className="tabbar-section-picker" aria-live="polite">
                  {activeNoteId || sectionName !== null || pinnedTabs.length > 0 ? (
                    <button
                      type="button"
                      className="tag-pill section-picker-item section-picker-create"
                      onClick={onSectionPickerClearClick}
                      data-tooltip="New section in this slot (no note, no tabs, no name)"
                      aria-label="New section in this slot"
                    >
                      <span className="fa-solid fa-book" aria-hidden="true" />
                    </button>
                  ) : null}
                  {swapCandidates.map((candidate) => {
                    const isDeletionPrimed = deletionPrimedSectionId === candidate.id
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        className={`tag-pill section-picker-item${isDeletionPrimed ? ' deletion-primed' : ''}`}
                        onClick={() => onSectionPickerCandidateClick(candidate.id)}
                        onContextMenu={(event) => onSectionPickerCandidateContextMenu(event, candidate.id)}
                        onMouseLeave={() => onSectionPickerCandidateMouseLeave(candidate.id)}
                        data-tooltip={isDeletionPrimed ? `Click again to permanently delete "${candidate.name}"` : `Swap in "${candidate.name}" -- right-click to delete`}
                      >
                        <span className="tag-pill-label">{candidate.name}</span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <>
                  <div
                    className="tag-pill note-tab-pill create-pill"
                    aria-disabled={!persistenceReady}
                    data-tooltip="New note in this section"
                    onClick={() => {
                      if (!persistenceReady) return
                      void onCreateNote()
                    }}
                  >
                    <span className="fa-solid fa-file" aria-hidden="true" />
                  </div>
                  {tempTabNoteId ? (() => {
                    const note = notes.find((entry) => entry.id === tempTabNoteId)
                    const { text: label, isAssigned } = resolveIdentityLabel(note?.assignedId, note?.contentText)
                    const isGhost = note ? (isArchivedNote(note) || isDeletedNote(note)) : true
                    const isPrimed = unpinPrimedTabNoteId === tempTabNoteId
                    const isPinArming = pinArmingTabNoteId === tempTabNoteId
                    const isUnpinArming = unpinArmingTabNoteId === tempTabNoteId

                    return (
                      <InlinePillOrInput
                        key={tempTabNoteId}
                        isEditing={editingTabNoteId === tempTabNoteId}
                        value={tabIdDraft}
                        onChange={setTabIdDraft}
                        onCommit={commitTabIdEdit}
                        onCancel={cancelTabIdEdit}
                        className="tag-pill note-tab-pill temp is-active note-tab-id-input"
                        ariaLabel="Note id"
                      >
                        <div
                          className={`tag-pill note-tab-pill temp is-active${isGhost ? ' ghost' : ''}${isPrimed ? ' unpin-primed' : ''}${isPinArming ? ' pin-arming' : ''}${isUnpinArming ? ' unpin-arming' : ''}`}
                          style={{ '--temp-tab-pin-hold-ms': `${TEMP_TAB_PIN_HOLD_MS}ms` } as CSSProperties}
                          onClick={() => handleTabClick(tempTabNoteId)}
                          onContextMenu={handleTabContextMenu}
                          onMouseDown={(event) => {
                            handleTempTabMouseDown(event, tempTabNoteId)
                            handleTabMouseDown(event, tempTabNoteId)
                          }}
                          onMouseUp={(event) => {
                            clearTempTabHoldTimer()
                            handleTabMouseUp(event, tempTabNoteId)
                          }}
                          onMouseLeave={() => {
                            handleTabMouseLeave(tempTabNoteId)
                            clearTempTabHoldTimer()
                          }}
                          data-tooltip={
                            isPrimed
                              ? 'Click again to close, or move cursor away to cancel'
                              : `${note?.title ?? 'Open note'} — hold left to pin, right-click to rename`
                          }
                        >
                          <span className={`tag-pill-label${isAssigned ? '' : ' tag-pill-label-derived'}`}>{label}</span>
                        </div>
                      </InlinePillOrInput>
                    )
                  })() : null}
                  {pinnedTabs.map((tab, index) => {
                    const note = notes.find((entry) => entry.id === tab.noteId)
                    const { text: label, isAssigned } = resolveIdentityLabel(note?.assignedId, note?.contentText)
                    const isGhost = note ? (isArchivedNote(note) || isDeletedNote(note)) : true
                    const isActive = tab.noteId === tabIdentityNoteId
                    const isPrimed = unpinPrimedTabNoteId === tab.noteId
                    const isUnpinArming = unpinArmingTabNoteId === tab.noteId

                    return (
                      <InlinePillOrInput
                        key={tab.noteId}
                        isEditing={editingTabNoteId === tab.noteId}
                        value={tabIdDraft}
                        onChange={setTabIdDraft}
                        onCommit={commitTabIdEdit}
                        onCancel={cancelTabIdEdit}
                        className={`tag-pill note-tab-pill note-tab-id-input${isActive ? ' is-active' : ''}`}
                        ariaLabel={`Tab ${index + 1} note id`}
                      >
                        <div
                          className={`tag-pill note-tab-pill${isActive ? ' is-active' : ''}${isGhost ? ' ghost' : ''}${isPrimed ? ' unpin-primed' : ''}${isUnpinArming ? ' unpin-arming' : ''}`}
                          draggable
                          onDragStart={(event) => handleTabDragStart(event, index)}
                          onDragEnd={handleTabDragEnd}
                          onDrop={(event) => handleTabDrop(event, index)}
                          onClick={() => handleTabClick(tab.noteId)}
                          onContextMenu={handleTabContextMenu}
                          onMouseDown={(event) => handleTabMouseDown(event, tab.noteId)}
                          onMouseUp={(event) => handleTabMouseUp(event, tab.noteId)}
                          onMouseLeave={() => handleTabMouseLeave(tab.noteId)}
                          data-tooltip={
                            isPrimed
                              ? 'Click again to unpin, or move cursor away to cancel'
                              : `${note?.title ?? 'Open note'} — hold right to unpin, quick right-click to rename`
                          }
                        >
                          <span className={`tag-pill-label${isAssigned ? '' : ' tag-pill-label-derived'}`}>{label}</span>
                        </div>
                      </InlinePillOrInput>
                    )
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
      <div className="tab-mode-shell" role="group" aria-label="Tag manager">
        {isSuggestedTagsExpanded ? (
          <div
            className={`tabbar-tabs-scroll-shell${suggestedTagsCanScrollLeft ? ' fade-left' : ''}${suggestedTagsCanScrollRight ? ' fade-right' : ''}`}
            onContextMenu={(event) => {
              event.preventDefault()
              toggleSuggestedTagsExpanded()
            }}
          >
            <div
              className="tabbar-suggested-tags-expanded"
              aria-live="polite"
              ref={suggestedTagsScrollerRef}
              onScroll={updateSuggestedTagsScrollEdges}
              onWheel={handleSuggestedTagsWheel}
            >
              {suggestedTags.length === 0 ? (
                <span className="tabbar-tag-hint">Suggested tags appear here.</span>
              ) : (
                suggestedTags.map((tagName) => (
                  <div
                    key={tagName}
                    className="tag-pill suggested"
                    onClick={() => handleAddSuggestedTag(tagName)}
                    data-tooltip={`Add ${tagName}`}
                    aria-disabled={!activeNoteId || isTagMutationPending || activeNoteIsExternal || activeNoteIsTimeless}
                  >
                    {tagName}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <>
            <div
              className="tabbar-tag-input"
              onContextMenu={(event) => {
                event.preventDefault()
                toggleSuggestedTagsExpanded()
              }}
              data-tooltip="Right-click to show suggested tags"
            >
              <input
                ref={tagInputRef}
                className="tabbar-tag-input-field"
                type="text"
                value={tagInputValue}
                placeholder={!activeNoteId ? '...' : '···'}
                onChange={(event) => setTagInputValue(event.target.value)}
                onKeyDown={handleTagInputKeyDown}
                disabled={!persistenceReady || !activeNoteId || isTagMutationPending || activeNoteIsExternal || activeNoteIsTimeless}
                aria-label="Tag input"
              />
            </div>
            <div
              className="tabbar-tags-display"
              aria-live="polite"
              onDragOver={handleTagContainerDragOver}
              onDrop={handleTagContainerDrop}
            >
              {!activeNoteId ? (
                <span className="tabbar-tag-hint"></span>
              ) : orderedActiveTags.length === 0 ? (
                <span className="tabbar-tag-hint"></span>
              ) : (
                orderedActiveTags.map((tagName, index) => {
                  const normalized = normalizeTagName(tagName)
                  const isProtected = isProtectedTagName(tagName)

                  return (
                    <InlinePillOrInput
                      key={tagName}
                      isEditing={renamingTagName === tagName}
                      value={tagRenameDraft}
                      onChange={setTagRenameDraft}
                      onCommit={commitTagRename}
                      onCancel={cancelTagRename}
                      className="tag-pill is-active tag-rename-input"
                      ariaLabel={`Rename tag ${tagName}`}
                    >
                      <div
                        className={`tag-pill is-active${deletePrimedTagName === tagName ? ' primed' : ''}${isProtected ? ` protected ${normalized}` : ''}`}
                        draggable={!isProtected}
                        onDragStart={(event) => handleTagDragStart(event, index)}
                        onDragEnd={handleTagDragEnd}
                        onDragOver={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          event.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={(event) => handleTagDrop(event, index)}
                        onClick={() => handleTagChipClick(tagName)}
                        onContextMenu={(event) => handleTagContextMenu(event, tagName)}
                        onMouseLeave={() => handleTagChipMouseLeave(tagName)}
                        data-tooltip={deletePrimedTagName === tagName ? 'Click again to delete or move cursor away to cancel' : 'Click to arm deletion, right-click to rename'}
                      >
                        <span className="tag-pill-label">{tagName}</span>
                      </div>
                    </InlinePillOrInput>
                  )
                })
              )}
            </div>
            <div className="tabbar-suggested-tags" aria-hidden={suggestedTags.length === 0}>
              {suggestedTags.map((tagName) => (
                <div
                  key={tagName}
                  className="tag-pill suggested"
                  onClick={() => handleAddSuggestedTag(tagName)}
                  data-tooltip={`Add ${tagName}`}
                  aria-disabled={!activeNoteId || isTagMutationPending || activeNoteIsExternal || activeNoteIsTimeless}
                >
                  {tagName}
                </div>
              ))}
              {suggestedTags.length === 0 ? (
                <span className="tabbar-tag-hint">Suggested tags appear here.</span>
              ) : null}
            </div>
          </>
        )}
      </div>
      )}

      {/* Edit/render toggle -- a per-slot control, so it lives here at the
          slot's own edge rather than in the chapter bar (which speaks for one
          note's internals). Active means edit mode, so a note that can't leave
          render view (auto-TOC, Open Items, timeless) reads as plain inactive
          and takes no clicks, rather than showing a state the user can't act
          on. Sitting immediately left of the add-slot "+" also lets the two
          read together as slot-level actions: this is the writing window, and
          that makes another one. */}
      <button
        type="button"
        className={`btn-icon section-render-mode-toggle${!isForcedPreviewNote && !isPreviewMode ? ' is-active' : ''}`}
        data-tooltip={isForcedPreviewNote
          ? 'This note is always shown in render view'
          : (isPreviewMode ? 'Switch to Edit Mode (Esc)' : 'Switch to Render View (Esc)')}
        aria-label={isForcedPreviewNote
          ? 'This note is always shown in render view'
          : (isPreviewMode ? 'Switch to Edit Mode' : 'Switch to Render View')}
        aria-pressed={!isForcedPreviewNote && !isPreviewMode}
        disabled={isForcedPreviewNote}
        onClick={onToggleRenderViewMode}
      >
        <span className="fa-solid fa-pen-to-square" aria-hidden="true" />
      </button>

      {canCreateSection ? (
        <button
          type="button"
          className="btn-icon section-create-toggle"
          data-tooltip="Add a slot"
          aria-label="Add a slot"
          onClick={onCreateSection}
        >
          <span className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      ) : null}
    </section>
  )
}
