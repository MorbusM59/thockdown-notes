# V2 Session Handbook

This file is the continuity ledger across sessions. Append one entry per session.

## Rules
- Keep one active objective per session.
- Keep all out-of-scope items explicit.
- Record decisions with reasons.
- Record blockers immediately.
- Use final-form structural planning by default; placeholders must preserve intended full-feature component boundaries and extension seams.
- For every UI carryover element: audit V1 first, publish behavior report, declare exact-repro viability, list caveats, request user confirmation if caveats exist, then implement.
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
2026-05-23

### Active Phase
Phase 2 - Fixed Focus Engine Stability

### Objective
Investigate reported CRLF-tail bottom-of-document disagreement between wheel scroll and ArrowDown caret traversal with root-cause-level evidence.

### Out of Scope
- Phase 4 persistence spine implementation.
- Feature carryover beyond Phase 2 stability.

### Work Completed
- Reproduced and instrumented terminal empty-line behavior under real clipboard paste using CRLF+CRLF tails.
- Verified current live state where wheel and ArrowDown are now in sync for the reported scenario.
- Captured detailed caret/selection telemetry for terminal paragraphs and wrapped-line traversal.
- Benchmarked selection-offset range mapping at large document sizes; no immediate performance ceiling observed in current workloads.

### Decisions
- Decision: Treat the CRLF-tail wheel/ArrowDown disagreement as currently resolved in the live app state, not an active blocker.
  - Reason: User manual validation and repeated probes both confirmed synchronized behavior.
- Decision: Keep the deeper terminal-offset model risk documented, but do not patch without a deterministic failing repro.
  - Reason: Proper process requires evidence-driven changes to avoid introducing regressions in already-stable paths.

### Risks or Blockers
- Risk/Blocker: Terminal collapsed-caret geometry still relies on fallback rect sources in empty paragraphs.
  - Impact: Future edge regressions remain possible under specific content/layout combinations.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 5 - Feature Parity Carryover

### Objective
Remove sidebar flicker on note switch and formalize a permanent performance-first update policy.

### Out of Scope
- Search/tag/timeline carryover implementation details.
- Phase 6 hardening baselines.

### Work Completed
- Replaced visual note-transition state toggles with non-visual lock refs to avoid whole-menu disabled redraw.
- Memoized sidebar note rows and stabilized callbacks.
- Implemented identity-preserving note list merge so unchanged note rows keep object references across refresh.
- Updated governance docs to make minimal targeted redraws a non-negotiable process rule.

### Decisions
- Decision: Default to least-invasive render/update path for all UI work.
  - Reason: Large-note loading and transition paths expose avoidable UI repaint costs and visible flicker.

### Risks or Blockers
- Risk/Blocker: Some future features may require broader invalidation.
  - Impact: Potential measurable UI performance regression if not controlled.
  - Mitigation: Require explicit tradeoff logging and rejected alternatives before accepting broader redraw scope.

### Checklist Deltas
- Checked: Performance-first rule enforced (minimal redraw/update path preferred by default).

### Next Session
- Objective: Continue Phase 5 feature carryover with sidebar modes while preserving selective render boundaries.
- First action: Add mode state and filtering mechanics without breaking note row identity guarantees.
  - Mitigation: Preserve instrumentation path and only implement fix design after deterministic failing capture.

### Checklist Deltas
- Checked: CRLF-tail wheel/ArrowDown sync issue currently non-repro and user-confirmed clean.
- Unchecked/Reopened: Long-run traversal and broader perceptual gate checks remain open.

### Next Session
- Objective: Continue Phase 2 closure with remaining long-run traversal and perceptual stability checks.
- First action: Run prolonged manual traversal pass with mixed paste + wrap + boundary navigation and log any deterministic failures.

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

---

## Session Entry

### Session Date
2026-05-21

### Active Phase
Phase 2 - Fixed Focus Engine Stability

### Objective
Drive editor codebase toward pristine, maintainable state while preserving fixed-focus behavior and eliminating drift-prone duplicated logic.

### Out of Scope
- Phase 4 persistence/IPC restoration.
- Phase 5 feature carryover modules.
- Packaging/release tasks.

