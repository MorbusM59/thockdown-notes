# V2 Editor Contract

## Purpose
This contract isolates app features from editor engine internals. All carryover work from V1 must integrate through this boundary, not through direct plugin internals.

## Source of Truth
- Contract types: `src/editor/EditorContract.ts`
- Current implementation: `src/components/Editor.tsx`

## Canonical Semantics

### Text Model
- Plain text uses `\n` as the line break representation.
- Text and title-line semantics are contract-defined but not yet fully implemented in the Lexical bridge.
- Until text events go live, app modules must not infer content from editor DOM.

### Selection Model
- Selection indices are global document offsets (`anchor`, `focus`, `start`, `end`).
- Collapsed caret is represented with `isCollapsed = true` and `start = end`.
- Selection events are emitted by the contract bridge.
- Current offset extraction strategy is DOM-range based within the editor root.

### Viewport Model
- Fixed-focus viewport state is authoritative for integration points.
- `topBoundaryPx` and `bottomBoundaryPx` are quantized to line-height increments.
- `scrollTopPx` is tracked from the editor scroller.

### Lifecycle Model
- `mounted`: component mounted.
- `ready`: editor surface is ready to receive integration calls.
- `destroyed`: component unmounted.

## Event Semantics
- `onViewportChange`:
  - `source = user-input` for user-driven scrolling.
  - `source = programmatic` for boundary updates and snapshot application.
- `onTextChange` and `onSelectionChange` are active.
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

## Current Capability Status
- `textEvents`: true
- `selectionEvents`: true
- `viewportEvents`: true
- `snapshotRead`: true
- `snapshotWrite`: false
- `snapshotWriteText`: false
- `snapshotWriteSelection`: false
- `snapshotWriteViewport`: true

## Usage Example
```ts
import { useRef } from 'react';
import { Editor } from '../components/Editor';
import type { EditorAdapter } from '../editor/EditorContract';

const adapterRef = useRef<EditorAdapter | null>(null);

<Editor
  adapterRef={adapterRef}
  bindings={{
    onViewportChange: (event) => {
      console.log('viewport', event.viewport);
    },
  }}
/>;
```

## Rule for Future Work
Before adding a feature that depends on editor state, extend `EditorContract.ts` first, then implement through `Editor.tsx`, then update this document and the parity checklist.
