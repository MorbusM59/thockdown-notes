import React, { useEffect, useRef, useState } from 'react';
import { Note } from '../shared/types';
import { Sidebar } from './Sidebar';
import { MarkdownEditor, TimelineProps } from './MarkdownEditor';
import { TagInput } from './TagInput';
import {
  FILTER_MONTHS,
  FILTER_YEARS,
  CLEAR_MONTHS_SIGNAL,
  CLEAR_YEARS_SIGNAL,
  YearValue,
  handleMultiSelect,
} from '../shared/filterConstants';
import './Shared.scss';
import './App.scss';
import { SuggestedPanel } from './SuggestedPanel';
import { Utility } from './Utility';

export const App: React.FC = () => {
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  
  // Time Machine State
  const [snapshots, setSnapshots] = useState<import('../shared/types').NoteSnapshot[]>([]);
  const [timeMachineIndex, setTimeMachineIndex] = useState<number>(-1);

  useEffect(() => {
    const handleSnap = async () => {
      if (selectedNote && isMountedRef.current) {
        const snaps = await window.electronAPI.getNoteSnapshots(selectedNote.id);
        setSnapshots(snaps);
      }
    };
    document.addEventListener('manual-snapshot-completed', handleSnap);
    document.addEventListener('auto-snapshot-completed', handleSnap);
    return () => {
      document.removeEventListener('manual-snapshot-completed', handleSnap);
      document.removeEventListener('auto-snapshot-completed', handleSnap);
    };
  }, [selectedNote]);
    const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
    const [logBase, setLogBase] = useState(10);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  const [sidebarNoteUpdate, setSidebarNoteUpdate] = useState<Note | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set());
  const [selectedYears, setSelectedYears] = useState<Set<number | 'older'>>(new Set());
  const [viewMode, setViewMode] = useState<'latest' | 'active' | 'archived' | 'trash'>('latest');
  const [hasAnyNotes, setHasAnyNotes] = useState<boolean>(false);

  // Draggable / layout state and constraints
  const SIDEBAR_MIN = 220;
  const TAG_MIN = 250;
  const TAG_DEFAULT = 350;
  const SUGGESTED_MIN = 150;
  const UTILITY_FIXED = 150;
  const DIVIDER_W = 8;
  const APP_MIN_WIDTH = 790;
  const APP_MIN_HEIGHT = 550;

  // Sidebar sizing / drag
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('sidebar-width');
    const val = saved ? parseInt(saved, 10) : 320;
    return Math.max(SIDEBAR_MIN, val);
  });
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  // Top-row widths: explicit tagInput and suggested columns
  const [tagWidth, setTagWidth] = useState<number>(() => {
    const saved = localStorage.getItem('tag-input-width');
    return saved ? parseInt(saved, 10) : TAG_DEFAULT;
  });
  const [suggestedWidth, setSuggestedWidth] = useState<number>(() => {
    const saved = localStorage.getItem('tag-suggestions-width');
    return saved ? parseInt(saved, 10) : 240;
  });

  // Keep a ref of the last user-set ratio (tag / (tag + suggested)).
  // This is used during window resize to preserve the user's relative sizes.
  const ratioRef = useRef<number>(tagWidth / Math.max(1, tagWidth + suggestedWidth));

  // Only left divider (between tag and suggested) is draggable
  const [isDraggingLeftDivider, setIsDraggingLeftDivider] = useState(false);

  // Global editor preview/edit mode
  const [showPreview, setShowPreview] = useState<boolean>(() => {
    return localStorage.getItem('markdown-show-preview') === 'true';
  });
  const [historyResetSignal, setHistoryResetSignal] = useState(0);

  const appRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);

  const handleAppPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Only allow native text inputs to receive focus.
    if (target.closest('input, textarea, select')) {
      return;
    }

    // Keep the editor focused when clicking anywhere else in the app.
    if (!target.closest('.fixed-focus-editor')) {
      event.preventDefault();
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Keep selected note behavior as before
  useEffect(() => {
    (async () => {
      try {
        const last = await window.electronAPI.getLastEditedNote();
        if (last && isMountedRef.current) {
          setSelectedNote(last);
          const snaps = await window.electronAPI.getNoteSnapshots(last.id);
          if (isMountedRef.current) {
            setSnapshots(snaps);
          }
        }
        // determine whether any notes exist
        try {
          const all = await window.electronAPI.getAllNotes();
          if (isMountedRef.current) setHasAnyNotes(Array.isArray(all) && all.length > 0);
        } catch (e) {
          // non-fatal
        }
      } catch (err) {
        console.warn('Could not get last edited note', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePreview = async (next: boolean) => {
    if (next) {
      try {
        await (window as any).electronAPI.requestForceSave();
      } catch (err) {
        console.warn('requestForceSave failed', err);
      }
    }
    setShowPreview(next);
    localStorage.setItem('markdown-show-preview', String(next));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || '').toLowerCase();
      // Ctrl+N: create a new note
      if (e.ctrlKey && !e.shiftKey && key === 'n') {
        e.preventDefault();
        handleCreateNote();
        return;
      }
      // Ctrl+Shift+N: create note using clipboard text as title and place cursor on second line
      if (e.ctrlKey && e.shiftKey && key === 'n') {
        e.preventDefault();
        (async () => {
          try {
            try {
              await (window as any).electronAPI.requestForceSave();
            } catch (err) {
              console.warn('requestForceSave failed', err);
            }

            if (!isMountedRef.current) return;
            setShowPreview(false);
            localStorage.setItem('markdown-show-preview', 'false');

            // Read clipboard text (browser API in renderer). Fall back to 'Untitled'.
            let title = 'Untitled';
            try {
              const clip = await navigator.clipboard.readText();
              if (clip && clip.trim().length > 0) title = clip.trim();
            } catch (err) {
              // ignore clipboard failures
            }

            const note = await window.electronAPI.createNote(title);
            // Build initial content with title on first line and an empty second line.
            const initialContent = `# ${title}\n\n`;
            await window.electronAPI.saveNote(note.id, initialContent);

            // Save UI state so editor will place the cursor at the start of the second line
            try {
              const cursorPos = initialContent.indexOf('\n') + 1; // start of second line
              await window.electronAPI.saveNoteUiState(note.id, { cursorPos, scrollTop: 0 });
            } catch (err) {
              // non-fatal
            }

            if (!isMountedRef.current) return;
            setSelectedNote(note);
            setSnapshots([]);
            setTimeMachineIndex(-1);
            setViewMode('latest');
            setRefreshKey(k => k + 1);
            setHasAnyNotes(true);
          } catch (err) {
            console.warn('create note from clipboard failed', err);
          }
        })();
        return;
      }

      // Use Escape to toggle preview/edit mode instead of Shift+Enter
      if (e.key === 'Escape') {
        e.preventDefault();
        togglePreview(!showPreview);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showPreview]);

  // Handle opening .md files from external sources
  useEffect(() => {
    const handleOpenMdFile = async (_event: any, filePath: string) => {
      try {
        // Check if we already have a temp note for this file
        const tempNotes = await window.electronAPI.getTempNotes();
        const existingTempNote = tempNotes.find(note => note.externalPath === filePath);

        if (existingTempNote) {
          // Switch to existing temp note
          setSelectedNote(existingTempNote);
          setSnapshots([]);
          setTimeMachineIndex(-1);
          setViewMode('latest');
          setRefreshKey(k => k + 1);
          return;
        }

        // Strip BOM, CRLF, HTML tags, emojis, and variation selectors
        const sanitize = (raw: string): string =>
          raw
            .replace(/^\uFEFF/, '')
            .replace(/\r\n/g, '\n')
            .replace(/<[^>]*>/g, '')
            .replace(/\p{Extended_Pictographic}/gu, '')
            .replace(/\uFE0F/g, '');

        const raw = await window.electronAPI.readFileContent(filePath);
        const content = sanitize(raw ?? '');

        // Write back to disk if sanitization changed the content
        if (raw !== null && content !== raw) {
          await window.electronAPI.writeFileContent(filePath, content);
        }

        const title = await window.electronAPI.getFileBasename(filePath);

        // Create a temp note
        const tempNote = await window.electronAPI.createTempNote(title, filePath, 'utf8');
        if (tempNote) {
          // Save the content to the temp note
          await window.electronAPI.saveNote(tempNote.id, content);

          // Switch to the new temp note
          setSelectedNote(tempNote);
          setSnapshots([]);
          setTimeMachineIndex(-1);
          setViewMode('latest');
          setRefreshKey(k => k + 1);
          setHasAnyNotes(true);
        }
      } catch (err) {
        console.warn('Failed to open .md file:', filePath, err);
      }
    };

    // Listen for open-md-file events from main process
    (window as any).electronAPI.onOpenMdFile(handleOpenMdFile);

    return () => {
      // Cleanup if needed
    };
  }, []);

  const handleCreateNote = async () => {
    try {
      await (window as any).electronAPI.requestForceSave();
    } catch (err) {
      console.warn('requestForceSave failed', err);
    }

    if (!isMountedRef.current) return;
    setShowPreview(false);
    localStorage.setItem('markdown-show-preview', 'false');

    const note = await window.electronAPI.createNote('Untitled');
    const initialContent = '# ';
    await window.electronAPI.saveNote(note.id, initialContent);

    if (!isMountedRef.current) return;
    setSelectedNote(note);
    setSnapshots([]);
    setTimeMachineIndex(-1);
    // Ensure the sidebar shows the latest view when creating a new note
    setViewMode('latest');
    setRefreshKey(k => k + 1);
    setHasAnyNotes(true);
  };

  const handleConvertTempNote = async () => {
    if (!selectedNote || !selectedNote.isTemp) return;

    try {
      await (window as any).electronAPI.requestForceSave();
    } catch (err) {
      console.warn('requestForceSave failed', err);
    }

    if (!isMountedRef.current) return;
    
    try {
      // 1. Get the current content
      const content = await window.electronAPI.loadNote(selectedNote.id);

      // 2. Create a new note
      const newNote = await window.electronAPI.createNote('Untitled');
      
      // 3. Paste the contents
      await window.electronAPI.saveNote(newNote.id, content || '# ');

      // 4. Close the old temp note
      await window.electronAPI.deleteTempNote(selectedNote.id);

      if (!isMountedRef.current) return;
      setShowPreview(false);
      localStorage.setItem('markdown-show-preview', 'false');

      // 5. Select the new file
      setSelectedNote(newNote);
      setSnapshots([]);
      setTimeMachineIndex(-1);
      setViewMode('latest');
      setRefreshKey(k => k + 1);
      setHasAnyNotes(true);
    } catch (err) {
      console.error('Failed to convert temp note', err);
    }
  };

  const handleSelectNote = async (note: Note) => {
    try {
      await (window as any).electronAPI.requestForceSave();
    } catch (err) {
      console.warn('requestForceSave failed on note select', err);
    }
    if (isMountedRef.current) {
      setSelectedNote(note);
      setTimeMachineIndex(-1);
      // Fetch snapshots
      window.electronAPI.getNoteSnapshots(note.id).then(snaps => {
        if (isMountedRef.current) {
          setSnapshots(snaps);
        }
      });
    }
  };

  const handleTimeMachineNavigate = (direction: 'back' | 'forward' | 'latest') => {
    if (snapshots.length === 0) return;
    
    if (direction === 'latest') {
      setTimeMachineIndex(-1);
    } else if (direction === 'back') {
      setTimeMachineIndex(prev => Math.min(prev + 1, snapshots.length - 1));
    } else if (direction === 'forward') {
      setTimeMachineIndex(prev => Math.max(-1, prev - 1));
    }
  };

  const handleNoteUpdate = (updatedNote: Note) => {
    setSelectedNote(updatedNote);
    // Targeted update: notify sidebar of the single-note change so it can
    // update its local state without a full remount/refresh.
    // We also include hasUnsavedChanges so the Sidebar tracks temp note dirty state.
    if (selectedNote && (
      updatedNote.title !== selectedNote.title ||
      updatedNote.updatedAt !== selectedNote.updatedAt ||
      updatedNote.lastEdited !== selectedNote.lastEdited ||
      updatedNote.hasUnsavedChanges !== selectedNote.hasUnsavedChanges
    )) {
      setSidebarNoteUpdate(updatedNote);
      setTimeout(() => setSidebarNoteUpdate(null), 20);
    }
  };

  const handleSidebarRefresh = () => {
    // Trigger a sidebar refresh without changing the current view.
    // Previously this auto-switched to `archived`/`trash` when the selected
    // note gained those primary tags; that behavior is intentionally removed
    // so that the menu does not jump as a result of tag changes.
    (async () => {
      setSidebarRefreshTrigger(t => t + 1);
    })();
  };

  const handleTempNoteSave = async () => {
    if (!selectedNote?.isTemp || !selectedNote.externalPath) return;
    try {
      const content = await window.electronAPI.loadNote(selectedNote.id);
      const success = await window.electronAPI.writeFileContent(selectedNote.externalPath, content);
      if (success) {
        await window.electronAPI.updateTempNoteState(selectedNote.id, false, !!selectedNote.syncMode);
        setSelectedNote({ ...selectedNote, hasUnsavedChanges: false });
      }
    } catch (err) {
      console.warn('handleTempNoteSave failed', err);
    }
  };

  const handleTempNoteSyncToggle = async () => {
    if (!selectedNote?.isTemp) return;
    const newSyncMode = !selectedNote.syncMode;
    try {
      await window.electronAPI.updateTempNoteState(selectedNote.id, !!selectedNote.hasUnsavedChanges, newSyncMode);
      setSelectedNote({ ...selectedNote, syncMode: newSyncMode });
    } catch (err) {
      console.warn('handleTempNoteSyncToggle failed', err);
    }
  };

  const handleUtilityActionComplete = async (purgedNoteIds?: number[]) => {
    if (purgedNoteIds && selectedNote && purgedNoteIds.includes(selectedNote.id)) {
      setSelectedNote(null);
      setSnapshots([]);
      setTimeMachineIndex(-1);
    }

    setSidebarRefreshTrigger(t => t + 1);
    setRefreshKey(k => k + 1);

    if (purgedNoteIds) {
      try {
        const all = await window.electronAPI.getAllNotes();
        if (isMountedRef.current) setHasAnyNotes(Array.isArray(all) && all.length > 0);
      } catch (e) {
        // ignore
      }
    }
  };

  const handleMonthToggle = (month: number, event: React.MouseEvent) => {
    if (month === CLEAR_MONTHS_SIGNAL && event.type === 'contextmenu') {
      setSelectedMonths(new Set());
      return;
    }
    handleMultiSelect(month, event, selectedMonths, FILTER_MONTHS, setSelectedMonths);
  };

  const handleYearToggle = (year: YearValue, event: React.MouseEvent) => {
    if (year === CLEAR_YEARS_SIGNAL && event.type === 'contextmenu') {
      setSelectedYears(new Set());
      return;
    }
    if (year !== CLEAR_YEARS_SIGNAL) {
      handleMultiSelect(year, event, selectedYears, FILTER_YEARS, setSelectedYears);
    }
  };

  const handleNoteDelete = async (deletedNoteId: number, nextNoteToSelect?: Note | null) => {
    if (selectedNote?.id === deletedNoteId) {
      if (nextNoteToSelect) setSelectedNote(nextNoteToSelect);
      else setSelectedNote(null);
    }
    setRefreshKey(k => k + 1);
    setSidebarRefreshTrigger(t => t + 1);
    // Recompute whether we still have any notes
    try {
      const all = await window.electronAPI.getAllNotes();
      if (isMountedRef.current) setHasAnyNotes(Array.isArray(all) && all.length > 0);
    } catch (e) {
      // ignore
    }
  };

  const handleExportPdf = async (chooseFolder = false) => {
    try {
      const reselect = chooseFolder;
      const saved = localStorage.getItem('pdf-export-folder');
      let folder = saved && !reselect ? saved : null;
      if (!folder) {
        folder = await (window as any).electronAPI.selectExportFolder();
        if (!folder) return; // user cancelled
        localStorage.setItem('pdf-export-folder', folder);
      }

      // Choose element to export: prefer preview when visible
      const previewEl = document.querySelector('.markdown-preview') as HTMLElement | null;
      const textareaEl = document.querySelector('.markdown-textarea') as HTMLTextAreaElement | null;
      const container = showPreview ? (previewEl ?? textareaEl) : (textareaEl ?? previewEl);
      if (!container) return;

      // Create a printable clone. If it's a textarea, render its text into a div that preserves newlines.
      const existingGhost = document.getElementById('pdf-export-ghost');
      if (existingGhost) existingGhost.remove();
      const ghost = document.createElement('div');
      ghost.id = 'pdf-export-ghost';

      const isTextarea = container.tagName === 'TEXTAREA' || container.classList.contains('markdown-textarea');
      if (isTextarea) {
        const ta = container as HTMLTextAreaElement;
        const printable = document.createElement('div');
        printable.className = 'pdf-export-textarea-clone';
        printable.textContent = ta.value;
        printable.style.whiteSpace = 'break-spaces';
        printable.style.wordBreak = 'break-word';
        printable.style.fontFamily = 'inherit';
        printable.style.fontSize = 'inherit';
        printable.style.lineHeight = '1.4';
        printable.style.color = 'black';
        printable.style.background = 'white';
        printable.style.padding = '16px';
        ghost.appendChild(printable);
      } else {
        // clone the node to keep styles
        const clone = (container as HTMLElement).cloneNode(true) as HTMLElement;
        clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
        ghost.appendChild(clone);
      }

      ghost.style.display = 'none';
      document.body.appendChild(ghost);

      // Insert minimal print CSS that shows only the ghost during printing
      const css = `@media print { body > *:not(#pdf-export-ghost) { display: none !important; } #pdf-export-ghost { display: block !important; } }`;
      const styleEl = document.createElement('style');
      styleEl.id = 'pdf-export-style';
      styleEl.appendChild(document.createTextNode(css));
      document.head.appendChild(styleEl);

      // Build filename: YY-MM-DD_<title truncated to 50>.pdf
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const datePart = `${yy}-${mm}-${dd}`;
      const rawTitle = (selectedNote?.title ?? 'Untitled').trim() || 'Untitled';
      const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]+/g, '_');
      const truncated = sanitize(rawTitle).substring(0, 50);
      const fileName = `${datePart}_${truncated}.pdf`;

      const res = await (window as any).electronAPI.exportPdf(folder, fileName);

      // cleanup
      try { const ex = document.getElementById('pdf-export-style'); if (ex) ex.remove(); } catch { /* ignore */ }
      try { const g = document.getElementById('pdf-export-ghost'); if (g) g.remove(); } catch { /* ignore */ }

      if (!res || !res.ok) {
        console.warn('PDF export failed', res?.error);
      } else {
        console.log('Exported PDF to', res.path);
      }
    } catch (err) {
      console.warn('Export PDF error', err);
    }
  };

  const handleExportMd = async (chooseFolder = false) => {
    if (!selectedNote) return;

    try {
      const reselect = chooseFolder;
      const saved = localStorage.getItem('md-export-folder');
      let folder = saved && !reselect ? saved : null;
      if (!folder) {
        folder = await (window as any).electronAPI.selectExportFolder();
        if (!folder) return; // user cancelled
        localStorage.setItem('md-export-folder', folder);
      }

      // Get the content that's currently displayed (timeline version or current file)
      let currentContent: string;
      if (timeMachineIndex >= 0 && snapshots[timeMachineIndex]) {
        currentContent = snapshots[timeMachineIndex].content;
      } else {
        // Load current content from file
        currentContent = await (window as any).electronAPI.loadNote(selectedNote.id);
      }

      // Build filename: YY-MM-DD_<title truncated to 50>.md
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const datePart = `${yy}-${mm}-${dd}`;
      const rawTitle = (selectedNote.title ?? 'Untitled').trim() || 'Untitled';
      const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]+/g, '_');
      const truncated = sanitize(rawTitle).substring(0, 50);
      const fileName = `${datePart}_${truncated}.md`;

      const res = await (window as any).electronAPI.exportMd(folder, fileName, currentContent);

      if (!res || !res.ok) {
        console.warn('MD export failed', res?.error);
      } else {
        console.log('Exported MD to', res.path);
      }
    } catch (err) {
      console.warn('Export MD error', err);
    }
  };

  // Utilities
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  // When user drags the sidebar, we proportionally adjust tag/suggested to keep ratioRef.
  useEffect(() => {
    if (!isDraggingSidebar) return;

    const handleMove = (e: MouseEvent) => {
      if (!appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();
      // clamp sidebar between minimum and something reasonable
      const maxSidebar = Math.max(SIDEBAR_MIN, rect.width - (TAG_MIN + SUGGESTED_MIN + UTILITY_FIXED + DIVIDER_W * 3));
      const newSidebar = clamp(Math.round(e.clientX - rect.left), SIDEBAR_MIN, maxSidebar);

      const availableMain = rect.width - newSidebar - (DIVIDER_W * 3) - UTILITY_FIXED;
      if (availableMain <= 0) {
        setSidebarWidth(newSidebar);
        return;
      }

      // Preserve the last user ratio (ratioRef); compute new widths from it but enforce minima
      const minSum = TAG_MIN + SUGGESTED_MIN;
      let newTag = Math.round(ratioRef.current * availableMain);
      let newSug = availableMain - newTag;

      if (newTag < TAG_MIN) {
        newTag = TAG_MIN;
        newSug = Math.max(SUGGESTED_MIN, availableMain - newTag);
      }
      if (newSug < SUGGESTED_MIN) {
        newSug = SUGGESTED_MIN;
        newTag = Math.max(TAG_MIN, availableMain - newSug);
      }

      setSidebarWidth(newSidebar);
      setTagWidth(newTag);
      setSuggestedWidth(newSug);
    };

    const handleUp = () => {
      setIsDraggingSidebar(false);
      localStorage.setItem('sidebar-width', String(sidebarWidth));
      localStorage.setItem('tag-input-width', String(tagWidth));
      localStorage.setItem('tag-suggestions-width', String(suggestedWidth));
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingSidebar]);

  // Left divider drag (between tag and suggested) � update ratioRef on drag end.
  useEffect(() => {
    if (!isDraggingLeftDivider) return;

    const handleMove = (e: MouseEvent) => {
      if (!appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();
      const mainLeft = rect.left + sidebarWidth + DIVIDER_W;
      const mainRight = rect.right - (UTILITY_FIXED + DIVIDER_W * 2);
      const availableMain = Math.max(0, Math.round(mainRight - mainLeft));
      let newTag = clamp(Math.round(e.clientX - mainLeft), TAG_MIN, Math.max(TAG_MIN, availableMain - SUGGESTED_MIN));
      let newSug = Math.max(SUGGESTED_MIN, availableMain - newTag);

      // If availableMain smaller than minima, keep minima as best-effort.
      if (availableMain < TAG_MIN + SUGGESTED_MIN) {
        // distribute with priorities: keep tag at least TAG_MIN
        newTag = clamp(newTag, TAG_MIN, Math.max(TAG_MIN, availableMain - SUGGESTED_MIN));
        newSug = availableMain - newTag;
      }

      setTagWidth(newTag);
      setSuggestedWidth(newSug);
    };

    const handleUp = () => {
      setIsDraggingLeftDivider(false);
      // update ratioRef to the user's new ratio
      ratioRef.current = tagWidth / Math.max(1, tagWidth + suggestedWidth);
      localStorage.setItem('tag-input-width', String(tagWidth));
      localStorage.setItem('tag-suggestions-width', String(suggestedWidth));
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingLeftDivider]);

  // Window resize: preserve the last user ratio (ratioRef) and adjust tag/suggested accordingly.
  useEffect(() => {
    const handleResize = () => {
      if (!appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();

      // compute available width for tag+suggested given current sidebar and fixed utility
      const availableMain = rect.width - sidebarWidth - (DIVIDER_W * 3) - UTILITY_FIXED;
      if (availableMain <= 0) return;

      const minSum = TAG_MIN + SUGGESTED_MIN;

      // If availableMain is large enough, use the stored ratio to compute widths.
      if (availableMain >= minSum) {
        let newTag = Math.round(ratioRef.current * availableMain);
        let newSug = availableMain - newTag;

        // enforce minima
        if (newTag < TAG_MIN) {
          newTag = TAG_MIN;
          newSug = Math.max(SUGGESTED_MIN, availableMain - newTag);
        }
        if (newSug < SUGGESTED_MIN) {
          newSug = SUGGESTED_MIN;
          newTag = Math.max(TAG_MIN, availableMain - newSug);
        }

        setTagWidth(newTag);
        setSuggestedWidth(newSug);
        return;
      }

      // If we don't have enough space for minima, fall back to minima distribution:
      setTagWidth(TAG_MIN);
      setSuggestedWidth(Math.max(SUGGESTED_MIN, availableMain - TAG_MIN));
    };

    window.addEventListener('resize', handleResize);
    // run once to ensure values consistent on load
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarWidth]);

  // Save ratio whenever user updates the widths programmatically (keeps ratioRef reasonably up-to-date)
  useEffect(() => {
    ratioRef.current = tagWidth / Math.max(1, tagWidth + suggestedWidth);
  }, [tagWidth, suggestedWidth]);

  // Grid columns and areas
  const gridTemplateColumns = `${sidebarWidth}px ${DIVIDER_W}px ${tagWidth}px ${DIVIDER_W}px ${suggestedWidth}px ${DIVIDER_W}px ${UTILITY_FIXED}px`;
  const gridTemplateRows = 'auto 1fr';
  const gridTemplateAreas = `
    "sidebar d-sidebar taginput d-left suggested d-right utility"
    "sidebar d-sidebar viewer  viewer    viewer    viewer    viewer"
  `;

  return (
    <div
      className="app app-grid"
      ref={appRef}
      onPointerDown={handleAppPointerDown}
      style={{
        gridTemplateColumns,
        gridTemplateRows,
        gridTemplateAreas,
        position: 'relative',
        minWidth: APP_MIN_WIDTH,
        minHeight: APP_MIN_HEIGHT,
      }}
    >
      {/* Sidebar */}
      <div className="sidebar" style={{ gridArea: 'sidebar' }}>
        <Sidebar
          key={refreshKey}
          hasAnyNotes={hasAnyNotes}
          selectedNote={selectedNote}
          onSelectNote={handleSelectNote}
          refreshTrigger={sidebarRefreshTrigger}
          noteUpdate={sidebarNoteUpdate}
          selectedMonths={selectedMonths}
          selectedYears={selectedYears}
          onMonthToggle={handleMonthToggle}
          onYearToggle={handleYearToggle}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          width={sidebarWidth}
          onNoteDelete={handleNoteDelete}
          onNotesUpdate={handleSidebarRefresh}
        />
      </div>

      {/* Sidebar divider (draggable) */}
      <div
        className="grid-divider divider-sidebar"
        style={{ gridArea: 'd-sidebar' }}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDraggingSidebar(true);
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />

      {/* Tag input */}
      <div className="tag-input-grid" style={{ gridArea: 'taginput' }}>
          <TagInput 
            note={selectedNote} 
            onTagsChanged={handleSidebarRefresh} 
            refreshTrigger={sidebarRefreshTrigger} 
            hasAnyNotes={hasAnyNotes} 
            onConvertTempNote={handleConvertTempNote}
          />
      </div>

      {/* Left divider between tag and suggested (draggable) */}
      <div
        className="grid-divider divider-left"
        style={{ gridArea: 'd-left' }}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDraggingLeftDivider(true);
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize suggested tags"
      />

      {/* Suggested */}
      <div className="suggested-grid" style={{ gridArea: 'suggested' }}>
        <SuggestedPanel
          note={selectedNote}
          width={suggestedWidth}
          onTagsChanged={handleSidebarRefresh}
          refreshTrigger={sidebarRefreshTrigger}
          hasAnyNotes={hasAnyNotes}
        />
      </div>

      {/* Right divider (fixed, not draggable) */}
      <div
        className="grid-divider divider-right"
        style={{ gridArea: 'd-right' }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Fixed separator"
      />

      {/* Utility fixed */}
      <div className="utility-grid" style={{ gridArea: 'utility' }}>
        <Utility
          onActionComplete={handleUtilityActionComplete}
          onExportPdf={handleExportPdf}
          onExportMd={handleExportMd}
          autoSaveEnabled={autoSaveEnabled}
          onToggleAutoSave={() => setAutoSaveEnabled(!autoSaveEnabled)}
          hasSelectedNote={selectedNote != null}
          isTempNote={!!selectedNote?.isTemp}
          tempHasUnsavedChanges={!!selectedNote?.hasUnsavedChanges}
          tempSyncMode={!!selectedNote?.syncMode}
          onTempSave={handleTempNoteSave}
          onTempSyncToggle={handleTempNoteSyncToggle}
          logBase={logBase}
          onLogBaseChange={setLogBase}
        />
      </div>

      {/* Viewer/editor */}
      <div className="viewer" style={{ gridArea: 'viewer' }}>
        <MarkdownEditor
          note={selectedNote}
          onNoteUpdate={handleNoteUpdate}
          showPreview={showPreview}
          onTogglePreview={(next: boolean) => togglePreview(next)}
          hasAnyNotes={hasAnyNotes}
          autoSaveEnabled={autoSaveEnabled}
          timeMachineSnapshotContent={timeMachineIndex >= 0 && snapshots[timeMachineIndex] ? snapshots[timeMachineIndex].content : null}
          onTimeMachineInterrupt={() => {
            if (timeMachineIndex !== -1) {
              setTimeMachineIndex(-1);
            }
          }}
          timelineProps={selectedNote ? {
            snapshots,
            timeMachineIndex,
            logBase,
            onNavigate: (index: number) => setTimeMachineIndex(index),
            onDeleteSnapshot: async (id: number) => {
              await window.electronAPI.deleteNoteSnapshot(id);
              const snaps = await window.electronAPI.getNoteSnapshots(selectedNote.id);
              if (isMountedRef.current) setSnapshots(snaps);
            },
            onManualSnapshot: () => {
              document.dispatchEvent(new CustomEvent('request-manual-snapshot'));
            }
          } : undefined}
        />
      </div>
    </div>
  );
};
