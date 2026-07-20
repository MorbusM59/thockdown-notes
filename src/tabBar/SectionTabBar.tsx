import type { CSSProperties } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isArchivedNote, isDeletedNote } from '../shared/noteLifecycle'
import { normalizeTagName, isProtectedTagName } from '../shared/tags'
import { TEMP_TAB_PIN_HOLD_MS, type UseSectionTabsResult } from './useSectionTabs'

export interface SectionTabBarProps {
  tabs: UseSectionTabsResult
  /** Only the leftmost section shows this button at all; every other section shows a close button here instead (not built yet). */
  isSidebarVisible: boolean
  toggleSidebarVisible: () => void
  persistenceReady: boolean
  activeNoteId: string | null
  notes: NoteSummary[]
  activeNoteSummary: NoteSummary | null
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
  isSidebarVisible,
  toggleSidebarVisible,
  persistenceReady,
  activeNoteId,
  notes,
  activeNoteSummary,
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
  } = tabs

  return (
    <section className="tabbar-grid" style={{ flex: '0 0 36px' }} aria-label="Tab bar">
      <button
        type="button"
        className="btn-icon sidebar-toggle"
        title={isSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
        aria-label={isSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
        onClick={toggleSidebarVisible}
      >
        <span className="fa-solid fa-bars" aria-hidden="true" />
      </button>

      <button
        type="button"
        className="btn-icon tabbar-mode-toggle"
        title={tabBarMode === 'tags' ? 'Switch to tab bar' : 'Switch to tag bar'}
        aria-label={tabBarMode === 'tags' ? 'Switch to tab bar' : 'Switch to tag bar'}
        onClick={toggleTabBarMode}
      >
        <span className={`fa-solid ${tabBarMode === 'tags' ? 'fa-tags' : 'fa-table-cells-large'}`} aria-hidden="true" />
      </button>

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
            >
              {pinnedTabs.length === 0 && !tempTabNoteId ? (
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
                        <span className="tag-pill-label">{label}</span>
                      </div>
                    )
                  })() : null}
                  {pinnedTabs.map((tab) => {
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
        <div className="tabbar-tag-input">
          <input
            ref={tagInputRef}
            className="tabbar-tag-input-field"
            type="text"
            value={tagInputValue}
            placeholder={
              !activeNoteId
                ? (notes.length > 0 ? 'Select a note...' : 'Create a note...')
                : (renamingTagName ? 'Rename tag...' : '···')
            }
            onChange={(event) => setTagInputValue(event.target.value)}
            onKeyDown={handleTagInputKeyDown}
            disabled={!persistenceReady || !activeNoteId || isTagMutationPending || activeNoteIsExternal}
            aria-label="Tag input"
          />
        </div>
        {activeNoteSummary?.assignedId ? (
          <div className="tabbar-assigned-id-display">
            <div className="tag-pill">
              <span className="tag-pill-label">${activeNoteSummary.assignedId}</span>
            </div>
          </div>
        ) : null}
        <div
          className="tabbar-tags-display"
          aria-live="polite"
          onDragOver={handleTagContainerDragOver}
          onDrop={handleTagContainerDrop}
        >
          {!activeNoteId ? (
            <span className="tabbar-tag-hint">Drag to order, click to remove.</span>
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
      </div>
      )}
    </section>
  )
}
