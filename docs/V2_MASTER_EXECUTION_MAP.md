# V2 Master Execution Map

## North Star
Deliver a visually and functionally identical app to V1, with a rock-solid editor architecture that removes the performance and stability issues.

## Non-Negotiable Invariants
- Functional parity with V1 behavior is required.
- Visual parity with V1 editor experience is required.
- No workaround that violates browser/editor lifecycle correctness.
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
Status: IN PROGRESS

### Phase 2 - Fixed Focus Engine Stability
Goal: Achieve deterministic fixed-focus behavior and line-break/scroll mechanics.
Exit criteria:
- Manual scroll boundary behavior is deterministic.
- Line break handling is stable at all boundary conditions.
- Caret rendering and selection remain consistent under rapid input.
- No visible flicker/jitter in normal editing paths.
Status: PENDING

### Phase 3 - Pixel-Perfect Visual Alignment
Goal: Grid, glyphs, and custom caret align exactly and remain aligned under resize/zoom/font load.
Exit criteria:
- Grid-cell and glyph advance alignment is repeatable.
- Caret snaps correctly in all supported editing contexts.
- Resize and font readiness do not desync alignment.
Status: PENDING

### Phase 4 - Persistence Spine
Goal: Reintroduce V1-grade persistence and process boundaries.
Exit criteria:
- Main/preload/renderer contracts restored for note lifecycle.
- DB + markdown file persistence paths are stable.
- Autosave contract works with new editor adapter.
Status: PENDING

### Phase 5 - Feature Parity Carryover
Goal: Port V1 features behind stable editor and persistence contracts.
Exit criteria:
- Sidebar modes, search, tags, timeline, utilities restored.
- Keyboard flows and note lifecycle parity restored.
- No regressions against editor core behavior.
Status: PENDING

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

At end of session:
- Update status in this map.
- Update parity checklist progress.
- Write next-session objective and first action.

## Current Focus
- Active phase: Phase 1 - Editor Core Contract
- Active objective: Activate text and selection events on the contract and remove placeholder snapshot content.
- Out of scope: Porting feature modules before contract finalization.
