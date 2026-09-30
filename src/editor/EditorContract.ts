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

/**
 * A single contiguous document edit, in start-state coordinates:
 * `text.slice(0, from) + insert + text.slice(to)` is the resulting document.
 *
 * One range is enough for every transform this editor has. Verified rather
 * than assumed: the multi-line cases (indentSelectionByStep, the bulleted and
 * numbered list toggles) each already compute one contiguous block
 * `[lineStart, lineEndExclusive)`, rewrite the lines inside it and join --
 * so the block they build IS the insert, and no multi-range shape is needed.
 */
export interface EditorTextEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * What a transform returns.
 *
 * `edit` is authoritative and `text` is derived from it: the invariant is
 * `text === previousText.slice(0, edit.from) + edit.insert +
 * previousText.slice(edit.to)`, asserted in development by
 * assertTransformResultConsistency.
 *
 * Both are carried deliberately. A transform knows exactly what it changed;
 * before `edit` existed the contract discarded that and the editor had to
 * rediscover the position by walking two whole documents with a
 * common-prefix/common-suffix diff -- O(document) work, on every Enter and
 * every Tab, to recover a number the transform had already computed.
 *
 * `text` stays because the app's state model genuinely needs the whole
 * document (the note text in React state, the save queue, the title
 * preview), and because building it is cheap in a way the scan was not:
 * V8 represents `a.slice(0, i) + b + a.slice(j)` as sliced and cons strings,
 * so the concatenation is O(1) pointers rather than O(document) copying.
 * The scan was what forced a flatten. Making the whole-document string
 * itself unnecessary is a separate, larger change to how app state is held.
 */