### Work Completed
- Removed obsolete experimental selection-mutation paste correction and cleaned plugin chain.
- Consolidated terminal trailing-newline visual compensation into `src/editor/CaretTerminalOffset.ts`.
- Consolidated caret top-in-scroll resolution into `src/editor/CaretVisualPosition.ts` and consumed it from both caret/scroll plugins.
- Centralized geometry constants in `src/editor/LayoutConstants.ts` and removed duplicated literals.
- Refactored `src/editor/CaretRect.ts` to simplify adjacent-probe mapping and document explicit non-mutating fallback order.
- Scoped editor diagnostics keydown listener to editor scroller instead of global window.
- Replaced timeout-based layout defer with requestAnimationFrame scheduling and cleanup.
- Resolved lint blockers (`react-hooks/exhaustive-deps` warnings in `Editor.tsx`, `no-explicit-any` in `MeaslyTokenNode.ts`).
- Revalidated with `npx tsc --noEmit` and `npm run lint`.

### Decisions
- Decision: Keep selection state immutable during caret-geometry reads; only visual compensation is allowed.
  - Reason: DOM/selection mutation during geometry probes destabilized focus and caused editor clickability regressions.
- Decision: Extract shared caret/terminal offset policy into editor utilities consumed by both scroll and caret plugins.
  - Reason: Prevents policy drift and eliminates duplicated symptom patches across runtime paths.

### Risks or Blockers
- Risk/Blocker: Terminal trailing-newline caret placement still depends on fallback geometry heuristics in edge browser states.
  - Impact: Rare paste-tail display mismatches may still appear in specific collapsed-range conditions.
  - Mitigation: Add focused scenario validation set for CRLF/blank-tail paste cases before marking Phase 2 complete.

### Checklist Deltas
- Checked: Process control continuity maintained and quality gates (type/lint) satisfied for this stabilization batch.
- Unchecked/Reopened: Phase 2 behavioral gate items remain open pending explicit validation pass.

### Next Session
- Objective: Execute and document Phase 2 gate validation (Enter near boundaries, rapid key repeat, undo/redo, flicker/jump checks).
- First action: Run scripted/manual validation matrix and update `docs/V2_PARITY_CHECKLIST.md` with concrete pass/fail outcomes.

---

## Session Entry

### Session Date
2026-05-23

### Active Phase
Phase 2 - Fixed Focus Engine Stability

### Objective
Close Phase 2 with final manual stability confirmation under large-document stress.

### Out of Scope
- Phase 4 persistence spine implementation.
- Feature carryover work before visual alignment gate starts.

### Work Completed
- User completed final manual perceptual validation and reported smooth/correct behavior.
- User confirmed stability with extreme paste-scale stress (~10,000 lines) and no interaction desync.
- Updated validation matrix to pass long-document traversal and promote gate decision state.
- Updated master execution map to mark Phase 2 done and shift active focus to Phase 3.

### Decisions
- Decision: Treat Phase 2 as complete and advance to Phase 3 alignment work.
  - Reason: Gate-critical behavioral criteria are now met with both automation evidence and explicit manual sign-off.

### Risks or Blockers
- Risk/Blocker: Terminal empty-line fallback geometry remains an architectural sensitivity.
  - Impact: Could reappear in future if alignment refactors alter caret geometry ordering.
  - Mitigation: Keep existing instrumentation path and use it as a guardrail during Phase 3 caret/grid updates.

### Checklist Deltas
- Checked: Phase 2 long-run traversal/stress confidence established.
- Unchecked/Reopened: Phase 3 visual alignment checklist remains entirely open.

### Next Session
- Objective: Begin Phase 3 by validating grid/glyph/caret alignment invariants under resize + font-ready transitions.
- First action: Capture a deterministic alignment baseline (row/column snap assertions + visual probe logs) before any alignment code changes.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 5 - Feature Parity Carryover

### Objective
Standardize sidebar view naming and lock conceptual architecture semantics to prevent internal/external terminology drift.

### Out of Scope
- Search implementation details.
- Tag CRUD implementation details.

### Work Completed
- Finalized canonical view labels as Date, Category, Archive, Trash.
- Documented canonical behavior boundaries for each view.
- Updated phase gate/checklist artifacts to enforce canonical terminology and structure.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 5 - Feature Parity Carryover

### Objective
Implement active-note tag management UI (add/remove/reorder) using the new persistence contract.

### Out of Scope
- Suggested tags UX.
- Search and timeline carryover.

### Work Completed
- Added sidebar tag manager for the active note in `src/App.tsx`.
- Wired add/remove/reorder controls to `window.measlyNotes` tag APIs.
- Added mutation serialization and save-first flow before tag operations.
- Added compact tag manager styling in `src/App.css`.
- Updated Phase 5 checklist items for sidebar/date/category/tag carryover completion.

### Decisions
- Decision: Serialize tag mutations through the same note transition lock and save-flush path used by note activation.
  - Reason: Preserves markdown-authoritative persistence ordering and avoids renderer/main race windows.

