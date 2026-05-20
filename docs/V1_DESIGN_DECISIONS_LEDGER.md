# V1 Design Decisions Ledger

This ledger extracts design choices from V1 implementation on `main` and classifies each item.

Legend:
- `EXPLICIT`: Directly encoded in code behavior.
- `INFERRED`: Strongly implied by implementation patterns.
- `AMBIGUOUS`: Multiple plausible interpretations; requires product call.

## 1. Editor Interaction Model

1. `EXPLICIT` - Escape toggles edit/preview mode.
   - Source ref: `main:src/components/App.tsx`

2. `EXPLICIT` - `Ctrl+N` creates new note; `Ctrl+Shift+N` creates from clipboard and positions cursor to second line.
   - Source ref: `main:src/components/App.tsx`

3. `EXPLICIT` - Enter handling is custom and markdown-aware (indent/list continuation).
   - Source ref: `main:src/components/MarkdownEditor.tsx`

4. `EXPLICIT` - Tab and Shift+Tab apply indentation logic using quantized steps.
   - Source ref: `main:src/components/MarkdownEditor.tsx`

5. `EXPLICIT` - Undo/redo keybindings are handled explicitly in editor keydown.
   - Source ref: `main:src/components/MarkdownEditor.tsx`

6. `EXPLICIT` - Time-travel lock prevents non-navigation edits while viewing history snapshots.
   - Source ref: `main:src/components/MarkdownEditor.tsx`

7. `INFERRED` - Editor architecture intentionally centralizes authoritative global selection state to avoid slice-relative desync.
   - Source ref: `main:src/components/MarkdownEditor.tsx`

8. `EXPLICIT` - Font readiness and resize reflow are part of core correctness, not cosmetic polish.
   - Source ref: `main:src/components/MarkdownEditor.tsx`

9. `AMBIGUOUS` - Exact spacing/quantization constants are partly aesthetic and may represent tuned compromise rather than hard product intent.
   - Source ref: `main:src/components/MarkdownEditor.tsx`

## 2. Autosave and Note Semantics

1. `EXPLICIT` - Autosave is debounced and title-line aware (guarded while on first line).
   - Source ref: `main:src/components/MarkdownEditor.tsx`

2. `EXPLICIT` - Leaving first-line context triggers save resumption.
   - Source ref: `main:src/components/MarkdownEditor.tsx`

3. `EXPLICIT` - Force-save handshake exists between renderer and main before sensitive transitions (preview toggle/external-open).
   - Source ref: `main:src/components/App.tsx`, `main:src/preload.ts`, `main:src/index.ts`

4. `EXPLICIT` - First markdown heading defines note title semantics.
   - Source ref: `main:src/components/MarkdownEditor.tsx`

## 3. Fixed Focus and Visual Mechanics

1. `EXPLICIT` - Fixed-focus editor viewport is treated as a core behavior layer with explicit wrapping/viewport model utilities.
   - Source ref: `main:src/components/FixedFocusViewport/FixedFocusEditor.tsx`, `main:src/components/FixedFocusViewport/textWrapping.ts`, `main:src/components/FixedFocusViewport/viewportModel.ts`

2. `EXPLICIT` - Grid/caret/line alignment correctness is managed by explicit sizing and measurement logic, not default browser flow.
   - Source ref: `main:src/components/MarkdownEditor.tsx`, `main:src/components/FixedFocusViewport/lineMetrics.ts`

3. `INFERRED` - V1 intentionally trades implementation complexity for deterministic rendering behavior.
   - Source ref: `main:src/components/MarkdownEditor.tsx`, `main:src/components/FixedFocusViewport/*`

## 4. Sidebar, Navigation, and View Modes

1. `EXPLICIT` - Four primary modes: `latest`, `active`, `archived`, `trash`.
   - Source ref: `main:src/components/Sidebar.tsx`

2. `EXPLICIT` - Date mode filters by month/year and suppresses deleted notes; archived notes are hidden unless date filters are active.
   - Source ref: `main:src/components/Sidebar.tsx`

3. `EXPLICIT` - Category tree auto-expands around current note after hierarchy updates.
   - Source ref: `main:src/components/Sidebar.tsx`

4. `EXPLICIT` - Search supports text and `#tag` modes with dedicated handling.
   - Source ref: `main:src/components/Sidebar.tsx`, `main:src/main/database.ts`

