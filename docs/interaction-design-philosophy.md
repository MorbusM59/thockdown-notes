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

### 3b. View-scrolling keys belong to the visible pane, not to whatever has focus
- `PageUp`/`PageDown` move the *view the reader is looking at*. Focus is where
  their next character would go, which is a different question: having just
  clicked a toolbar button does not mean the reader stopped reading. Routing
  these keys by focus alone leaves them swallowed by a button that has no use
  for them -- measured live: one click on any toolbar icon and PageDown did
  nothing at all until the reader clicked back into the text.
- So each pane listens at the window, and three conditions decide the single
  owner: the section is the active one (otherwise both panes of a split view
  answer the same keypress), the pane is the one on screen (the edit pane stays
  mounted while hidden, and would otherwise scroll invisibly in render view),
  and nothing with a real claim already took the key.
- "A real claim" means either a caret that can page through text
  (`contentEditable`, `textarea`) or a control that deliberately binds the key
  and calls `preventDefault` -- the Options sliders nudge by ten steps. Both
  panes use the identical predicate so they cannot drift apart; a focused
  button or search field is not a claim.

### 3c. The scrollbar describes the text, not the layout
- A scrollbar asks one question of the document -- "where am I, as a fraction?"
  -- and gets it two different ways depending on size
  (`src/editor/documentPosition.ts`). The scrollbar itself only ever deals in
  ratios and knows nothing about which answer it got.
- **Under 50,000 characters**: ordinary pixel scrolling. The whole document is
  rendered, its height is genuinely known, and pretending otherwise would be
  ceremony.
- **Over 50,000 characters**: the document is chunked, so its pixel height is
  not known -- and no attempt is made to learn it. Thumb POSITION is a
  character offset into the source; thumb SIZE is `viewport lines / document
  lines`, counted once from the source. Neither reads `scrollHeight`.
- The reason for the second is not accuracy, it is stability. A pixel ratio is
  a question about layout, and layout is not known until it has been measured,
  so the thumb moved every time the app learned something -- once per note
  load, and again whenever a better height estimate arrived. A scrollbar that
  twitches when the app's knowledge improves is reporting on the wrong thing.
- Ballpark is the standard there, not exactness: measured within 2-9% of the
  pixel ratio on ordinary notes, and knowingly worse on image-heavy ones. A
  thumb that is consistently a little wrong beats one that is briefly right and
  then moves.
- Recompute on CHANGE (the text, the typography, the pane geometry), never on
  measurement. If a recomputation would be triggered by the app finishing some
  work rather than by the reader doing something, it is the wrong trigger.
- That rule is now enforced rather than merely intended: the size is COMMITTED
  against a signature of exactly those inputs and held until one of them moves
  (`createCommittedThumbHeight`, `src/editor/scrollThumbMetrics.ts`). Deriving
  the right answer on every sync is not the same thing as holding it -- any
  wobble in the reading became a thumb that resized under the reader, most
  visibly at the end of a long journey.
- A provisional answer is never committed. "Not yet" is not an answer, and a
  document entitled to an exact scrollbar must not be pinned to whatever
  estimate happened to be current the first time it could say anything
  (`isThumbRatioSettled`, `src/editor/documentPosition.ts`).
- Where a thumb is written directly to the DOM for an animation, handing it
  back has to write the DOM directly too. A restore that only sets React state
  is silently conditional on that state having changed -- and once the size is
  correctly stable, it never has, so the animation's last frame stays on screen
  for good.

### 3e2. A keypress moves the text by whole rows, and never by a revision's cost
- **The invariant.** One arrow press moves the TEXT by exactly zero rows or
  exactly one row, decided only by whether the caret has reached the cage's
  edge -- never by anything about measurement. It is an invariant about where
  CHARACTERS sit, not about `scrollTop`: when a height-map revision changes the
  height of content above the viewport, holding the text still *requires*
  `scrollTop` to change, by exactly the revision's cost.
- Therefore `scrollTop` is the wrong thing to measure, and measuring it is how
  this hid for so long. A press reporting a scroll delta of -208px may have
  moved the reader one row while absorbing a -182px revision, which is right,
  or eight rows, which is not. Only text movement -- scroll delta minus height
  change -- answers the question, and the trace reports both halves for that
  reason.
- **A revision above the viewport is the only thing that displaces a reader.**
  Heights learned *below* the viewport do not move what is above them, so
  downward travel is correct by construction and must be left alone. Correcting
  it anyway broke it outright: the bottom resting position is screen-anchored
  (pane height minus two insets) rather than a row, so a real row can never
  land on it, the caret sits permanently short, and a correction firing on that
  residual fights every keypress. The correction is top-edge only.
