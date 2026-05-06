import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { Node } from 'unist';
import {
  ArchivedParagraphHistoryEntry,
  EditHistoryEntry,
  EditSnapshot,
  Note,
  NoteEditHistoryState,
  RecentEditHistoryEntry,
} from '../shared/types';
import { FixedFocusEditor, ceGetSelection, ceSetSelection, ceGetText } from './FixedFocusViewport';
import './MarkdownEditor.scss';
import './MarkdownThemes.scss';

type HighlightColorKey = 'caret' | 'selection' | 'leading' | 'trailing' | 'background' | 'topBackground' | 'bottomBackground';

type HighlightColors = Record<HighlightColorKey, string>;

type FixedFocusHighlightColors = HighlightColors & { grid: string };
type HistoryBoundaryReason = 'space' | 'enter' | 'delete-boundary' | 'paste' | 'delete-selection' | 'tab';

const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {
  recent: [],
  archived: [],
  redo: [],
  storedChangeCount: 0,
};

const DEFAULT_HIGHLIGHT_COLORS: HighlightColors = {
  caret: 'rgba(0, 0, 0, 0.3)',
  selection: 'rgba(0, 0, 0, 0.1)',
  leading: 'rgba(0, 0, 0, 0)',
  trailing: 'rgba(0, 0, 0, 0)',
  background: 'rgba(0, 0, 0, 0.05)',
  topBackground: 'rgba(0, 0, 0, 0.08)',
  bottomBackground: 'rgba(0, 0, 0, 0.08)',
};

const HIGHLIGHT_COLOR_STORAGE_KEYS: Record<HighlightColorKey, string> = {
  caret: 'markdown-editor-highlight-caret',
  selection: 'markdown-editor-highlight-selection',
  leading: 'markdown-editor-highlight-leading',
  trailing: 'markdown-editor-highlight-trailing',
  background: 'markdown-editor-highlight-background',
  topBackground: 'markdown-editor-highlight-top-background',
  bottomBackground: 'markdown-editor-highlight-bottom-background',
};

const HIGHLIGHT_COLOR_LABELS: Record<HighlightColorKey, string> = {
  caret: 'C',
  selection: 'S',
  leading: 'L',
  trailing: 'T',
  background: 'B',
  topBackground: '↑',
  bottomBackground: '↓',
};

const HIGHLIGHT_COLOR_TITLES: Record<HighlightColorKey, string> = {
  caret: 'Caret box color',
  selection: 'Selection box color',
  leading: 'Leading space box color',
  trailing: 'Trailing space box color',
  background: 'Regular box background color',
  topBackground: 'Top section regular box background color',
  bottomBackground: 'Bottom section regular box background color',
};

function toOpaqueColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim();

  const rgbOrRgbaMatch = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgbOrRgbaMatch) {
    const red = Math.max(0, Math.min(255, Number(rgbOrRgbaMatch[1])));
    const green = Math.max(0, Math.min(255, Number(rgbOrRgbaMatch[2])));
    const blue = Math.max(0, Math.min(255, Number(rgbOrRgbaMatch[3])));
    return `rgb(${red}, ${green}, ${blue})`;
  }

  const hexMatch = trimmed.match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgb(${red}, ${green}, ${blue})`;
  }

  return null;
}

function normalizeHighlightColorInput(input: string): string | null {
  const trimmed = input.trim();
  const hexMatch = trimmed.match(/^#([0-9a-fA-F]{8})$/);
  if (hexMatch) {
    return `#${hexMatch[1].toUpperCase()}`;
  }

  const tupleSource = trimmed.startsWith('rgba(') && trimmed.endsWith(')')
    ? trimmed.slice(5, -1)
    : trimmed.startsWith('(') && trimmed.endsWith(')')
      ? trimmed.slice(1, -1)
      : trimmed;
  const tupleMatch = tupleSource.match(/^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*$/);
  if (!tupleMatch) return null;

  const red = Number(tupleMatch[1]);
  const green = Number(tupleMatch[2]);
  const blue = Number(tupleMatch[3]);
  const alpha = Number(tupleMatch[4]);
  if (
    !Number.isFinite(red) || red < 0 || red > 255 ||
    !Number.isFinite(green) || green < 0 || green > 255 ||
    !Number.isFinite(blue) || blue < 0 || blue > 255 ||
    !Number.isFinite(alpha) || alpha < 0 || alpha > 1
  ) {
    return null;
  }

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function parseHighlightColor(color: string): { red: number; green: number; blue: number; alpha: number } | null {
  const normalized = normalizeHighlightColorInput(color);
  if (!normalized) return null;

  if (normalized.startsWith('#')) {
    return {
      red: Number.parseInt(normalized.slice(1, 3), 16),
      green: Number.parseInt(normalized.slice(3, 5), 16),
      blue: Number.parseInt(normalized.slice(5, 7), 16),
      alpha: Number.parseInt(normalized.slice(7, 9), 16) / 255,
    };
  }

  const rgbaMatch = normalized.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!rgbaMatch) return null;
  return {
    red: Number(rgbaMatch[1]),
    green: Number(rgbaMatch[2]),
    blue: Number(rgbaMatch[3]),
    alpha: Number(rgbaMatch[4]),
  };
}

function getHighlightLabelColor(color: string): string {
  const parsed = parseHighlightColor(color);
  if (!parsed) return '#111';
  const blendFactor = parsed.alpha;
  const blendedRed = (parsed.red * blendFactor) + (255 * (1 - blendFactor));
  const blendedGreen = (parsed.green * blendFactor) + (255 * (1 - blendFactor));
  const blendedBlue = (parsed.blue * blendFactor) + (255 * (1 - blendFactor));
  const luminance = ((0.299 * blendedRed) + (0.587 * blendedGreen) + (0.114 * blendedBlue)) / 255;
  return luminance > 0.65 ? '#111' : '#fff';
}

function cloneEmptyEditHistoryState(): NoteEditHistoryState {
  return {
    recent: [],
    archived: [],
    redo: [],
    storedChangeCount: 0,
  };
}

function countLineBreaks(text: string): number {
  return (text.match(/\n/g) || []).length;
}

function splitTextIntoLines(text: string): string[] {
  return text.split('\n');
}

function createArchivedParagraphEntry(entry: RecentEditHistoryEntry): ArchivedParagraphHistoryEntry | null {
  if (countLineBreaks(entry.after.content) <= countLineBreaks(entry.before.content)) return null;

  const beforeLines = splitTextIntoLines(entry.before.content);
  const afterLines = splitTextIntoLines(entry.after.content);

  let startLine = 0;
  while (
    startLine < beforeLines.length
    && startLine < afterLines.length
    && beforeLines[startLine] === afterLines[startLine]
  ) {
    startLine += 1;
  }

  let commonSuffix = 0;
  while (
    commonSuffix < (beforeLines.length - startLine)
    && commonSuffix < (afterLines.length - startLine)
    && beforeLines[beforeLines.length - 1 - commonSuffix] === afterLines[afterLines.length - 1 - commonSuffix]
  ) {
    commonSuffix += 1;
  }

  const beforeEndLine = beforeLines.length - commonSuffix;
  const afterEndLine = afterLines.length - commonSuffix;
  if (beforeEndLine < startLine || afterEndLine < startLine) return null;

  return {
    storage: 'archived',
    kind: 'paragraph',
    reason: entry.reason,
    startLine,
    beforeEndLine,
    afterEndLine,
    beforeLines: beforeLines.slice(startLine, beforeEndLine),
    afterLines: afterLines.slice(startLine, afterEndLine),
    beforeSelection: {
      selectionStart: entry.before.selectionStart,
      selectionEnd: entry.before.selectionEnd,
    },
    afterSelection: {
      selectionStart: entry.after.selectionStart,
      selectionEnd: entry.after.selectionEnd,
    },
    timestamp: entry.timestamp,
  };
}

function addRecentHistoryEntry(history: NoteEditHistoryState, entry: RecentEditHistoryEntry): NoteEditHistoryState {
  const nextRecent = [...history.recent, entry];
  const nextArchived = [...history.archived];
  if (nextRecent.length > 10) {
    const shifted = nextRecent.shift();
    if (shifted) {
      const archivedEntry = createArchivedParagraphEntry(shifted);
      if (archivedEntry) {
        nextArchived.push(archivedEntry);
      }
    }
  }

  return {
    recent: nextRecent,
    archived: nextArchived,
    redo: [],
    storedChangeCount: nextRecent.length + nextArchived.length,
  };
}

function replaceLineRange(lines: string[], startLine: number, endLineExclusive: number, replacement: string[]): string[] {
  return [
    ...lines.slice(0, startLine),
    ...replacement,
    ...lines.slice(endLineExclusive),
  ];
}

function applyHistoryEntry(currentContent: string, entry: EditHistoryEntry, direction: 'undo' | 'redo'): EditSnapshot {
  if (entry.kind === 'full') {
    return direction === 'undo' ? entry.before : entry.after;
  }

  const currentLines = splitTextIntoLines(currentContent);
  if (direction === 'undo') {
    return {
      content: replaceLineRange(currentLines, entry.startLine, entry.afterEndLine, entry.beforeLines).join('\n'),
      selectionStart: entry.beforeSelection.selectionStart,
      selectionEnd: entry.beforeSelection.selectionEnd,
    };
  }

  return {
    content: replaceLineRange(currentLines, entry.startLine, entry.beforeEndLine, entry.afterLines).join('\n'),
    selectionStart: entry.afterSelection.selectionStart,
    selectionEnd: entry.afterSelection.selectionEnd,
  };
}

