# Interaction Design Philosophy

## Purpose
This document defines how input, caret, scroll, and note activation behavior must be implemented across the editor stack.

The goal is deterministic behavior with one source of truth per interaction phase.

## Quality Bar
- Interactions must feel crisp, predictable, and immediate.
- Any tolerance, smoothing, or fudge factor must be deliberate, documented, and tied to a clear UX rationale.
- Hidden leeway that can blur correctness boundaries is not acceptable.

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
