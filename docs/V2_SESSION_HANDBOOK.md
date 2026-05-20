# V2 Session Handbook

This file is the continuity ledger across sessions. Append one entry per session.

## Rules
- Keep one active objective per session.
- Keep all out-of-scope items explicit.
- Record decisions with reasons.
- Record blockers immediately.
- End every session with the next exact first action.

---

## Session Entry Template

### Session Date
YYYY-MM-DD

### Active Phase
Phase X - <name>

### Objective
One concrete objective only.

### Out of Scope
- Item 1
- Item 2

### Work Completed
- Item 1
- Item 2

### Decisions
- Decision: <what>
  - Reason: <why>

### Risks or Blockers
- Risk/Blocker: <description>
  - Impact: <effect>
  - Mitigation: <plan>

### Checklist Deltas
- Checked: <item(s)>
- Unchecked/Reopened: <item(s)>

### Next Session
- Objective: <single objective>
- First action: <first concrete action>

---

## Current Session Entry

### Session Date
2026-05-19

### Active Phase
Phase 1 - Editor Core Contract

### Objective
Create strict process controls and define the immediate editor-contract focus.

### Out of Scope
- Porting V1 feature modules.
- Persistence and IPC implementation changes.
- Visual polish beyond contract needs.

### Work Completed
- Added master execution map.
- Added parity checklist with phase gates.
- Added this session handbook for continuity.

### Decisions
- Decision: Use v2 editor-first execution with strict phase gates.
  - Reason: Highest risk sits in editor behavior; de-risking it first reduces overall rewrite risk.

### Risks or Blockers
- Risk/Blocker: Editor contract not yet formalized in code.
  - Impact: Feature carryover could couple to unstable editor internals.
  - Mitigation: Next session starts by defining adapter interface and event semantics.

### Checklist Deltas
- Checked: Process control artifacts created.
- Unchecked/Reopened: All implementation-phase items remain open.

### Next Session
- Objective: Define and commit the editor adapter contract types and invariants.
- First action: Add TypeScript contract file(s) under src and wire Editor.tsx to the contract surface.

---

## Session Entry

### Session Date
2026-05-19

### Active Phase
Phase 1 - Editor Core Contract

### Objective
Implement editor adapter contract types and wire the current editor surface to the contract boundary.

### Out of Scope
- V1 feature carryover modules.
- Persistence and IPC reintroduction.
- Visual and behavior tuning beyond contract wiring.

### Work Completed
- Added editor contract types at `src/editor/EditorContract.ts`.
- Wired `src/components/Editor.tsx` to accept bindings and expose adapterRef.
- Implemented lifecycle and viewport contract events.
- Implemented snapshot read/write for viewport state.
- Added contract semantics and examples at `docs/V2_EDITOR_CONTRACT.md`.

### Decisions
- Decision: Use capability flags to represent partial contract implementation while rewrite is in progress.
  - Reason: Keeps integration strict without faking unavailable behavior.

### Risks or Blockers
- Risk/Blocker: Text and selection events are still not active in the Lexical bridge.
  - Impact: Feature modules requiring exact text/selection reactivity must wait.
  - Mitigation: Next step is adding deterministic text and selection event emission through the contract.

### Checklist Deltas
- Checked: All Phase 1 contract definition/documentation items.
- Unchecked/Reopened: Session end update remains open until each coding session fully closes.

### Next Session
- Objective: Activate contract-grade text and selection events with deterministic semantics.
- First action: Add dedicated event bridge plugin(s) that emit global offsets and normalized text through Editor bindings.

---

## Session Entry

### Session Date
2026-05-19

### Active Phase
Phase 1 - Editor Core Contract

### Objective
Extract detailed V1 design decisions from code and continue Phase 1 by activating contract text/selection events.

### Out of Scope
- V1 module carryover implementation.
- Persistence spine migration work.
- Phase 2 behavior tuning.

### Work Completed
- Added detailed V1 design decision ledger at `docs/V1_DESIGN_DECISIONS_LEDGER.md`.
- Added ambiguity queue at `docs/V1_AMBIGUOUS_DECISIONS_QUEUE.md`.
- Added `ContractBridgePlugin` to emit normalized text and selection updates through contract bindings.
- Updated editor adapter capabilities and snapshots to use live text/selection state.

### Decisions
- Decision: Treat V1 extracted behavior as parity baseline unless explicitly overridden.
  - Reason: Keeps rewrite anchored to product intent encoded in shipped behavior.

### Risks or Blockers
- Risk/Blocker: Selection offsets are currently derived from DOM ranges and require deeper validation against complex lexical structures.
  - Impact: Edge-case offset mismatches may appear for advanced structures.
  - Mitigation: Add deterministic offset tests and reconcile against lexical-native location mapping in the next step.

### Checklist Deltas
- Checked: V1 decision extraction completed for planning baseline.
- Unchecked/Reopened: Hard validation of selection-offset correctness remains open.

### Next Session
- Objective: Validate and harden selection offset mapping accuracy under multiline and structural edge cases.
- First action: Add targeted contract bridge validation harness and test cases for selection and line-break offset equivalence.

---

## Session Entry

### Session Date
2026-05-19

### Active Phase
Phase 1 - Editor Core Contract

### Objective
Lock ambiguous product decisions and continue selection-offset hardening.