interface MarkdownEditorProps {
  note: Note | null;
  onNoteUpdate?: (note: Note) => void;
  showPreview: boolean;
  onTogglePreview: (next: boolean) => void;
  hasAnyNotes?: boolean;
  onEditHistoryCountChange?: (count: number) => void;
  historyResetSignal?: number;
}

type EditState = {
  selectionStart: number;
  scrollTop: number;
  viewportStartRow?: number;
};

const EDIT_STATE_KEY_PREFIX = 'md-edit-state-';

const remarkSourcePos = () => {
  return (tree: Node) => {
    visit(tree, (node: any) => {
      if (node.position && node.position.start) {
        node.data = node.data || {};
        node.data.hProperties = node.data.hProperties || {};
        node.data.hProperties['data-line'] = node.position.start.line - 1; // 0-based to match logicalLineIndex
      }
    });
  };
};

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  note,
  onNoteUpdate,
  showPreview,
  onTogglePreview,
  hasAnyNotes,
  onEditHistoryCountChange,
  historyResetSignal = 0,
}) => {
  const [content, setContent] = useState('');
  const [caretPos, setCaretPos] = useState(0);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [editViewportStartRow, setEditViewportStartRow] = useState(0);
  const [editorViewportSize, setEditorViewportSize] = useState({ width: 0, height: 0 });
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [fixedFocusTopRowCount, setFixedFocusTopRowCount] = useState(3);
  const [fixedFocusBottomRowCount, setFixedFocusBottomRowCount] = useState(3);
  const isComposingRef = useRef(false);
  const [isOnFirstLine, setIsOnFirstLine] = useState(false);

  // View (preview) settings
  const [viewStyle, setViewStyle] = useState<string>('modern');
  const [viewFontSize, setViewFontSize] = useState<string>('m');
  const [viewSpacing, setViewSpacing] = useState<string>('cozy');

  // Editor settings (separate from view)
  const [editorStyle, setEditorStyle] = useState<string>('syne');
  const [editorFontSize, setEditorFontSize] = useState<string>('m');
  const [editorSpacing, setEditorSpacing] = useState<string>('cozy');
  const [highlightColors, setHighlightColors] = useState<HighlightColors>(DEFAULT_HIGHLIGHT_COLORS);
  const [editorPanelGridColor, setEditorPanelGridColor] = useState<string>('rgb(255, 255, 255)');
  const [activeHighlightColorKey, setActiveHighlightColorKey] = useState<HighlightColorKey | null>(null);
  const [highlightColorInput, setHighlightColorInput] = useState('');
  const [highlightColorInputInvalid, setHighlightColorInputInvalid] = useState(false);

  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const [editHistoryCount, setEditHistoryCount] = useState(0);
  const textareaRef = useRef<HTMLDivElement | null>(null);
  const editorContentRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef('');
  const lastSavedTitleRef = useRef('');
  const currentNoteIdRef = useRef<number | null>(null);

  // Short-lived UI timeouts that should be cleared on unmount
  const loadNoteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRestoreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce for selection save
  const selectionSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track all transient timeouts so they can be cleared on unmount
  const pendingTimeoutsRef = useRef<number[]>([]);
  const programmaticInsertRef = useRef(false);
  const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());
  const lastCommittedSnapshotRef = useRef<EditSnapshot>({ content: '', selectionStart: 0, selectionEnd: 0 });
  const pendingHistoryBoundaryRef = useRef<{ reason: HistoryBoundaryReason; before: EditSnapshot } | null>(null);
  // Captures edit position when entering view mode for fast restoration (no async DB round-trip).
  const savedEditPositionRef = useRef<{ selectionStart: number; selectionEnd: number; viewportStartRow: number } | null>(null);
  // Latest wrapped row count reported by FixedFocusEditor, used for edit→view scroll sync.
  const totalWrappedRowsRef = useRef(0);
  // Always-current mirrors of state values, safe to read inside stale-closure effects.
  const liveSelectionStartRef = useRef(0);
  const liveSelectionEndRef = useRef(0);
  const liveViewportStartRowRef = useRef(0);
  const liveViewportTopSourceLineRef = useRef(0);

  const scheduleTimeout = (cb: () => void, ms: number) => {
    const id = window.setTimeout(cb, ms);
    pendingTimeoutsRef.current.push(id as unknown as number);
    return id;
  };

  const setTextareaSelection = useCallback((start: number, end = start) => {
    const el = textareaRef.current;
    if (!el) return;
    ceSetSelection(el, start, end);
    setSelectionStart(start);
    setSelectionEnd(end);
    setCaretPos(end);
  }, []);

  const buildSnapshot = useCallback((snapshotContent: string, start: number, end: number): EditSnapshot => ({
    content: snapshotContent,
    selectionStart: start,
    selectionEnd: end,
  }), []);

  const persistEditHistory = useCallback(async (noteId: number, history: NoteEditHistoryState) => {
    try {
      await window.electronAPI.saveNoteEditHistory(noteId, history);
    } catch (err) {
      console.warn('saveNoteEditHistory failed', err);
    }
  }, []);

  const replaceEditHistory = useCallback((nextHistory: NoteEditHistoryState) => {
    editHistoryRef.current = nextHistory;
    setEditHistoryCount(nextHistory.storedChangeCount);
    if (currentNoteIdRef.current != null) {
      void persistEditHistory(currentNoteIdRef.current, nextHistory);
    }
  }, [persistEditHistory]);

  const recordHistoryEntry = useCallback((reason: HistoryBoundaryReason, before: EditSnapshot, after: EditSnapshot) => {
    if (!note || before.content === after.content) {
      lastCommittedSnapshotRef.current = after;
      return;
    }

    const nextHistory = addRecentHistoryEntry(editHistoryRef.current, {
      storage: 'recent',
      kind: 'full',
      reason,
      before,
      after,
      timestamp: new Date().toISOString(),
    });
    replaceEditHistory(nextHistory);
    lastCommittedSnapshotRef.current = after;
  }, [note, replaceEditHistory]);

  const syncSelectionState = useCallback((start: number, end: number) => {
    setSelectionStart(start);
    setSelectionEnd(end);
    setCaretPos(end);
    liveSelectionStartRef.current = start;
    liveSelectionEndRef.current = end;
  }, []);

  // Keep live refs up-to-date whenever state changes (covers setTextareaSelection paths).
  useEffect(() => { liveSelectionStartRef.current = selectionStart; }, [selectionStart]);
  useEffect(() => { liveSelectionEndRef.current = selectionEnd; }, [selectionEnd]);
  useEffect(() => { liveViewportStartRowRef.current = editViewportStartRow; }, [editViewportStartRow]);

  useEffect(() => {
    onEditHistoryCountChange?.(editHistoryCount);
  }, [editHistoryCount, onEditHistoryCountChange]);

  useEffect(() => {
    if (!note) {
      editHistoryRef.current = cloneEmptyEditHistoryState();
      setEditHistoryCount(0);
      pendingHistoryBoundaryRef.current = null;
      lastCommittedSnapshotRef.current = { content: '', selectionStart: 0, selectionEnd: 0 };
      return;
    }

    const noteId = note.id;
    let isCancelled = false;
    void window.electronAPI.getNoteEditHistory(noteId).then((history) => {
      if (isCancelled) return;
      const normalizedHistory = history ?? cloneEmptyEditHistoryState();
      editHistoryRef.current = normalizedHistory;
      setEditHistoryCount(normalizedHistory.storedChangeCount ?? 0);
    }).catch((err) => {
      console.warn('getNoteEditHistory failed', err);
      if (isCancelled) return;
      editHistoryRef.current = cloneEmptyEditHistoryState();
      setEditHistoryCount(0);
    });

    return () => {
      isCancelled = true;
    };
  }, [note]);

  useEffect(() => {
    editHistoryRef.current = cloneEmptyEditHistoryState();
    setEditHistoryCount(0);
    pendingHistoryBoundaryRef.current = null;
    lastCommittedSnapshotRef.current = buildSnapshot(content, selectionStart, selectionEnd);
  }, [buildSnapshot, historyResetSignal]);

  useEffect(() => {
    if (lastCommittedSnapshotRef.current.content === content) {
      lastCommittedSnapshotRef.current = buildSnapshot(content, selectionStart, selectionEnd);
    }
  }, [buildSnapshot, content, selectionEnd, selectionStart]);

  // Editor style options — Syne and Red Hat (display labels simplified).
  const editorStyleOptions: { key: string; label: string; family: string }[] = [
    { key: 'syne', label: 'Syne', family: "'Syne Mono', 'Menlo', 'Monaco', monospace" },
    { key: 'redhat', label: 'Red Hat', family: "'Red Hat Mono', 'Menlo', 'Monaco', monospace" },
  ];

  const getEditorFamily = (styleKey: string): string => {
    const opt = editorStyleOptions.find(o => o.key === styleKey);
    return opt ? opt.family : editorStyleOptions[0].family;
  };

  const getPrimaryFamily = (fontFamilyValue: string | null | undefined): string | null => {
    if (!fontFamilyValue) return null;
    const first = fontFamilyValue.split(',')[0].trim();
    return first.replace(/^['"]|['"]$/g, '') || null;
  };

  const normalizeForChecks = (s: string) => s || '';
  const countLeadingSpaces = (s: string) => {
    const m = (s || '').match(/^ */);
    return m ? m[0].length : 0;
  };
  const stripTrailingWhitespace = (s: string) => {
    if (!s) return s;
    return s.replace(/[ \t]+$/, '');
  };

  // Helpers to persist per-note edit state
  const getEditStateKey = (noteId: number) => `${EDIT_STATE_KEY_PREFIX}${noteId}`;

  const saveEditState = async (noteId: number) => {
    const el = textareaRef.current;
    const editorContent = editorContentRef.current;
    if (!editorContent) return;
    // Use live selection if element is focused, otherwise fall back to React state
    const liveSel = el ? (ceGetSelection(el) ?? { start: selectionStart, end: selectionEnd }) : { start: selectionStart, end: selectionEnd };
    const state: EditState = {
      selectionStart: liveSel.start,
      scrollTop: editViewportStartRow,
      viewportStartRow: editViewportStartRow,
    };
    try {
      // persist to DB via preload API (best-effort)
      try {
        await window.electronAPI.saveNoteUiState(noteId, {
          cursorPos: state.selectionStart,
          scrollTop: state.scrollTop,
          progressEdit: showPreview
            ? (editorContent.scrollHeight > editorContent.clientHeight ? editorContent.scrollTop / (editorContent.scrollHeight - editorContent.clientHeight) : 0)
            : 0,
        });
      } catch (err) { console.warn('saveNoteUiState failed', err); }
    } catch {
      // ignore
    }

    try {
      localStorage.setItem(getEditStateKey(noteId), JSON.stringify(state));
    } catch {
      // ignore storage errors
    }
  };

  const loadEditState = async (noteId: number): Promise<EditState | null> => {
    try {
      try {
        const st = await window.electronAPI.getNoteUiState(noteId);
        if (st && (st.cursorPos != null || st.scrollTop != null)) {
          return {
            selectionStart: (st.cursorPos ?? 0),
            scrollTop: (st.scrollTop ?? 0),
            viewportStartRow: (st.scrollTop ?? 0),
          };
        }
      } catch (err) { console.warn('loadNote failed to provide content', err); }

      const raw = localStorage.getItem(getEditStateKey(noteId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as EditState;
      return parsed;
    } catch {
      return null;
    }
  };

  // When entering view mode: snapshot edit position, collapse selection state (avoids flash
  // on return), persist to DB, and sync view scrollTop to the edit viewport position.
  // When returning to edit mode: restore from snapshot (fast, no async round-trip) if available,
  // otherwise load from DB (note was first opened in view mode).
  useEffect(() => {
    if (showPreview) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      // Capture the full selection via live refs (immune to stale closure).
      savedEditPositionRef.current = {
        selectionStart: liveSelectionStartRef.current,
        selectionEnd: liveSelectionEndRef.current,
        viewportStartRow: liveViewportStartRowRef.current,
      };
      // Collapse to caret before unmounting FixedFocusEditor.  This is critical:
      // FixedFocusEditor's caret/viewport sync effect early-returns when
      // selectionStart !== selectionEnd, which prevents lastCaretViewportOffsetRef
      // from being seeded on the first render after remount.  Without the correct
      // offset, the wrapWidthJustChanged reanchor (fired by ResizeObserver when the
      // container becomes visible) snaps the viewport to caretRow instead of the
      // saved position.
      const liveEnd = liveSelectionEndRef.current;
      setSelectionStart(liveEnd);
      setSelectionEnd(liveEnd);
      setCaretPos(liveEnd);
      // Persist to DB / localStorage.
      if (note?.id != null) void saveEditState(note.id);
    } else {
      // Returning to edit mode.
      if (previewRestoreTimeoutRef.current) {
        clearTimeout(previewRestoreTimeoutRef.current);
        previewRestoreTimeoutRef.current = null;
      }
      const saved = savedEditPositionRef.current;
      if (saved) {
        // Step 1: restore collapsed caret + viewport.  selectionStart === selectionEnd
        // is required so FixedFocusEditor's sync effect runs (not early-returned) and
        // seeds lastCaretViewportOffsetRef before wrapWidthJustChanged fires.
        setSelectionStart(saved.selectionEnd);
        setSelectionEnd(saved.selectionEnd);
        setCaretPos(saved.selectionEnd);
        setEditViewportStartRow(saved.viewportStartRow);
        // Step 2: restore full selection range after focus + viewport have settled.
        // The focus timeout fires at ~10 ms; 30 ms gives the ResizeObserver reanchor
        // time to complete so the viewport is stable before we expand the selection.
        if (saved.selectionStart !== saved.selectionEnd) {
          scheduleTimeout(() => {
            setSelectionStart(saved.selectionStart);
            setSelectionEnd(saved.selectionEnd);
            setCaretPos(saved.selectionEnd);
          }, 30);
        }
      } else {
        // Note was first opened in view mode — load saved state from DB.
        previewRestoreTimeoutRef.current = scheduleTimeout(async () => {
          if (!note) return;
          const st = await loadEditState(note.id);
          if (st) {
            setSelectionStart(st.selectionStart);
            setSelectionEnd(st.selectionStart);
            setCaretPos(st.selectionStart);
            setEditViewportStartRow(st.viewportStartRow ?? 0);
          }
        }, 0) as unknown as ReturnType<typeof setTimeout>;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview]);

  // Synchronously update the preview scroll position before the browser paints,
  // entirely eliminating the flash of the previous/incorrect scroll location.
  useLayoutEffect(() => {
    if (showPreview) {
      const editorContent = editorContentRef.current;
      const totalRows = Math.max(1, totalWrappedRowsRef.current);
      if (!editorContent) return;
      
      const targetLine = liveViewportTopSourceLineRef.current;
      const elements = Array.from(editorContent.querySelectorAll('[data-line]'));
      let targetElement: Element | null = null;
      let minDiff = Infinity;
      
      for (const el of elements) {
        const lineStr = el.getAttribute('data-line');
        if (lineStr) {
          const line = parseInt(lineStr, 10);
          if (line <= targetLine) {
            const diff = targetLine - line;
            if (diff < minDiff) {
              minDiff = diff;
              targetElement = el;
            }
          }
        }
      }

      if (targetElement && targetLine > 0) {
        const topDiff = targetElement.getBoundingClientRect().top - editorContent.getBoundingClientRect().top;
        editorContent.scrollTop = editorContent.scrollTop + topDiff;
      } else if (targetLine === 0) {
        editorContent.scrollTop = 0;
      } else {
        // Fallback to ratio
        const visibleRows = editorContent.clientHeight / 24; 
        const scrollableRows = Math.max(1, totalRows - visibleRows);
        const ratio = Math.min(1, liveViewportStartRowRef.current / scrollableRows);
        editorContent.scrollTop = ratio * Math.max(0, editorContent.scrollHeight - editorContent.clientHeight);
      }
    }
  }, [showPreview]);

  // Load note content when note changes
  useEffect(() => {
    if (note) {
      if (currentNoteIdRef.current === note.id) {
        lastSavedTitleRef.current = note.title;
        return;
      }

      currentNoteIdRef.current = note.id;
      savedEditPositionRef.current = null; // clear cached position so DB is loaded for this note
      window.electronAPI.loadNote(note.id).then(noteContent => {
        lastSavedContentRef.current = noteContent;
        setContent(noteContent);
        pendingHistoryBoundaryRef.current = null;
        lastCommittedSnapshotRef.current = { content: noteContent, selectionStart: 0, selectionEnd: 0 };
        lastSavedTitleRef.current = note.title;
        setEditViewportStartRow(0);
        setCaretPos(0);
        setSelectionStart(0);
        setSelectionEnd(0);

        // Focus & position cursor for edit mode
        if (!showPreview) {
          if (loadNoteTimeoutRef.current) {
            clearTimeout(loadNoteTimeoutRef.current);
            loadNoteTimeoutRef.current = null;
          }
          loadNoteTimeoutRef.current = scheduleTimeout(async () => {
            const textarea = textareaRef.current;
            const editorContent = editorContentRef.current;
            if (textarea) {
              // restore edit state if available
              const st = await loadEditState(note.id);
              if (st) {
                textarea.focus();
                setTextareaSelection(st.selectionStart, st.selectionStart);
                setEditViewportStartRow(st.viewportStartRow ?? st.scrollTop ?? 0);
                if (editorContent && showPreview) {
                  editorContent.scrollTop = st.scrollTop;
                }
              } else {
                // default behavior: put cursor at end or after '# '
                textarea.focus();
                if (noteContent === '# ') {
                  setTextareaSelection(2, 2);
                } else {
                  setTextareaSelection((noteContent || '').length, (noteContent || '').length);
                }
              }
              autosizeTextarea(textarea);
              ensureCaretVisible();
            }
          }, 10) as unknown as ReturnType<typeof setTimeout>;
        }
      }).catch(err => {
        console.warn('loadNote failed', err);
      });
    } else {
      setContent('');
      lastSavedContentRef.current = '';
      lastSavedTitleRef.current = '';
      currentNoteIdRef.current = null;
      pendingHistoryBoundaryRef.current = null;
      savedEditPositionRef.current = null;
      lastCommittedSnapshotRef.current = { content: '', selectionStart: 0, selectionEnd: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);

  // If switched to edit mode, focus textarea (restore handled elsewhere)
  useEffect(() => {
    if (!showPreview) {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
      focusTimeoutRef.current = scheduleTimeout(() => textareaRef.current?.focus(), 10) as unknown as ReturnType<typeof setTimeout>;
    }
  }, [showPreview]);

  // Load and persist view/editor settings.
  useEffect(() => {
    const savedViewStyle = localStorage.getItem('markdown-view-style');
    const savedViewFontSize = localStorage.getItem('markdown-view-font-size') || localStorage.getItem('markdown-font-size');
    const savedViewSpacing = localStorage.getItem('markdown-view-spacing') || localStorage.getItem('markdown-spacing');

    const savedEditorStyle = localStorage.getItem('markdown-editor-style');
    const savedEditorFontSize = localStorage.getItem('markdown-editor-font-size');
    const savedEditorSpacing = localStorage.getItem('markdown-editor-spacing');
    const savedHighlightColors: HighlightColors = {
      caret: localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEYS.caret) || DEFAULT_HIGHLIGHT_COLORS.caret,
      selection: localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEYS.selection) || DEFAULT_HIGHLIGHT_COLORS.selection,
      leading: localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEYS.leading) || DEFAULT_HIGHLIGHT_COLORS.leading,
      trailing: localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEYS.trailing) || DEFAULT_HIGHLIGHT_COLORS.trailing,
      background: localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEYS.background) || DEFAULT_HIGHLIGHT_COLORS.background,
      topBackground: localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEYS.topBackground) || DEFAULT_HIGHLIGHT_COLORS.topBackground,
      bottomBackground: localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEYS.bottomBackground) || DEFAULT_HIGHLIGHT_COLORS.bottomBackground,
    };

    if (savedViewStyle) setViewStyle(savedViewStyle);
    if (savedViewFontSize) setViewFontSize(savedViewFontSize);
    if (savedViewSpacing) setViewSpacing(savedViewSpacing);

    if (savedEditorStyle) setEditorStyle(savedEditorStyle);
    if (savedEditorFontSize) setEditorFontSize(savedEditorFontSize);
    if (savedEditorSpacing) setEditorSpacing(savedEditorSpacing);
    setHighlightColors(savedHighlightColors);
    
    const initialSpacing = savedEditorSpacing || 'cozy';
    const savedFixedFocusTopRowCount = localStorage.getItem(`markdown-editor-fixed-focus-top-rows-${initialSpacing}`) || localStorage.getItem('markdown-editor-fixed-focus-top-rows');
    const savedFixedFocusBottomRowCount = localStorage.getItem(`markdown-editor-fixed-focus-bottom-rows-${initialSpacing}`) || localStorage.getItem('markdown-editor-fixed-focus-bottom-rows');

    if (savedFixedFocusTopRowCount) {
      const parsedTopRowCount = Number(savedFixedFocusTopRowCount);
      if (Number.isFinite(parsedTopRowCount) && parsedTopRowCount >= 0) {
        setFixedFocusTopRowCount(Math.floor(parsedTopRowCount));
      }
    }
    if (savedFixedFocusBottomRowCount) {
      const parsedBottomRowCount = Number(savedFixedFocusBottomRowCount);
      if (Number.isFinite(parsedBottomRowCount) && parsedBottomRowCount >= 0) {
        setFixedFocusBottomRowCount(Math.floor(parsedBottomRowCount));
      }
    }
  }, []);

  // View handlers
  const handleViewStyleChange = (style: string) => {
    setViewStyle(style);
    localStorage.setItem('markdown-view-style', style);
  };
  const handleViewFontSizeChange = (size: string) => {
    setViewFontSize(size);
    localStorage.setItem('markdown-view-font-size', size);
  };
  const handleViewSpacingChange = (spacingValue: string) => {
    setViewSpacing(spacingValue);
    localStorage.setItem('markdown-view-spacing', spacingValue);
  };

  // Editor handlers
  const handleEditorStyleChange = (style: string) => {
    setEditorStyle(style);
    localStorage.setItem('markdown-editor-style', style);
  };
  const handleEditorFontSizeChange = (size: string) => {
    setEditorFontSize(size);
    localStorage.setItem('markdown-editor-font-size', size);
  };
  const handleEditorSpacingChange = (spacingValue: string) => {
    setEditorSpacing(spacingValue);
    localStorage.setItem('markdown-editor-spacing', spacingValue);
    
    // Load per-spacing row counts if they exist
    const savedTop = localStorage.getItem(`markdown-editor-fixed-focus-top-rows-${spacingValue}`);
    const savedBottom = localStorage.getItem(`markdown-editor-fixed-focus-bottom-rows-${spacingValue}`);
    
    if (savedTop) {
      const parsedTop = Number(savedTop);
      if (Number.isFinite(parsedTop) && parsedTop >= 0) {
        setFixedFocusTopRowCount(Math.floor(parsedTop));
      }
    }
    
    if (savedBottom) {
      const parsedBottom = Number(savedBottom);
      if (Number.isFinite(parsedBottom) && parsedBottom >= 0) {
        setFixedFocusBottomRowCount(Math.floor(parsedBottom));
      }
    }
  };
  const openHighlightColorEditor = (key: HighlightColorKey) => {
    if (activeHighlightColorKey === key) {
      setActiveHighlightColorKey(null);
      setHighlightColorInput('');
      setHighlightColorInputInvalid(false);
      return;
    }

    setActiveHighlightColorKey(key);
    setHighlightColorInput(highlightColors[key]);
    setHighlightColorInputInvalid(false);
  };
  const applyHighlightColor = () => {
    if (!activeHighlightColorKey) return;
    const normalizedColor = normalizeHighlightColorInput(highlightColorInput);
    if (!normalizedColor) {
      setHighlightColorInputInvalid(true);
      return;
    }

    setHighlightColors((previousColors) => ({
      ...previousColors,
      [activeHighlightColorKey]: normalizedColor,
    }));
    localStorage.setItem(HIGHLIGHT_COLOR_STORAGE_KEYS[activeHighlightColorKey], normalizedColor);
    setActiveHighlightColorKey(null);
    setHighlightColorInput('');
    setHighlightColorInputInvalid(false);
  };
  const handleHighlightColorInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyHighlightColor();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setActiveHighlightColorKey(null);
      setHighlightColorInput('');
      setHighlightColorInputInvalid(false);
    }
  };
  const handleFixedFocusTopRowCountChange = (rowCount: number) => {
    setFixedFocusTopRowCount(rowCount);
    localStorage.setItem(`markdown-editor-fixed-focus-top-rows-${editorSpacing}`, String(rowCount));
    localStorage.setItem('markdown-editor-fixed-focus-top-rows', String(rowCount)); // fallback
  };
  const handleFixedFocusBottomRowCountChange = (rowCount: number) => {
    setFixedFocusBottomRowCount(rowCount);
    localStorage.setItem(`markdown-editor-fixed-focus-bottom-rows-${editorSpacing}`, String(rowCount));
    localStorage.setItem('markdown-editor-fixed-focus-bottom-rows', String(rowCount)); // fallback
  };

  // Preload the selected editor font so switching between edit/view is immediate.
  useEffect(() => {
    const family = getEditorFamily(editorStyle);
    const primary = getPrimaryFamily(family);
    if (!primary) return;

    try {
      if ((document as any).fonts && typeof (document as any).fonts.load === 'function') {
        void (document as any).fonts.load(`12px "${primary}"`).catch((err: any) => { console.warn('fonts.load failed', err); });
      }
    } catch (err) {
      // ignore
    }
  }, [editorStyle]);

  // Autosize helper: set textarea height to its content height.
  const autosizeTextarea = useCallback((ta?: HTMLElement | null) => {
    if (!showPreview) return;
    const el = ta ?? textareaRef.current;
    const editorContent = editorContentRef.current;
    if (!el) return;
    // preserve scrollTop of the scrolling container so we don't jump
    const prevScrollTop = editorContent ? editorContent.scrollTop : 0;

    // Reset so scrollHeight is measured correctly
    el.style.height = 'auto';
    // Add a small fudge to avoid cutting off last line on some browsers
    const newHeight = el.scrollHeight + 2;
    el.style.height = `${newHeight}px`;

    // restore container scrollTop to previous value (keeps view stable)
    if (editorContent) {
      const maxScroll = editorContent.scrollHeight - editorContent.clientHeight;
      editorContent.scrollTop = Math.max(0, Math.min(prevScrollTop, maxScroll));
    }
  }, []);

  // Compute approximate caret Y (relative to editorContent's scrollTop)
  const getCaretApproxY = (): number | null => {
    if (!showPreview) return null;
    const ta = textareaRef.current;
    const editorContent = editorContentRef.current;
    if (!ta || !editorContent) return null;

    // Determine caret line number
    const pos = selectionStart;
    // Use content state for line calculation (ceGetText could also be used but adds overhead)
    const textUpToCursor = content.substring(0, pos);
    const lineIndex = textUpToCursor.split('\n').length - 1;

    const cs = window.getComputedStyle(ta);
    // get line-height; fallback to font-size * 1.2
    let lineHeight = parseFloat(cs.lineHeight || '0');
    if (!lineHeight || Number.isNaN(lineHeight)) {
      const fontSize = parseFloat(cs.fontSize || '16');
      lineHeight = fontSize * 1.2;
    }

    // compute padding-top of textarea
    const paddingTop = parseFloat(cs.paddingTop || '0');

    // textarea offset relative to editorContent
    let textareaOffsetTop = 0;
    let node: HTMLElement | null = ta;
    while (node && node !== editorContent && node.offsetParent) {
      textareaOffsetTop += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    // caret Y within editorContent coordinate space
    const caretY = textareaOffsetTop + paddingTop + lineIndex * lineHeight;
    return caretY;
  };

  // Ensure caret is visible in editorContent. Only scroll if caret is below visible area.
  const ensureCaretVisible = () => {
    if (!showPreview) return;
    const editorContent = editorContentRef.current;
    if (!editorContent) return;
    const caretY = getCaretApproxY();
    if (caretY === null) return;

    // estimate single line height (approx)
    const ta = textareaRef.current;
    if (!ta) return;
    const cs = window.getComputedStyle(ta);
    let lineHeight = parseFloat(cs.lineHeight || '0');
    if (!lineHeight || Number.isNaN(lineHeight)) {
      const fontSize = parseFloat(cs.fontSize || '16');
      lineHeight = fontSize * 1.2;
    }

    const visibleTop = editorContent.scrollTop;
    const visibleBottom = visibleTop + editorContent.clientHeight - (lineHeight / 2);

    // If caret is above visible top -> scroll up to keep it visible at top (rare)
    if (caretY < visibleTop) {
      editorContent.scrollTop = Math.max(0, caretY - 8);
      return;
    }

    // If caret is within visible area -> do nothing (we want to keep view unchanged)
    if (caretY >= visibleTop && caretY < visibleBottom) {
      return;
    }

    // If caret is below visible area, scroll down by three lines (or to end)
    // This prevents the caret from being pushed right to the very bottom
    // where it's hard to see when typing new lines.
    const maxScroll = editorContent.scrollHeight - editorContent.clientHeight;
    const desired = editorContent.scrollTop + (lineHeight * 3);
    // Ensure we don't scroll past the max; also don't overshoot so caret becomes invisible again
    editorContent.scrollTop = Math.max(0, Math.min(desired, maxScroll));
  };

  // Run autosize when content changes or when switching to edit mode.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (!showPreview) return;

    if (!showPreview) {
      autosizeTextarea(ta);
      // ensure caret visible only if needed; skip during programmatic inserts
      if (!programmaticInsertRef.current) ensureCaretVisible();
    } else {
      // Clearing height when in preview so textarea doesn't force layout
      ta.style.height = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, showPreview, autosizeTextarea]);

  // Attach an input listener to autosize while the user types/pastes.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (!showPreview) return;
    const onInput = () => {
      autosizeTextarea(ta);
      ensureCaretVisible();
    };
    ta.addEventListener('input', onInput);
    // Ensure initial sizing
    autosizeTextarea(ta);
    return () => {
      ta.removeEventListener('input', onInput);
    };
  }, [autosizeTextarea]);

  // cursor / first line detection
  const checkCursorPosition = useCallback(() => {
    const cursorPos = selectionStart;
    const textBeforeCursor = content.substring(0, cursorPos);
    const lines = textBeforeCursor.split('\n');
    setIsOnFirstLine(lines.length === 1);
  }, [content, selectionStart]);

  // extract title
  const extractTitle = useCallback((text: string): string => {
    const lines = text.split('\n');
    const firstLine = lines[0] || '';
    if (firstLine.startsWith('# ')) {
      return firstLine.substring(2).trim();
    }
    return 'Untitled';
  }, []);

  // autoSave (returns a promise)
  const autoSave = useCallback(async () => {
    if (!note || content == null) return;
    const diskContent = content;
    if (diskContent === lastSavedContentRef.current) return;

    const savedNote = await window.electronAPI.saveNote(note.id, diskContent);
    lastSavedContentRef.current = diskContent;

    const newTitle = extractTitle(diskContent);
    // Only notify parent about the saved note when the title actually
    // changes. Avoid writing empty titles (e.g. when content is just "# ").
    const newTitleNonEmpty = newTitle.trim();
    if (newTitle !== lastSavedTitleRef.current && newTitleNonEmpty.length > 0) {
      await window.electronAPI.updateNoteTitle(note.id, newTitle);
      lastSavedTitleRef.current = newTitle;

      if (onNoteUpdate) {
        const payload = savedNote ? { ...savedNote, title: newTitle } : { ...note, title: newTitle };
        onNoteUpdate(payload);
      }
    }
  }, [note, content, extractTitle, onNoteUpdate]);

  // Register force-save listener from preload API; accept requestId and respond when done
  useEffect(() => {
    let unsub: { unsubscribe: () => void } | null = null;
    try {
      const api = (window as any).electronAPI;
      if (api && typeof api.onForceSave === 'function') {
        unsub = api.onForceSave(async (requestId?: string) => {
          if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
            autoSaveTimeoutRef.current = null;
          }
          try {
            await autoSave();
            // Persist edit UI state (cursor/scroll) while textarea is still mounted.
            try {
              if (note?.id != null) await saveEditState(note.id);
            } catch (err) {
              console.warn('saveEditState during force-save failed', err);
            }
          } catch (err) {
            // ignore save errors; still signal completion
            console.warn('autoSave during force-save failed', err);
            } finally {
            try {
              api.forceSaveComplete?.(requestId);
            } catch (err) { console.warn('forceSaveComplete notification failed', err); }
          }
        });
      }
    } catch (err) {
      console.warn('Failed to register onForceSave:', err);
    }
    return () => {
      try { unsub?.unsubscribe(); } catch (err) { console.warn('failed to unsubscribe editor listeners', err); }
    };
  }, [autoSave, note, content]);

  // formatting detection
  const checkFormatting = useCallback(() => {
    const start = selectionStart;
    const end = selectionEnd;
    const active = new Set<string>();

    if (start === end && start === 0) {
      setActiveFormats(active);
      return;
    }

    if (start >= 2 && end <= content.length - 2) {
      if (content.substring(start - 2, start) === '**' && content.substring(end, end + 2) === '**') active.add('bold');
    }
    if (start >= 1 && end <= content.length - 1) {
      const beforeChar = content.substring(start - 1, start);
      const afterChar = content.substring(end, end + 1);
      const beforeBefore = start >= 2 ? content.substring(start - 2, start - 1) : '';
      const afterAfter = end <= content.length - 2 ? content.substring(end + 1, end + 2) : '';
      if (beforeChar === '*' && afterChar === '*' && beforeBefore !== '*' && afterAfter !== '*') active.add('italic');
    }
    if (start >= 2 && end <= content.length - 2) {
      if (content.substring(start - 2, start) === '~~' && content.substring(end, end + 2) === '~~') active.add('strikethrough');
    }
    if (start >= 1 && end <= content.length - 1) {
      if (content.substring(start - 1, start) === '`' && content.substring(end, end + 1) === '`') active.add('code');
    }

    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = content.indexOf('\n', end);
    const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;

    if (lineStart >= 4) {
      const prevLine = content.lastIndexOf('\n', lineStart - 2);
      const prevLineContent = content.substring(prevLine + 1, lineStart - 1);
      const prevLineNorm = normalizeForChecks(prevLineContent).trim();
      if (prevLineNorm === '```') {
        const nextLineStart = actualLineEnd + 1;
        const nextLineEnd = content.indexOf('\n', nextLineStart);
        const nextLineContent = content.substring(nextLineStart, nextLineEnd === -1 ? content.length : nextLineEnd);
        if (normalizeForChecks(nextLineContent).trim() === '```') active.add('codeblock');
      }
    }

    const currentLineContent = content.substring(lineStart, actualLineEnd);
    const currentLineNorm = normalizeForChecks(currentLineContent);
    if (currentLineNorm.startsWith('# ')) active.add('h1');
    else if (currentLineNorm.startsWith('## ')) active.add('h2');
    else if (currentLineNorm.startsWith('### ')) active.add('h3');
    else if (currentLineNorm.startsWith('> ')) active.add('blockquote');
    else if (currentLineNorm.match(/^- /)) active.add('bullet');
    else if (currentLineNorm.match(/^\d+\. /)) active.add('number');

    setActiveFormats(active);
  }, [content, selectionEnd, selectionStart]);

  // Formatting helpers
  const wrapSelection = (before: string, after: string = before) => {
    const start = selectionStart;
    const end = selectionEnd;
    const selectedText = content.substring(start, end);

    const isWrapped =
      start >= before.length &&
      end <= content.length - after.length &&
      content.substring(start - before.length, start) === before &&
      content.substring(end, end + after.length) === after;

    let newText: string;
    let newSelectionStart: number;
    let newSelectionEnd: number;

    if (isWrapped) {
      newText = content.substring(0, start - before.length) + selectedText + content.substring(end + after.length);
      newSelectionStart = start - before.length;
      newSelectionEnd = end - before.length;
    } else {
      newText = content.substring(0, start) + before + selectedText + after + content.substring(end);
      newSelectionStart = start + before.length;
      newSelectionEnd = end + before.length;
    }

    setContent(newText);
    handleContentChange(newText);

    scheduleTimeout(() => {
      textareaRef.current?.focus();
      setTextareaSelection(newSelectionStart, newSelectionEnd);
      checkFormatting();
    }, 0);
  };

  const insertAtCursor = (text: string, historyReason?: HistoryBoundaryReason) => {
    const start = selectionStart;
    const end = selectionEnd;
    const newText = content.substring(0, start) + text + content.substring(end);
    const afterSnapshot = buildSnapshot(newText, start + text.length, start + text.length);
    // mark this as a programmatic insert so autosize/ensureCaretVisible
    // triggered by the content-change effect do not run and cause jumps
    programmaticInsertRef.current = true;
    setContent(newText);
    handleContentChange(newText);
    if (historyReason) {
      recordHistoryEntry(historyReason, lastCommittedSnapshotRef.current, afterSnapshot);
    }
    scheduleTimeout(() => {
      textareaRef.current?.focus();
      setTextareaSelection(start + text.length, start + text.length);
      autosizeTextarea(null);
      ensureCaretVisible();
      programmaticInsertRef.current = false;
    }, 0);
  };

  const prependToLines = (prefix: string, numbered = false) => {
    const start = selectionStart;
    const end = selectionEnd;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = content.indexOf('\n', end);
    const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
    const selectedLines = content.substring(lineStart, actualLineEnd);
    const lines = selectedLines.split('\n');

    const allHavePrefix = lines.every(line => {
      if (numbered) return line.match(/^\d+\. /);
      return line.startsWith(prefix);
    });

    let newLines: string[];
    if (allHavePrefix) {
      newLines = lines.map(line => {
        if (numbered) return line.replace(/^\d+\. /, '');
        return line.startsWith(prefix) ? line.substring(prefix.length) : line;
      });
    } else {
      newLines = lines.map((line, index) => {
        if (numbered) return `${index + 1}. ${line}`;
        return `${prefix}${line}`;
      });
    }

    const newText = content.substring(0, lineStart) + newLines.join('\n') + content.substring(actualLineEnd);
    setContent(newText);
    handleContentChange(newText);

    scheduleTimeout(() => {
      textareaRef.current?.focus();
      checkFormatting();
    }, 0);
  };

  const insertHeading = (level: number) => {
    const start = selectionStart;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = content.indexOf('\n', start);
    const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
    const currentLine = content.substring(lineStart, actualLineEnd);
    const prefix = '#'.repeat(level) + ' ';
    const hasHeading = currentLine.startsWith(prefix);

    let newText: string;
    let newCursorPos: number;

    if (hasHeading) {
      newText = content.substring(0, lineStart) + currentLine.substring(prefix.length) + content.substring(actualLineEnd);
      newCursorPos = start - prefix.length;
    } else {
      let cleanLine = currentLine;
      const headingMatch = currentLine.match(/^#{1,6} /);
      if (headingMatch) cleanLine = currentLine.substring(headingMatch[0].length);
      newText = content.substring(0, lineStart) + prefix + cleanLine + content.substring(actualLineEnd);
      newCursorPos = headingMatch ? start - headingMatch[0].length + prefix.length : start + prefix.length;
    }

    setContent(newText);
    handleContentChange(newText);

    scheduleTimeout(() => {
      textareaRef.current?.focus();
      setTextareaSelection(newCursorPos, newCursorPos);
      checkFormatting();
    }, 0);
  };

  // sanitize pasted text (preserve URLs)
  const sanitizePastedText = (text: string): string => {
    if (!text) return '';
    let out = text.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
    out = out.replace(/\r\n/g, '\n');
    out = out.replace(/<\/?[^>]+(>|$)/g, '');
    return out;
  };

  const handleCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = textareaRef.current;
    if (!el) return;
    const sel = ceGetSelection(el) ?? { start: selectionStart, end: selectionEnd };
    const selected = content.substring(sel.start, sel.end);
    try {
      e.clipboardData.setData('text/plain', selected || '');
      e.preventDefault();
    } catch (err) {
      // fallback: allow normal copy
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    let plain = e.clipboardData.getData('text/plain') || '';
    if (!plain) {
      const html = e.clipboardData.getData('text/html') || '';
      if (html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        plain = tmp.textContent || tmp.innerText || '';
      }
    }
    const sanitized = sanitizePastedText(plain);
    if (sanitized) {
      insertAtCursor(sanitized, 'paste');
    }
  };

  // content change handler with debounced save
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Do not trigger autosave for programmatic edits (tab/shift-tab inserts/etc.)
    // since they do not change the note title and should not cause parent
    // menu updates. Autosave still runs for normal user edits when not on
    // the first line.
    if (!programmaticInsertRef.current && !isOnFirstLine && note && !showPreview) {
      autoSaveTimeoutRef.current = scheduleTimeout(() => {
        void autoSave();
      }, 1000) as unknown as ReturnType<typeof setTimeout>;
    }
  }, [autoSave, isOnFirstLine, note, scheduleTimeout, showPreview]);

  const finalizePendingNativeBoundary = useCallback((newContent: string, newSelectionStart: number, newSelectionEnd: number) => {
    const pendingBoundary = pendingHistoryBoundaryRef.current;
    if (!pendingBoundary) return;
    pendingHistoryBoundaryRef.current = null;
    const afterSnapshot = buildSnapshot(newContent, newSelectionStart, newSelectionEnd);
    recordHistoryEntry(pendingBoundary.reason, pendingBoundary.before, afterSnapshot);
  }, [buildSnapshot, recordHistoryEntry]);

  const applySnapshotProgrammatically = useCallback((snapshot: EditSnapshot) => {
    programmaticInsertRef.current = true;
    pendingHistoryBoundaryRef.current = null;
    handleContentChange(snapshot.content);
    syncSelectionState(snapshot.selectionStart, snapshot.selectionEnd);
    lastCommittedSnapshotRef.current = snapshot;

    scheduleTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        setTextareaSelection(snapshot.selectionStart, snapshot.selectionEnd);
        autosizeTextarea(el);
        ensureCaretVisible();
        checkFormatting();
      }
      programmaticInsertRef.current = false;
    }, 0);
  }, [autosizeTextarea, checkFormatting, ensureCaretVisible, handleContentChange, setTextareaSelection, syncSelectionState]);

  const handleUndo = useCallback(() => {
    const history = editHistoryRef.current;
    if (history.recent.length === 0 && history.archived.length === 0) return;

    let entry: EditHistoryEntry;
    let nextHistory: NoteEditHistoryState;
    if (history.recent.length > 0) {
      entry = history.recent[history.recent.length - 1];
      nextHistory = {
        recent: history.recent.slice(0, -1),
        archived: history.archived,
        redo: [...history.redo, entry],
        storedChangeCount: (history.recent.length - 1) + history.archived.length,
      };
    } else {
      entry = history.archived[history.archived.length - 1];
      nextHistory = {
        recent: history.recent,
        archived: history.archived.slice(0, -1),
        redo: [...history.redo, entry],
        storedChangeCount: history.recent.length + (history.archived.length - 1),
      };
    }

    replaceEditHistory(nextHistory);
    applySnapshotProgrammatically(applyHistoryEntry(content, entry, 'undo'));
  }, [applySnapshotProgrammatically, content, replaceEditHistory]);

  const handleRedo = useCallback(() => {
    const history = editHistoryRef.current;
    if (history.redo.length === 0) return;

    const entry = history.redo[history.redo.length - 1];
    let restoredHistory: NoteEditHistoryState;
    if (entry.storage === 'recent' && entry.kind === 'full') {
      restoredHistory = addRecentHistoryEntry({
        recent: history.recent,
        archived: history.archived,
        redo: history.redo.slice(0, -1),
        storedChangeCount: history.recent.length + history.archived.length,
      }, entry);
      restoredHistory = { ...restoredHistory, redo: history.redo.slice(0, -1) };
    } else {
      const nextArchived = [...history.archived, entry];
      restoredHistory = {
        recent: history.recent,
        archived: nextArchived,
        redo: history.redo.slice(0, -1),
        storedChangeCount: history.recent.length + nextArchived.length,
      };
    }

    replaceEditHistory(restoredHistory);
    applySnapshotProgrammatically(applyHistoryEntry(content, entry, 'redo'));
  }, [applySnapshotProgrammatically, content, replaceEditHistory]);

  const requestHistoryBoundary = useCallback((reason: HistoryBoundaryReason) => {
    pendingHistoryBoundaryRef.current = {
      reason,
      before: lastCommittedSnapshotRef.current,
    };
  }, []);

  const handleTextareaKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      if (!isOnFirstLine && note && content !== lastSavedContentRef.current) {
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
          autoSaveTimeoutRef.current = null;
        }
        void autoSave();
      }
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showPreview) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;

      const start = selectionStart;
      const end = selectionEnd;
      const lineStart = content.lastIndexOf('\n', start - 1) + 1;
      const currentLineBeforeCursor = content.substring(lineStart, start);
      
      const whitespaceMatch = currentLineBeforeCursor.match(/^[ \t]*/);
      const leadingWhitespace = whitespaceMatch ? whitespaceMatch[0] : '';
      
      const listMatch = currentLineBeforeCursor.substring(leadingWhitespace.length).match(/^([-*+]|\d+\.)\s+/);
      let listMarker = '';
      if (listMatch) {
        listMarker = listMatch[0];
        const numMatch = listMarker.match(/^(\d+)\.\s+/);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10);
          listMarker = `${num + 1}. `;
        }
      }

      const insert = '\n' + leadingWhitespace + listMarker;
      const newText = content.substring(0, start) + insert + content.substring(end);
      const newCursorPos = start + insert.length;

      programmaticInsertRef.current = true;
      setContent(newText);
      handleContentChange(newText);
      
      scheduleTimeout(() => {
        el.focus();
        setTextareaSelection(newCursorPos, newCursorPos);
        autosizeTextarea(el);
        ensureCaretVisible();
        programmaticInsertRef.current = false;
      }, 0);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;

      const start = selectionStart;
      const end = selectionEnd;
      const lineStart = content.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = content.indexOf('\n', end);
      const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
      const selectedLines = content.substring(lineStart, actualLineEnd).split('\n');

      let pos = lineStart;
      let selectionOffsetStart = 0;
      let selectionOffsetEnd = 0;

      const newLines = selectedLines.map((ln, idx) => {
        const leadMatch = ln.match(/^[ ]*/);
        const leadSpaces = leadMatch ? leadMatch[0].length : 0;
        const lineLen = ln.length;
        
        let modifiedLine = ln;
        let changeCount = 0;

        if (e.shiftKey) {
          if (leadSpaces > 0) {
            const remainder = leadSpaces % 3;
            const toRemove = remainder === 0 ? 3 : remainder;
            modifiedLine = ln.substring(toRemove);
            changeCount = -toRemove;
          }
        } else {
          const remainder = leadSpaces % 3;
          const toAdd = remainder === 0 ? 3 : 3 - remainder;
          modifiedLine = ' '.repeat(toAdd) + ln;
          changeCount = toAdd;
        }

        if (start > pos) {
           const beforeStart = Math.min(start - pos, leadSpaces);
           if (changeCount < 0) {
             selectionOffsetStart += Math.max(changeCount, -beforeStart);
           } else {
             selectionOffsetStart += changeCount;
           }
        } else if (start === pos && changeCount > 0) {
           selectionOffsetStart += changeCount;
        }

        if (end > pos) {
           const beforeEnd = Math.min(end - pos, leadSpaces);
           if (changeCount < 0) {
             selectionOffsetEnd += Math.max(changeCount, -beforeEnd);
           } else {
             selectionOffsetEnd += changeCount;
           }
        } else if (end === pos && changeCount > 0) {
           selectionOffsetEnd += changeCount;
        }

        pos += lineLen + 1;
        return modifiedLine;
      });

      const newText = content.substring(0, lineStart) + newLines.join('\n') + content.substring(actualLineEnd);
      const newStart = Math.max(0, start + selectionOffsetStart);
      const newEnd = Math.max(0, end + selectionOffsetEnd);

      programmaticInsertRef.current = true;
      setContent(newText);
      handleContentChange(newText);

      scheduleTimeout(() => {
        el.focus();
        setTextareaSelection(newStart, newEnd);
        autosizeTextarea(el);
        ensureCaretVisible();
        programmaticInsertRef.current = false;
      }, 0);
      return;
    }
  };

  // selection listeners
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const handleSelectionChange = () => {
      const sel = ceGetSelection(el);
      if (!sel) return;
      checkCursorPosition();
      checkFormatting();
      syncSelectionState(sel.start, sel.end);

      // debounce save edit state for current note
      if (note?.id != null) {
        if (selectionSaveTimeout.current) clearTimeout(selectionSaveTimeout.current);
            selectionSaveTimeout.current = scheduleTimeout(() => {
              void saveEditState(note.id as number);
            }, 250) as unknown as ReturnType<typeof setTimeout>;
      }
    };
    el.addEventListener('click', handleSelectionChange);
    el.addEventListener('keyup', handleSelectionChange);
    el.addEventListener('select', handleSelectionChange);
    return () => {
      el.removeEventListener('click', handleSelectionChange);
      el.removeEventListener('keyup', handleSelectionChange);
      el.removeEventListener('select', handleSelectionChange);
      if (selectionSaveTimeout.current) {
        clearTimeout(selectionSaveTimeout.current);
        selectionSaveTimeout.current = null;
      }
    };
  }, [checkCursorPosition, checkFormatting, note, syncSelectionState]);

  // trigger auto-save when moving off first line
  useEffect(() => {
    if (!isOnFirstLine && note && content !== lastSavedContentRef.current) {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = scheduleTimeout(() => {
        void autoSave();
      }, 1000) as unknown as ReturnType<typeof setTimeout>;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnFirstLine, note, content]);

  // reflow after fonts arrive (helps initial wrapping)
  useEffect(() => {
    const container = editorContentRef.current;
    if (!container) return;

    const updateSize = () => {
      setEditorViewportSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });

      const panelBackgroundColor = window.getComputedStyle(container).backgroundColor;
      const opaquePanelBackgroundColor = toOpaqueColor(panelBackgroundColor);
      if (opaquePanelBackgroundColor) {
        setEditorPanelGridColor(opaquePanelBackgroundColor);
      }
    };

    updateSize();
    const frameId = requestAnimationFrame(updateSize);
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [showPreview, note?.id]);

  const fixedFocusHighlightColors: FixedFocusHighlightColors = {
    ...highlightColors,
    grid: editorPanelGridColor,
  };

  useEffect(() => {
    const reflowTextarea = () => {
      if (showPreview) {
        const ta = textareaRef.current;
        if (!ta) return;
        (ta as any).style.display = 'none';
        ta.offsetHeight;
        (ta as any).style.display = '';
        autosizeTextarea(ta);
        return;
      }

      setLayoutRevision((version) => version + 1);
    };

    if ((document as any).fonts && (document as any).fonts.ready) {
      (document as any).fonts.ready.then(() => {
        requestAnimationFrame(() => requestAnimationFrame(reflowTextarea));
      }).catch(() => {
        scheduleTimeout(reflowTextarea, 100);
      });
    } else {
      const t = scheduleTimeout(reflowTextarea, 100);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorStyle, autosizeTextarea]);

  // toolbar layout styles: two flex areas (left/right) and fixed toolbar height/line-height
  const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '44px',
    lineHeight: '44px',
    padding: '0',
    flexWrap: 'nowrap',   // prevent wrapping to next line
    overflow: 'hidden',   // clip overflow so content is cut off at the edge
  };
  const leftToolsStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: '0 0 auto',     // keep left controls visible
    minWidth: 0,
  };
  const rightToolsStyle: React.CSSProperties = {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: '0 0 auto',     // do not shrink; allow toolbar container to clip it
    overflow: 'visible',
    whiteSpace: 'nowrap',
  };

  // Helper: map size/spacing tokens to actual values for the editor textarea
  const sizeToPx = (size: string): number => {
    switch (size) {
      case 'xs': return 12;
      case 's': return 14;
      case 'm': return 16;
      case 'l': return 18;
      case 'xl': return 20;
      default: return 16;
    }
  };
  const spacingToLineHeight = (spacingVal: string): number => {
    switch (spacingVal) {
      case 'tight': return 1.2;
      case 'compact': return 1.4;
      case 'cozy': return 1.6;
      case 'wide': return 1.8;
      default: return 1.6;
    }
  };

  // derive inline styles for editor textarea based on editor settings (kept for potential fallbacks)
  const editorInlineStyle: React.CSSProperties = {
    fontFamily: getEditorFamily(editorStyle),
    fontSize: `${sizeToPx(editorFontSize)}px`,
  };

  // cleanup
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
      if (selectionSaveTimeout.current) {
        clearTimeout(selectionSaveTimeout.current);
        selectionSaveTimeout.current = null;
      }
      if (loadNoteTimeoutRef.current) {
        clearTimeout(loadNoteTimeoutRef.current);
        loadNoteTimeoutRef.current = null;
      }
      if (previewRestoreTimeoutRef.current) {
        clearTimeout(previewRestoreTimeoutRef.current);
        previewRestoreTimeoutRef.current = null;
      }
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
      // Clear any other pending timeouts scheduled via scheduleTimeout
      try {
        if (pendingTimeoutsRef.current && pendingTimeoutsRef.current.length) {
          pendingTimeoutsRef.current.forEach(id => clearTimeout(id));
          pendingTimeoutsRef.current = [];
        }
      } catch (err) {
        // ignore
      }
      if (note?.id != null) {
        if (showPreview) {
          // save preview progress
          try {
            const editorContent = editorContentRef.current;
            if (editorContent) {
              const ratio = editorContent.scrollHeight > editorContent.clientHeight ? editorContent.scrollTop / (editorContent.scrollHeight - editorContent.clientHeight) : 0;
              void window.electronAPI.saveNoteUiState(note.id, { progressPreview: ratio });
            }
          } catch (err) { console.warn('failed to restore selection after load', err); }
        } else {
          void saveEditState(note.id);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist scrolling/progress in both preview and edit modes.
  useEffect(() => {
    if (!note?.id) return;
    if (!showPreview) return;
    const id = note.id;
    let timer: NodeJS.Timeout | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const el = editorContentRef.current;
        if (!el) return;
        const ratio = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
        if (showPreview) {
          void window.electronAPI.saveNoteUiState(id, { progressPreview: ratio });
        } else {
          void window.electronAPI.saveNoteUiState(id, { progressEdit: ratio, cursorPos: textareaRef.current ? (ceGetSelection(textareaRef.current)?.start ?? null) : null, scrollTop: el.scrollTop });
        }
      }, 200);
    };

    const el = editorContentRef.current;
    if (el) {
      el.addEventListener('scroll', handler);
    }
    return () => {
      if (el) el.removeEventListener('scroll', handler);
      if (timer) clearTimeout(timer);
    };
  }, [showPreview, note?.id]);

  if (!note) {
    return (
      <div className="markdown-editor empty">
        <div className="empty-state">
          <p>{hasAnyNotes ? 'Select a note or create a new one with Ctrl+N' : 'Go ahead and create your first note with Ctrl+N.'}</p>
        </div>
      </div>
    );
  }

  // safe href check
  const isSafeHref = (href: string | undefined): boolean => {
    if (!href) return false;
    try {
      const parsed = new URL(href);
      const allowed = ['http:', 'https:', 'mailto:', 'tel:'];
      return allowed.includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  return (
    <div className="markdown-editor">
      <div className="editor-toolbar" style={toolbarStyle}>
        <div style={leftToolsStyle}>
          <button
            className={`toolbar-toggle-btn ${!showPreview ? 'active' : ''}`}
            onClick={() => onTogglePreview(!showPreview)}
          >
            {showPreview ? 'Edit' : 'View'}
          </button>

          {/* left-aligned text editing tools - only in edit mode */}
          {!showPreview && (
            <div className="markdown-toolbar">
              <button className={`toolbar-btn-icon ${activeFormats.has('bold') ? 'active' : ''}`} onClick={() => wrapSelection('**')} title="Bold">
                <strong>B</strong>
              </button>
              <button className={`toolbar-btn-icon ${activeFormats.has('italic') ? 'active' : ''}`} onClick={() => wrapSelection('*')} title="Italic">
                <em>I</em>
              </button>
              <button className={`toolbar-btn-icon ${activeFormats.has('strikethrough') ? 'active' : ''}`} onClick={() => wrapSelection('~~')} title="Strikethrough">
                <span style={{ textDecoration: 'line-through' }}>S</span>
              </button>
              <span className="toolbar-divider">|</span>
              <button className={`toolbar-btn-icon ${activeFormats.has('h1') ? 'active' : ''}`} onClick={() => insertHeading(1)} title="Heading 1">H1</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('h2') ? 'active' : ''}`} onClick={() => insertHeading(2)} title="Heading 2">H2</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('h3') ? 'active' : ''}`} onClick={() => insertHeading(3)} title="Heading 3">H3</button>
              <span className="toolbar-divider">|</span>
              <button className="toolbar-btn-icon" onClick={() => wrapSelection('[', '](url)')} title="Link">🔗</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('code') ? 'active' : ''}`} onClick={() => wrapSelection('`')} title="Inline Code">{'<>'}</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('codeblock') ? 'active' : ''}`} onClick={() => wrapSelection('```\n', '\n```')} title="Code Block">{'{ }'}</button>
              <span className="toolbar-divider">|</span>
              <button className={`toolbar-btn-icon ${activeFormats.has('bullet') ? 'active' : ''}`} onClick={() => prependToLines('- ')} title="Bulleted List">≡</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('number') ? 'active' : ''}`} onClick={() => prependToLines('', true)} title="Numbered List">#</button>
              <button className={`toolbar-btn-icon ${activeFormats.has('blockquote') ? 'active' : ''}`} onClick={() => prependToLines('> ')} title="Blockquote">&quot;</button>
              <button className="toolbar-btn-icon" onClick={() => insertAtCursor('\n---\n')} title="Horizontal Rule">—</button>
            </div>
          )}
        </div>

        {/* right-aligned controls — always rendered, but clipped by container when there's not enough space */}
        <div style={rightToolsStyle}>
          {showPreview ? (
            <>
              <div className="style-selector">
                <label className="selector-label">Style:</label>
                <select value={viewStyle} onChange={(e) => handleViewStyleChange(e.target.value)}>
                  <option value="modern">Modern</option>
                  <option value="narrow">Narrow</option>
                  <option value="cute">Cute</option>
                  <option value="print">Print</option>
                </select>
              </div>

              <div className="style-selector">
                <label className="selector-label">Size:</label>
                <select value={viewFontSize} onChange={(e) => handleViewFontSizeChange(e.target.value)}>
                  <option value="xs">XS</option>
                  <option value="s">S</option>
                  <option value="m">M</option>
                  <option value="l">L</option>
                  <option value="xl">XL</option>
                </select>
              </div>

              <div className="style-selector">
                <label className="selector-label">Spacing:</label>
                <select value={viewSpacing} onChange={(e) => handleViewSpacingChange(e.target.value)}>
                  <option value="tight">Tight</option>
                  <option value="compact">Compact</option>
                  <option value="cozy">Cozy</option>
                  <option value="wide">Wide</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="highlight-color-controls">
                {(['caret', 'selection', 'background', 'topBackground', 'bottomBackground'] as HighlightColorKey[]).map((key) => (
                  <button
                    key={key}
                    className={`toolbar-btn-icon color-swatch-btn${activeHighlightColorKey === key ? ' is-open' : ''}`}
                    style={{
                      background: highlightColors[key],
                      color: getHighlightLabelColor(highlightColors[key]),
                    }}
                    onClick={() => openHighlightColorEditor(key)}
                    title={HIGHLIGHT_COLOR_TITLES[key]}
                  >
                    {HIGHLIGHT_COLOR_LABELS[key]}
                  </button>
                ))}

                {activeHighlightColorKey && (
                  <div className="highlight-color-input-group">
                    <input
                      className={`highlight-color-input${highlightColorInputInvalid ? ' is-invalid' : ''}`}
                      value={highlightColorInput}
                      onChange={(e) => {
                        setHighlightColorInput(e.target.value);
                        if (highlightColorInputInvalid) setHighlightColorInputInvalid(false);
                      }}
                      onKeyDown={handleHighlightColorInputKeyDown}
                      placeholder="#RRGGBBAA or (255,255,255,1)"
                      title="Enter #RRGGBBAA or (255,255,255,1)"
                    />
                    <button
                      className="toolbar-btn-icon color-apply-btn"
                      onClick={applyHighlightColor}
                      title="Apply color"
                    >
                      ✓
                    </button>
                  </div>
                )}
              </div>

              <div className="style-selector">
                <label className="selector-label">Style:</label>
                <select value={editorStyle} onChange={(e) => handleEditorStyleChange(e.target.value)}>
                  {editorStyleOptions.map(opt => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="style-selector">
                <label className="selector-label">Size:</label>
                <select value={editorFontSize} onChange={(e) => handleEditorFontSizeChange(e.target.value)}>
                  <option value="xs">XS</option>
                  <option value="s">S</option>
                  <option value="m">M</option>
                  <option value="l">L</option>
                  <option value="xl">XL</option>
                </select>
              </div>

              <div className="style-selector">
                <label className="selector-label">Spacing:</label>
                <select value={editorSpacing} onChange={(e) => handleEditorSpacingChange(e.target.value)}>
                  <option value="tight">Tight</option>
                  <option value="compact">Compact</option>
                  <option value="cozy">Cozy</option>
                  <option value="wide">Wide</option>
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={`editor-content ${showPreview ? 'is-preview' : 'is-editor'}`} ref={editorContentRef} style={!showPreview ? { overflow: 'hidden' } : undefined}>
        {!showPreview ? (
          <FixedFocusEditor
            key={`${editorStyle}-${editorFontSize}-${editorSpacing}-${layoutRevision}`}
            text={content}
            caretPos={caretPos}
            selectionStart={selectionStart}
            selectionEnd={selectionEnd}
            fontFamily={getEditorFamily(editorStyle)}
            fontSizePx={sizeToPx(editorFontSize)}
            spacingPreset={editorSpacing}
            highlightColors={fixedFocusHighlightColors}
            leftPaddingPx={10}
            rightPaddingPx={5}
            topPaddingPx={10}
            bottomPaddingPx={10}
            topRowCount={fixedFocusTopRowCount}
            bottomRowCount={fixedFocusBottomRowCount}
            containerWidthPx={Math.max(1, editorViewportSize.width)}
            containerHeightPx={Math.max(1, editorViewportSize.height)}
            viewportStartRow={editViewportStartRow}
            onViewportStartRowChange={setEditViewportStartRow}
            onViewportTopSourceLineChange={(lineIndex) => { liveViewportTopSourceLineRef.current = lineIndex; }}
            onTopRowCountChange={handleFixedFocusTopRowCountChange}
            onBottomRowCountChange={handleFixedFocusBottomRowCountChange}
            onTotalWrappedRowCountChange={(count) => { totalWrappedRowsRef.current = count; }}
            onTextChange={(newText, newSelectionStart, newSelectionEnd) => {
              handleContentChange(newText);
              finalizePendingNativeBoundary(newText, newSelectionStart, newSelectionEnd);
              syncSelectionState(newSelectionStart, newSelectionEnd);
              checkCursorPosition();
            }}
            onSelectionChange={(start, end) => {
              // Programmatic transforms (Enter/list continuation/etc.) set an explicit
              // target selection. Ignore transient browser select events in that window.
              if (programmaticInsertRef.current) return;
              syncSelectionState(start, end);
            }}
            onCaretChange={(newCaretPos) => {
              if (programmaticInsertRef.current) return;
              if (!textareaRef.current) return;
              setTextareaSelection(newCaretPos, newCaretPos);
              checkCursorPosition();
              checkFormatting();
            }}
            textareaRef={textareaRef}
            textareaClassName={`markdown-textarea editor-style-${editorStyle}`}
            textareaStyle={editorInlineStyle}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            onCopy={(e) => handleCopy(e)}
            onKeyUp={handleTextareaKeyUp}
            onKeyDown={handleTextareaKeyDown}
            onPaste={handlePaste}
            placeholder={`# Note Title

Start typing your note here...`}
          />
        ) : (
          <div className={`markdown-preview style-${viewStyle} size-${viewFontSize} spacing-${viewSpacing}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkSourcePos]}
              components={{
                a: ({ node, ...props }) => {
                  const href = (props as any).href as string | undefined;
                  const children = props.children;
                  let childText = '';
                  if (Array.isArray(children)) {
                    childText = children.map(c => (typeof c === 'string' ? c : (c && (c as any).props?.children) || '')).join('');
                  } else if (typeof children === 'string') {
                    childText = children;
                  } else if (children && (children as any).props?.children) {
                    childText = (children as any).props.children;
                  }

                  if (href && childText && childText.trim() === href.trim()) {
                    return <span>{childText}</span>;
                  }

                  if (isSafeHref(href)) {
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {props.children}
                      </a>
                    );
                  }

                  return <span>{props.children}</span>;
                }
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};