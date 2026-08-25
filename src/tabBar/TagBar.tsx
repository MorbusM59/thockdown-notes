import { useState } from 'react'
import type { MouseEvent } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { normalizeTagName, isProtectedTagName } from '../shared/tags'
import { resolveIdentityLabel } from '../shared/tabLabels'
import { buildNextAutoAssignedId, isAutoAssignedId } from '../shared/assignedIds'
import { InlinePillOrInput } from '../shared/InlinePillOrInput'
import type { UseSectionTabsResult } from './useSectionTabs'

export interface TagBarProps {
  tabs: UseSectionTabsResult
  persistenceReady: boolean
  activeNoteId: string | null
  /** The chapter-aware identity (SectionEditorArea's `menuIdentityNoteId`): tags and the note id belong to the NOTE, so a chapter shows its parent's. */
  identityNoteId: string | null
  notes: NoteSummary[]
  /** Mirrors the note list's own assignedId locally once the write lands -- same callback useSectionTabs takes. */
  updateNoteAssignedId: (noteId: string, assignedId: string) => void
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
export function TagBar({ tabs, persistenceReady, activeNoteId, identityNoteId, notes, updateNoteAssignedId }: TagBarProps) {
  // Copied from the section-identity tab's own shape (SectionTabBar), not
  // routed through useInlinePillEdit: that hook's `keyExists` guard requires
  // the note to be pinned as a tab, so an unpinned note's edit was cancelled
  // the instant it opened -- the gesture appeared to do nothing at all.
  const [isEditingNoteId, setIsEditingNoteId] = useState(false)
  const [noteIdDraft, setNoteIdDraft] = useState('')
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
  } = tabs

  /** Same write and same guards as useSectionTabs' own commitTabIdEditValue. */
  const commitNoteId = async (noteId: string, draft: string) => {
    if (!window.thockdownNotes) return
    const trimmed = draft.trim()
    const note = notes.find((entry) => entry.id === noteId)
    // Clearing the field is how a user gives an id BACK rather than how they
    // ask for no id: no note is ever without one. An emptied field falls back
    // to a fresh provisional NOTE-#n, computed here rather than handed to
    // setNoteAssignedId as a blank -- a blank makes it derive an id from the
    // note's title, which is a third id the user never asked for.
    //
    // An id that is already provisional stays exactly as it is: re-rolling
    // NOTE-#1 into NOTE-#7 would be pure churn, since neither is a name the
    // user chose.
    const requested = trimmed.length === 0
      ? (isAutoAssignedId(note?.assignedId)
          ? (note?.assignedId ?? buildNextAutoAssignedId(notes.filter((entry) => entry.id !== noteId).map((entry) => entry.assignedId)))
          : buildNextAutoAssignedId(notes.filter((entry) => entry.id !== noteId).map((entry) => entry.assignedId)))
      : trimmed
    if (requested === (note?.assignedId ?? '')) return
    if (note?.isTimeless) return
    try {
      const updated = await window.thockdownNotes.setNoteAssignedId({ id: noteId, requestedId: requested })
      if (updated?.assignedId) updateNoteAssignedId(noteId, updated.assignedId)
    } catch (error) {
      console.error('Failed to set note internal ID', error)
    }
  }

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
        {isEditingNoteId ? (
          <input
            className="tag-pill note-identity-input"
            value={noteIdDraft}
            autoFocus
            // Caret lands at the END of an existing id (renaming is usually a
            // tweak), and an empty field simply centres it -- the field is
            // centre-aligned, so an empty value puts the caret mid-field with
            // no extra work. Explicit rather than relying on autoFocus's own
            // placement, which varies by browser.
            ref={(element) => {
              if (!element) return
              const end = element.value.length
              element.setSelectionRange(end, end)
            }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => setNoteIdDraft(event.target.value)}
            // Blur is an implicit exit, so an empty field there means "I
            // changed my mind", not "give this note a new provisional id".
            // Only Enter -- an explicit commit -- clears an id back to auto.
            onBlur={() => {
              setIsEditingNoteId(false)
              if (identityNoteId && noteIdDraft.trim().length > 0) void commitNoteId(identityNoteId, noteIdDraft)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                setIsEditingNoteId(false)
                if (identityNoteId) void commitNoteId(identityNoteId, noteIdDraft)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setIsEditingNoteId(false)
              }
            }}
            aria-label="Note id"
          />
        ) : (
          <button
            type="button"
            className={`tag-pill note-identity-tab${isProvisionalId ? ' is-auto-assigned' : ''}`}
            disabled={!identityNoteId}
            // A plain toggle in both directions: the same click that fills the
            // bar with suggestions puts the tag input back, so the button is a
            // switch rather than a one-way door the reader has to find another
            // way out of.
            onClick={toggleSuggestedTagsExpanded}
            onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
              event.preventDefault()
              if (!identityNoteId) return
              // A provisional id was never chosen by the user, so start empty
              // rather than making them clear it first.
              setNoteIdDraft(isProvisionalId ? '' : (identityNote?.assignedId ?? ''))
              setIsEditingNoteId(true)
            }}
            data-tooltip={identityNoteId
              ? (isProvisionalId
                  ? `${identityLabel} -- right-click to give this note an id of its own, click for suggested tags`
                  : `Note: ${identityLabel} -- click for suggested tags, right-click to rename`)
              : 'No note open'}
          >
            <span className={`tag-pill-label${isAssigned ? '' : ' tag-pill-label-derived'}`}>{identityLabel}</span>
          </button>
        )}
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