5. `EXPLICIT` - Two-step armed actions are used for destructive operations.
   - Source ref: `main:src/components/Sidebar.tsx`

## 5. Tags and Classification

1. `EXPLICIT` - Tag names are normalized to lowercase with whitespace-to-hyphen conversion.
   - Source ref: `main:src/components/TagInput.tsx`

2. `EXPLICIT` - Protected tags (`deleted`, `archived`, `temp`) are constrained and not treated as regular user tags.
   - Source ref: `main:src/components/TagInput.tsx`, `main:src/components/Sidebar.tsx`

3. `EXPLICIT` - Tag ordering is position-based and reorderable via drag/drop.
   - Source ref: `main:src/components/TagInput.tsx`, `main:src/main/database.ts`

4. `INFERRED` - Primary/secondary/tertiary position semantics are central to category organization.
   - Source ref: `main:src/main/database.ts`, `main:src/components/Sidebar.tsx`

## 6. Timeline / Time Machine

1. `EXPLICIT` - Timeline uses nonlinear/log-like distribution to map snapshot age into discrete columns.
   - Source ref: `main:src/components/Timeline.tsx`

2. `EXPLICIT` - Present-state box behavior differs from historical boxes (manual snapshot vs return-to-present).
   - Source ref: `main:src/components/Timeline.tsx`

3. `EXPLICIT` - Snapshot deletion uses arm-then-confirm right-click pattern.
   - Source ref: `main:src/components/Timeline.tsx`

4. `EXPLICIT` - Overlapping snapshot columns open a flyout selector.
   - Source ref: `main:src/components/Timeline.tsx`

## 7. Persistence and Query Semantics

1. `EXPLICIT` - Local SQLite is canonical metadata/query store.
   - Source ref: `main:src/main/database.ts`

2. `EXPLICIT` - Markdown files are canonical content storage and import/export bridge.
   - Source ref: `main:src/main/fileSystem.ts`

3. `EXPLICIT` - FTS search has layered fallbacks (FTS query, safe inline query, manual scan) for robustness.
   - Source ref: `main:src/main/database.ts`

4. `EXPLICIT` - Search snippets are context-windowed and highlighted.
   - Source ref: `main:src/main/database.ts`

5. `EXPLICIT` - UI edit state persists per note (cursor/progress/scroll).
   - Source ref: `main:src/main/database.ts`, `main:src/preload.ts`

6. `EXPLICIT` - Snapshot records are persisted and queryable per note.
   - Source ref: `main:src/main/database.ts`

## 8. Process Boundaries and Runtime Safety

1. `EXPLICIT` - Preload provides validated, minimal API facade to renderer.
   - Source ref: `main:src/preload.ts`

2. `EXPLICIT` - Main process enforces context isolation, manages IO, and gates window navigation/security behavior.
   - Source ref: `main:src/index.ts`

3. `EXPLICIT` - Window state persistence is part of expected lifecycle behavior.
   - Source ref: `main:src/index.ts`

4. `EXPLICIT` - External link and `window.open` handling are controlled by explicit policy.
   - Source ref: `main:src/index.ts`

## 9. Known Ambiguities To Resolve Before Full Parity Lock

1. Whether all V1 quantization constants (indent width, scroll jump size, boundary offsets) are strict requirements or tunable implementation artifacts.

2. Whether V1 behavior around emoji/special-character sanitization for externally opened files is desired product behavior or defensive workaround.

3. Whether timeline log-base defaults and clustering behavior are part of product identity or adjustable ergonomics.

4. Whether fallback dev-server URL behavior in main process is expected in V2 or should be removed for cleaner runtime guarantees.

## 9.1 Resolved Product Calls (2026-05-19)

1. Quantization constants are tunable.
   - Constraint: behavior must retain V1 feel while improving stability/performance.

2. External input sanitization is strict plain text.
   - Constraint: no links, graphics, styling artifacts, emojis, or non-standard characters.

3. Timeline distribution is not fixed identity, but current tuning should be carried over.
   - Constraint: do not change unless required by measured regression fixes.

4. No production fallback behavior for dev URL loading.

5. `temp` semantics should remain baseline-compatible, with room for a more intuitive conversion flow.

## 10. Execution Rule Derived From Ledger

Any V2 carryover item marked `EXPLICIT` must match behavior unless a deliberate, documented design override is approved.