- **CM6's anchor is not the reader's caret.** Its compensation holds *its own*
  anchor still, which can carry the caret clean across the viewport -- measured,
  a 442px revision moved it from the top edge to the bottom. So a check that
  asks only "is the caret inside the cage" is satisfied by a caret that has been
  thrown the width of the pane. Remember which edge the reader was travelling
  along and restore that; and let only a real keypress set it, since a
  correction that redefines the edge oscillates forever.
- A "no edge" answer is an answer. A caret comfortably inside the cage is not a
  missing reading, and treating it as one leaves the last edge standing, so
  every later press in any direction drags the caret back to it.

### 3f. A journey in flight is not interruptible, except to end it
- While a scroll is travelling, an ordinary click on the track is ignored. A
  second journey would inherit the stretched thumb as its own base size and
  set off from that, which is how a thumb ends up longer than its own rail.
- The one input honored mid-flight is the HOLD, which snaps. That is coherent
  because a snap ends the journey outright rather than trying to travel
  alongside it -- and it is the gesture a reader reaches for precisely when
  they have decided the journey is in the way.
- Ending a journey early, by any route, must return the thumb to its resting
  size. A cancelled animation that leaves its own geometry behind is worse
  than one that never ran.

### 3d. In edit view, text is never between rows
- The edit pane is a grid of character cells. Text sits on row boundaries
  before, during and after every interaction -- a wheel, a held PageDown, a
  thumb drag, a resize, a mid-flight animation frame. There is no moment,
  however brief, at which a line is allowed to sit half a row off its box.
- This is a hard guard, not a convention: every engine that writes `scrollTop`
  quantizes on the way out, and `src/editor/rowGridGuard.ts` is the net beneath
  them for the writes the app does not make (chiefly CodeMirror adjusting
  `scrollTop` as its own height estimates firm up). Two correctors never run on
  one scroller at once; the guard stands down while a drag-selection owns the
  position.
- The rule is edit view only. The render view lays out blocks of every height
  and has no grid to hold.

### 3e. A long journey is cut, not endured
- Travel time is a property of the interaction, not of the distance. A
  scrollbar click across a very large document takes about the same half second
  as one across a small one, because the journey's middle is removed rather
  than played (`src/editor/scrollJourney.ts`, `src/editor/scrollBridge.ts`).
- It is a cut, not a teleport, and the difference is the whole design: the
  motion ramps up on the real document, a curtain of spoof text sweeps in at
  the journey's own speed, the jump happens only while the pane is fully
  covered, and the ramp-down lands on the target as the curtain sweeps out. The
  reader sees text leave, text pass, and text arrive.
- Speed is always measured in real viewport pixels, never in characters. A
  character-space ratio may say WHERE to go; how fast it feels getting there is
  a question about the screen.
- The scrollbar tells the same story rather than a smoother one. Its thumb
  stretches across the span, holds while the cut happens, and gathers itself at
  the far end -- a thumb that slid evenly would be describing a journey that
  did not take place.
- Nothing here reaches the scroll-sync between the two panes, which keeps its
  own approach.

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

- **A destructive decision is made from the source of truth, never from a renderer cache.** "Is this note empty?" answered from the editor's in-memory buffer or the notes list can be wrong in ways the two caches AGREE on -- the buffer misses text that arrived by another route, the list misses anything not yet refreshed -- and when they agree wrongly, the note is deleted with the user's writing in it. Read the record (and flush pending writes first). One IPC call at a rare gesture costs nothing; deleting someone's note is unrecoverable. Found exactly this way while building set-aside for undocked notes: a note reading "Call from Rita" was discarded because both caches still said it was the empty template.

## Rules for User-Facing Text
- **A tooltip is user information, never code commentary.** It says what the control does or why it is unavailable, in the reader's terms, and stops. Mechanism, architecture, rationale, and the design reasoning behind a restriction belong in the code comment next to the implementation -- where the person who needs them is actually looking -- not in the one line a user reads mid-task.
- Concretely: "The User Guide cannot be modified." is complete. "The User Guide is read-only -- it ships with the app and updates itself" is a note to a developer wearing a tooltip's clothes, and it costs the reader time to work out that none of it changes what they can do.
- The test: would this sentence still make sense to someone who does not know the app has a database, a main process, or a seeding step? If not, it is commentary. Move it into the code and write the user a shorter sentence.
- This applies equally to `aria-label`, placeholder text, empty-state copy, and confirmation prompts. Being thorough in the wrong register reads as noise, not care.

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
