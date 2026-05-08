import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { Node } from 'unist';
import {
  EditSnapshot,
  Note,
} from '../shared/types';
import { FixedFocusEditor, ceGetSelection, ceSetSelection, ceGetText } from './FixedFocusViewport';
import './MarkdownEditor.scss';
import './MarkdownThemes.scss';

type HighlightColorKey = 'caret' | 'selection' | 'leading' | 'trailing' | 'background' | 'topBackground' | 'bottomBackground';

type HighlightColors = Record<HighlightColorKey, string>;
type HSVA = { h: number; s: number; v: number; a: number };
type ColorSliderKey = 'hue' | 'saturation' | 'vibrancy' | 'alpha';

type FixedFocusHighlightColors = HighlightColors & { grid: string };
type HistoryBoundaryReason = 'space' | 'enter' | 'delete-boundary' | 'paste' | 'delete-selection' | 'tab' | 'char';

type UndoEntry = { type: 'char' | 'paste' | 'bundled' | 'boundary'; snapshot: EditSnapshot; diff: number; };
const MAX_UNDO_CHARS = 1000;

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

function rgbToHsv(red: number, green: number, blue: number): { h: number; s: number; v: number } {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
  }

  h = Math.round((h * 60 + 360) % 360);
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb(h: number, s: number, v: number): { red: number; green: number; blue: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return {
    red: Math.round((r + m) * 255),
    green: Math.round((g + m) * 255),
    blue: Math.round((b + m) * 255),
  };
}

function colorToHsva(color: string): HSVA | null {
  const parsed = parseHighlightColor(color);
  if (!parsed) return null;
  const hsv = rgbToHsv(parsed.red, parsed.green, parsed.blue);
  return { h: hsv.h, s: Math.round(hsv.s * 100), v: Math.round(hsv.v * 100), a: parsed.alpha };
}

