import React, { useState, useEffect, useRef } from 'react';
// icon assets are referenced by path at runtime
import { Note, SearchResult, CategoryHierarchy } from '../shared/types';
import { DateFilter } from './DateFilter';
import { YearValue } from '../shared/filterConstants';
import './Sidebar.scss';

interface SidebarProps {
  onSelectNote: (note: Note) => void;
  selectedNote: Note | null;
  onNotesUpdate?: () => void;
  refreshTrigger?: number;
  noteUpdate?: Note | null;
  selectedMonths?: Set<number>;
  selectedYears?: Set<number | 'older'>;
  onMonthToggle?: (month: number, event: React.MouseEvent) => void;
  onYearToggle?: (year: YearValue, event: React.MouseEvent) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  width?: number;
  onNoteDelete?: (noteId: number, nextNoteToSelect?: Note | null) => void;
  hasAnyNotes?: boolean;
}

type ViewMode = 'latest' | 'active' | 'archived' | 'trash';
type SearchMode = 'none' | 'text' | 'tag';

export const Sidebar: React.FC<SidebarProps> = ({ 
  onSelectNote, 
  selectedNote, 
  onNotesUpdate,
  refreshTrigger,
  noteUpdate,
  selectedMonths = new Set(),
  selectedYears = new Set(),
  onMonthToggle,
  onYearToggle,
  viewMode: externalViewMode = 'latest',
  onViewModeChange,
  width = 320,
  onNoteDelete,
  hasAnyNotes = false
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('none');
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>('latest');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [dateNotes, setDateNotes] = useState<Note[]>([]);
  const [categoryHierarchy, setCategoryHierarchy] = useState<CategoryHierarchy>({});
  const [uncategorizedNotes, setUncategorizedNotes] = useState<Note[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalNotes, setTotalNotes] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState<number>(20);
  const [collapsedPrimary, setCollapsedPrimary] = useState<Set<string>>(new Set());
  const [collapsedSecondary, setCollapsedSecondary] = useState<Set<string>>(new Set());
  const [deleteArmedId, setDeleteArmedId] = useState<number | null>(null);
  const [armed, setArmed] = useState<{ kind: 'none' | 'delete' | 'archive' | 'permanent' | 'close-temp'; noteId?: number | null; category?: string | null }>({ kind: 'none' });
  
  const isMountedRef = React.useRef(true);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [showPagination, setShowPagination] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  
  // Use external viewMode if provided, otherwise use internal
  const viewMode = onViewModeChange ? externalViewMode : internalViewMode;
  
  const handleViewModeChange = (mode: ViewMode) => {
    if (onViewModeChange) {
      onViewModeChange(mode);
    } else {
      setInternalViewMode(mode);
    }
  };

  const handleTrashToggleClick = async () => {
    try {
      if (viewMode !== 'trash') {
        handleViewModeChange('trash');
        // clear any standing mass-delete arm for trash
        if (armed.kind === 'permanent' && armed.category === 'deleted') setArmed({ kind: 'none' });
      }
    } catch (err) {
      console.warn('trash toggle failed', err);
    }
  };

  // Clear trash mass-delete arm when leaving Trash view
  useEffect(() => {
    if (viewMode !== 'trash' && armed.kind === 'permanent' && armed.category === 'deleted') {
      setArmed({ kind: 'none' });
    }
  }, [viewMode]);

  // Load notes based on view mode
  useEffect(() => {
    if (searchMode === 'none') {
      if (viewMode === 'latest') {
        loadDateNotes();
      } else if (viewMode === 'active') {
        loadCategoryHierarchy();
      } else if (viewMode === 'archived') {
        loadArchivedHierarchy();
      } else if (viewMode === 'trash') {
        loadTrashNotes();
      }
    }
  }, [viewMode, currentPage, searchMode, refreshTrigger, itemsPerPage]);

  const loadDateNotes = async () => {
    try {
      const result = await window.electronAPI.getNotesPage(currentPage, itemsPerPage);
      if (!isMountedRef.current) return;
      // Exclude notes whose primary tag is 'deleted'; exclude 'archived' unless date filters are active
      const filtered = (result.notes || []).filter((n: any) => {
        const primary = (n as any).primaryTag as string | undefined | null;
        if (!primary) return true;
        const p = primary.trim().toLowerCase();
        if (p === 'deleted') return false;
        if (p === 'archived' && selectedMonths.size === 0 && selectedYears.size === 0) return false;
        return true;
      });
      setDateNotes(filtered);
      setTotalNotes(result.total);
      // Adjust current page if it is now out of range
      const newTotalPages = Math.max(1, Math.ceil(result.total / itemsPerPage));
      if (currentPage > newTotalPages) {
        setCurrentPage(newTotalPages);
      }
    } catch (err) {
      console.warn('loadDateNotes failed', err);
    }
  };

  const loadCategoryHierarchy = async () => {
    try {
      const data = await window.electronAPI.getCategoryHierarchy();
      if (!isMountedRef.current) return;
      setCategoryHierarchy(data.hierarchy);
      setUncategorizedNotes(data.uncategorizedNotes);
    } catch (err) {
      console.warn('loadCategoryHierarchy failed', err);
    }
  };

  const loadArchivedHierarchy = async () => {
    try {
      const data = await window.electronAPI.getHierarchyForTag('archived');
      if (!isMountedRef.current) return;
      setCategoryHierarchy(data.hierarchy);
      setUncategorizedNotes(data.uncategorizedNotes);
    } catch (err) {
      console.warn('loadArchivedHierarchy failed', err);
    }
  };

  const loadTrashNotes = async () => {
    try {
      const notes = await window.electronAPI.getNotesInTrash();
      if (!isMountedRef.current) return;
      setDateNotes(notes);
      setTotalNotes(notes.length);
      const newTotalPages = Math.max(1, Math.ceil(notes.length / itemsPerPage));
      if (currentPage > newTotalPages) setCurrentPage(newTotalPages);
    } catch (err) {
      console.warn('loadTrashNotes failed', err);
    }
  };

  // Auto-expand relevant categories when the hierarchy reloads or the selected note changes.
  // This makes tag changes reflect immediately in the menu: the note's primary and
  // secondary will be unfolded and all other primary/secondary entries will be folded in.
  useEffect(() => {
    // Only apply this behavior in active/archived (category-style) view and when not searching.
    if ((viewMode !== 'active' && viewMode !== 'archived') || searchMode !== 'none') return;
    if (!selectedNote) return;
    if (!categoryHierarchy || Object.keys(categoryHierarchy).length === 0) return;

    const allPrimary = Object.keys(categoryHierarchy);
    // Build a flat list of all secondary keys across all primaries: "Primary:Secondary"
    const allSecondaryKeys = allPrimary.flatMap(p => Object.keys(categoryHierarchy[p]?.secondary ?? {}).map(s => `${p}:${s}`));

    let matched = false;

    for (const primary of allPrimary) {
      const pData = categoryHierarchy[primary];
      if (!pData) continue;

      // Primary-only notes
      if (pData.notes.some(n => n.id === selectedNote.id)) {
        // Open this primary (collapse all others)
        setCollapsedPrimary(new Set(allPrimary.filter(p => p !== primary)));
        // Fold in (collapse) all secondaries (for a clean overview)
        setCollapsedSecondary(new Set(allSecondaryKeys));
        matched = true;
        break;
      }

      // Check secondary and tertiary groups
      for (const [secondary, secData] of Object.entries(pData.secondary || {})) {
        // Notes directly under secondary
        if (secData.notes.some(n => n.id === selectedNote.id)) {
          setCollapsedPrimary(new Set(allPrimary.filter(p => p !== primary)));
          // Collapse all secondaries except the target one (so the target secondary is unfolded)
          setCollapsedSecondary(new Set(allSecondaryKeys.filter(k => k !== `${primary}:${secondary}`)));
          matched = true;
          break;
        }

        // Notes under tertiary groups
        for (const [tertiary, tNotes] of Object.entries(secData.tertiary || {})) {
          if (tNotes.some(n => n.id === selectedNote.id)) {
            setCollapsedPrimary(new Set(allPrimary.filter(p => p !== primary)));
            // Unfold the parent secondary and collapse all other secondaries
            setCollapsedSecondary(new Set(allSecondaryKeys.filter(k => k !== `${primary}:${secondary}`)));
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (matched) break;
    }

    // If nothing matched (e.g. uncategorized note), fall back to collapsing all primaries
    // which results in the uncategorized header being visible but everything else folded.
    if (!matched) {
      setCollapsedPrimary(new Set(Object.keys(categoryHierarchy))); // collapse all primaries
      setCollapsedSecondary(new Set(allSecondaryKeys)); // collapse all secondaries
    }
  // Note: intentionally do NOT include `selectedNote` as a dependency so that
  // simply selecting a different note does NOT cause the menu to re-collapse
  // or jump. We still want the auto-expand behavior when the hierarchy or
  // refresh trigger updates (e.g. after tag changes or a reload), so those
  // remain in the dependency list.
  }, [categoryHierarchy, refreshTrigger, viewMode, searchMode]);

  // Filter notes by date
  const filterNotesByDate = (note: Note): boolean => {
    const hasMonthFilter = selectedMonths.size > 0;
    const hasYearFilter = selectedYears.size > 0;
    
    // If no filters are active, show all notes
    if (!hasMonthFilter && !hasYearFilter) {
      return true;
    }
    
    const noteDate = new Date(note.updatedAt);
    const noteMonth = noteDate.getMonth() + 1; // JavaScript months are 0-indexed
    const noteYear = noteDate.getFullYear();
    
    // Check month filter
    const monthMatch = !hasMonthFilter || selectedMonths.has(noteMonth);
    
    // Check year filter
    let yearMatch = !hasYearFilter;
    if (hasYearFilter) {
      if (selectedYears.has(noteYear)) {
        yearMatch = true;
      } else if (selectedYears.has('older') && noteYear <= 2021) {
        yearMatch = true;
      }
    }
    
    // Exclude notes with primary tag 'deleted' from date view entirely
    const primary = (note as any).primaryTag as string | undefined | null;
    const p = primary ? primary.trim().toLowerCase() : null;
    if (p === 'deleted') return false;
    // Archived notes are hidden in date view unless a date filter is active
    if (p === 'archived' && !hasMonthFilter && !hasYearFilter) return false;

    return monthMatch && yearMatch;
  };

  // Filter notes list
  const getFilteredNotes = (notes: Note[]): Note[] => {
    return notes.filter(filterNotesByDate);
  };

  // Filter category hierarchy (apply same date-based filtering as Latest view)
  const getFilteredHierarchy = (hierarchy: CategoryHierarchy): CategoryHierarchy => {
    const filtered: CategoryHierarchy = {};

    Object.entries(hierarchy).forEach(([primaryTag, primaryData]) => {
      const filteredPrimary = {
        notes: getFilteredNotes(primaryData.notes),
        secondary: {} as CategoryHierarchy[string]['secondary']
      };

      Object.entries(primaryData.secondary).forEach(([secondaryTag, secondaryData]) => {
        const filteredSecondary = {
          notes: getFilteredNotes(secondaryData.notes),
          tertiary: {} as CategoryHierarchy[string]['secondary'][string]['tertiary']
        };

        Object.entries(secondaryData.tertiary).forEach(([tertiaryTag, notes]) => {
          const filteredTertiary = getFilteredNotes(notes);
          if (filteredTertiary.length > 0) {
            filteredSecondary.tertiary[tertiaryTag] = filteredTertiary;
          }
        });

        if (filteredSecondary.notes.length > 0 || Object.keys(filteredSecondary.tertiary).length > 0) {
          filteredPrimary.secondary[secondaryTag] = filteredSecondary;
        }
      });

      if (filteredPrimary.notes.length > 0 || Object.keys(filteredPrimary.secondary).length > 0) {
        filtered[primaryTag] = filteredPrimary;
      }
    });

    return filtered;
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchMode('none');
      return;
    }

    if (searchQuery.startsWith('#')) {
      // Tag search
      try {
        const tagName = searchQuery.substring(1);
        const results = await window.electronAPI.searchNotesByTag(tagName);
        if (!isMountedRef.current) return;
        setSearchResults(results);
        setSearchMode('tag');
      } catch (err) { console.warn('searchNotesByTag failed', err); }
    } else {
      // Text search
      try {
        const results = await window.electronAPI.searchNotes(searchQuery);
        if (!isMountedRef.current) return;
        setSearchResults(results);
        setSearchMode('text');
      } catch (err) { console.warn('searchNotes failed', err); }
    }
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchMode('none');
    setSearchResults([]);
  };

  const togglePrimaryCategory = (category: string) => {
    // List of all primary tags available from current hierarchy
    const allPrimary = Object.keys(categoryHierarchy);

    const isCurrentlyCollapsed = collapsedPrimary.has(category);

    if (isCurrentlyCollapsed) {
      // Primary is currently collapsed -> open it and close all others.
      const newCollapsedPrimary = new Set(allPrimary.filter(p => p !== category));
      setCollapsedPrimary(newCollapsedPrimary);

      // When opening a primary, collapse (fold in) all of its secondary categories
      // so the user sees a clean overview.
      const secondaries = Object.keys(categoryHierarchy[category]?.secondary ?? {});
      const secondaryKeys = secondaries.map(s => `${category}:${s}`);

      // Add these secondary keys to the collapsed set
      setCollapsedSecondary(prev => {
        const next = new Set(prev);
        secondaryKeys.forEach(k => next.add(k));
        return next;
      });

    } else {
      // Primary is currently open -> we should toggle all secondaries under this primary.
      // First, ensure this primary remains the only open primary (collapse all others).
      const newCollapsedPrimary = new Set(Object.keys(categoryHierarchy).filter(p => p !== category));
      setCollapsedPrimary(newCollapsedPrimary);

      // Now toggle secondary groups under this primary:
      const secondaries = Object.keys(categoryHierarchy[category]?.secondary ?? {});
      const secondaryKeys = secondaries.map(s => `${category}:${s}`);

      if (secondaryKeys.length === 0) {
        // Nothing to toggle
        return;
      }

      // Determine if ALL secondaries are currently expanded (i.e., none of their keys are in collapsedSecondary)
      const allExpanded = secondaryKeys.every(k => !collapsedSecondary.has(k));

      const newCollapsedSecondary = new Set(collapsedSecondary);

      if (allExpanded) {
        // All expanded -> collapse them all (add all keys to collapsed set)
        secondaryKeys.forEach(k => newCollapsedSecondary.add(k));
      } else {
        // Not all expanded -> expand them all (remove their keys from collapsed set)
        secondaryKeys.forEach(k => newCollapsedSecondary.delete(k));
      }

      setCollapsedSecondary(newCollapsedSecondary);
    }
  };

  const toggleSecondaryCategory = (primaryTag: string, secondaryTag: string) => {
    const key = `${primaryTag}:${secondaryTag}`;

    // Ensure this primary becomes the only open primary (collapse all others)
    const allPrimary = Object.keys(categoryHierarchy);
    const newCollapsedPrimary = new Set(allPrimary.filter(p => p !== primaryTag));
    setCollapsedPrimary(newCollapsedPrimary);

    // Build the set of secondary keys that belong to this primary
    const secondaries = Object.keys(categoryHierarchy[primaryTag]?.secondary ?? {});
    const secondaryKeys = secondaries.map(s => `${primaryTag}:${s}`);

    const newCollapsedSecondary = new Set(collapsedSecondary);

    if (newCollapsedSecondary.has(key)) {
      // Currently collapsed -> open this one, collapse other secondaries within same primary
      secondaryKeys.forEach(k => {
        if (k !== key) newCollapsedSecondary.add(k);
      });
      newCollapsedSecondary.delete(key);
    } else {
      // Currently open -> collapse this one
      newCollapsedSecondary.add(key);
    }

    setCollapsedSecondary(newCollapsedSecondary);
  };

  const handleNoteContextMenu = async (e: React.MouseEvent, note: Note) => {
    e.preventDefault();
    try {
      // Special handling for temp notes
      if (note.isTemp) {
        if (!note.hasUnsavedChanges) {
          // No unsaved changes — close immediately
          try {
            await window.electronAPI.deleteTempNote(note.id);
            if (!isMountedRef.current) return;
            const nextNote = findNextNoteAfterDeletion(note.id);
            if (onNoteDelete) onNoteDelete(note.id, nextNote);
            if (onNotesUpdate) onNotesUpdate();
            await loadDateNotes();
          } catch (err) {
            console.warn('deleteTempNote failed', err);
          }
        } else if (armed.kind === 'close-temp' && armed.noteId === note.id) {
          // Second right-click — close despite unsaved changes
          try {
            await window.electronAPI.deleteTempNote(note.id);
            if (!isMountedRef.current) return;
            setArmed({ kind: 'none' });
            const nextNote = findNextNoteAfterDeletion(note.id);
            if (onNoteDelete) onNoteDelete(note.id, nextNote);
            if (onNotesUpdate) onNotesUpdate();
            await loadDateNotes();
          } catch (err) {
            console.warn('deleteTempNote failed', err);
            setArmed({ kind: 'none' });
          }
        } else {
          // First right-click with unsaved changes — arm
          setArmed({ kind: 'close-temp', noteId: note.id });
        }
        return;
      }

      // Ensure we derive the primary tag from the DB to be robust across views
      let primary: string | undefined | null = (note as any).primaryTag as string | undefined | null;
      try {
        const tags = await window.electronAPI.getNoteTags(note.id);
        if (tags && tags.length > 0) primary = tags[0].tag?.name ?? primary;
      } catch (err) {
        // ignore - fall back to whatever was present on `note`
      }
      // Normalize for robust comparisons
      primary = primary ? (primary as string).trim().toLowerCase() : primary;
      if (e.ctrlKey) {
      // Ctrl + right-click -> delete flow (arm then assign 'deleted' as primary)
        if (primary === 'deleted') {
          // Already deleted -> arm for permanent deletion
          if (armed.kind === 'permanent' && armed.noteId === note.id) {
            // Confirm permanent delete
            try {
              await window.electronAPI.deleteNote(note.id);
              if (!isMountedRef.current) return;
              setArmed({ kind: 'none' });
              const last = await window.electronAPI.getLastEditedNote();
              let nextNote: Note | null = null;
              if (last && last.id !== note.id) nextNote = last; else nextNote = findNextNoteAfterDeletion(note.id);
              if (onNoteDelete) onNoteDelete(note.id, nextNote);
              if (onNotesUpdate) onNotesUpdate();
              if (searchMode === 'none') {
                if (viewMode === 'latest') await loadDateNotes(); else await loadCategoryHierarchy();
              }
            } catch (err) { console.warn('permanent delete failed', err); setArmed({ kind: 'none' }); }
          } else {
            setArmed({ kind: 'permanent', noteId: note.id });
          }
        } else {
          // Arm for assigning 'deleted'
          if (armed.kind === 'delete' && armed.noteId === note.id) {
            try {
              await window.electronAPI.addTagToNote(note.id, 'deleted', 0);
              const tags = await window.electronAPI.getNoteTags(note.id);
              await window.electronAPI.reorderNoteTags(note.id, tags.map(t => t.tagId));
              if (!isMountedRef.current) return;
              setArmed({ kind: 'none' });
              // notify parent so TagInput and other panels refresh
              if (onNotesUpdate) onNotesUpdate();
              if (searchMode === 'none') {
                if (viewMode === 'latest') await loadDateNotes(); else await loadCategoryHierarchy();
              }
            } catch (err) { console.warn('assign deleted failed', err); setArmed({ kind: 'none' }); }
          } else {
            setArmed({ kind: 'delete', noteId: note.id });
          }
        }
      } else {
        // Right-click without Ctrl -> if the note is protected, remove protected tags; otherwise archive flow (arm then assign 'archived')
        if (primary === 'archived' || primary === 'deleted') {
          try {
            const tags = await window.electronAPI.getNoteTags(note.id);
            for (const t of tags) {
              const n = (t.tag?.name || '').trim().toLowerCase();
              if (n === 'archived' || n === 'deleted') {
                await window.electronAPI.removeTagFromNote(note.id, t.tagId);
              }
            }
            if (!isMountedRef.current) return;
            if (onNotesUpdate) onNotesUpdate();
            if (searchMode === 'none') {
              if (viewMode === 'latest') await loadDateNotes(); else await loadCategoryHierarchy();
            }
          } catch (err) { console.warn('remove protected tags failed', err); }
          return;
        }

        // Right-click without Ctrl -> archive flow (arm then assign 'archived')
        if (armed.kind === 'archive' && armed.noteId === note.id) {
          try {
            await window.electronAPI.addTagToNote(note.id, 'archived', 0);
            const tags = await window.electronAPI.getNoteTags(note.id);
            await window.electronAPI.reorderNoteTags(note.id, tags.map(t => t.tagId));
            if (!isMountedRef.current) return;
            setArmed({ kind: 'none' });
            if (onNotesUpdate) onNotesUpdate();
            if (searchMode === 'none') {
              if (viewMode === 'latest') await loadDateNotes(); else await loadCategoryHierarchy();
            }
          } catch (err) { console.warn('assign archived failed', err); setArmed({ kind: 'none' }); }
        } else {
          setArmed({ kind: 'archive', noteId: note.id });
        }
      }
    } catch (err) {
      console.warn('note context menu failed', err);
    }
  };

  const handleCategoryHeaderContextMenu = async (e: React.MouseEvent, primaryTag: string) => {
    e.preventDefault();
    try {
      const norm = primaryTag ? primaryTag.trim().toLowerCase() : primaryTag;
      if (norm === 'deleted' && e.ctrlKey) {
        if (armed.kind === 'permanent' && armed.category === primaryTag) {
          // Confirm permanent deletion of all notes in this category
          try {
            const groups = await window.electronAPI.getNotesByPrimaryTag();
            const notes = groups['deleted'] || [];
            for (const n of notes) {
              try { await window.electronAPI.deleteNote(n.id); } catch (err) { console.warn('delete note failed', n.id, err); }
            }
            if (!isMountedRef.current) return;
            setArmed({ kind: 'none' });
            if (onNotesUpdate) onNotesUpdate();
            if (searchMode === 'none') {
              if (viewMode === 'latest') await loadDateNotes(); else await loadCategoryHierarchy();
            }
          } catch (err) { console.warn('mass delete failed', err); setArmed({ kind: 'none' }); }
        } else {
          setArmed({ kind: 'permanent', category: primaryTag });
        }
      }
    } catch (err) { console.warn('category context menu failed', err); }
  };

  const handleDeleteNote = async (e: React.MouseEvent, noteId: number) => {
    // Legacy delete button removed. Keep function for compatibility but no-op.
    e.stopPropagation();
    return;
  };

  const handleDeleteMouseLeave = (e: React.MouseEvent) => {
    e.stopPropagation();
    setArmed({ kind: 'none' });
  };

  // Helper function to get all visible notes in current view
  const getAllVisibleNotes = (): Note[] => {
    if (searchMode !== 'none') {
      return searchResults.map(r => r.note);
    }
    
    if (viewMode === 'latest') {
      return getFilteredNotes(dateNotes);
    }
    
    // Category view - flatten hierarchy
    const notes: Note[] = [];
    const filteredHierarchy = getFilteredHierarchy(categoryHierarchy);
    
    Object.entries(filteredHierarchy).forEach(([, primaryData]) => {
      // Add secondary notes first
      Object.entries(primaryData.secondary).forEach(([, secondaryData]) => {
        notes.push(...secondaryData.notes);
        // Add tertiary notes
        Object.values(secondaryData.tertiary).forEach(tertiaryNotes => {
          notes.push(...tertiaryNotes);
        });
      });
      // Add primary-only notes last
      notes.push(...primaryData.notes);
    });
    
    // Add uncategorized notes
    const filteredUncategorized = getFilteredNotes(uncategorizedNotes);
    notes.push(...filteredUncategorized);
    
    return notes;
  };

  // Helper function to find next note after deletion
  const findNextNoteAfterDeletion = (deletedNoteId: number): Note | null => {
    const allNotes = getAllVisibleNotes();
    const currentIndex = allNotes.findIndex(n => n.id === deletedNoteId);
    
    if (currentIndex === -1) {
      // Note not found in current view, return null
      return null;
    }
    
    // If there's a note after this one, select it
    if (currentIndex < allNotes.length - 1) {
      return allNotes[currentIndex + 1];
    }
    
    // If this was the last note and there are other notes, select the previous one (now last)
    if (currentIndex > 0) {
      return allNotes[currentIndex - 1];
    }
    
    // No notes left
    return null;
  };

  // Replace/update a single note object inside the category hierarchy
  const replaceNoteInHierarchy = (updated: Note): boolean => {
    let found = false;
    setCategoryHierarchy(prev => {
      const next: CategoryHierarchy = {};
      Object.entries(prev).forEach(([primary, pData]) => {
        const newSecondary: CategoryHierarchy[string]['secondary'] = {};

        // update primary-level notes
        const newPrimaryNotes = pData.notes.map(n => {
          if (n.id === updated.id) {
            found = true;
            return { ...n, title: updated.title, updatedAt: updated.updatedAt ?? n.updatedAt, lastEdited: updated.lastEdited ?? n.lastEdited };
          }
          return n;
        });

        Object.entries(pData.secondary).forEach(([sec, secData]) => {
          const newSecNotes = secData.notes.map(n => {
            if (n.id === updated.id) {
              found = true;
              return { ...n, title: updated.title, updatedAt: updated.updatedAt ?? n.updatedAt, lastEdited: updated.lastEdited ?? n.lastEdited };
            }
            return n;
          });
          const newTertiary: CategoryHierarchy[string]['secondary'][string]['tertiary'] = {};
          Object.entries(secData.tertiary).forEach(([ter, notes]) => {
            newTertiary[ter] = notes.map(n => {
              if (n.id === updated.id) {
                found = true;
                return { ...n, title: updated.title, updatedAt: updated.updatedAt ?? n.updatedAt, lastEdited: updated.lastEdited ?? n.lastEdited };
              }
              return n;
            });
          });
          newSecondary[sec] = { notes: newSecNotes, tertiary: newTertiary } as any;
        });

        next[primary] = { notes: newPrimaryNotes, secondary: newSecondary } as any;
      });
      return next;
    });
    return found;
  };

  // Replace/update a single note across the sidebar state (date list, uncategorized, search results, hierarchy)
  const replaceNoteInState = (updated: Note): boolean => {
    let found = false;

    setDateNotes(prev => prev.map(n => {
      if (n.id === updated.id) {
        found = true;
        return { ...n, title: updated.title, updatedAt: updated.updatedAt ?? n.updatedAt, lastEdited: updated.lastEdited ?? n.lastEdited };
      }
      return n;
    }));

    setUncategorizedNotes(prev => prev.map(n => {
      if (n.id === updated.id) {
        found = true;
        return { ...n, title: updated.title, updatedAt: updated.updatedAt ?? n.updatedAt, lastEdited: updated.lastEdited ?? n.lastEdited };
      }
      return n;
    }));

    setSearchResults(prev => prev.map(r => {
      if (r.note.id === updated.id) {
        found = true;
        return { ...r, note: { ...r.note, title: updated.title, updatedAt: updated.updatedAt ?? r.note.updatedAt, lastEdited: updated.lastEdited ?? r.note.lastEdited } };
      }
      return r;
    }));

    // update hierarchy as well
    const foundInHierarchy = replaceNoteInHierarchy(updated);
    return found || foundInHierarchy;
  };

  // Apply targeted updates when parent supplies a single-note update
  useEffect(() => {
    if (!noteUpdate) return;
    const didReplace = replaceNoteInState(noteUpdate);
    if (!didReplace) {
      // If the note wasn't found in local caches, trigger a full refresh
      if (onNotesUpdate) onNotesUpdate();
    }
  }, [noteUpdate]);

  const formatLastEdited = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Date indicator helpers for Latest/Trash views
  const getWeekStartTimestamp = (date: Date) => {
    // Normalize to local Monday 00:00:00. Use (getDay()+6)%7 to make Monday=0
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayIndex = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dayIndex);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const getDateIndicatorClass = (note: Note) => {
    if (!note || !note.updatedAt) return '';
    const now = new Date();
    const noteDate = new Date(note.updatedAt);

    // Today
    if (
      now.getFullYear() === noteDate.getFullYear() &&
      now.getMonth() === noteDate.getMonth() &&
      now.getDate() === noteDate.getDate()
    ) {
      return 'date-today';
    }

    // This workweek: same calendar week (Monday-start). This avoids "last 7 days" semantics.
    const nowWeekStart = getWeekStartTimestamp(now);
    const noteWeekStart = getWeekStartTimestamp(noteDate);
    if (nowWeekStart === noteWeekStart) {
      return 'date-week';
    }

    // This month
    if (
      now.getFullYear() === noteDate.getFullYear() &&
      now.getMonth() === noteDate.getMonth()
    ) {
      return 'date-month';
    }

    return '';
  };

  const totalPages = Math.max(1, Math.ceil(totalNotes / itemsPerPage));

  // Detect whether the sidebar-content currently requires scrolling; show pagination
  useEffect(() => {
    // Compute itemsPerPage based on available height and fixed item size
    const ITEM_HEIGHT = 56; // fixed per .date-view .note-item
    const ITEM_MARGIN_V = 8; // total vertical margin (4px top + 4px bottom)
    const ITEM_TOTAL = ITEM_HEIGHT + ITEM_MARGIN_V;
    const PAGINATION_HEIGHT = 40; // approximate height of pagination controls

    const compute = () => {
      const el = contentRef.current;
      if (!el) return;
      const contentH = el.clientHeight;
      // naive full-capacity without pagination
      let items = Math.floor(contentH / ITEM_TOTAL);
      if (items < 1) items = 1;

      // If more notes than items, pagination will be shown; ensure there is space for pagination controls
      if (totalNotes > items) {
        while (items > 1 && (items * ITEM_TOTAL + PAGINATION_HEIGHT) > contentH) {
          items -= 1;
        }
      }

      if (items !== itemsPerPage) setItemsPerPage(items);
      // Show pagination whenever more than one page exists in Latest/Trash views
      const shouldShow = (viewMode === 'latest' || viewMode === 'trash') && Math.ceil(totalNotes / Math.max(1, items)) > 1 && searchMode === 'none';
      setShowPagination(shouldShow);
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [viewMode, totalNotes, searchMode, selectedMonths, selectedYears]);

  // Reset to page 1 when view mode or filters change to avoid stale pages
  useEffect(() => {
    setCurrentPage(1);
  }, [viewMode, selectedMonths, selectedYears, searchMode]);

  const renderSearchResults = () => (
    <div className="search-results">
      <div className="search-header">
        <h3>Search Results ({searchResults.length})</h3>
        <button className="clear-search" onClick={handleClearSearch}>Clear</button>
      </div>
      {searchResults.map(result => (
        <div
          key={result.note.id}
          className={`note-item ${selectedNote?.id === result.note.id ? 'selected' : ''}`}
          onClick={() => onSelectNote(result.note)}
        >
          <div className="note-content">
            <div className="note-title">{result.note.title}</div>
            {result.snippet && (
              <div className="note-snippet">
                {result.snippet.map((seg, i) =>
                  seg.highlight ? <strong key={i}>{seg.text}</strong> : <span key={i}>{seg.text}</span>
                )}
              </div>
            )}
            <div className="note-date">
              {new Date(result.note.updatedAt).toLocaleDateString()}
              {result.note.lastEdited ? (
                <span className="note-edited">[{formatLastEdited(result.note.lastEdited)}]</span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderDateView = () => {
    const filteredNotes = viewMode === 'trash' ? dateNotes : getFilteredNotes(dateNotes);
    // Determine which notes to show on this page. For `latest` we fetch a page from the DB
    // so `dateNotes` already contains the current page. For `trash` we paginate client-side.
    let displayedNotes: Note[] = [];
    if (viewMode === 'latest') {
      displayedNotes = filteredNotes;
    } else {
      const start = (currentPage - 1) * itemsPerPage;
      displayedNotes = filteredNotes.slice(start, start + itemsPerPage);
    }

    return (
      <div className="date-view">
        <div className="notes-list">
          {displayedNotes.length === 0 ? (
            <div className="empty-state" style={{ padding: 16, textAlign: 'center' }}>
              {viewMode === 'trash' && totalNotes === 0 ? (
                <div>The trash bin is currently empty.</div>
              ) : hasAnyNotes ? (
                <div>No notes to show for the current filters.</div>
              ) : (
                <div>
                  {viewMode === 'trash' ? (
                    <span>
                      This is where you will find your deleted notes. (Notes can be deleted from other views by right clicking them while holding the control key.) <br /><br />
                      Deleted notes in the trash bin can be restored with a right click or purged from the database permanently by holding the control key and right clicking once more.
                    </span>
                  ) : (
                    <span>This view lists your notes in the order they were last edited. It&apos;s a great way to keep track of your most recent work at a glance.</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            displayedNotes.map(note => (
            <div
              key={note.id}
              className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''} ${getDateIndicatorClass(note)} ${armed.kind === 'delete' && armed.noteId === note.id ? 'armed-delete' : ''} ${armed.kind === 'archive' && armed.noteId === note.id ? 'armed-archive' : ''} ${armed.kind === 'permanent' && armed.noteId === note.id ? 'armed-permanent' : ''} ${armed.kind === 'close-temp' && armed.noteId === note.id ? 'armed-close-temp' : ''} ${note.isTemp ? 'temp-note' : ''}`}
              onClick={() => { setArmed({ kind: 'none' }); onSelectNote(note); }}
              onContextMenu={(e) => handleNoteContextMenu(e, note)}
            >
              <div className="note-content">
                <div className="note-title">
                  {note.title}
                </div>
                <div className="note-date">
                  {new Date(note.updatedAt).toLocaleDateString()}
                  {note.lastEdited ? (
                    <span className="note-edited">[{formatLastEdited(note.lastEdited)}]</span>
                  ) : null}
                </div>
              </div>
              {/* delete button removed — use context menu (right-click) to arm/archive/delete */}
            </div>
          ))) }
        </div>
        
        {/* pagination moved to the bottom of the sidebar so it's shown when the content area overflows */}
      </div>
    );
  };

  const renderCategoryView = () => {
    const filteredHierarchy = getFilteredHierarchy(categoryHierarchy);
    const filteredUncategorized = getFilteredNotes(uncategorizedNotes);
    
    const hasHierarchy = Object.keys(filteredHierarchy).length > 0 || filteredUncategorized.length > 0;
    return (
      <div className="category-view">
        {!hasHierarchy ? (
          <div className="empty-state" style={{ padding: 16, textAlign: 'center' }}>
            {hasAnyNotes ? (
              <div>No categories to show. Assign tags to your notes to create categories.</div>
            ) : (
              <div>
                {viewMode === 'archived' ? (
                  <span>
                    This is where notes go when you archive them. (Notes in other views can be moved to the archive with a right click.)<br /><br />
                    Archiving a note moves it out of your active notes, allowing you to keep your workspace clean.<br /><br />
                    Archived notes can be restored to your active notes with a right click.
                  </span>
                ) : (
                  <span>This view groups your active notes by their primary, secondary and tertiary tags. This allows you to keep your workspace organized and easily navigate through your notes.</span>
                )}
              </div>
            )}
          </div>
        ) : (
          Object.entries(filteredHierarchy).map(([primaryTag, primaryData]) => {
        const isPrimaryCollapsed = collapsedPrimary.has(primaryTag);
        const primaryNoteCount = primaryData.notes.length + 
          Object.values(primaryData.secondary).reduce((sum, secData) => {
            return sum + secData.notes.length + 
              Object.values(secData.tertiary).reduce((tSum, tNotes) => tSum + tNotes.length, 0);
          }, 0);
        
        return (
          <div key={primaryTag} className="category-group">
            <div
              className="category-header primary"
              onClick={() => togglePrimaryCategory(primaryTag)}
              onContextMenu={(e) => handleCategoryHeaderContextMenu(e, primaryTag)}
            >
              <span className="category-arrow">
                {isPrimaryCollapsed ? '▶' : '▼'}
              </span>
              <span className="category-name">{primaryTag}</span>
              <span className="category-count">({primaryNoteCount})</span>
            </div>
            
            {!isPrimaryCollapsed && (
              <div className="category-content">
                {/* Secondary tags accordion */}
                {Object.entries(primaryData.secondary).map(([secondaryTag, secondaryData]) => {
                  const secKey = `${primaryTag}:${secondaryTag}`;
                  const isSecondaryCollapsed = collapsedSecondary.has(secKey);
                  const secNoteCount = secondaryData.notes.length + 
                    Object.values(secondaryData.tertiary).reduce((sum, tNotes) => sum + tNotes.length, 0);
                  
                  return (
                    <div key={secKey} className="secondary-group">
                      <div
                        className="category-header secondary"
                        onClick={() => toggleSecondaryCategory(primaryTag, secondaryTag)}
                      >
                        <span className="category-arrow">
                          {isSecondaryCollapsed ? '▶' : '▼'}
                        </span>
                        <span className="category-name">{secondaryTag}</span>
                        <span className="category-count">({secNoteCount})</span>
                      </div>
                      
                      {!isSecondaryCollapsed && (
                        <div className="secondary-content">
                          {/* Notes with primary + secondary but no tertiary */}
                          {secondaryData.notes.map(note => (
                            <div
                              key={note.id}
                              className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''} ${armed.kind === 'delete' && armed.noteId === note.id ? 'armed-delete' : ''} ${armed.kind === 'archive' && armed.noteId === note.id ? 'armed-archive' : ''} ${armed.kind === 'permanent' && armed.noteId === note.id ? 'armed-permanent' : ''}`}
                              onClick={() => { setArmed({ kind: 'none' }); onSelectNote(note); }}
                              onContextMenu={(e) => handleNoteContextMenu(e, note)}
                            >
                              <div className="note-content">
                                <div className="note-title">{note.title}</div>
                                <div className="note-date">
                                  {new Date(note.updatedAt).toLocaleDateString()}
                                  {note.lastEdited ? <span className="note-edited">[{formatLastEdited(note.lastEdited)}]</span> : null}
                                </div>
                              </div>
                              {/* delete button removed — use context menu (right-click) to arm/archive/delete */}
                            </div>
                          ))}
                          
                          {/* Tertiary tags (visual dividers, not accordion) */}
                          {Object.entries(secondaryData.tertiary).map(([tertiaryTag, notes]) => (
                            <div key={tertiaryTag} className="tertiary-group">
                              <div className="tertiary-header">{tertiaryTag}</div>
                              {notes.map(note => (
                                <div
                                  key={note.id}
                                  className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''} ${armed.kind === 'delete' && armed.noteId === note.id ? 'armed-delete' : ''} ${armed.kind === 'archive' && armed.noteId === note.id ? 'armed-archive' : ''} ${armed.kind === 'permanent' && armed.noteId === note.id ? 'armed-permanent' : ''}`}
                                  onClick={() => { setArmed({ kind: 'none' }); onSelectNote(note); }}
                                  onContextMenu={(e) => handleNoteContextMenu(e, note)}
                                >
                                  <div className="note-content">
                                    <div className="note-title">{note.title}</div>
                                    <div className="note-date">
                                      {new Date(note.updatedAt).toLocaleDateString()}
                                      {note.lastEdited ? <span className="note-edited">[{formatLastEdited(note.lastEdited)}]</span> : null}
                                    </div>
                                  </div>
                                  {/* delete button removed — use context menu (right-click) to arm/archive/delete */}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                
                {/* Notes with only primary tag (at the end) */}
                {primaryData.notes.map(note => (
                  <div
                    key={note.id}
                    className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''} ${armed.kind === 'delete' && armed.noteId === note.id ? 'armed-delete' : ''} ${armed.kind === 'archive' && armed.noteId === note.id ? 'armed-archive' : ''} ${armed.kind === 'permanent' && armed.noteId === note.id ? 'armed-permanent' : ''}`}
                    onClick={() => { setArmed({ kind: 'none' }); onSelectNote(note); }}
                    onContextMenu={(e) => handleNoteContextMenu(e, note)}
                  >
                    <div className="note-content">
                      <div className="note-title">{note.title}</div>
                      <div className="note-date">
                        {new Date(note.updatedAt).toLocaleDateString()}
                        {note.lastEdited ? <span className="note-edited">[{formatLastEdited(note.lastEdited)}]</span> : null}
                      </div>
                    </div>
                    {/* delete button removed — use context menu (right-click) to arm/archive/delete */}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })) }
      
      {/* Uncategorized notes section */}
      {filteredUncategorized.length > 0 && (
        <div className="category-group">
          <div className="category-header primary uncategorized">
            <span className="category-name">Uncategorized</span>
            <span className="category-count">({filteredUncategorized.length})</span>
          </div>
          <div className="category-content">
            {filteredUncategorized.map(note => (
              <div
                key={note.id}
                className={`note-item ${selectedNote?.id === note.id ? 'selected' : ''} ${armed.kind === 'delete' && armed.noteId === note.id ? 'armed-delete' : ''} ${armed.kind === 'archive' && armed.noteId === note.id ? 'armed-archive' : ''} ${armed.kind === 'permanent' && armed.noteId === note.id ? 'armed-permanent' : ''}`}
                onClick={() => { setArmed({ kind: 'none' }); onSelectNote(note); }}
                onContextMenu={(e) => handleNoteContextMenu(e, note)}
              >
                <div className="note-content">
                  <div className="note-title">{note.title}</div>
                  <div className="note-date">
                    {new Date(note.updatedAt).toLocaleDateString()}
                    {note.lastEdited ? <span className="note-edited">[{formatLastEdited(note.lastEdited)}]</span> : null}
                  </div>
                </div>
                {/* delete button removed — use context menu (right-click) to arm/archive/delete */}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

  return (
    <div className="sidebar" style={{ width: `${width}px` }}>
      <div className="search-box">
        <input
          type="text"
          placeholder="Search notes or #tag..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={handleSearchKeyPress}
        />
      </div>
      
      {searchMode === 'none' && (
        <div className="view-toggle">
          <button
            className={`toggle-btn icon-btn btn-latest ${viewMode === 'latest' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('latest')}
            title="Latest"
            aria-label="Latest"
          />
          <button
            className={`toggle-btn icon-btn btn-active ${viewMode === 'active' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('active')}
            title="Active"
            aria-label="Active"
          />
          <button
            className={`toggle-btn icon-btn btn-archived ${viewMode === 'archived' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('archived')}
            title="Archived"
            aria-label="Archived"
          />
          <button
            className={`toggle-btn icon-btn btn-deleted ${viewMode === 'trash' ? 'active' : ''}`}
            onClick={() => handleTrashToggleClick()}
            title="Trash"
            aria-label="Trash"
          />
        </div>
      )}
      
      <div className="sidebar-content" ref={contentRef}>
        {searchMode !== 'none' ? renderSearchResults() : 
         (viewMode === 'latest' || viewMode === 'trash') ? renderDateView() : 
         renderCategoryView()}
      </div>
    
        {showPagination && (
          <div className="sidebar-pagination">
            <button
              className="sidebar-page-btn"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            >&lt;</button>
            <span className="sidebar-page-number">{currentPage}</span>
            <button
              className="sidebar-page-btn"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            >&gt;</button>
          </div>
        )}

        {searchMode === 'none' && (
          <DateFilter
            selectedMonths={selectedMonths}
            selectedYears={selectedYears}
            onMonthToggle={onMonthToggle}
            onYearToggle={onYearToggle}
          />
        )}
    </div>
  );
};