### Out of Scope
- Persistence-spine implementation.
- Feature carryover modules.

### Work Completed
- Recorded all user-resolved ambiguity decisions.
- Updated ambiguity queue and V1 design ledger with final directives.

### Decisions
- Decision: External files are strict plain-text sanitized input in V2.
  - Reason: Core product vision prioritizes deterministic monofont rendering and clean text model.

### Risks or Blockers
- Risk/Blocker: Selection offset bridge still requires edge-case hardening.
  - Impact: Cursor/selection mapping errors can destabilize editor contract consumers.
  - Mitigation: Continue by hardening offset mapping utilities and adding validation checks.

### Checklist Deltas
- Checked: Ambiguous product calls are now resolved.
- Unchecked/Reopened: Selection offset hardening remains active.

### Next Session
- Objective: Complete selection offset hardening and close remaining Phase 1 bridge gaps.
- First action: Refactor contract bridge to use a dedicated offset utility with stronger clamping and root-boundary safeguards.

---

## Session Entry

### Session Date
2026-05-19

### Active Phase
Phase 1 - Editor Core Contract

### Objective
Harden selection-offset mapping and lock resolved ambiguity decisions into the implementation path.

### Out of Scope
- Phase 4 persistence spine work.
- V1 feature module carryover.

### Work Completed
- Refactored selection offset logic into `src/editor/SelectionOffsets.ts`.
- Added root-boundary validation, exception-safe range handling, and clamped offsets.
- Updated `ContractBridgePlugin` to use hardened utilities and emit initial-load state.
- Captured resolved product decisions in design ledger and ambiguity queue docs.

### Decisions
- Decision: Treat resolved ambiguity answers as implementation directives, not discussion notes.
  - Reason: Prevents drift and repeated re-debates across sessions.

### Risks or Blockers
- Risk/Blocker: Offset mapping still needs behavioral verification under rich structural cases (mixed nodes, rapid edits).
  - Impact: Potential edge mismatch between visual caret and global offsets.
  - Mitigation: Add targeted validation harness and edge-case scenarios next.

### Checklist Deltas
- Checked: Selection-offset hardening baseline implemented.
- Unchecked/Reopened: Edge-case verification remains pending.

### Next Session
- Objective: Add offset verification harness and begin Phase 2 fixed-focus stability tuning.
- First action: Instrument contract events and assert invariants during Enter/Tab/scroll edge paths.

---

## Session Entry

### Session Date
2026-05-19

### Active Phase
Phase 2 - Fixed Focus Engine Stability

### Objective
Start invariant-driven stabilization by adding a contract verification harness for text, selection, and viewport event streams.

### Out of Scope
- Persistence spine and feature carryover.
- Visual alignment tuning beyond invariant checks.

### Work Completed
- Added invariant harness utility at `src/editor/ContractInvariantHarness.ts`.
- Integrated invariant checks into `src/components/Editor.tsx` for text/selection/viewport/snapshot flows.

### Decisions
- Decision: Keep invariant checks dev-only and deduplicated.
  - Reason: High signal during stabilization without flooding logs in repetitive paths.

### Risks or Blockers
- Risk/Blocker: Invariants detect structural mismatches but do not yet execute scenario-driven assertions.
  - Impact: Some behavior regressions may still require targeted scripted validation.
  - Mitigation: Next step is adding scenario instrumentation for Enter/Tab/rapid input sequences.

### Checklist Deltas
- Checked: Baseline invariant harness added.
- Unchecked/Reopened: Phase 2 deterministic behavior checks remain pending.

### Next Session
- Objective: Add scenario-based invariant probes for boundary line-break and rapid input behavior.
- First action: Capture and analyze event traces for Enter near top/bottom boundaries.

---

## Session Entry

### Session Date
2026-05-19

### Active Phase
Phase 2 - Fixed Focus Engine Stability

### Objective
Address observed cage escape and jitter by enforcing hard quantized movement and strict caret caging.

### Out of Scope
- Persistence and feature carryover.
- Timeline/search/tag parity work.

### Work Completed
- Updated `CagedScrollPlugin` to move scroll in strict 24px row increments using ceil-based correction.
- Added scroll-range clamping in caged scrolling to prevent overshoot.
- Updated `BlockCaretPlugin` to hard-clamp custom caret rendering inside the middle cage region.
- Passed top/bottom boundary values into block caret plugin from `Editor`.
- Added explicit `scrollBehavior: auto` on editor scroller to avoid smooth-drift artifacts.

### Decisions
- Decision: Hard row-step correction beats proportional correction for this product model.
  - Reason: Product vision favors deterministic box-to-box movement with no easing drift.

### Risks or Blockers
- Risk/Blocker: Needs user validation in live interaction to confirm perceptual jitter is resolved.
  - Impact: Review gate cannot be declared until observed behavior matches expected feel.
  - Mitigation: Run immediate manual validation pass for Enter-near-boundary and type-while-scroll.

### Checklist Deltas
- Checked: Deterministic cage correction implemented.
- Unchecked/Reopened: Phase 2 checklist items still pending validation sign-off.

### Next Session
- Objective: Validate user-perceived movement quality and, if clean, mark first review gate reached.
- First action: User performs quick interaction pass on latest build and reports residual artifacts.