function hsvaToRgbaString(hsva: HSVA): string {
  const rgb = hsvToRgb(hsva.h, hsva.s / 100, hsva.v / 100);
  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${Math.max(0, Math.min(1, hsva.a))})`;
}

function sliderKeyToInputValue(key: ColorSliderKey, value: number): number {
  switch (key) {
    case 'hue': return Math.round((value / 360) * 255);
    case 'saturation':
    case 'vibrancy': return Math.round((value / 100) * 255);
    case 'alpha': return Math.round(value * 255);
  }
}

function sliderKeyToHsvaProp(key: ColorSliderKey): keyof HSVA {
  switch (key) {
    case 'hue': return 'h';
    case 'saturation': return 's';
    case 'vibrancy': return 'v';
    case 'alpha': return 'a';
  }
}

function sliderKeyBackground(key: ColorSliderKey, hsva: HSVA): string {
  switch (key) {
    case 'hue': {
      const rgb = hsvToRgb(hsva.h, 1, 1);
      return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, 1)`;
    }
    case 'saturation': {
      const rgb = hsvToRgb(hsva.h, hsva.s / 100, 1);
      return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, 1)`;
    }
    case 'vibrancy': {
      const rgb = hsvToRgb(hsva.h, 1, hsva.v / 100);
      return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, 1)`;
    }
    case 'alpha': {
      const rgb = hsvToRgb(hsva.h, 1, 1);
      return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${hsva.a})`;
    }
  }
}

function sliderKeyTextStyle(key: ColorSliderKey, hsva: HSVA): React.CSSProperties | undefined {
  if (key === 'hue') {
    return {
      color: '#fff',
      textShadow: '0 0 2px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,1)',
    };
  }
  let brightness: number;
  if (key === 'saturation') {
    brightness = 1 - hsva.s / 100;
  } else if (key === 'vibrancy') {
    brightness = 1 - hsva.v / 100;
  } else {
    brightness = 1 - hsva.a;
  }

  const isBright = brightness > 0.5;
  if (key === 'vibrancy') {
    return {
      color: '#fff',
      textShadow: '0 0 2px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,1)',
    };
  }

  if (isBright) {
    return {
      color: '#111',
      textShadow: '0 0 2px rgba(255,255,255,1), 0 0 4px rgba(255,255,255,1)',
    };
  }

  return {
    color: '#fff',
    textShadow: '0 0 2px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,1)',
  };
}

function getSliderValueFromHsva(key: ColorSliderKey, hsva: HSVA): number {
  const prop = sliderKeyToHsvaProp(key);
  return prop === 'a' ? hsva.a : hsva[prop];
}

function inputValueToSliderValue(key: ColorSliderKey, value: number): number {
  const clamped = Math.max(0, Math.min(255, value));
  switch (key) {
    case 'hue': return Math.round((clamped / 255) * 360);
    case 'saturation':
    case 'vibrancy': return Math.round((clamped / 255) * 100);
    case 'alpha': return clamped / 255;
  }
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


import { Timeline } from './Timeline';

export interface TimelineProps {
  snapshots: any[];
  timeMachineIndex: number;
  logBase?: number;
  onNavigate: (index: number) => void;
  onDeleteSnapshot: (snapshotId: number) => void;
  onManualSnapshot: () => void;
}

interface MarkdownEditorProps {
  note: Note | null;
  onNoteUpdate?: (note: Note) => void;
  showPreview: boolean;
  onTogglePreview: (next: boolean) => void;
  hasAnyNotes?: boolean;
  autoSaveEnabled?: boolean;
  timeMachineSnapshotContent?: string | null;
  onTimeMachineInterrupt?: () => void;
  timelineProps?: TimelineProps;
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
  autoSaveEnabled = true,
  timeMachineSnapshotContent,
  onTimeMachineInterrupt,
  timelineProps
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
  const [secondaryToolbarPanel, setSecondaryToolbarPanel] = useState<'color-settings' | null>(null);
  const [colorSliderHsva, setColorSliderHsva] = useState<HSVA | null>(null);
  const [activeSliderInputKey, setActiveSliderInputKey] = useState<ColorSliderKey | null>(null);
  const [sliderInputValue, setSliderInputValue] = useState<string>('');

  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const [editHistoryCount, setEditHistoryCount] = useState(0);
  const textareaRef = useRef<HTMLDivElement | null>(null);
  const editorContentRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef('');
  const lastAutoSnapshotTimeRef = useRef(0);
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
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const undoTotalDiffRef = useRef<number>(0);
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

  const pushHistorySnapshot = useCallback((
    targetStack: 'undo' | 'redo',
    type: 'char' | 'paste' | 'bundled' | 'boundary',
    snapshot: EditSnapshot,
    diff: number
  ) => {
    const stack = targetStack === 'undo' ? undoStackRef.current : redoStackRef.current;
    stack.push({ type, snapshot, diff });
    
    if (targetStack === 'undo') {
      undoTotalDiffRef.current += diff;
      while (undoTotalDiffRef.current > 1000 && stack.length > 1) {
        const removed = stack.shift()!;
        undoTotalDiffRef.current -= removed.diff;
      }
    } else {
      if (stack.length > 50) stack.shift();
    }
    setEditHistoryCount(undoStackRef.current.length + redoStackRef.current.length);
  }, []);

  const bundleRecentChars = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length < 2) return;
    let i = stack.length - 1;
    while (i >= 0 && stack[i].type === 'char') { i--; }
    const charCount = stack.length - 1 - i;
    if (charCount > 1) {
      const firstCharIdx = i + 1;
      const firstCharSnapshot = stack[firstCharIdx].snapshot;
      let totalDiff = 0;
      for (let j = firstCharIdx; j < stack.length; j++) {
        totalDiff += stack[j].diff;
      }
      stack.splice(firstCharIdx, charCount, { type: 'bundled', snapshot: firstCharSnapshot, diff: totalDiff });
    }
  }, []);

  const recordHistoryEntry = useCallback((reason: HistoryBoundaryReason, before: EditSnapshot, after: EditSnapshot) => {
    if (!note || before.content === after.content) {
      lastCommittedSnapshotRef.current = after;
      return;
    }
    // calculate simple length diff
    const diff = Math.abs(after.content.length - before.content.length);
    let type: 'char' | 'paste' | 'bundled' | 'boundary' = 'char';
    if (reason === 'paste') type = 'paste';
    else if (reason === 'enter' || reason === 'space' || reason === 'tab') type = 'boundary';
    
    pushHistorySnapshot('undo', type, before, diff);
    redoStackRef.current = []; // clear redo on new action
    lastCommittedSnapshotRef.current = after;
  }, [note, pushHistorySnapshot]);

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
    const handleManualSnapshot = async () => {
      if (!note || content == null) return;
      await window.electronAPI.saveNoteSnapshot(note.id, content, true);
      lastAutoSnapshotTimeRef.current = Date.now();
      document.dispatchEvent(new CustomEvent('manual-snapshot-completed'));
    };
    document.addEventListener('request-manual-snapshot', handleManualSnapshot);
    return () => document.removeEventListener('request-manual-snapshot', handleManualSnapshot);
  }, [note, content]);

  useEffect(() => {
    if (!note) {
      undoStackRef.current = [];
      redoStackRef.current = [];
      undoTotalDiffRef.current = 0;
      setEditHistoryCount(0);
      pendingHistoryBoundaryRef.current = null;
      lastCommittedSnapshotRef.current = { content: '', selectionStart: 0, selectionEnd: 0 };
      return;
    }

    let isCancelled = false;
    // History is now ephemeral across edits.
    undoStackRef.current = [];
    redoStackRef.current = [];
    undoTotalDiffRef.current = 0;
    setEditHistoryCount(0);

    return () => {
      isCancelled = true;
    };
  }, [note]);

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
        lastAutoSnapshotTimeRef.current = Date.now();
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
  const setPreviewColorFromElement = (key: HighlightColorKey) => {
    const currentHsva = colorToHsva(highlightColors[key]) ?? { h: 210, s: 10, v: 90, a: 1 };
    setColorSliderHsva(currentHsva);
    setSecondaryToolbarPanel('color-settings');
  };

  const applyPreviewColorToElement = (key: HighlightColorKey) => {
    if (!colorSliderHsva) return;
    const rgba = hsvaToRgbaString(colorSliderHsva);
    setHighlightColors((previousColors) => ({
      ...previousColors,
      [key]: rgba,
    }));
    localStorage.setItem(HIGHLIGHT_COLOR_STORAGE_KEYS[key], rgba);
  };

  const updateColorSliderValue = (next: HSVA) => {
    setColorSliderHsva(next);
  };

  const openSliderKeyInput = (key: ColorSliderKey) => {
    if (activeSliderInputKey === key) {
      setActiveSliderInputKey(null);
      return;
    }

    const current = colorSliderHsva ?? { h: 210, s: 10, v: 90, a: 1 };
    const prop = sliderKeyToHsvaProp(key);
    setActiveSliderInputKey(key);
    setSliderInputValue(String(sliderKeyToInputValue(key, current[prop])));
  };

  const commitSliderInput = () => {
    if (!activeSliderInputKey || !colorSliderHsva) {
      setActiveSliderInputKey(null);
      return;
    }
    const numeric = Number(sliderInputValue);
    if (!Number.isFinite(numeric)) {
      setActiveSliderInputKey(null);
      return;
    }

    const prop = sliderKeyToHsvaProp(activeSliderInputKey);
    const next = {
      ...colorSliderHsva,
      [prop]: inputValueToSliderValue(activeSliderInputKey, numeric),
    } as HSVA;
    updateColorSliderValue(next);
    setActiveSliderInputKey(null);
  };

  const applySliderInputValueToAllElements = (key: ColorSliderKey) => {
    const numeric = Number(sliderInputValue);
    if (!Number.isFinite(numeric)) return;
    const nextValue = Math.max(0, Math.min(255, numeric));

    const nextColors: HighlightColors = { ...highlightColors };
    const prop = sliderKeyToHsvaProp(key);
    (Object.keys(nextColors) as HighlightColorKey[]).forEach((colorKey) => {
      const hsva = colorToHsva(nextColors[colorKey]) ?? { h: 210, s: 10, v: 90, a: 1 };
      hsva[prop] = inputValueToSliderValue(key, nextValue);
      const rgba = hsvaToRgbaString(hsva);
      nextColors[colorKey] = rgba;
      localStorage.setItem(HIGHLIGHT_COLOR_STORAGE_KEYS[colorKey], rgba);
    });

    setHighlightColors(nextColors);
  };

  const applyCurrentSliderValueToAllElements = (key: ColorSliderKey) => {
    if (!colorSliderHsva) return;
    const numeric = sliderKeyToInputValue(key, colorSliderHsva[sliderKeyToHsvaProp(key)] as number);
    const nextValue = Math.max(0, Math.min(255, numeric));

    const nextColors: HighlightColors = { ...highlightColors };
    const prop = sliderKeyToHsvaProp(key);
    (Object.keys(nextColors) as HighlightColorKey[]).forEach((colorKey) => {
      const hsva = colorToHsva(nextColors[colorKey]) ?? { h: 210, s: 10, v: 90, a: 1 };
      hsva[prop] = inputValueToSliderValue(key, nextValue);
      const rgba = hsvaToRgbaString(hsva);
      nextColors[colorKey] = rgba;
      localStorage.setItem(HIGHLIGHT_COLOR_STORAGE_KEYS[colorKey], rgba);
    });

    setHighlightColors(nextColors);
  };

  useEffect(() => {
    if (showPreview && secondaryToolbarPanel) {
      setSecondaryToolbarPanel(null);
    }
  }, [showPreview, secondaryToolbarPanel]);

  useEffect(() => {
    if (secondaryToolbarPanel === 'color-settings' && !colorSliderHsva) {
      const firstKey: HighlightColorKey = 'caret';
      const currentHsva = colorToHsva(highlightColors[firstKey]) ?? { h: 210, s: 10, v: 90, a: 1 };
      setColorSliderHsva(currentHsva);
    }
  }, [secondaryToolbarPanel, colorSliderHsva, highlightColors]);

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
    if (!autoSaveEnabled || !note || content == null) return;
    const diskContent = content;
    if (diskContent === lastSavedContentRef.current) return;

    const savedNote = await window.electronAPI.saveNote(note.id, diskContent);
    lastSavedContentRef.current = diskContent;

    const now = Date.now();
    if (now - lastAutoSnapshotTimeRef.current >= 5 * 60 * 1000) {
      window.electronAPI.saveNoteSnapshot(note.id, diskContent, false)
        .then(() => {
          lastAutoSnapshotTimeRef.current = Date.now();
          document.dispatchEvent(new CustomEvent('auto-snapshot-completed'));
        })
        .catch(err => console.warn('snapshot save failed', err));
    }

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
  }, [autoSaveEnabled, note, content, extractTitle, onNoteUpdate]);

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
    if (undoStackRef.current.length === 0) return;

    if (pendingHistoryBoundaryRef.current) {
       // if we were in the middle of typing, we should flush it first or drop it?
       // user pressed Ctrl+Z while typing. Let's record the current state to redo stack first,
       // but since we haven't flushed, just pop undo
       pendingHistoryBoundaryRef.current = null;
    }

    const entry = undoStackRef.current.pop()!;
    undoTotalDiffRef.current -= entry.diff;

    // The undo entry has the snapshot from BEFORE the change.
    // But to REDO, we need the state from AFTER the change (which is current state).
    const redoDiff = -entry.diff;
    const currentSnapshot = buildSnapshot(content, liveSelectionStartRef.current, liveSelectionEndRef.current);
    redoStackRef.current.push({ type: entry.type, snapshot: currentSnapshot, diff: redoDiff });
    
    setEditHistoryCount(undoStackRef.current.length + redoStackRef.current.length);
    applySnapshotProgrammatically(entry.snapshot);
  }, [applySnapshotProgrammatically, buildSnapshot, content]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;

    if (pendingHistoryBoundaryRef.current) {
       pendingHistoryBoundaryRef.current = null;
    }

    const entry = redoStackRef.current.pop()!;
    
    const undoDiff = -entry.diff;
    const currentSnapshot = buildSnapshot(content, liveSelectionStartRef.current, liveSelectionEndRef.current);
    undoStackRef.current.push({ type: entry.type, snapshot: currentSnapshot, diff: undoDiff });
    undoTotalDiffRef.current += undoDiff;
    
    setEditHistoryCount(undoStackRef.current.length + redoStackRef.current.length);
    applySnapshotProgrammatically(entry.snapshot);
  }, [applySnapshotProgrammatically, buildSnapshot, content]);

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

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      handleRedo();
      return;
    }

    if (e.key === ' ' || e.key === 'Enter' || e.key === 'Tab') {
      bundleRecentChars();
    }

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

      const beforeSnapshot = lastCommittedSnapshotRef.current;
      const afterSnapshot = buildSnapshot(newText, newCursorPos, newCursorPos);
      recordHistoryEntry('enter', beforeSnapshot, afterSnapshot);

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

      const beforeSnapshot = lastCommittedSnapshotRef.current;
      const afterSnapshot = buildSnapshot(newText, newStart, newEnd);
      recordHistoryEntry('tab', beforeSnapshot, afterSnapshot);

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
              <button
                className={`toolbar-btn${secondaryToolbarPanel === 'color-settings' ? ' active' : ''}`}
                onClick={() => setSecondaryToolbarPanel((current) => current === 'color-settings' ? null : 'color-settings')}
                title="Toggle color settings"
              >
                Colors
              </button>

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

      <div className={`secondary-toolbar-panel${secondaryToolbarPanel ? ' is-visible' : ''}`}>
        {secondaryToolbarPanel === 'color-settings' && (
          <div className="secondary-toolbar-content">
            <div className="highlight-color-controls">
              <div className="highlight-color-buttons-row">
                {(['caret', 'selection', 'background', 'topBackground', 'bottomBackground'] as HighlightColorKey[]).map((key) => (
                  <button
                    key={key}
                    className="toolbar-btn-icon color-swatch-btn"
                    style={{
                      background: highlightColors[key],
                      color: getHighlightLabelColor(highlightColors[key]),
                    }}
                    onClick={() => setPreviewColorFromElement(key)}
                    onContextMenu={(e) => {
                      if (!colorSliderHsva) return;
                      e.preventDefault();
                      applyPreviewColorToElement(key);
                    }}
                    title={HIGHLIGHT_COLOR_TITLES[key]}
                  >
                    {HIGHLIGHT_COLOR_LABELS[key]}
                  </button>
                ))}
              </div>

              {colorSliderHsva && (
                <div className="highlight-color-panel">
                  <div className="highlight-color-sliders-row">
                    {([
                      { key: 'hue', label: 'H', min: 0, max: 360, step: 1, value: colorSliderHsva.h },
                      { key: 'saturation', label: 'S', min: 0, max: 100, step: 1, value: colorSliderHsva.s },
                      { key: 'vibrancy', label: 'V', min: 0, max: 100, step: 1, value: colorSliderHsva.v },
                      { key: 'alpha', label: 'A', min: 0, max: 100, step: 1, value: Math.round(colorSliderHsva.a * 100) },
                    ] as Array<{ key: ColorSliderKey; label: string; min: number; max: number; step: number; value: number }>).map((slider) => (
                      <div key={slider.key} className="highlight-color-slider-cell">
                        {activeSliderInputKey === slider.key ? (
                          <input
                            className="slider-key-input"
                            value={sliderInputValue}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            onChange={(e) => setSliderInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                            onBlur={commitSliderInput}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                commitSliderInput();
                              } else if (e.key === 'Escape') {
                                setActiveSliderInputKey(null);
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              applySliderInputValueToAllElements(slider.key);
                            }}
                            title="Right click to apply this channel value to all elements"
                          />
                        ) : (
                          <button
                            className="toolbar-btn-icon slider-key-btn"
                            type="button"
                            style={colorSliderHsva ? {
                              backgroundColor: sliderKeyBackground(slider.key, colorSliderHsva),
                              ...sliderKeyTextStyle(slider.key, colorSliderHsva),
                            } : undefined}
                            onClick={() => openSliderKeyInput(slider.key)}
                            onContextMenu={(e) => {
                              if (!colorSliderHsva) return;
                              e.preventDefault();
                              applyCurrentSliderValueToAllElements(slider.key);
                            }}
                            title="Click to enter exact 0–255 value; right click to apply this channel value to all elements"
                          >
                            {slider.label}
                          </button>
                        )}
                        <input
                          id={`color-slider-${slider.key}`}
                          type="range"
                          min={slider.min}
                          max={slider.max}
                          step={slider.step}
                          value={slider.value}
                          onChange={(e) => {
                            const numeric = Number(e.target.value);
                            const next = { ...colorSliderHsva };
                            if (slider.key === 'hue') next.h = numeric;
                            if (slider.key === 'saturation') next.s = numeric;
                            if (slider.key === 'vibrancy') next.v = numeric;
                            if (slider.key === 'alpha') next.a = numeric / 100;
                            updateColorSliderValue(next);
                            if (activeSliderInputKey === slider.key) {
                              setSliderInputValue(String(sliderKeyToInputValue(slider.key, getSliderValueFromHsva(slider.key, next))));
                            }
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  <button
                    className="toolbar-btn-icon color-preview-btn"
                    style={{
                      background: hsvaToRgbaString(colorSliderHsva),
                      color: getHighlightLabelColor(hsvaToRgbaString(colorSliderHsva)),
                    }}
                    title="Preview"
                    aria-label="Current color preview"
                    disabled
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={`editor-content ${showPreview ? 'is-preview' : 'is-editor'}`} ref={editorContentRef} style={!showPreview ? { overflow: 'hidden' } : undefined}>
        {!showPreview ? (
          <FixedFocusEditor
            key={`${editorStyle}-${editorFontSize}-${editorSpacing}-${layoutRevision}`}
            text={timeMachineSnapshotContent ?? content}
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
            timelineProps={timelineProps}
            onTextChange={(newText, newSelectionStart, newSelectionEnd) => {
              onTimeMachineInterrupt?.();
              const beforeSnapshot = lastCommittedSnapshotRef.current;
              if (beforeSnapshot.content !== newText) {
                const diff = Math.abs(newText.length - beforeSnapshot.content.length);
                const reason = diff > 10 ? 'paste' : 'char';
                const afterSnapshot = buildSnapshot(newText, newSelectionStart, newSelectionEnd);
                recordHistoryEntry(reason, beforeSnapshot, afterSnapshot);
              }
              handleContentChange(newText);
              syncSelectionState(newSelectionStart, newSelectionEnd);
              checkCursorPosition();
            }}
            onSelectionChange={(start, end) => {
              onTimeMachineInterrupt?.();
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
              {(timeMachineSnapshotContent ?? content) || '_No content_'}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};