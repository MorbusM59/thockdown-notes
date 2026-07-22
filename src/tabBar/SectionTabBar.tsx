import type { CSSProperties, MouseEvent, RefObject } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isArchivedNote, isDeletedNote } from '../shared/noteLifecycle'
import { normalizeTagName, isProtectedTagName } from '../shared/tags'
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
  notes: NoteSummary[]
  activeNoteSummary: NoteSummary | null
  /** The leftmost section keeps the sidebar toggle at the left edge; every other section shows a close button there instead. */
  isLeftmostSection: boolean
  /** Whether there's room for one more 300px-minimum section -- hides the "+" button when there isn't. */
  canCreateSection: boolean
  /** Creates a new section immediately to the right of this one. */
  onCreateSection: () => void
  /** Closes this section's slot (only ever called for non-leftmost sections). */
  onCloseSection: () => void

  /** This section's own name -- null until the user names it via the identity tab. */
  sectionName: string | null
  isEditingSectionName: boolean
  sectionNameDraft: string
  setSectionNameDraft: (value: string) => void
  onCommitSectionRename: () => void
  onCancelSectionRename: () => void

  /** The active note's assigned id, mid-edit via the identity tab's tag-bar-mode right-click. */
  isEditingNoteId: boolean
  noteIdDraft: string
  setNoteIdDraft: (value: string) => void
  onCommitNoteIdEdit: () => void
  onCancelNoteIdEdit: () => void

  /** Left-click: in tab-bar mode, opens (or closes) the section picker; in tag-bar mode, toggles the suggested-tags-expanded view. Right-click: assign a note id (tag bar) or rename this section (tab bar). */
  onIdentityClick: () => void
  onIdentityContextMenu: (event: MouseEvent<HTMLButtonElement>) => void

  /** A held left-click on the identity tab (tab-bar mode only) takes over the tab bar's own pill area with this slot's swap targets -- every other named section, offered to swap in. */
  isSectionPickerOpen: boolean
  swapCandidates: { id: string; name: string }[]
  onSectionPickerCandidateClick: (candidateId: string) => void
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
  notes,
  activeNoteSummary,
  isLeftmostSection,
  canCreateSection,
  onCreateSection,
  onCloseSection,
  sectionName,
  isEditingSectionName,
  sectionNameDraft,
  setSectionNameDraft,
  onCommitSectionRename,
  onCancelSectionRename,
  isEditingNoteId,
  noteIdDraft,
  setNoteIdDraft,
  onCommitNoteIdEdit,
  onCancelNoteIdEdit,
  onIdentityClick,
  onIdentityContextMenu,
  isSectionPickerOpen,
  swapCandidates,
  onSectionPickerCandidateClick,
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
    isSuggestedTagsExpanded,
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
    tabsScrollerRef,
    tabsCanScrollLeft,
    tabsCanScrollRight,
    handleTabContextMenu,
    handleTabMouseLeave,
    handleTabClick,
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
    <section ref={tabbarGridRef} className="tabbar-grid" style={{ flex: '0 0 36px' }} aria-label="Tab bar">
      {isLeftmostSection ? (
        <button
          type="button"
          className="btn-icon sidebar-toggle"
          title={isSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          aria-label={isSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          onClick={toggleSidebarVisible}
        >
          <span className="fa-solid fa-bars" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="btn-icon section-close-toggle"
          title="Close this section"
          aria-label="Close this section"
          onClick={onCloseSection}
        >
          <span className="fa-solid fa-chevron-left" aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        className={`btn-icon tagbar-toggle${tabBarMode === 'tags' ? ' active' : ''}`}
        title={tabBarMode === 'tags' ? 'Show tabs' : 'Show tags'}
        aria-label={tabBarMode === 'tags' ? 'Show tabs' : 'Show tags'}
        onClick={toggleTabBarMode}
      >
        <span className="fa-solid fa-tags" aria-hidden="true" />
      </button>

      <div className="section-identity-tab-shell">
        {isEditingSectionName ? (
          <input
            className="tag-pill section-identity-input"
            value={sectionNameDraft}
            autoFocus
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
        ) : isEditingNoteId ? (
          <input
            className="tag-pill section-identity-input"
            value={noteIdDraft}
            autoFocus
            onChange={(event) => setNoteIdDraft(event.target.value)}
            onBlur={onCommitNoteIdEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onCommitNoteIdEdit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                onCancelNoteIdEdit()
              }
            }}
            aria-label="Note id"
          />
        ) : (
          <button
            type="button"
            className={`tag-pill section-identity-tab${(isSectionPickerOpen || isSuggestedTagsExpanded) ? ' active' : ''}`}
            onClick={onIdentityClick}
            onContextMenu={onIdentityContextMenu}
            title={
              tabBarMode === 'tabs'
                ? (sectionName ? `Section: ${sectionName} -- click to swap in another named section, right-click to rename` : 'Unnamed section -- click to swap in a named section, right-click to name this section')
                : 'Click to show suggested tags, right-click to assign this note\'s id'
            }
          >
            <span className="tag-pill-label">
              {tabBarMode === 'tabs' ? (sectionName ?? '···') : `$${activeNoteSummary?.assignedId ?? '···'}`}
            </span>
          </button>
        )}
      </div>

      {tabBarMode === 'tabs' ? (
        <div className="tab-mode-shell tabs-mode" role="group" aria-label="Note tabs">
          <div className="tabbar-tabs-scroll-shell">
            <div className={`tabbar-tabs-edge-fade left${tabsCanScrollLeft ? ' visible' : ''}`} aria-hidden="true" />
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
                      title="Clear this section (no note, no tabs, no name)"
                    >
                      <span className="tag-pill-label">···</span>
                    </button>
                  ) : null}
                  {swapCandidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      className="tag-pill section-picker-item"
                      onClick={() => onSectionPickerCandidateClick(candidate.id)}
                      title={`Swap in "${candidate.name}"`}
                    >
                      <span className="tag-pill-label">{candidate.name}</span>
                    </button>
                  ))}
                </div>
              ) : pinnedTabs.length === 0 && !tempTabNoteId ? (
                <span className="tabbar-tag-hint">Open a note to preview it here.</span>
              ) : (
                <>
                  {tempTabNoteId ? (() => {
                    const note = notes.find((entry) => entry.id === tempTabNoteId)
                    const label = note?.assignedId ?? '···'
                    const isGhost = note ? (isArchivedNote(note) || isDeletedNote(note)) : true
                    const isPrimed = unpinPrimedTabNoteId === tempTabNoteId
                    const isArming = pinArmingTabNoteId === tempTabNoteId
                    return (
                      <div
                        key={tempTabNoteId}
                        className={`tag-pill note-tab-pill temp active${isGhost ? ' ghost' : ''}${isPrimed ? ' unpin-primed' : ''}${isArming ? ' pin-arming' : ''}`}
                        style={{ '--temp-tab-pin-hold-ms': `${TEMP_TAB_PIN_HOLD_MS}ms` } as CSSProperties}
                        onClick={() => handleTabClick(tempTabNoteId)}
                        onContextMenu={(event) => handleTabContextMenu(event, tempTabNoteId)}
                        onMouseDown={(event) => handleTempTabMouseDown(event, tempTabNoteId)}
                        onMouseUp={clearTempTabHoldTimer}
                        onMouseLeave={() => {
                          handleTabMouseLeave(tempTabNoteId)
                          clearTempTabHoldTimer()
                        }}
                        title={
                          isPrimed
                            ? 'Click again to close, or move cursor away to cancel'
                            : `${note?.title ?? 'Open note'} — hold to pin`
                        }
                      >
                        <span className="tag-pill-label">${label}</span>
                      </div>
                    )
                  })() : null}
                  {pinnedTabs.map((tab, index) => {
                    const note = notes.find((entry) => entry.id === tab.noteId)
                    const label = note?.assignedId != null
                      ? `$${note.assignedId}`
                      : '···';
                    const isGhost = note ? (isArchivedNote(note) || isDeletedNote(note)) : true
                    const isActive = tab.noteId === activeNoteId
                    const isPrimed = unpinPrimedTabNoteId === tab.noteId
                    return (
                      <div
                        key={tab.noteId}
                        className={`tag-pill note-tab-pill${isActive ? ' active' : ''}${isGhost ? ' ghost' : ''}${isPrimed ? ' unpin-primed' : ''}`}
                        draggable
                        onDragStart={(event) => handleTabDragStart(event, index)}
                        onDragEnd={handleTabDragEnd}
                        onDrop={(event) => handleTabDrop(event, index)}
                        onClick={() => handleTabClick(tab.noteId)}
                        onContextMenu={(event) => handleTabContextMenu(event, tab.noteId)}
                        onMouseLeave={() => handleTabMouseLeave(tab.noteId)}
                        title={
                          isPrimed
                            ? 'Click again to unpin, or move cursor away to cancel'
                            : (note?.title ?? 'Open note')
                        }
                      >
                        <span className="tag-pill-label">{label}</span>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
            <div className={`tabbar-tabs-edge-fade right${tabsCanScrollRight ? ' visible' : ''}`} aria-hidden="true" />
          </div>
        </div>
      ) : (
      <div className="tab-mode-shell" role="group" aria-label="Tag manager">
        {isSuggestedTagsExpanded ? (
          <div className="tabbar-tabs-scroll-shell">
            <div className={`tabbar-tabs-edge-fade left${suggestedTagsCanScrollLeft ? ' visible' : ''}`} aria-hidden="true" />
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
                    title={`Add ${tagName}`}
                    aria-disabled={!activeNoteId || isTagMutationPending || activeNoteIsExternal}
                  >
                    {tagName}
                  </div>
                ))
              )}
            </div>
            <div className={`tabbar-tabs-edge-fade right${suggestedTagsCanScrollRight ? ' visible' : ''}`} aria-hidden="true" />
          </div>
        ) : (
          <>
            <div className="tabbar-tag-input">
              <input
                ref={tagInputRef}
                className="tabbar-tag-input-field"
                type="text"
                value={tagInputValue}
                placeholder={
                  !activeNoteId
                    ? (notes.length > 0 ? '...' : '...')
                    : (renamingTagName ? 'Edit...' : '···')
                }
                onChange={(event) => setTagInputValue(event.target.value)}
                onKeyDown={handleTagInputKeyDown}
                disabled={!persistenceReady || !activeNoteId || isTagMutationPending || activeNoteIsExternal}
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
                    <div
                      key={tagName}
                      className={`tag-pill active${deletePrimedTagName === tagName ? ' primed' : ''}${isProtected ? ` protected ${normalized}` : ''}`}
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
                      title={deletePrimedTagName === tagName ? 'Click again to delete or move cursor away to cancel' : 'Click to arm deletion'}
                    >
                      <span className="tag-pill-label">{tagName}</span>
                    </div>
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
                  title={`Add ${tagName}`}
                  aria-disabled={!activeNoteId || isTagMutationPending || activeNoteIsExternal}
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

      {canCreateSection ? (
        <button
          type="button"
          className="btn-icon section-create-toggle"
          title="Add a section"
          aria-label="Add a section"
          onClick={onCreateSection}
        >
          <span className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      ) : null}
    </section>
  )
}