export interface EditorTransformResult {
  text: string;
  selection: EditorSelectionState;
  edit: EditorTextEdit;
  /**
   * A step applied BEFORE this one and recorded in the undo history as a
   * separate entry, so one undo takes back this result and leaves the
   * prelude in place, and a second takes back the prelude. Used where one
   * keypress does two things the reader may want to keep apart -- a table's
   * Enter tidies the row just left, then starts a new row
   * (MarkdownTableTransforms.ts). This result's `edit` and `selection` index
   * the prelude's `text`, not the text the transform was given; `text` is
   * the final document either way.
   */
  prelude?: EditorTransformResult;
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
  // KeyboardEvent.code of the keydown immediately preceding this change, if
  // any (undefined for undo/redo, programmatic edits, or anything else not
  // directly driven by a fresh keydown). Backs the keystroke-sound spatial
  // slider's keyboard-position mode (TypingSoundManager) -- `code` is a
  // layout-independent physical key identifier, unlike the character the
  // change actually inserted, which depends on the active OS keyboard
  // layout (e.g. QWERTY vs QWERTZ).
  physicalKeyCode?: string;
  /**
   * The single contiguous edit that produced `text` from `previousText`, in
   * `previousText` coordinates -- or null when this change was not a single
   * range (a multi-range transaction, an undo of one) or has no meaningful
   * predecessor (initial load).
   *
   * Null means "recompute from scratch", never "nothing changed". Consumers
   * that maintain incremental state off this MUST treat it as the
   * correctness fallback it is; see DocumentLineIndex.ts, which does.
   *
   * Carried so app-state consumers stop rediscovering it. Before this, the
   * note title, the word count and the markdown inline-state cache each
   * derived the edit again from two whole documents -- by splitting both
   * into lines, or by a prefix/suffix diff -- on every keystroke, to do a
   * few characters' worth of work with the answer.
   */
  edit: EditorTextEdit | null;
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

/**
 * How the editor should move the viewport for a programmatically applied
 * selection. 'center-caged' animates there -- the motion is what orients a
 * reader who is staying inside the document they were already reading (a
 * find hit, a link to another part of the same note). 'center-caged-instant'
 * lands on the same position with no animation, for the case where there is
 * nothing to orient: arriving from a *different* note, where the position
 * being travelled from is one the reader never chose and mostly never saw.
 *
 * 'top-caged-instant' lands the selection's line at the TOP of the caged
 * area (one line below the boundary, the same RESTORE_OFFSET_LINES convention
 * every restore uses) instead of centring it, with no animation. That is for
 * a jump whose target is a structural boundary rather than a point inside
 * prose: a heading opens the section under it, so the section is what should
 * be on screen. Centring a heading spends the upper half of the viewport on
 * the section being left.
 */
export type EditorSelectionScrollBehavior = 'center-caged' | 'center-caged-instant' | 'top-caged-instant' | 'preserve-scroll';

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
  // Where the caret currently sits across the *visual* (wrapped) row it's
  // on: 0 at the row's start, 1 at its last column before an automatic
  // line-wrap (or the logical line end, whichever comes first). Backs the
  // keystroke-sound spatial slider's caret-position mode (TypingSoundManager)
  // -- an adapter primitive rather than a caller-side DOM measurement for
  // the same reason as the pair above: correctly finding "the current
  // wrapped row's bounds" depends on line-wrapping layout only the editor
  // can reason about. Returns null when the adapter can't currently answer.
  resolveCaretHorizontalWrapRatio(): number | null;
  // The span of 0-indexed source lines currently on screen, or null when the
  // adapter can't answer yet. Block-granular by nature: a wrapped logical line
  // whose first row is above the fold still counts as visible, because the
  // editor's own height map answers in logical lines.
  //
  // An adapter primitive for the same reason the pair above are: only the
  // editor knows how its lines map onto heights. The render view answers the
  // same question through DocumentPosition.readVisibleSourceLineRange, and the
  // two are deliberately the same shape so a caller can ask either one.
  readVisibleSourceLineRange(): { fromLine: number; toLine: number } | null;
  // Calls `listener` whenever the visible range may have moved -- today, on
  // every scroll. Returns its own unsubscribe.
  //
  // Separate from the `onViewportChange` binding rather than folded into it:
  // bindings are a single object owned by one consumer (the section mount),
  // and this is a signal several unrelated features want at once. A listener
  // set is the honest shape for that; routing a second consumer through the
  // one binding would make the mount hook responsible for fanning out events
  // it has no interest in.
  subscribeToViewportChange(listener: () => void): () => void;
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
  }) => EditorTransformResult | null;
  onMarkdownShortcutTransform?: (event: {
    shortcut: 'bold' | 'italic' | 'strikethrough' | 'heading-toggle' | 'unordered-list' | 'ordered-list';
    text: string;
    selection: EditorSelectionState;
  }) => EditorTransformResult | null;
  onCharacterInsertTransform?: (event: {
    char: string;
    text: string;
    selection: EditorSelectionState;
  }) => EditorTransformResult | null;
  onEnterTransform?: (event: {
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    text: string;
    selection: EditorSelectionState;
  }) => EditorTransformResult | null;
  /**
   * A primary click in the edit view, before the click moves the caret.
   * `clickOffset` is the box under the pointer (boxPointer.ts's
   * resolveBoxAtCoords); `selection` is still where the caret was. Each
   * policy decides for itself which clicks it acts on -- a checkbox toggles
   * only when the click lands on the caret's own box, a table divider on
   * any click. Returning null lets the click place the caret as usual.
   */
  onCaretClickTransform?: (event: {
    text: string;
    selection: EditorSelectionState;
    clickOffset: number;
  }) => EditorTransformResult | null;
  /**
   * Shift+Backspace and Ctrl+Backspace, before the editor's own handling.
   * Plain Backspace never reaches this. Returning null leaves the key to do
   * what it does anywhere else (Ctrl+Backspace: delete the previous word).
   */
  onModifiedBackspaceTransform?: (event: {
    modifier: 'shift' | 'ctrl';
    text: string;
    selection: EditorSelectionState;
  }) => EditorTransformResult | null;
}