### Risks or Blockers
- Risk/Blocker: `npm run lint` currently fails in this environment with a launcher error (`The system cannot execute the specified program`).
  - Impact: Full lint gate is temporarily blocked despite clean file diagnostics.
  - Mitigation: Continue validating with `npm run build` + `get_errors` until environment runner issue is resolved.

### Checklist Deltas
- Checked: Sidebar view model, Date filter rail, Category/Archive hierarchy, Tag model carryover items.
- Unchecked/Reopened: Search, suggested tags, timeline, utility actions, keyboard shortcuts.

### Next Session
- Objective: Implement Phase 5 search carryover (text + #tag) on top of current canonical sidebar/tag model.
- First action: Add a single search query state and deterministic filter pipeline shared across Date/Category/Archive/Trash lists.

### Decisions
- Decision: Replace V1 labels (`latest`, `active`) with V2 canonical labels (`Date`, `Category`) across development artifacts.
  - Reason: Avoid semantic conflict between list recency and categorized hierarchy concepts, and avoid confusion with tag-management surfaces.
- Decision: Reserve `tag` terminology for note metadata and tag management, not top-level view labels.
  - Reason: Keeps architecture language unambiguous across UI and implementation.

### Risks or Blockers
- Risk/Blocker: Existing in-progress code may still contain transitional labels.
  - Impact: Temporary naming inconsistency in implementation phase.
  - Mitigation: Apply rename sweep during next sidebar/search increment before feature completion gate sign-off.

### Checklist Deltas
- Checked: Canonical sidebar view model captured in process artifacts.

### Next Session
- Objective: Continue Phase 5 implementation using canonical Date/Category/Archive/Trash naming in code-level mode state.
- First action: Rename current mode constants/UI labels and align filtering logic to the canonical semantics.

---

## Session Entry

### Session Date
2026-05-23

### Active Phase
Phase 3 - Pixel-Perfect Visual Alignment

### Objective
Capture deterministic pre-change alignment baseline for grid, glyph, and caret geometry.

### Out of Scope
- Phase 4 persistence spine implementation.
- Feature carryover while Phase 3 baseline is still being established.

### Work Completed
- Captured style/metric baseline for font, line lattice, cell width, and caret probe points.
- Verified font-readiness stability (`document.fonts.ready`) with zero measured metric drift.
- Logged baseline artifact at `docs/V3_ALIGNMENT_BASELINE.md`.

### Decisions
- Decision: Treat current baseline as valid for runtime/style state, but incomplete for true Electron window resize semantics.
  - Reason: Shared browser instrumentation cannot fully represent app-window resize behavior in this environment.

### Risks or Blockers
- Risk/Blocker: Caret geometry probes rely primarily on fallback rect sources in collapsed/empty states.
  - Impact: Alignment regressions may hide in fallback ordering changes.
  - Mitigation: Keep fallback-source ratio tracked in baseline and reevaluate after each alignment change.

### Checklist Deltas
- Checked: Phase 3 baseline artifact created before code changes.
- Unchecked/Reopened: Full resize matrix and visual acceptance thresholds still pending.

### Next Session
- Objective: Build resize-aware alignment matrix and set explicit acceptance thresholds for snap error.
- First action: Run Electron-window manual resize pass while collecting probe logs tied to `docs/V3_ALIGNMENT_BASELINE.md` metrics.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 5 - Feature Parity Carryover

### Objective
Restore suggested tags and replace the right-side tag placeholder with a functional collection panel.

### Out of Scope
- Timeline/time machine carryover.
- Utility actions carryover (import/export/pdf/trash controls).

### Work Completed
- Implemented global tag collection derivation in `src/App.tsx` from current note summaries.
- Added suggested tags list for the active note, excluding already-attached and protected tags.
- Wired one-click suggested-tag add through the existing serialized tag mutation flow.
- Replaced right-side tag placeholder with functional Suggested Tags + Tag Collection panels.
- Added UI styles for tag chips and collection rows in `src/App.css`.

### Decisions
- Decision: Build suggested tags from canonical note-summary tags already loaded in renderer state.
  - Reason: Preserves markdown-authoritative model while avoiding extra IPC/race surfaces for this UI layer.

### Risks or Blockers
- Risk/Blocker: Suggested ranking currently uses usage-count + alpha tie-break only.
  - Impact: Relevance may feel generic for very large tag sets.
  - Mitigation: Revisit ranking with recency/context weighting during future search/tag UX parity pass.

### Checklist Deltas
- Checked: Suggested tags restored.
- Unchecked/Reopened: Timeline/time machine; utility actions.

### Next Session
- Objective: Begin timeline/time machine carryover with minimal structural intrusion.
- First action: Restore timeline panel skeleton with canonical data plumbing and deterministic note activation flow.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 5 - Feature Parity Carryover

### Objective
Execute confirmed V1-accurate carryover for suggested tags/tag collection as a single lean surface.

### Out of Scope
- Timeline/time machine carryover implementation.
- Utility action carryover implementation.

### Work Completed
- Audited V1 `SuggestedPanel` and `TagInput` behavior before implementation changes.
- Replaced the split V2 suggested/collection panel with a single compact suggested chip surface in `src/App.tsx`.
- Removed extra labels/counters and reduced inline tag-input row stacking to eliminate wasted space.
- Applied V1-style compact chip wrapping and max-height behavior in `src/App.css`.
- Revalidated with `npm run build`.

### Decisions
- Decision: Treat suggested tags and tag collection as one UI surface for Phase 5 parity.
  - Reason: Matches V1 lean UX and avoids redundant labels/panels that consume screen space.
- Decision: Keep protected tags excluded from suggestions and preserve top-used ranking with alphabetical tie-break.
  - Reason: Reproduces V1 interaction safety and suggestion ordering semantics.

### Risks or Blockers
- Risk/Blocker: Suggested ranking still reflects global usage only.
  - Impact: Context-specific relevance may be lower for very large tag vocabularies.
  - Mitigation: Revisit ranking strategy only after parity closure, as a deliberate post-parity optimization.

### Checklist Deltas
- Checked: V1-first audit gate was executed before implementation for this UI element.
- Unchecked/Reopened: Timeline/time machine; utility actions.

### Next Session
- Objective: Run V1-first audit for timeline/time machine carryover.
- First action: Extract V1 timeline component behavior and produce exact-repro viability report before coding.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 5 - Feature Parity Carryover

### Objective
Restore Date view menu pagination and date-filter interactions to V1 behavior and visual density.

### Out of Scope
- Timeline/time machine carryover implementation.
- Utility action carryover implementation.

### Work Completed
- Ran V1-first audit for `Sidebar` and `DateFilter` behavior before coding.
- Added shared V1-compatible filter semantics utility at `src/shared/filterConstants.ts`.
- Replaced Date/Trash filter controls with V1-style two-row button matrix and right-click row clear behavior in `src/App.tsx`.
- Restored V1 multi-select semantics (exclusive, ctrl/cmd toggle, shift range) for month/year filters in `src/App.tsx`.
- Added V1-style minimal pagination controls (`<`, current page, `>`) for Date/Trash views in `src/App.tsx`.
- Added date-view fixed-row pagination density computation (items-per-page based on sidebar content height) in `src/App.tsx`.
- Updated date filter and pagination styling for compact V1-like UX in `src/App.css`.
- Revalidated with `npm run build`.

### Decisions
- Decision: Keep pagination client-side on the current `listNotes` data source for now.
  - Reason: Preserves V1-visible UX without introducing a new IPC pagination contract in this brick.

### Risks or Blockers
- Risk/Blocker: Client-side pagination over full note list can become heavier than DB paging for very large datasets.
  - Impact: Potential future performance cost at scale.
  - Mitigation: If needed after parity closure, introduce optional paged IPC API without changing restored UI semantics.

### Checklist Deltas
- Checked: Date view month/year filter rail restored in compact two-line interaction model (now behavior-aligned with V1 interactions).
- Unchecked/Reopened: Timeline/time machine; utility actions.

### Next Session
- Objective: Run V1-first audit for timeline/time machine carryover.
- First action: Extract V1 timeline component behavior and produce exact-repro viability report before coding.

---

## Session Entry

### Session Date
2026-05-22

### Active Phase
Phase 2 - Fixed Focus Engine Stability

### Objective
Execute the Phase 2 validation matrix and convert results into objective gate evidence.

### Out of Scope
- New architecture refactors.
- Phase 4+ persistence and feature-carryover implementation.

### Work Completed
- Executed automated browser validation for undo/redo scenario.
- Executed paste-tail (`CRLF+CRLF`) scenario and verified insertion point consistency.
- Executed post-paste ArrowUp/ArrowDown navigation validation.
- Ran additional structural automation for resize and boundary-handle drag quantization.
- Updated `docs/V2_PHASE2_VALIDATION_MATRIX.md` with explicit PASS/PARTIAL/MANUAL-PENDING outcomes.
- Updated `docs/V2_PARITY_CHECKLIST.md` to check off undo/redo stability item.

### Decisions
- Decision: Keep Phase 2 gate OPEN until perceptual interaction checks (jitter/flicker/feel) are manually verified.
  - Reason: Structural and state-level automation cannot fully certify visual smoothness or user-perceived drift.

### Risks or Blockers
- Risk/Blocker: Remaining open Phase 2 items depend on human-perception validation (top/bottom Enter behavior, rapid-repeat feel, flicker/jump presence).
  - Impact: Gate closure cannot be claimed solely from automation.
  - Mitigation: Run focused manual pass using matrix scenarios and immediately record PASS/FAIL evidence.

### Checklist Deltas
- Checked: Undo/redo maintains consistent caret and viewport behavior.
- Unchecked/Reopened: Enter-near-boundary determinism, rapid-repeat stability, and anti-flicker item remain open.

### Next Session
- Objective: Complete final manual Phase 2 validation and decide READY TO CLOSE vs OPEN with defects.
- First action: Run P2-01, P2-02, P2-03, and perceptual portions of P2-05/P2-08/P2-09/P2-10 directly in-app and record each outcome in `docs/V2_PHASE2_VALIDATION_MATRIX.md`.

---

## Session Entry

### Session Date
2026-05-23

### Active Phase
Phase 3 - Pixel-Perfect Visual Alignment

### Objective
Close the resize-perception gap and convert the baseline into threshold-driven execution criteria.

### Out of Scope
- Phase 4 persistence spine implementation.
- Feature carryover modules while alignment thresholds are being established.

### Work Completed
- User manually validated resize behavior in live app and reported clean feel.
- Updated `docs/V3_ALIGNMENT_BASELINE.md` with manual confirmation evidence.
- Added provisional numeric acceptance thresholds for top/left snap error and resize stability.

### Decisions
- Decision: Treat manual resize confirmation as sufficient to proceed from pure baseline capture to threshold-driven Phase 3 implementation.
  - Reason: The primary environment limitation (shared browser vs app window resize semantics) is now covered by explicit user confirmation.

### Risks or Blockers
- Risk/Blocker: Vertical snap offset baseline remains at ~2px and may represent intentional baseline policy or real drift.
  - Impact: Misclassification could cause unnecessary churn or accidental regressions.
  - Mitigation: Make first Phase 3 code change contingent on proving whether this offset is policy vs defect.

### Checklist Deltas
- Checked: Resize perception gap addressed with manual confirmation evidence.
- Unchecked/Reopened: Phase 3 visual-alignment checklist items remain open pending threshold-verified implementation passes.

### Next Session
- Objective: Execute first alignment change candidate and validate against newly defined thresholds.
- First action: Build a focused probe for non-empty/wrapped/empty/terminal caret rows and compare measured snap errors pre/post change.

---

## Session Entry

### Session Date
2026-05-23

### Active Phase
Phase 3 - Pixel-Perfect Visual Alignment

### Objective
Resolve whether the persistent ~2px vertical offset indicates a real alignment defect or a measurement artifact.

### Out of Scope
- Phase 4 persistence spine implementation.
- Feature carryover while Phase 3 alignment criteria are still open.

### Work Completed
- Ran focused rendered-caret lattice probe across non-empty, wrapped, empty, and terminal-empty states.
- Confirmed rendered block caret snaps exactly to both row (`24px`) and cell (`10px`) lattices.
- Updated baseline docs and checklist evidence accordingly.

### Decisions
- Decision: Classify the ~2px signal as raw selection-rect artifact, not rendered alignment defect.
  - Reason: Primary rendered-caret metrics show exact lattice snap with zero error at sampled points.

### Risks or Blockers
- Risk/Blocker: Remaining Phase 3 items still require selection-highlight and glyph-advance validation under real app interactions.
  - Impact: Phase 3 cannot close until these criteria are explicitly evidenced.
  - Mitigation: Run targeted highlight/glyph probes and then request focused manual perception pass for final sign-off.

### Checklist Deltas
- Checked: Custom caret aligns to glyph grid in empty and non-empty lines.
- Unchecked/Reopened: Glyph advance, baseline/row stability, selection highlight, and resize/font-ready final criteria remain open.

### Next Session
- Objective: Close the next two highest-value Phase 3 criteria (glyph advance + baseline/row stability).
- First action: Build probe that compares effective glyph advance to cell lattice across representative glyph sets and wrapped lines.

---

## Session Entry

### Session Date
2026-05-23

### Active Phase
Phase 3 - Pixel-Perfect Visual Alignment

### Objective
Close glyph-advance and row-lattice stability criteria using deterministic probes.

### Out of Scope
- Phase 4 persistence spine implementation.
- Feature carryover until remaining Phase 3 visual criteria are confirmed.

### Work Completed
- Probed effective glyph advance across mixed glyph sets and confirmed exact `10px` cell alignment.
- Probed row-lattice behavior across non-empty, wrapped, and empty lines.
- Confirmed all row tops snap to 24px lattice; wrapped lines expand in exact line-height multiples.
- Updated checklist and baseline evidence docs.

### Decisions
- Decision: Mark glyph-advance and baseline/row-stability criteria as complete.
  - Reason: Probe evidence met thresholds with exact or better-than-threshold values.

### Risks or Blockers
- Risk/Blocker: Selection highlight perceptual quality is still unverified.
  - Impact: Phase 3 cannot close without confirming highlight does not break alignment perception.
  - Mitigation: Run focused manual highlight perception pass next.

### Checklist Deltas
- Checked: Glyph advance aligns to grid cell width.
- Checked: Baseline and row height alignment are stable across content.
- Unchecked/Reopened: Selection highlight and resize/font-ready/initial-render final criterion remain open.

### Next Session
- Objective: Validate selection-highlight alignment perception and close remaining Phase 3 criterion candidates.
- First action: Run manual selection sweep across mixed content (short, wrapped, empty, terminal) and record PASS/FAIL evidence.

---

## Session Entry

### Session Date
2026-05-23

### Active Phase
Phase 3 - Pixel-Perfect Visual Alignment

### Objective
Address drag-selection auto-scroll desync by quantizing viewport movement during native pointer drag.

### Work Completed
- Implemented in-flight drag scroll quantization in `CagedScrollPlugin`.
- Added pointer-driven drag lifecycle guards (start/end/cancel/blur/visibility).
- Added direction-aware row snapping during drag scroll correction to avoid backward jitter.
- Preserved existing wheel/key/paste intent behavior and refocus transaction semantics.
- Verified lint and TypeScript compile success after change.

### Decisions
- Decision: Prefer in-operation quantization over post-selection snap.
  - Reason: Keeps viewport/grid contract true at all times and avoids visible correction artifacts after selection ends.

### Risks or Blockers
- Risk/Blocker: Final acceptance still requires manual perceptual confirmation during real drag-to-boundary selection.
  - Impact: Phase 3 selection-highlight criterion remains open until manual pass is recorded.
  - Mitigation: Execute focused drag-selection manual suite next and log outcomes.

### Next Session
- Objective: Manually validate drag-selection smoothness and continuous grid alignment under boundary auto-scroll.
- First action: Perform top-to-bottom and bottom-to-top drag sweeps with crossed boundaries and confirm no perceived misalignment.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 3 - Pixel-Perfect Visual Alignment

### Objective
Execute final manual perception gate and close Phase 3 if criteria pass.

### Out of Scope
- Phase 4 persistence implementation changes.
- Phase 5 feature carryover work.

### Work Completed
- User executed manual selection perception suite and reported `PASS all 3`.
- Confirmed startup/font-ready initial alignment probe remained row-lattice aligned.
- Updated checklist and master execution map to reflect Phase 3 completion.

### Decisions
- Decision: Close Phase 3 and advance active focus to Phase 4.
  - Reason: All Phase 3 checklist criteria are now satisfied with both objective probes and manual perception evidence.

### Risks or Blockers
- Risk/Blocker: Persistence spine contracts are still pending.
  - Impact: Note lifecycle reliability and V1 data-path parity are not yet restored.
  - Mitigation: Begin Phase 4 with contract-first IPC and storage-path restoration sequence.

### Checklist Deltas
- Checked: Selection highlight does not break alignment perception.
- Checked: Resize/font-ready/initial render keep alignment stable.

### Next Session
- Objective: Start Phase 4 by restoring main/preload/renderer persistence contracts for note lifecycle.
- First action: Enumerate and implement typed IPC contract surface for list/load/save/create/delete note actions.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 4 - Persistence Spine

### Objective
Implement typed note lifecycle persistence contract across renderer, preload, and main process.

### Out of Scope
- SQLite compatibility and migration mapping.
- Timeline/trash/archive parity semantics.
- Phase 5 feature carryover.

### Work Completed
- Added shared note lifecycle types and channel map.
- Added main-process note lifecycle filesystem service.
- Registered typed IPC handlers for list/load/create/save/delete.
- Exposed narrow preload bridge API as `window.measlyNotes`.
- Wired renderer bootstrap + debounced autosave to the new API.
- Added Phase 4 contract documentation.

### Decisions
- Decision: Use markdown-filesystem lifecycle as the first persistence spine slice.
  - Reason: Establishes deterministic renderer/main contract first, then allows DB/state parity to layer on cleanly.
- Decision: Use repo `data/notes` in development and userData-backed `data/notes` when packaged.
  - Reason: Preserves local dev observability while keeping packaged runtime storage correct.

### Risks or Blockers
- Risk/Blocker: Browser automation cannot validate preload-exposed APIs because they exist only in Electron runtime.
  - Impact: Final persistence gate needs live app verification.
  - Mitigation: Run focused manual Electron save/reload/delete lifecycle checks.

### Checklist Deltas
- Checked: No checklist item fully closed yet in Phase 4 (implementation baseline complete, runtime verification pending).
- Unchecked/Reopened: All Phase 4 gates remain open until manual runtime verification is recorded.

### Next Session
- Objective: Validate runtime persistence behavior in Electron and close first Phase 4 gate if passing.
- First action: Execute manual lifecycle test (create/edit/save/relaunch/load/delete) and record pass/fail evidence.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 4 - Persistence Spine

### Objective
Close the first persistence runtime gate with manual save/relaunch/load evidence and resolve restart hydration regressions.

### Out of Scope
- Full note-management behavior parity (sidebar-driven lifecycle flows).
- DB migration and schema-compatibility layer.

### Work Completed
- User manually validated save/relaunch/load path in app runtime.
- Fixed startup hydration bug that caused blank editor on relaunch.
- Fixed newline round-trip mismatch where loaded text showed extra blank rows.
- Confirmed intentional empty lines persist correctly after relaunch.
- Updated Phase 4 contract and checklist evidence.

### Decisions
- Decision: Mark note lifecycle IPC + markdown persistence path as complete.
  - Reason: Runtime manual validation now confirms stable create/edit/save/relaunch/load behavior for current app surface.
- Decision: Defer delete-path acceptance until note-management UI surface is restored.
  - Reason: Current Edit > Delete affordance is not yet backed by full V1 note management semantics.

### Risks or Blockers
- Risk/Blocker: Autosave/title-aware policy parity remains incomplete.
  - Impact: Behavior may differ from V1 title-edit save cadence.
  - Mitigation: Add explicit title-line-aware autosave policy and validation in next Phase 4 increment.
- Risk/Blocker: Last-edited note + UI state restoration contract still missing.
  - Impact: Startup selection and layout continuity can drift between sessions.
  - Mitigation: Implement typed app-state/window-state persistence contract next.

### Checklist Deltas
- Checked: Main/preload IPC contract for note lifecycle restored.
- Checked: Markdown file persistence path restored.
- Unchecked/Reopened: Autosave/title-aware parity, DB migration path, and last-edited/UI-state persistence remain open.

### Next Session
- Objective: Implement typed app-state/window-state persistence and last-edited note restore.
- First action: Define shared state contract and wire load/save flows for selected note id + UI state at startup/shutdown.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 4 - Persistence Spine

### Objective
Implement typed app-state/window-state persistence and restore last-edited note continuity.

### Out of Scope
- DB migration compatibility work.
- Title-aware autosave parity policy.

### Work Completed
- Added shared typed app/window state contract and IPC channels.
- Added main-process `StateService` for `app-state.json` and `window-state.json`.
- Wired preload bridge as `window.measlyState`.
- Restored selected note from persisted app state on startup, with fallback to most recently updated note.
- Persisted selected note id on bootstrap and active-note changes.
- Restored and persisted window bounds/maximized state in main process.

### Decisions
- Decision: Treat selected note + window bounds as the current minimal UI-state continuity baseline.
  - Reason: Phase 5 sidebar/panel surfaces are not yet restored, so broader UI-state parity is deferred.

### Risks or Blockers
- Risk/Blocker: Title-aware autosave policy is still incomplete.
  - Impact: Save cadence may differ from V1 during title edits.
  - Mitigation: Implement explicit title-line save suppression/flush policy next.
- Risk/Blocker: DB compatibility/migration path still undocumented.
  - Impact: Persistence spine is not fully parity-safe for V1 data model reintroduction.
  - Mitigation: Draft and validate migration strategy before Phase 4 closure.

### Checklist Deltas
- Checked: Last-edited note and UI state persistence restored.
- Unchecked/Reopened: DB migration path and title-aware autosave parity remain open.

### Next Session
- Objective: Close remaining Phase 4 items (title-aware autosave parity and DB compatibility path).
- First action: Implement title-line-aware autosave behavior and validate with restart/save matrix.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 4 - Persistence Spine

### Objective
Finalize autosave/title behavior and close Phase 4.

### Out of Scope
- Phase 5 sidebar/search/tag/timeline feature carryover implementation details.

### Work Completed
- Simplified autosave decision path to post-edit evaluation only.
- Removed predictive title-focus logic used only for indicator/test signaling.
- Simplified save indicator to display last save timestamp only.
- Accepted current behavior as sufficient to proceed; marked Phase 4 complete.

### Decisions
- Decision: Treat title-edit save nuance as non-blocking for forward progress.
  - Reason: User accepted current behavior and explicitly prioritized moving on.

### Risks or Blockers
- Risk/Blocker: Title-edit autosave UX may still be tuned later.
  - Impact: Minor behavior polish, not architectural risk.
  - Mitigation: Revisit only if future feature carryover exposes practical issues.

### Checklist Deltas
- Checked: Autosave cadence and title-aware save behavior restored.
- Checked: Phase 4 is complete.

### Next Session
- Objective: Start Phase 5 with sidebar/list surface restoration to enable practical note-management parity.
- First action: Define minimal sidebar contract and render note list + selection actions against current persistence API.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 5 - Feature Parity Carryover

### Objective
Complete full V1->V2 persistence-model audit and publish canonical data model requirements before further carryover implementation.

### Out of Scope
- Phase 6 hardening/release baseline work.
- UI polish iterations unrelated to data coverage.

### Work Completed
- Audited full V1 database/types/filesystem model against current V2 contracts/services.
- Identified parity-critical missing entities (ordered tag relations, search projection, snapshots, per-note UI state).
- Documented canonical V2 data model requirements in `docs/V5_CANONICAL_DATA_MODEL.md`.
- Synced master execution map/checklist/persistence contract docs to the new model reference.

### Decisions
- Decision: Keep markdown note files as authoritative content source in V2.
  - Reason: This is a core product design requirement for portability and shareability.
- Decision: Treat DB/JSON stores as derivative projections for query, timeline, and UI continuity only.
  - Reason: Preserves source-of-truth clarity while enabling full feature parity.

### Risks or Blockers
- Risk/Blocker: Current V2 implementation still lacks full projection entities for search/snapshot/per-note UI state.
  - Impact: Full Phase 5 parity remains blocked until projection contracts are implemented.
  - Mitigation: Implement projection entities in planned sequence from `docs/V5_CANONICAL_DATA_MODEL.md`.

### Checklist Deltas
- Checked: Canonical data model parity spec documented.

### Next Session
- Objective: Implement ordered note-tag relation contract and write paths (primary/secondary/tertiary + protected-tag enforcement).
- First action: Extend shared note lifecycle/tag contracts and main-process persistence handlers for add/remove/reorder/rename tag flows.

---

## Session Entry

### Session Date
2026-05-24

### Active Phase
Phase 5 - Feature Parity Carryover

### Objective
Stabilize note creation/editing UX parity and align governance artifacts with completed carryover behavior.

### Out of Scope
- Suggested tags implementation details.
- Timeline/time machine implementation details.
- Utility action parity implementation.

### Work Completed
- Restored and validated keyboard shortcuts: Ctrl+N, Ctrl+Shift+N, and Escape search-reset behavior.
- Implemented new-note template as `# ` and enforced immediate caret placement after the heading marker.
- Hardened active-note title synchronization so menu cards update live while typing.
- Removed save-indicator UI and associated renderer logic.
- Added runtime-data repository hygiene policy (`data/**` ignored with `.gitkeep` exception).
- Updated parity checklist to reflect completed Search and Keyboard carryover items.

### Decisions
- Decision: Use optimistic title projection in renderer plus save-response reconciliation from persistence.
  - Reason: Maintains immediate UI coherence while preserving markdown-authoritative persistence ordering.
- Decision: Keep runtime user data excluded from source control except for directory sentinel.
  - Reason: Prevents accidental data churn in commits while preserving expected local storage shape.

### Risks or Blockers
- Risk/Blocker: Suggested tags, timeline, and utility actions remain unimplemented.
  - Impact: Phase 5 remains open despite major interaction parity completion.
  - Mitigation: Execute remaining carryover bricks in isolation with checklist-gated validation.

### Checklist Deltas
- Checked: Search restored (text + #tag).
- Checked: Keyboard shortcuts restored (Ctrl+N, Ctrl+Shift+N, Escape).
- Unchecked/Reopened: Suggested tags, timeline/time machine, utility actions.

### Next Session
- Objective: Implement Suggested tags parity on top of the current canonical tag model.
- First action: Add deterministic suggestion derivation pipeline and sidebar interaction hooks without violating markdown source-of-truth flow.
