import React, { useEffect, useRef, useState } from 'react';
import { Note, Tag, NoteTag } from '../shared/types';
import './TagInput.scss';

interface TagInputProps {
  note: Note | null;
  onTagsChanged?: () => void;
  refreshTrigger?: number;
}

interface TagInputPropsExtended extends TagInputProps {
  hasAnyNotes?: boolean;
  onConvertTempNote?: () => void;
}

/*
  TagInput: simplified active-tags-only rendering (no lingering "ghost" placeholders).
  Deletion UX: first click arms, second click deletes immediately.
  Moving mouse away cancels the arm.
  refreshTrigger: when parent increments this, component reloads tags.
*/

export const TagInput: React.FC<TagInputPropsExtended> = ({ note, onTagsChanged, refreshTrigger, hasAnyNotes, onConvertTempNote }) => {
  const [inputValue, setInputValue] = useState('');
  const [noteTags, setNoteTags] = useState<NoteTag[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // which index is currently armed for deletion (clicked once)
  const [deleteArmedIndex, setDeleteArmedIndex] = useState<number | null>(null);
  // when set, we're renaming this tagId and inputValue holds the draft name
  const [renamingTagId, setRenamingTagId] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProtectedTag = (name?: string) => {
    const n = (name || '').trim().toLowerCase();
    return n === 'deleted' || n === 'archived' || n === 'temp';
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
    };
  }, []);

  // defensive normalization
  const normalizeTagName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

  useEffect(() => {
    if (note) {
      loadNoteTags();
      setDeleteArmedIndex(null);
    } else {
      setNoteTags([]);
      setDeleteArmedIndex(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);

  // reload when parent signals refresh (sibling panel changed tags)
  useEffect(() => {
    if (note) {
      loadNoteTags();
      setDeleteArmedIndex(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const loadNoteTags = async () => {
    if (!note) return;
    try {
      const tags = await window.electronAPI.getNoteTags(note.id);
      if (!isMountedRef.current) return;
      setNoteTags(tags);
    } catch (err) {
      console.warn('loadNoteTags failed', err);
    }
  };

  const handleAddTag = async () => {
    if (!note || !inputValue.trim()) return;
    if (note.isTemp) return; // temp notes cannot have other tags

    const normalized = normalizeTagName(inputValue);
    if (!normalized) return;
    if (isProtectedTag(normalized)) {
      // Protected tags must be assigned via the sidebar context menu to ensure primary placement
      console.warn('Protected tags (deleted/archived) must be assigned via sidebar context menu');
      setInputValue('');
      return;
    }

    const position = noteTags.length;
    try {
      await window.electronAPI.addTagToNote(note.id, normalized, position);
      if (!isMountedRef.current) return;
      setInputValue('');
      await loadNoteTags();
      inputRef.current?.focus();
    } catch (err) {
      console.warn('addTagToNote failed', err);
    }

    if (onTagsChanged) onTagsChanged();
  };

  const handleKeyPress = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // If we're renaming an existing tag, call rename flow
      if (renamingTagId !== null) {
        const newName = inputValue.trim();
        if (!newName) return;
        try {
          const res = await window.electronAPI.renameTag(renamingTagId, newName);
          if (res && res.ok) {
            if (!isMountedRef.current) return;
            setRenamingTagId(null);
            setInputValue('');
            await loadNoteTags();
            if (onTagsChanged) onTagsChanged();
          } else {
            console.warn('Rename failed', res?.error);
          }
        } catch (err) {
          console.warn('renameTag call failed', err);
        }
        return;
      }

      handleAddTag();
    }
    if (e.key === 'Escape') {
      // cancel rename mode
      if (renamingTagId !== null) {
        setRenamingTagId(null);
        setInputValue('');
      }
    }
  };

  // Click behavior:
  // - If click on a tag when it's not armed -> arm it
  // - If click on a tag when it's already armed -> delete it immediately
  const handleActiveTagClick = async (index: number, tag: Tag, tagId: number) => {
    if (!note) return;

    if (deleteArmedIndex === index) {
      // second click -> delete immediately
      try {
        await window.electronAPI.removeTagFromNote(note.id, tagId);
        if (!isMountedRef.current) return;
        // No placeholder/ghost behavior anymore — simply reload active tags
        setDeleteArmedIndex(null);
        await loadNoteTags();
        if (onTagsChanged) onTagsChanged();
        return;
      } catch (err) {
        console.warn('Failed to remove tag', err);
        if (isMountedRef.current) setDeleteArmedIndex(null);
        return;
      }
    }

    // first click -> arm
    setDeleteArmedIndex(index);
  };

  // Mouse leave cancels the armed deletion (do not delete)
  const handleActiveTagMouseLeave = (index: number) => {
    if (deleteArmedIndex === index) {
      setDeleteArmedIndex(null);
    }
  };

  const handleDragStart = (index: number) => {
    const t = noteTags[index]?.tag?.name;
    if (isProtectedTag(t)) return; // disallow dragging protected tags
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (!note || draggedIndex === null || draggedIndex === targetIndex) { setDraggedIndex(null); return; }

    // If the drop target is a protected tag, cancel reorder and return dragged tag to original position
    const targetTagName = noteTags[targetIndex]?.tag?.name ?? '';
    if (isProtectedTag(targetTagName)) {
      setDraggedIndex(null);
      return;
    }

    const newTags = [...noteTags];
    const [moved] = newTags.splice(draggedIndex, 1);
    newTags.splice(targetIndex, 0, moved);

    await window.electronAPI.reorderNoteTags(note.id, newTags.map(nt => nt.tagId));
    await loadNoteTags();
    setDraggedIndex(null);

    if (onTagsChanged) onTagsChanged();
  };

  if (!note) {
    // Show placeholder UI so the overall layout remains visible for new users
    return (
      <div className="tag-input-container">
        <div className="tag-input-section">
          <div className="tag-input-bar">
            <div className="tag-input-wrapper">
              <input
                type="text"
                className="tag-input"
                value={''}
                disabled
                placeholder={hasAnyNotes ? 'Select a note to edit tags.' : 'Once you have created a note, you can add tags here.'}
                aria-label="Tag input disabled"
              />
            </div>
          </div>
          <div className="tags-display">
            <div className="empty-state">Tags appear here. Drag to change order, left click to remove or right click to edit them across all notes.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tag-input-container">
      <div className="tag-input-section">
        <div className="tag-input-bar">
          <div className="tag-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="tag-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={note.isTemp ? 'Temp note — click "temp" pill to convert' : 'Type to add tag...'}
              disabled={!!note.isTemp}
              aria-label="Tag input"
            />
          </div>
        </div>

        <div className="tags-display" aria-live="polite">
          {!!note.isTemp && (
            <div
              className="tag-pill active protected temp"
              title="Temp note. Click to convert into a regular note"
              onClick={() => {
                if (onConvertTempNote) onConvertTempNote();
              }}
            >
              temp
            </div>
          )}
          {noteTags.map((noteTag, slotIdx) => {
            const tag = noteTag.tag as Tag;
            const armed = deleteArmedIndex === slotIdx;
            const protectedFlag = isProtectedTag(tag?.name);
            const protectedClass = protectedFlag ? ` protected ${((tag?.name||'').trim().toLowerCase())}` : '';
            return (
              <div
                key={noteTag.tagId}
                className={`tag-pill active${armed ? ' armed' : ''}${protectedClass}`}
                draggable={!protectedFlag}
                onDragStart={() => handleDragStart(slotIdx)}
                onDragOver={(e) => handleDragOver(e)}
                onDrop={(e) => handleDrop(e, slotIdx)}
                onClick={() => handleActiveTagClick(slotIdx, tag, noteTag.tagId)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  // Prevent renaming protected tags
                  const normalized = (tag?.name || '').trim().toLowerCase();
                  if (normalized === 'deleted' || normalized === 'archived') {
                    // no-op: protected tag cannot be renamed
                    return;
                  }
                  // start renaming: load tag name into input and focus
                  setRenamingTagId(noteTag.tagId);
                  setInputValue(tag?.name ?? '');
                  if (focusTimeoutRef.current) {
                    clearTimeout(focusTimeoutRef.current);
                    focusTimeoutRef.current = null;
                  }
                  focusTimeoutRef.current = setTimeout(() => inputRef.current?.focus(), 10);
                }}
                onMouseLeave={() => handleActiveTagMouseLeave(slotIdx)}
                title={armed ? 'Click again to delete or move cursor away to cancel' : 'Click to arm deletion'}
              >
                {tag?.name}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
