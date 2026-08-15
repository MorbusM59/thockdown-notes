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

export type EditorViewportChangeOrigin = 'viewport-drag' | 'scroll' | 'programmatic';

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
// (see clampBoundaryLines in CM6Editor.tsx) and are never written back into
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
  origin?: EditorViewportChangeOrigin;
  // Correlates programmatic viewport events with the scroll transition that
  // produced them (restore/settle operation ID).
  transitionId?: number;
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
  // Optional operation ID for deterministic restore handoff tracking.
  transitionId?: number;
  // Restores the boundary/scroll position from integer line counts. This is
  // the preferred restore path: no clamping is performed against the
  // current container size at apply time. Display values are derived lazily
  // and continuously via clampBoundaryLines, so applying this is safe at
  // any point, including before the container has been measured.
  viewportLines?: EditorViewportLines;
  // Marks this apply as a silent follow-up nudge to an already-in-flight
  // restore (see useEditorSectionMount.ts's settleCorrectionLoop), not a new
  // restore in its own right: the adapter must still move scrollTop, but
  // must NOT re-open/extend the input-blocking restore-settle transition or
  // its caret-suppression window a second time. Without this, re-running the
  // same correction on every settle-recheck frame kept re-arming that block
  // on each pass, and could hold real user wheel/scroll input hostage for
  // far longer than any single restore is meant to.
  quiet?: boolean;
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

// This is the stable contract app modules integrate against. CM6Editor.tsx
// (src/components/CM6Editor.tsx) is the sole implementation as of 0.5.4's
// CM6 migration -- the prior Lexical-backed Editor.tsx and its rollback
// path were removed once CM6 was confirmed production-ready (see
// docs/document-scale-performance-philosophy.md and
// docs/cm6-parity-hardening-plan.md). The capability-flag shape stays,
// since it's still useful as a contract, but there is no second
// implementation to be partial relative to it anymore.
export interface EditorAdapter {
  getCapabilities(): EditorCapabilityMap;
  getSnapshot(): EditorSnapshot | null;
  applySnapshot(snapshot: EditorSnapshotApplyRequest): void;
  // Precise edit<->preview scroll-position sync (EditRestoreMath.ts) needs to
  // convert between "a document-relative vertical pixel offset" (the same
  // coordinate space as EditorViewportState's scrollTopPx) and "a 0-indexed
  // line number in the plain source text" -- exact inverses of each other.
  // These exist as adapter primitives, not DOM queries done by the caller,
  // because that conversion is fundamentally editor-internal: it depends on
  // line-wrapping (a "source line" can span many visual rows) and on
  // whatever layout/virtualization scheme the editor uses, neither of which
  // any caller outside the adapter can correctly reason about from the DOM
  // alone. Both return null when the adapter can't currently answer (not
  // yet mounted, position out of range) -- callers must treat that as "the
  // sync can't happen right now," never as a resolved answer of 0.
  resolveSourceLineAtHeight(heightPx: number): number | null;
  resolveHeightForSourceLine(sourceLine: number): number | null;
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
  onCharacterInsertTransform?: (event: {
    char: string;
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
  onCaretClickTransform?: (event: {
    text: string;
    selection: EditorSelectionState;
  }) => {
    text: string;
    selection: EditorSelectionState;
  } | null;
}
