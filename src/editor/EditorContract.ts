export type EditorChangeSource =
  | 'user-input'
  | 'programmatic'
  | 'history-undo'
  | 'history-redo'
  | 'initial-load';

export type EditorLifecyclePhase = 'mounted' | 'ready' | 'destroyed';

export interface EditorSelectionState {
  anchor: number;
  focus: number;
  start: number;
  end: number;
  isCollapsed: boolean;
}

export interface EditorViewportState {
  topBoundaryPx: number;
  bottomBoundaryPx: number;
  scrollTopPx: number;
  lineHeightPx: number;
  cellWidthPx: number;
  scrollHeightPx?: number;
  clientHeightPx?: number;
}

// Persisted/restorable boundary and scroll position, expressed as integer
// line counts rather than pixels. Line counts are resolution-independent:
// they survive across sessions and font/line-height changes without ever
// needing to be validated against a live DOM measurement. Display pixel
// values are derived from these at render time via a pure clamp function
// (see clampBoundaryLines in Editor.tsx) and are never written back into
// this stored representation except in response to an explicit user drag.
export interface EditorViewportLines {
  topBoundaryLines: number;
  bottomBoundaryLines: number;
  scrollTopLines: number;
}

export interface EditorTextChangeEvent {
  source: EditorChangeSource;
  text: string;
  previousText: string;
  selection: EditorSelectionState;
}

export interface EditorSelectionChangeEvent {
  source: EditorChangeSource;
  selection: EditorSelectionState;
}

export interface EditorViewportChangeEvent {
  source: EditorChangeSource;
  viewport: EditorViewportState;
}

export interface EditorLifecycleEvent {
  phase: EditorLifecyclePhase;
}

export interface EditorSnapshot {
  text: string;
  selection: EditorSelectionState;
  viewport: EditorViewportState;
  // Present once the editor has resolved its restored boundary/scroll line
  // counts (either from an applySnapshot({ viewportLines }) call, or from
  // the default 0/0/0 if nothing was restored). Absent while the editor is
  // still waiting on a restore to arrive.
  viewportLines?: EditorViewportLines;
}

export type EditorSelectionScrollBehavior = 'center-caged' | 'preserve-scroll';

export interface EditorSnapshotApplyRequest extends Partial<EditorSnapshot> {
  selectionScrollBehavior?: EditorSelectionScrollBehavior;
  // Restores the boundary/scroll position from integer line counts. This is
  // the preferred restore path: no clamping is performed against the
  // current container size at apply time. Display values are derived lazily
  // and continuously via clampBoundaryLines, so applying this is safe at
  // any point, including before the container has been measured.
  viewportLines?: EditorViewportLines;
}

export interface EditorCapabilityMap {
  textEvents: boolean;
  selectionEvents: boolean;
  viewportEvents: boolean;
  snapshotRead: boolean;
  // True only when applySnapshot can restore text + selection + viewport.
  snapshotWrite: boolean;
  // Granular snapshot restore capability flags for partial implementations.
  snapshotWriteText: boolean;
  snapshotWriteSelection: boolean;
  snapshotWriteViewport: boolean;
}

// This is the stable contract app modules integrate against. Implementations
// may be partial while the rewrite is in flight; capabilities describe what is live.
export interface EditorAdapter {
  getCapabilities(): EditorCapabilityMap;
  getSnapshot(): EditorSnapshot | null;
  applySnapshot(snapshot: EditorSnapshotApplyRequest): void;
}

export interface EditorBindings {
  onLifecycle?: (event: EditorLifecycleEvent) => void;
  onTextChange?: (event: EditorTextChangeEvent) => void;
  onSelectionChange?: (event: EditorSelectionChangeEvent) => void;
  onViewportChange?: (event: EditorViewportChangeEvent) => void;
  onTabIndent?: (event: { shiftKey: boolean }) => void;
  onTabIndentTransform?: (event: {
    shiftKey: boolean;
    text: string;
    selection: EditorSelectionState;
  }) => {
    text: string;
    selection: EditorSelectionState;
  } | null;
  onMarkdownShortcutTransform?: (event: {
    shortcut: 'bold' | 'italic' | 'strikethrough' | 'heading-toggle' | 'unordered-list' | 'ordered-list';
    text: string;
    selection: EditorSelectionState;
  }) => {
    text: string;
    selection: EditorSelectionState;
  } | null;
  onEnterTransform?: (event: {
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    text: string;
    selection: EditorSelectionState;
  }) => {
    text: string;
    selection: EditorSelectionState;
  } | null;
}
