import type { MouseEvent } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { normalizeTagName, isProtectedTagName } from '../shared/tags'
import { resolveIdentityLabel } from '../shared/tabLabels'
import { isAutoAssignedId } from '../shared/assignedIds'
import { InlinePillOrInput } from '../shared/InlinePillOrInput'
import type { UseSectionTabsResult } from './useSectionTabs'

export interface TagBarProps {
  tabs: UseSectionTabsResult
  persistenceReady: boolean
  activeNoteId: string | null
  /** The chapter-aware identity (SectionEditorArea's `menuIdentityNoteId`): tags and the note id belong to the NOTE, so a chapter shows its parent's. */
  identityNoteId: string | null
  notes: NoteSummary[]
}

/**
 * The tag bar: a note's metadata layer, shown in place of the chapter bar's
 * own contents (docs/user-workflow-design.md).
 *
 * It lives at the note level rather than the tab bar's collection level
 * because tags are strictly per-note -- the chapter bar is its dual, holding
 * the note's CONTENT structure where this holds its METADATA. The leading
 * note-id pill is deliberately the same treatment as the section-identity
 * pill one bar up: same gesture (right-click to assign), one layer down.
 */
export function TagBar({ tabs, persistenceReady, activeNoteId, identityNoteId, notes }: TagBarProps) {
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
    editingTabNoteId,
    tabIdDraft,
    setTabIdDraft,
    commitTabIdEdit,
    cancelTabIdEdit,
    startEditingTabId,
  } = tabs

  const identityNote = identityNoteId ? notes.find((entry) => entry.id === identityNoteId) : undefined
  const { text: identityLabel, isAssigned } = resolveIdentityLabel(identityNote?.assignedId, identityNote?.contentText)
  // Provisional until the user commits to an id of their own -- see
  // isAutoAssignedId for why this is derived from the value rather than stored.
  const isProvisionalId = isAutoAssignedId(identityNote?.assignedId)

  return (
    <>
      {/* Same shell and gesture as the tab bar's section-identity pill, one
          layer down: this names the NOTE. Right-click assigns an id; left-click
          fills the bar with suggested tags, which is what makes "commit to an
          id, then file it" a single fluent motion. */}
      <div className="section-identity-tab-shell">
        <InlinePillOrInput
          isEditing={identityNoteId !== null && editingTabNoteId === identityNoteId}
          value={tabIdDraft}
          onChange={setTabIdDraft}
          onCommit={commitTabIdEdit}
          onCancel={cancelTabIdEdit}
          className="tag-pill note-identity-input"
          ariaLabel="Note id"
        >
          <button
            type="button"
            className={`tag-pill note-identity-tab${isProvisionalId ? ' is-auto-assigned' : ''}`}
            disabled={!identityNoteId}
            onClick={() => { if (!isSuggestedTagsExpanded) toggleSuggestedTagsExpanded() }}
            onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
              event.preventDefault()
              if (!identityNoteId) return
              startEditingTabId(identityNoteId)
            }}
            data-tooltip={identityNoteId
              ? (isProvisionalId
                  ? `${identityLabel} -- right-click to give this note an id of its own, click for suggested tags`
                  : `Note: ${identityLabel} -- click for suggested tags, right-click to rename`)
              : 'No note open'}
          >
            <span className={`tag-pill-label${isAssigned ? '' : ' tag-pill-label-derived'}`}>{identityLabel}</span>
          </button>
        </InlinePillOrInput>
      </div>

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
              {/* The icon IS the label, the same convention each bar's leading
                  create button uses: it says "tags" before anything is typed
                  and gets out of the way the moment the field is focused or
                  has content. Clicking the field still focuses it normally. */}
              <span className={`tabbar-tag-input-icon fa-solid fa-tag${tagInputValue ? ' is-hidden' : ''}`} aria-hidden="true" />
              <input
                ref={tagInputRef}
                className="tabbar-tag-input-field"
                type="text"
                value={tagInputValue}
                placeholder=""
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
    </>
  )
}
