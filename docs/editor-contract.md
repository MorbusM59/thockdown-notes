# Editor Contract

## Purpose
This contract isolates app features from editor engine internals. Features that depend on editor state must integrate through this boundary, not through direct plugin internals.

## Source of Truth
- Contract types: `src/editor/EditorContract.ts`
- Sole implementation: `src/components/CM6Editor.tsx` (production editor as of 0.5.4's CM6
  migration). The prior Lexical-backed `src/components/Editor.tsx` and its
  `localStorage['thockdown:cm6-editor-spike'] = '0'` rollback path were removed once CM6 was
  confirmed production-ready — see `docs/document-scale-performance-philosophy.md` and
  `docs/cm6-parity-hardening-plan.md` for that history. There is no fallback implementation
  anymore; `EditorContract.ts`'s capability-flag shape stays as a contract, not because a second
  implementation might be partial relative to it.

## Canonical Semantics

### Text Model
- Plain text uses `\n` as the line break representation.
- Text and title-line semantics are contract-defined and fully implemented.

### Selection Model
- Selection indices are global document offsets (`anchor`, `focus`, `start`, `end`).
- Collapsed caret is represented with `isCollapsed = true` and `start = end`.
- Selection events are emitted by the contract bridge.
- Current offset extraction strategy is DOM-range based within the editor root.

### Viewport Model
- Fixed-focus viewport state is authoritative for integration points.
- `topBoundaryPx` and `bottomBoundaryPx` are quantized to line-height increments.
- `scrollTopPx` is tracked from the editor scroller.

#### Persisted scroll position (scroll-sync rewrite)
- Exactly one thing is persisted per note, and independently per Timeline
  snapshot: `anchorBlockIndex` -- the canonical, mode-agnostic BLOCK, an
  index into the note's current top-level `PreviewMarkdownBlock[]` array
  (`src/editor/PreviewBlockSplit.ts`), resolved via
  `PreviewBlockIndex.ts`'s `resolvePreviewBlockIndexForSourceLine`/
  `resolveSourceLineForAnchorBlockIndex`. No raw pixel offsets, and no
  separate edit/preview values, are ever persisted.
- Written only at enumerated "note/snapshot leaves an editor" checkpoints:
  a note or section-clear/close/swap/quit checkpoint (`saveNoteUiState`),
  or a Timeline snapshot being navigated away from
  (`saveSnapshotAnchor`, `useNoteSnapshotTimeline.ts`'s
  `handleNavigateSnapshot`/`handleReturnToPresent`). If the same note is
  open in multiple editors, whichever leaves last wins -- no
  reconciliation, by design.
- Restored on first load of a note/snapshot into a section, landing one
  line-height below the top border (`RESTORE_OFFSET_LINES` in
  `EditRestoreMath.ts`), not flush against it. Falls back to top of
  document (index 0) if the persisted index is out of range for the
  document's current blocks -- deliberately no fuzzy/nearest-block
  matching.
- The only other legitimate scroll-restore trigger is an edit&#8596;preview
  mode switch within an already-open section
  (`sectionRequiresScrollUpdateRef` in `useEditorSectionMount.ts`). No
  other code path should call a scroll restore.

#### The BLOCK is the persistence unit, the LINE is the live unit
- A mode switch carries the **exact source line** the reader is on, not the
  block containing it. Both directions of `toggleRenderViewMode` pass the
  line straight through: within one toggle the document is byte-identical on
  both sides, so there is nothing for a coarser representation to protect
  against, and quantizing to the block start is pure loss -- leaving a note
  from the tenth bullet of a list returned the reader to its first bullet.
  (A `+ 1 block` fudge used to sit on the edit&#8594;render leg to offset part
  of that loss; carrying the line removes the cause and the fudge with it.)
- The BLOCK remains the unit for **persistence** (`anchorBlockIndex`), where
  line numbers genuinely can shift between save and restore. Reopening a note
  therefore still lands on a block boundary; a live mode switch does not.
- **One reference point, four operations.** `RESTORE_OFFSET_LINES`
  (`EditRestoreMath.ts`) is not only where a restore *lands* -- it is also
  where each mode *reads* its current position. Edit resolves the line at
  `scrollTop + topBoundary + RESTORE_OFFSET_LINES`
  (`resolveSourceAnchorFromEditState`); render resolves the element the same
  line cuts through (`selectPreviewAnchorCandidate`'s `referenceOffsetPx`).
  If reading and landing ever use different offsets, every switch shifts the
  position by the difference and repeated switches walk the document.

### Lifecycle Model
- `mounted`: component mounted.
- `ready`: editor surface is ready to receive integration calls.
- `destroyed`: component unmounted.

## Event Semantics
- `onViewportChange`:
  - `source = user-input` for user-driven scrolling.
  - `source = programmatic` for boundary updates and snapshot application.
- `onTextChange` and `onSelectionChange` are active.
- Command transform hooks are active for tab, markdown shortcuts, and enter:
  - `onTabIndentTransform`
  - `onMarkdownShortcutTransform`
  - `onEnterTransform`
- Current source mapping is conservative but deterministic:
  - `restore` updates map to `programmatic`.
  - `history-redo` tag maps to `history-redo`.
  - `historic` updates map to `history-undo`.
  - default remains `user-input`.

## Adapter Semantics
- `getCapabilities()` must be checked by callers before relying on a capability.
- `getSnapshot()` returns current integration-safe state.
- `applySnapshot()` restores supported subsets without forcing unsupported behavior.
- Unsupported snapshot fields must be treated as no-ops by callers unless the corresponding granular capability is true.
- `applySnapshot(selection)` honors `selectionScrollBehavior` (default, if omitted, is `center-caged`), skipped entirely when the same call also sets `viewport`/`viewportLines` (those already drive scroll explicitly):
  - `preserve-scroll`: apply selection while preserving current `scrollTop`.
  - `center-caged`: scroll the new selection to the vertical center of the cage (`topBoundaryPx`..`clientHeight - bottomBoundaryPx`), not its near edge -- used for discrete jumps (search-hit navigation, go-to-start/end) so an inaccurate CM6 height estimate for not-yet-measured content still leaves roughly half a viewport of slack instead of undershooting off-screen. Self-corrects across a few frames if CM6 revises its height map after the initial write (see `reconcileSelectionJumpScroll` in CM6Editor.tsx).
- Transform-originated selection replay is intentionally deferred to the next frame
  to avoid applying offsets against pre-transform DOM text.

## Current Capability Status
- `textEvents`: true
- `selectionEvents`: true
- `viewportEvents`: true
- `snapshotRead`: true
- `snapshotWrite`: false
- `snapshotWriteText`: false
- `snapshotWriteSelection`: true
- `snapshotWriteViewport`: true

## Usage Example
```ts
import { useRef } from 'react';
import { CM6Editor } from '../components/CM6Editor';
import type { EditorAdapter } from '../editor/EditorContract';

const adapterRef = useRef<EditorAdapter | null>(null);

<CM6Editor
  adapterRef={adapterRef}
  bindings={{
    onViewportChange: (event) => {
      console.log('viewport', event.viewport);
    },
  }}
/>;
```

## Rule for Future Work
Before adding a feature that depends on editor state, extend `EditorContract.ts` first, then implement through `CM6Editor.tsx`, then update this document.
