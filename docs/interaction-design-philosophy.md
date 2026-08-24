# Interaction Design Philosophy

## Purpose
This document defines how input, caret, scroll, note activation, and render/state-update scope must be implemented across the app.

The goal is deterministic behavior with one source of truth per interaction phase, and a render footprint that never exceeds what actually changed.

## Quality Bar
- Interactions must feel crisp, predictable, and immediate.
- Any tolerance, smoothing, or fudge factor must be deliberate, documented, and tied to a clear UX rationale.
- Hidden leeway that can blur correctness boundaries is not acceptable.
- No unnecessary re-renders or flicker: only what changed should redraw. This is treated as a correctness bar, not a cosmetic nice-to-have.

## Core Principles

### 1. Press-driven actions, not release-driven actions
- Primary user intent is recognized on key press.
- Any action that can be triggered on key press must not be deferred to key release.
- Key release is allowed only for lifecycle cleanup, never for first-time behavioral correction.

### 2. Deterministic first, geometric fallback second
- Boundary logic must be driven by deterministic state derived from the operation context.
- Geometry is a reconciliation aid, not the authority for core correctness.
- If geometry is missing or ambiguous, prefer deterministic state over timing retries.

### 3. Single owner per concern
- Scroll ownership must be explicit during guarded transactions.
- Caret visibility and viewport movement must not compete across multiple independent handlers.
- Each interaction has one active owner for state transitions.

### 4. No hidden second chance paths
- Fallbacks may exist, but they must not duplicate primary behavior in another phase.
- A release-phase fallback that can re-run a press-phase action is prohibited.
- If fallback is required, it must be phase-compatible and side-effect bounded.

### 5. Recoverability without ambiguity
- User-facing state changes must be recoverable through explicit idempotent actions.
- If UI appears stale, selecting an item again should perform a safe reload path.
- Active identity and rendered content must stay coupled.

### 6. Simplicity over defensive complexity
- Do not add state branches unless they close a reproduced failure mode.
- Remove temporary probes and safety scaffolding once deterministic behavior is confirmed.
- Prefer fewer transitions with stronger invariants.

### 7. No blanket fail safes
- A fail safe must never be used to mask unknown structural or technical defects.
- Blanket catch-all correction paths that obscure root causes are prohibited.
- A fallback is acceptable only when the edge case is known, deterministic, and explicitly scoped.

### 8. Pathology-first visibility
- Pathological behavior must remain visible enough to trace to first cause.
- Do not suppress or auto-heal failures in ways that erase diagnostic signal.
- If behavior is wrong, the default response is root-cause analysis and core-fix implementation.

### 9. Root-cause correction mandate
- Fix the origin, not the symptom.
- If a workaround is temporarily required, it must be time-boxed, documented, and removed after root-cause fix lands.
- Every corrective patch should state what vulnerability was removed from the core path.

### 10. Surgical rendering, never blanket updates
- Every state update must be scoped to exactly the entities that changed. Before writing one, identify precisely what's affected -- don't reach for "just replace the whole list/array/object" as a default because the real scope wasn't analyzed.
- Unaffected siblings must keep stable object identity (same reference, not a re-created equal copy) so they don't re-render alongside the thing that actually changed.
- A blanket update is acceptable only when the entire scope genuinely did change -- never as a shortcut that saves having to figure out what did.
- This is the default impulse for every state-touching change, not a special-case optimization reached for only when profiling flags it. Unnecessary re-renders and flicker are a broken-feeling product, not a cosmetic detail: nothing undermines a premium, physical-object feel like parts of the UI visibly redrawing themselves for no reason. We're building something that feels like a rock, not a mirage.

## Input Phase Contract

### Key press phase
- Capture intent.
- Arm deterministic transitions.
- Apply primary behavior for actions that must feel immediate.

### Update phase
- Reconcile DOM/editor state after the engine applies mutation.
- Apply caged viewport correction and caret stabilization.

### Key release phase
- Clear pressed-key bookkeeping.
- Deactivate transient transaction guards when safe.
- Never perform first-time scroll or caret correction.

## Rules for Boundary-sensitive Enter and Arrow Handling
- Enter boundary shifts are key-press initiated.
- Arrow navigation reconcile is update-driven after movement is committed.
- Boundary detection must use authoritative caret geometry for arming decisions.
- Ambiguous geometry must never promote a boundary state.

## Rules for Note Activation and Switching
- Note creation and activation must be atomic from the user perspective.
- Active note identity must drive editor instance ownership.
- Selecting a note card must be capable of forced reload recovery when state is stale.
- **Smooth scrolling is an orientation device, and orientation only exists within one document.** A jump that stays in the note the reader is already in (a find hit, a link to another part of the same note) animates: watching the travel is what tells them how where they were relates to where they asked to go. A jump that *changes* the active note never animates -- the position it would travel from is one the reader did not choose and mostly never saw, so the motion conveys nothing and only delays arrival.
- **A heading is a destination, not a point in prose.** A jump whose target is a heading (a table-of-contents entry, any `#heading:` anchor) lands that heading at the TOP of the viewport, not centred, and never animates -- not even within the note the reader is already in, which is the one exception to the orientation rule above. Centring a heading spends the upper half of the viewport on the section being left, and a menu of destinations is chosen from in order to arrive, not to watch. Mid-prose targets (a find hit, a manual `[text](#anchor)` into a paragraph) keep centring, the animation, and the highlight flash: there the target really is one point among others, and the flash is what distinguishes it.
- A note opened *at* a position (an anchor/TOC link into it) must be restored directly onto that position, not restored to its own stored position and then moved. The stored position must never be painted first: arriving somewhere the reader did not ask for, however briefly, is the same defect as landing there. Both panes have a channel for this -- `buildEditRestoreSnapshotFromUiState`'s `overrideSourceAnchorLine` for edit, `pendingRenderViewSourceAnchorRef` for render -- and both are fed from `activateNote`'s own override parameters.
- Programmatic jump geometry must not depend on the editor being focused. An unfocused editor has no DOM selection to measure, and following a link is exactly the case where focus is on the thing that was clicked -- resolve the target from the editor's own layout instead (CM6Editor's `resolveSelectionBlockInScroll`), or the jump silently does nothing in the one case it exists for.
- **Restores supersede, they never queue and never block.** A restore is a decision about where the reader should be, so the newest one -- computed from the newest state -- wins; an in-flight one is cancelled, not deferred to. Dropping the newcomer (the old rule) let a hand-off derived from where the reader actually is lose to a stale cached one, and made any restore that never completed silently disable every later restore for the rest of the session.
- **"It stopped moving" is not "it arrived."** A restore that positions the editor by line has to keep verifying against the editor's *current* height map: for lines it has not rendered, CM6 answers with an estimate that ignores wrapping, and a viewport landed on that estimate is perfectly stable at the wrong place. Settle loops exit when re-deriving the target would no longer move anything -- never on stillness alone.

## Review Checklist
Before shipping an interaction change, verify:
- No release-phase action duplicates a press-phase behavior.
- Boundary transitions are deterministic and reproducible under key repeat.
- No hidden race between native behavior and guarded behavior.
- Re-selecting active entities can recover from stale render states.
- Temporary instrumentation is removed once validation is complete.
- No blanket fail safe was introduced to hide unresolved behavior.
- Any fallback path is deterministic, bounded, and justified by a documented edge case.
- The patch removes or narrows a concrete root vulnerability instead of broadening tolerance.
- Every state update touches only the entities that actually changed; unaffected siblings keep stable object identity instead of being blanket-recreated.
