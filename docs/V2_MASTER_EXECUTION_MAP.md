# V2 Master Execution Map

## North Star
Deliver a visually and functionally identical app to V1, with a rock-solid editor architecture that removes the performance and stability issues.

## Non-Negotiable Invariants
- Functional parity with V1 behavior is required.
- Visual parity with V1 editor experience is required.
- No workaround that violates browser/editor lifecycle correctness.
- Performance-first execution is required: prefer minimal/targeted updates over broad redraws or wide invalidation.
- Build toward final-form architecture at every phase: placeholders are allowed only when their structure and extension seams already match the intended full feature set.
- No phase advancement without passing gate criteria.
- One active focus area at a time, but full-map tracking always maintained.

## Phase Gates

### Phase 0 - Control Plane Setup
Goal: Establish strict process and acceptance gates.
Exit criteria:
- Master map, parity checklist, and session handbook exist and are current.
- Current phase and blockers are explicitly documented.
Status: DONE

### Phase 1 - Editor Core Contract
Goal: Define the editor contract so app features integrate without editor internals leakage.
Exit criteria:
- Typed editor adapter contract defined (text, selection, viewport, lifecycle events).
- Event semantics documented for line breaks, caret movement, and scroll boundaries.
- Integration API is stable enough to build app features against.
Status: DONE

### Phase 2 - Fixed Focus Engine Stability
Goal: Achieve deterministic fixed-focus behavior and line-break/scroll mechanics.
Exit criteria:
- Manual scroll boundary behavior is deterministic.
- Line break handling is stable at all boundary conditions.
- Caret rendering and selection remain consistent under rapid input.
- No visible flicker/jitter in normal editing paths.
Status: DONE

### Phase 3 - Pixel-Perfect Visual Alignment
Goal: Grid, glyphs, and custom caret align exactly and remain aligned under resize/zoom/font load.
Exit criteria:
- Grid-cell and glyph advance alignment is repeatable.
- Caret snaps correctly in all supported editing contexts.
- Resize and font readiness do not desync alignment.
Status: DONE

### Phase 4 - Persistence Spine
Goal: Reintroduce V1-grade persistence and process boundaries.
Exit criteria:
- Main/preload/renderer contracts restored for note lifecycle.
- DB + markdown file persistence paths are stable.
- Autosave contract works with new editor adapter.
Status: DONE

### Phase 5 - Feature Parity Carryover
Goal: Port V1 features behind stable editor and persistence contracts.
Exit criteria:
- Sidebar view model restored with canonical modes: Date, Category, Archive, Trash.
- Search, tags, timeline, utilities restored.
- Keyboard flows and note lifecycle parity restored.
- No regressions against editor core behavior.
Status: PENDING

## Canonical Sidebar View Model (V2)
- Date view:
	- Recency-ordered note list.
	- Includes compact two-line month/year filter rail (carry over from V1 behavior).
	- Excludes notes with protected tags `archived` and `deleted`.
- Category view:
	- Hierarchical categorized browser by primary -> secondary -> tertiary tag grouping.
	- Excludes notes with protected tags `archived` and `deleted`.
- Archive view:
	- Same hierarchical category browser as Category view.
	- Includes archived notes only.
	- Excludes deleted notes.
- Trash view:
	- Recency-ordered deleted-note list.
	- Includes notes with protected tag `deleted`.

Terminology boundary:
- View naming uses Date/Category/Archive/Trash.
- `tag`/`tags` naming is reserved for note classification metadata and tag-management surfaces, not for top-level view labels.

Reference spec:
- `docs/V2_SIDEBAR_VIEW_ARCHITECTURE.md`

### Phase 6 - Hardening and Release Readiness
Goal: Remove instability and prove runtime consistency.
Exit criteria:
- Performance acceptance baseline is met.
- Stability acceptance baseline is met.
- Packaging identifiers/config are production-ready.
Status: PENDING

## Strict Sequence Rule
Do not begin Phase N+1 implementation work until all Phase N exit criteria are checked.

## Drift Prevention Protocol
At the start of each work session:
- Declare current phase and one exact objective.
- Declare what is explicitly out of scope for the session.

During session:
- If work touches out-of-scope areas, stop and log rationale before proceeding.
- Record every architectural decision in the session handbook.
- If a feature requires a measurable performance sacrifice, log the tradeoff, rejected alternatives, and acceptance rationale before merging.
- If introducing placeholders, verify they do not create dead-end component structure; document the future fit path in the session handbook.

At end of session:
- Update status in this map.
- Update parity checklist progress.
- Write next-session objective and first action.

## Current Focus
- Active phase: Phase 5 - Feature Parity Carryover
- Active objective: Complete canonical data-model parity planning so Date/Category/Archive/Trash, search, tags, timeline, and UI state all map to explicit required entities before further carryover.
- Out of scope: Phase 6 hardening/release readiness until core Phase 5 parity surfaces exist.

Model reference:
- `docs/V5_CANONICAL_DATA_MODEL.md`
