# CM6 Parity, Hardening & Performance Loose-Ends — Plan & Handover

Written for a fresh Claude Code session picking this up mid-stream, same convention as
`docs/large-document-performance-handover.md`. This doc is the throughline for a broader
effort than pure performance: the CM6 editor migration shipped as production
(`docs/large-document-performance-handover.md`'s "CodeMirror 6 migration" section, the
production flip at commit `61ea71a`), but shipping the replacement surfaced real correctness
gaps against the Lexical editor it replaced, and a full sweep of the performance effort's own
history (see below) surfaced tooling whose actual payoff was never checked against what it cost.
This doc exists to track closing both gaps without losing the thread across sessions.

**Read `docs/document-scale-performance-philosophy.md` first** for the parts of this effort that
are pure performance work (Phase 5 below) — its process discipline (measure before diagnosing,
fuzz-verify incrementality, live-browser-check anything touching caret/selection) applies
unchanged here, especially given two of the bugs below are caret/selection bugs, the
highest-severity class this codebase tracks.

## Where this came from

A session ran a full historical sweep of the large-document performance effort — 11 milestone
commits, 5 note sizes, 10 sustained bursts of 100 keystrokes each on real packaged-Electron
builds — specifically to answer "did any of this infrastructure cost more than it bought."
It found real answers (see Phase 3), and in the same conversation the user separately flagged
four live bugs in the now-production CM6 editor plus a suspicion that the CM6 migration hasn't
reached full parity with what the Lexical editor used to do. Both threads converge on the same
question: **for every piece of infrastructure or feature built during this effort, was it
actually given the chance to do what it was built for, and is anything left half-finished?**
That question is this doc's organizing principle across all five phases below.

## The five-phase plan

Priority order, per the user's own framing. Do not skip ahead — Phase 2 in particular can
surface more bugs that belong in Phase 1's bucket, and Phase 3's loose-ends audit is cheaper to
do once Phase 1/2 have stopped changing the code out from under it.

1. **Fix high-priority bugs** — the four items below, all live in the production CM6 editor.
2. **Restore full parity with pre-refactor (Lexical) functionality** — anything CM6 does today
   that is a regression, not just a difference, from what `Editor.tsx` used to do.
3. **Hunt down loose ends in the performance effort itself** — audit every tool/mechanism built
   during the performance push for whether it was actually exercised toward its stated purpose,
   and strip what wasn't (see the concrete candidates already found, below).
4. **Emergent-bug hunting and general CM6 hardening** — bugs not yet known, found by exercising
   the editor rather than reasoning about it.
5. **Outside-the-box performance exploration** — per the user: paths not yet tried because of an
   unexamined assumption, not because they were tried and failed. This continues under
   `docs/document-scale-performance-philosophy.md`'s existing contract; this doc only adds the
   "assumption-hunting" framing, it doesn't replace that doc's solution hierarchy.

## Latest Session Update (transition orchestration hardening)

- Added a dedicated deterministic transition state machine at
  `src/editor/ScrollTransitionController.ts` and integrated it into
  `CM6Editor.tsx` as the single authority for:
  - Programmatic-vs-user scroll provenance.
  - Temporary interaction blocking during restore/settle windows.
  - End-of-settle callback used to force custom-scrollbar thumb resync.
- Extended `EditorContract` (`EditorViewportChangeEvent` and
  `EditorSnapshotApplyRequest`) with optional `transitionId` so restore flows
  can be correlated end-to-end instead of inferred from timing/counters.
- Wired `transitionId` through `useEditorSectionMount.ts` restore paths
  (`applyEditRestoreSnapshot` and `seedInitialViewport`) and added matching
  filtering in `onViewportChange` to trust transition provenance over heuristic
  user-event suppression where IDs are present.
- Removed legacy ad hoc scroll-suppression counters/time-window plumbing from
  `CM6Editor.tsx` and replaced those call sites with controller lifecycle
  operations.

Validation done in this session:

- `npm run lint` clean (same known TS parser support warning as before).
- `npm test` clean (22 files, 277 tests passing).

Remaining follow-up to complete parity sweep:

- Preview-side paging/scroll ownership now participates in transition
  provenance: `useEditorSectionMount` owns a preview restore transition
  controller, classifies restore-origin scrolls deterministically, and
  exports `isPreviewScrollInteractionBlocked`; `usePreviewScrollbar` consumes
  it to block PageUp/PageDown and custom-scrollbar track/thumb interactions
  while restore settle is active.
- Next verification focus is live-behavior stress under rapid mode toggles:
  ensure blocked interactions are released promptly after settle and no
  starvation occurs when preview anchor resolution falls back/retries.

---

## Phase 1 — high-priority bugs (grounded, ready to implement)

A research pass grounded all four reports in source before any fix work started, per this
project's own "measure/read before diagnosing" rule. Findings below are cited by file:line as
of the investigation session; re-verify line numbers before trusting them if this doc is read
much later (this file's own sibling doc has twice flagged line-number drift as a recurring trap).

### Bug 1 — right-click selection-extension mechanic is missing from CM6 entirely — FIXED

**Fixed.** Ported into `CM6Editor.tsx`'s `EditorView.domEventHandlers` block: a `contextmenu`
handler reusing `resolveScopeRange`/`isSameRange` from `ContractBridgeRangeUtils.ts` completely
unchanged (confirmed framework-agnostic, pure text+offset functions — no CM6-side adapter needed
beyond reading `view.posAtCoords`/`view.state.selection.main` and dispatching
`EditorSelection.single(...)`, exactly as anticipated below), plus a `mousedown` handler
resetting the cycle ref on left-click, mirroring `ContractBridgePlugin.tsx` 1:1. A new
`rightClickCycleRef` tracks cycle state the same shape as Lexical's. Dispatching a
selection-only change (no `changes`) is picked up automatically by the existing shared
`updateListener`'s `update.selectionSet` branch, which already handles `onSelectionChange`
emission and caret/highlight scheduling — no duplicate wiring needed there.

Verified live (`scripts/perf/verifyCM6RightClickSelectionScope.mjs`, committed as a permanent
regression check matching this project's other `verifyCM6*.mjs` scripts): repeated right-clicks
on the same word correctly cycle word → sentence → line → block → (caps at block), an
intervening left-click correctly resets the next right-click to word scope, zero console errors.
`npx tsc --noEmit`, `npm run lint`, `npm test` (251/251) all clean; full existing
`scripts/perf/verifyCM6*.mjs` suite re-run to confirm no regression elsewhere (see this doc's
session-handover section for the pass/fail count from that run).

One thing worth flagging for whoever verifies this next: an early version of the live check
appeared to fail (selection reading empty on the "sentence"/"block" steps) — traced to the
*test's own* synthetic click coordinates landing on a word-boundary character instead of inside
a word, not a defect in the port. Calibrating the click position via native
double-click-selects-word first (CM6 doesn't suppress this) and reading its real bounding rect
resolved it. Documented here since it's exactly the kind of "looks like a regression, is actually
the test" trap this effort's process discipline warns about repeatedly — don't skip the
recalibration step if this pattern reappears elsewhere.

---

**Original investigation notes below, kept for context on why the fix took the shape it did:**

**Not a dead-end in a partial port — it was never ported.** Two *different* right-click features
exist in this codebase; don't conflate them:

- **Feature A, missing**: right-click *inside the editor text* cycles selection scope
  (word → sentence → line → block) on repeated right-clicks in the same spot. Lexical
  implementation: `src/plugins/ContractBridgePlugin.tsx:286-397` (`handleContextMenu`, bound to
  `contextmenu` on the root element, line 387), using `resolveScopeRange`/`SelectionScope` from
  `src/editor/ContractBridgeRangeUtils.ts`, a `rightClickCycleRef` to track repeat-clicks-in-place
  (`resolveNextScope`, lines 279-284), and `applySelectionStateToDom` to commit the result.
  Companion `handleMouseDown`/`handleDoubleClick` (lines 368-385) suppress the browser's native
  double/triple-click expansion, since this mechanic is meant to be the only way mouse-driven
  multi-unit selection happens. **`CM6Editor.tsx` has zero references** to any of
  `contextmenu`/`rightClickCycle`/`resolveScopeRange`/`SelectionScope` in its editor-content
  `EditorView.domEventHandlers` block (`CM6Editor.tsx:1828-1900+`, which only registers `paste`
  and `keydown`) — right-clicking inside CM6's text area today falls straight through to the
  native/Electron context menu, full stop.
- **Feature B, already fully ported, do not re-touch**: the custom scrollbar's right-click-hold
  paging (hold right mouse button on the scrollbar track to page). Lexical:
  `Editor.tsx:1124-1157`/`:1080-1122`. CM6: `CM6Editor.tsx:2408-2513`, line-for-line equivalent
  including the `onContextMenu` no-op suppressor at `CM6Editor.tsx:2515`. This is unrelated to
  Feature A — it lives on the scrollbar track DOM node, not the editor content — and the
  handover doc already credits it as ported. A plan that says "port right-click scrollbar
  paging" would be re-doing already-done work; the actual gap is Feature A only.

**Implementation note for whoever picks this up**: `ContractBridgeRangeUtils.ts`'s
`resolveScopeRange`/`SelectionScope` operate on the canonical text + a plain offset range, not
Lexical node objects — worth checking whether they can be reused as-is against CM6's
`EditorState.doc`/`EditorSelection` (a `Text` object, offsets already line up the same way), or
whether they need a thin CM6-side adapter. Given `EditorContract.ts`'s existing "one shared
implementation, two starting points" pattern (used repeatedly elsewhere in this effort — see
`FastParagraphResolver`, `scanInlineStateFrom`), reusing the Lexical-side scope-resolution logic
unchanged and writing only a CM6-side apply/dispatch step is very likely the right shape, not a
from-scratch CM6 reimplementation.

### Bug 2 — caret disappears after the right-click dead-end; not restored by section-switch, only by full note reload — CLOSED

**Root cause: the right-click handler simply wasn't wired up (Bug 1). Fixed by Bug 1, confirmed
live, closed — no further recovery/failsafe mechanism wanted.**

The right-click-specific focus loss is fixed: with Bug 1's `contextmenu` handler now intercepting
right-click (`event.preventDefault()`, no native menu ever appears), focus never leaves
`.cm-content`. Verified directly: click into the editor, right-click, confirm
`document.activeElement` is still the editor and there's no console error. The caret overlay
itself does go away after a right-click, but that's **correct, expected behavior, not a bug** —
`updateCaret()` (`CM6Editor.tsx:1024-1028`) deliberately hides the blinking-caret overlay
whenever the selection is a non-collapsed range (`!selectionRange.empty`), same as it would for
a drag-selection or double-click; `.thockdown-block-selection` (the actual selection highlight)
renders correctly in its place. Don't mistake this for a regression if re-checking later — verify
against `.thockdown-block-selection`, not `.thockdown-block-caret`, when a right-click has just
selected a range.

A deeper live trace (git-swapping in the pre-Bug-1 file to test the exact "no handler at all"
state, correcting an initial coordinate-calibration mistake that produced a false lead) confirmed
CM6 tracks cursor position from native mouse events via its own internal plumbing regardless of
which button — no internal/native-selection desync exists, with or without the fix. **Decision
(explicit, from the user): don't chase this further, and don't build a general "restore the
caret if it looks lost" recovery mechanism even if one had been found.** Stated reasoning, worth
preserving verbatim in spirit: a blanket recovery mechanism for symptoms that "might pop up" is
not appropriate development-time practice — if there's a failure, it should be visible, not
silently patched over by a failsafe. The `restorePersistedEditState` `focusAfterApply` fix from
the previous round stays (harmless, real consistency fix, unrelated to this decision) but the
originally-suspected multi-section-switch repro was never built and isn't being chased further —
re-open only if a new, concrete report narrows it down, not by resuming the general search.

**Named, acknowledged gap already in the source, independent of the above, deliberately not
pursued per the same reasoning**: `CM6Editor.tsx:2040-2047`'s own comment notes the port of
`CagedScrollPlugin.tsx`'s `handleKeyUp`/`handleWindowBlur`/`handleVisibilityChange` only covers
page-scroll-relevant parts, excluding "caret-refocus state not yet ported." Leave as a known,
named gap — only worth touching if a concrete symptom traces back to it specifically.

### Bug 3 — caret jumps back to document start (offset 0)

Turned out to be **two genuinely different bugs** the original report conflated (both produce
"cursor ends up at 0," but from opposite directions — one is live in-memory corruption *during*
typing, the other is a restore-time gap because a position was never persisted at all). Split
below; don't re-merge them, the fixes are unrelated.

#### 3a — mid-typing corruption: cursor resets to 0 while actively editing, not on restore — FIXED

**This is the one the user flagged as "a different beast... it happens mid typing in an active
note... document initial and text enters at the wrong place."** Not a restore-time issue at all —
found and fixed in `CM6Editor.tsx`'s same-note hydration path.

Root cause: the hydration effect (keyed on `[noteId, initialText]`) is *expected* to re-run on
every keystroke (React's `initialText` prop, sourced from `activeNoteText`, changes every
keystroke) and is *expected* to almost always no-op via its own guard (`currentText === initialText
→ return`). But whenever that guard failed for the *same* note — `initialText` transiently
disagreeing with CM6's own live document, for any reason, not just one specific trigger — the
previous code unconditionally did a full `{from: 0, to: doc.length, insert: initialText}` replace
**and an explicit `selection: EditorSelection.cursor(0)`**, for both a genuine note switch *and*
this same-note case. A genuine note switch legitimately wants that (a separate restore-snapshot
mechanism repositions the caret correctly afterward); the same-note case has no such follow-up,
so the reset stuck — the exact reported symptom.

Compared directly against the Lexical reference this was ported from
(`NoteTextHydrationPlugin.tsx`) and found a real, clean divergence: Lexical's version tags its
equivalent update with `SKIP_SELECTION_FOCUS_TAG` (never explicitly moves the caret for this
path) and patches only the differing span via a prefix/suffix line diff (`replaceEditorText`) —
CM6's port dropped both properties, per its own comment ("Slice-1 simplification... since CM6's
own `Text.replace()` already avoids that function's entire reason for existing"), which was true
performance-wise but missed that the diffing *also* did correctness work (giving CM6's own
selection-through-changes mapping something meaningful to map an existing caret through).

**Fixed** by branching on whether this is a genuine note switch
(`lastHydratedNoteIdRef.current !== noteId`): only that path still does the full replace + cursor
reset. The same-note path now dispatches a minimal, common-prefix/suffix-trimmed change (extracted
to a pure, fuzz-tested function, `computeMinimalTextReplacement` in
`src/editor/MinimalTextDiff.ts`) with **no explicit `selection` field**, letting CM6's own
selection-through-changes mapping preserve the caret automatically — confirmed this actually works
via a direct live check (dispatch a non-overlapping targeted change, confirm the existing caret
maps to the correct shifted position, not 0).

**What wasn't achieved, stated precisely rather than glossed over**: a full end-to-end live
reproduction of the *original triggering race* (what exactly makes `initialText` and CM6's live
doc transiently disagree for the same note) was not obtained. Two specific hypotheses were tested
and didn't reproduce it: (1) `deferPreviewOnRapidInput`'s coalesced-commit lag — its
`scheduleCoalescedPreviewCommit` reads `latestEditorTextRef.current` fresh at rAF-fire time, not a
stale snapshot, so it's more robust than it looks; (2) a 62-character synchronous CM6-dispatch
burst within a single JS task (to try to outrun React's re-render) — also stayed in sync every
time. The fix closes the *symptom* (confirmed via direct testing of the actual mechanism it
relies on) and matches the trusted reference implementation's own defensive shape, so it's shipped
with high confidence despite this gap — but if the exact trigger ever gets pinned down, record it
here rather than assuming this doc's hypotheses were it.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (258/258, +7 new fuzz tests for
`computeMinimalTextReplacement`), full `scripts/perf/verifyCM6*.mjs` suite (22/22), plus live
checks for both branches — genuine note-switch (content fully replaces, no cross-contamination,
caret focused) and the selection-mapping mechanism itself (a targeted non-overlapping edit
correctly shifts rather than resets an existing caret).

#### 3b — restore-time gap: cursor genuinely never persisted, so it reads back as 0 — NOT a bug, reframed as a design gap

**`getNoteUiState`'s 0-default is not a misdiagnosed "malformed read"** — `databaseService.ts:1567-1572`'s
own comment states it directly: the DB row's `cursorPos` column stays SQL NULL until the first
*debounced* UI-state save fires; if the app closes (or the note/section is switched away from)
before that, 0 is genuinely the last successfully-persisted state, not a failure to distinguish
from anything.

**The real gap, found by tracing every write path**: cursor position is essentially only ever
persisted at two moments in the whole app — `beforeunload` (`App.tsx:6733`,
`persistActiveNoteEditModeStateNow()`, but only for `activeSection`, not every open section in
split view) and the preview↔edit mode toggle (`useEditorSectionMount.ts:1258`, `immediate: true`).
**The function actually built for incremental/debounced saving during ordinary typing and
scrolling, `persistEditUiState`'s own 280ms-debounce branch, is never called in debounced mode
anywhere in the codebase** — confirmed by grepping the whole `src/` tree; its one call site always
passes `immediate: true`. This is the same shape as Bug 1: real infrastructure that was built but
never wired up to fire during normal use, not a logic bug in the fallback itself.

**Scope decision from the user, explicit**: this deserves a real, comprehensive fix, not a
patch on the fallback value. See the new "Cursor/scroll persistence redesign" section below —
this is being treated as its own tracked effort, not folded into a one-line Bug 3 fix.

Two *intentional* zero-resets exist, unrelated to either bug above, and must not be conflated with
either: `ZERO_EDITOR_SELECTION` (`EditRestoreMath.ts:21`) used for entering a Time Machine snapshot
preview (`useEditorSectionMount.ts:1658-1663`, "no saved cursor of its own, show from the top") and
the fallback when leaving preview back to a note with no cached edit-mode state (`:1671-1679`),
plus one analogous use in `useNoteSnapshotTimeline.ts:252-253`. These are product behavior.

No "brittle" comment/TODO exists in-repo — that word is the user's own characterization, not a
quoted source finding. 3a above is the concrete substance behind it.

## Cursor/scroll persistence redesign

Scoped out of Bug 3 (see 3b above) per explicit user direction: "lacking caret position
persistence in various cases has plagued the app for a while. we really need to have a fully
comprehensive but light weight persistence routine." Two parts, both implemented and verified this
session.

**1. Piggyback the cursor position onto the existing debounced note-text save — no extra
queries.** `useNoteSaveQueue.ts`'s `queueSave(text)` already fires a debounced
`saveNote({id, text})` ~350ms after typing pauses, via `upsertNoteContent`'s
`INSERT ... ON CONFLICT DO UPDATE` on the `notes` table. `cursorPos`/`scrollTop` are real columns
on that same table (already used by the separate, explicit `saveNoteUiState`/`getNoteUiState`
path) — so `queueSave` grew two more optional args (`cursorPos`, `scrollTopPx`), threaded through
`SaveNoteInput` → `noteLifecycleService.saveNote` → `databaseService.upsertNoteContent`, added as
two more bound params on the *same* prepared statement, no new query. The `ON CONFLICT` clause
`COALESCE`s against the existing row value (`cursorPos = COALESCE(excluded.cursorPos,
notes.cursorPos)`), so passing `null`/`undefined` (every other caller: `createNote`, external-file
sync, snapshot branching) never clobbers a previously-persisted position — matches the existing
`hasUnsavedChanges`/`syncMode` pattern already used on this same statement. Every call site of
`queueSave` in `useEditorSectionMount.ts` (7 of them: markdown-shortcut transform, checklist
typeover, Enter transform, character-insert transform, plain text-change, viewport/programmatic
sync) now passes `selection.end` and `latestEditViewportTelemetryRef.current?.scrollTopPx` — both
values it already had on hand at that point, so this really is "free" as asked: no new state, no
new subscriptions, no new render triggers, just two extra bound params on a write that was already
happening. The browser mock bridge (`installBrowserMockBridges.ts`) mirrors the same
COALESCE-if-provided semantics so dev-mode behavior matches production.

**2. Exhaustive-but-minimal explicit checkpoint list for content-unload/editor-switch points.**
The piggyback above only fires on the *next* debounced text save — genuinely free, but not
guaranteed to have fired yet at the exact moment a section's editor unloads (e.g. closing a
section 100ms after the last keystroke, well inside the 350ms window). Traced every point in the
app where an editor's content stops being the visibly active one, using the already-existing
`persistActiveNoteEditModeStateNow()` (an explicit, non-debounced `saveNoteUiState` call — this
one *is* a real extra query, but only at these transition points, not per-keystroke) as the
checkpoint primitive:

- **Already wired before this session** (confirmed by tracing, no fix needed): `activateNote`
  (`EditorSection.tsx:371-385`, switching notes within a section) and the preview↔edit toggle
  (`useEditorSectionMount.ts:1258`, `immediate: true`).
- **`handleCloseSection`** (`App.tsx`, parks a named section) — was missing entirely; added.
- **`handleDeleteSection`** (`App.tsx`, permanently removes a section slot) — same gap, same fix;
  the note itself can outlive the deleted slot, so its position is still worth keeping.
- **`handleSwapSection`** (`App.tsx`, swaps a different section into `outgoingSectionId`'s slot) —
  `outgoingSectionId`'s editor unloads its note here too; same fix, applied to the outgoing side.
- **`handleClearSection`** (`App.tsx`, "clear this section" picker action — closes the slot, then
  backfills a fresh blank section) — same underlying `closeSlot` call as `handleCloseSection`; same
  fix.
- **`beforeunload`** (`App.tsx`) — previously only flushed `activeSection`; now iterates every
  section in `sectionRegistryRef` so split-view panes other than the active one aren't silently
  dropped on quit.

**Verified live** (`scripts/perf/verifyCM6CursorPersistenceCheckpoints.mjs`, committed as a
permanent regression check): (1) typing alone, no explicit `saveNoteUiState` call, and
`getNoteUiState` reflects the typed-to cursor position after the debounce window — proves the
piggyback path works end-to-end through the real save queue, not just at the SQL layer; (2) typing
in a second section and closing it *immediately* (well inside the 350ms debounce window) still
persists the correct cursor position — proves the explicit checkpoint, not the debounce timer, is
what's responsible. A/B-verified: temporarily reverting just the `handleCloseSection` checkpoint
line reproduces the loss (`getNoteUiState` reads back `cursorPos: 0`, `sourceAnchorText: null` —
i.e. nothing was persisted at all) with the same test, confirming check (2) actually exercises the
fix rather than passing by coincidence. Also: `npx tsc --noEmit` clean, `npm run lint` clean,
`npm test` 258/258, full `scripts/perf/verifyCM6*.mjs` suite passing (see Session handover for the
exact count).

**Deliberately not done, per this doc's standing no-blanket-fix principle**: no generic "recover a
lost cursor" fallback, no extra query added anywhere except the handful of real, named transition
points above. The mid-typing corruption bug (3a) already fixed the actual "caret gets lost" defect
directly at its source — this redesign is purely about not losing a position that was already
correct.

### Bug 4 — Enter key visually produces a double line break

**Flagged for live-browser verification before writing a fix — static analysis argues this
specific symptom shouldn't reproduce in CM6, unlike the (already-resolved, unrelated) Lexical
`innerText`-measurement artifact this doc's sibling handover doc closed out previously.**

- Enter's *text* semantics are shared, not duplicated per editor: `EnterTransformPolicy.ts`'s
  `resolveMarkdownEnterTransform` is imported once (`useEditorSectionMount.ts:31`) and threaded
  through `EditorContract.ts`'s single `onEnterTransform` binding to both `Editor.tsx` and
  `CM6Editor.tsx` — CM6's own Enter handling (`CM6Editor.tsx:1710-1727+`) calls the exact same
  callback. A doc-model-level "adds an extra `\n`" bug would show up identically in both editors,
  and the prior investigation (`docs/large-document-performance-handover.md:167-187`) already
  confirmed the canonical text only ever gains exactly one `\n` per Enter, verified against the
  real save pipeline, not just `innerText`.
- The previously-diagnosed cause (Chromium's `innerText` serializer inserting a synthetic blank
  line between adjacent block-level `<p>` elements via margin-collapse) **structurally can't
  apply to CM6**: CM6 renders each line as a `<div class="cm-line">`, not a `<p>`, and its margin
  is explicitly zeroed twice over — `CM6Editor.tsx:1558` (`.cm-line { padding: 0 }` in the CM6
  theme) and `src/index.css:440-443` (`.editor-text p, .editor-text div { margin: 0; padding: 0 }`,
  which applies to `.cm-line` since CM6's real contentDOM carries the shared `editor-text` class).
- **If a real visual double line break is actually reproducing** (as opposed to a stale
  `innerText`-style symptom being reported again by habit), it is a *different, not-yet-explained*
  defect from the one this doc's sibling already closed — both the shared canonical-text logic
  and the CSS argue against it existing as described. **Before any fix**: reproduce live (type a
  line, press Enter, screenshot, count real `.cm-line` elements, read the saved text back through
  `window.thockdownNotes.loadNote()`), per this project's own non-negotiable "live-browser check,
  not code-reading" rule for anything selection/caret/rendering-adjacent. Don't skip straight to a
  CSS tweak on the assumption it's the same bug shape as before — the evidence above says it
  probably isn't.

### Bug 7 — 1px horizontal shift at a soft-wrap boundary ("wrap-boundary caret assoc") — FIXED (mechanism verified, pixel-level symptom not reproducible in this sandbox; largely superseded by Bug 8 below, which found the real cause of the user-visible symptom)

**User report**: typing a character (specifically a space) that fills a line all the way to its
last box and causes it to wrap shifts the edit-mode viewport's text one pixel to the left,
"looks like horizontal scrolling." The shift reverts if you break into the new line, arrow-left to
its first box, then arrow-left once more. A live follow-up narrowed it further: switching
Left/Right at the exact wrap point while the caret is at the boundary toggles the 1px shift
directly — the caret sits "behind the last box, off screen or partially cut off by the border" in
the wrong state, and the user's own diagnosis was that an ambiguous, partially-cut-off caret
position should "automatically break the ambiguity in favor of showing the caret on the new line."

**Root cause, grounded in `@codemirror/view`/`@codemirror/state` source, not guessed**: a collapsed
cursor sitting exactly at a soft-wrap boundary is simultaneously "end of the old visual row" and
"start of the new one" — the same document offset, two different rows. CM6 has a real, built-in
mechanism for this exact ambiguity: `SelectionRange.assoc` (`-1`/`0`/`1` — "associated with the
character before," "no preference," "associated with the character after," i.e. downstream/new-line
— see `@codemirror/state`'s own doc comment on `SelectionRange.assoc`). `ViewState.update`
(`@codemirror/view/dist/index.js`) sets `mustEnforceCursorAssoc = true` whenever a selection update
leaves a collapsed cursor with a **non-zero** assoc under line-wrapping; the next measure pass then
calls `DocView.enforceCursorAssoc()`, which reads the current DOM Selection and moves it (via
`Selection.modify()`) to the correct visual side.

The gap: CM6's own default text-insertion path — `EditorState.replaceSelection(text)`
(`@codemirror/state`), which is what handles literally every ordinary keystroke, including the
space that triggers the wrap — always produces the resulting cursor via
`EditorSelection.cursor(range.from + text.length)`, **no `assoc` argument**, defaulting to `0`. So
`mustEnforceCursorAssoc` never engages for typing. Arrow-key navigation across the same boundary
doesn't have this problem: `moveByChar`/`moveVisually` (what `cursorCharLeft`/`cursorCharRight`
use) **always** returns a cursor with a real, nonzero assoc — confirmed by reading
`moveVisually`'s own return statements in `@codemirror/view/dist/index.js` — which is exactly why
the user's arrow-key round trip "fixes" it and typing doesn't: arrow keys already correctly trigger
CM6's own correction; typing never did.

This also independently confirms the user's own proposed fix direction: `assoc: 1` in CM6's own
vocabulary literally *means* "associated with the character after" (downstream/new-line) — the same
"always downstream at a wrap boundary" policy `CaretRect.ts`'s `resolveCollapsedCaretRect` already
applies to this app's own caret-overlay rendering (see its doc comment, `resolveCollapsedCaretRect`
in `src/editor/CaretRect.ts`), just not previously applied to CM6's *real* native selection, which
is what native browser auto-scroll-into-view behavior actually reacts to. Confirmed this app never
intentionally needs horizontal scroll at all (`CM6Editor.tsx`'s own `EditorView.theme` comment on
`.cm-scroller { scrollbarWidth: 'none', overflowX: 'hidden' }`: "this app draws its own scrollbar
... and never scrolls horizontally (line-wrapping is always on)"), which is consistent with any
observed horizontal drift being a native-browser artifact of exactly this ambiguity, not legitimate
app state.

**Fix** (`CM6Editor.tsx`, in the existing `updateListener`, next to `reconcileCagedScroll`/
`reconcilePasteScroll`'s own flag-and-reconcile pattern): after any `docChanged` transaction that
leaves a collapsed cursor with `assoc === 0`, queue a microtask (not a synchronous re-dispatch from
inside the listener that produced the update — a known CM6 footgun, the same reason the two
existing reconciles above defer rather than dispatch in place; a microtask rather than
`requestAnimationFrame` since this doesn't need a real layout settle, only to be outside the
current callstack, and firing before paint avoids a one-frame flash) that re-dispatches
`EditorSelection.cursor(pos, 1)` at the same position, generation-guarded so a second keystroke or
navigation landing before the microtask runs supersedes it instead of stomping on wherever the
selection ended up next. A debug-only dispatch counter
(`wrapBoundaryAssocFixDispatchCountRef`, exposed through the existing
`thockdown:debug-cage-state` debug hook alongside a `selectionAssoc` read) exists purely so this
fix's own mechanism is externally observable — the necessity of the counter is itself a finding,
see below.

**What verification could and couldn't prove — recorded honestly, not glossed over**:

- `npx tsc --noEmit`, `npm run lint` (one pre-existing, unrelated failure in `App.tsx` confirmed via
  `git stash` to exist identically without this change), `npm test` (513/513, no regressions) all
  clean.
- A live-browser regression script
  (`scripts/perf/verifyCM6WrapBoundaryAssoc.mjs`) types real word-wrapped text up to the exact last
  box of a wrapped row (mirroring the user's own repro), types the wrap-triggering character, and
  asserts the fix's dispatch counter incremented exactly once for that keystroke. A/B-verified
  (`git stash` on just `CM6Editor.tsx`): without the fix, the debug fields this test reads don't
  exist at all and the assertion fails outright — confirming the test actually exercises the fix,
  not passing by coincidence.
- Per-keystroke performance A/B (`npm run perf:input-lag -- --chars=1500000 --keystrokes=30
  --position=end`, 3 runs each side): with-fix means ~32.8/39.5/40.1ms, baseline means
  ~44.5/33.7/38.7ms — indistinguishable within this environment's run-to-run noise, no measurable
  regression from the extra per-keystroke selection-only dispatch (cheap: no doc/height-map/
  decoration recompute, unlike the text-changing transaction that already just happened).
- **Honestly unresolved**: a genuine pixel-level before/after of the originally reported symptom
  (the actual 1px scrollLeft/text shift) was attempted extensively and never reproduced in this
  sandbox's headless Linux Chromium (`dev:browser`), fix or no fix. Multiple angles were tried and
  all came back negative: real word-wrapped typing across dozens of wrap points, an exact
  screenshot pixel-diff (`pixelmatch`) of an unrelated, already-settled row before/after the
  wrap-triggering keystroke (0 pixels different, both with and without the review-gutter/
  line-numbers column enabled), a sweep across 16 window widths, and direct polling of
  `scroller.scrollLeft`/`.cm-content`'s bounding rect/computed `transform` across the exact
  Left/Right arrow toggle sequence the user described (never moved, even by a sub-pixel, across
  any of these). The native `Selection` Range's own `getBoundingClientRect()` was *already* on the
  correct (downstream) row in every attempt, fix or no fix — meaning Chromium's own default
  wrap-boundary-affinity heuristic apparently already resolves correctly by default in this
  specific environment (headless Linux Chromium, whatever font/DPI/GPU-compositor path that
  implies), so the ambiguous branch this fix targets was never actually forced open here to prove
  the *symptom* went away. This reads as a Chromium-version/platform-specific heuristic difference,
  not a flaw in the root-cause analysis (which is grounded directly in `@codemirror/view`/
  `@codemirror/state` source, not inference from a failed repro) — but it's a real gap: the fix is
  shipped on the strength of (a) a documented CM6 mechanism used exactly as CM6 itself uses it for
  the already-correct arrow-key case, (b) confirmed-firing mechanism-level verification, and (c) an
  A/B-verified regression test — not a live pixel-for-pixel confirmation of the user's own
  screen. If this symptom recurs, the next lead is trying the real packaged Electron app (a
  different Chromium build/config than the `dev:browser` mock) via `xvfb-run`, per this doc's own
  `docs/large-document-performance-handover.md`-established pattern
  (`scripts/perf/measureInputLagElectron.mjs`), rather than re-attempting the same headless-Chromium
  angle.
- The full existing `scripts/perf/verifyCM6*.mjs` suite (25 scripts) was also re-run to confirm no
  incidental regression elsewhere in the shared `updateListener` this fix touches: 19/25 passed;
  the 6 that didn't (`verifyCM6CaretSurvivesTagMutation`, `verifyCM6ColdBootCaretFocus`,
  `verifyCM6Phase2Slice11`, `verifyCM6Phase2Slice17`, `verifyCM6Phase2Slice20`,
  `verifyCM6ProductionGating`) were each individually A/B-verified via `git stash` on just
  `CM6Editor.tsx` — every one fails identically with the fix stashed out, confirming pre-existing
  sandbox flakiness (a drag-handle locator, a tag-pill locator, a y-box slider test-setup gap two
  of the failures' own error messages already flag as "test setup is wrong, not a product bug," and
  a cold-boot caret-focus race unrelated to this fix's scope), not a regression from this change.

---

## Phase 2 — restore full parity with pre-refactor (Lexical) functionality

Not yet inventoried, and the original plan for doing so needs adjusting: **`Editor.tsx` and every
Lexical-only plugin no longer exist in the working tree** — a later session fully removed the
Lexical fallback (see Phase 3's newest entry) once CM6 was confirmed production-ready. The
side-by-side "diff `Editor.tsx`'s feature surface against `CM6Editor.tsx`'s" method this section
originally proposed still works, just needs to read `Editor.tsx` from git history instead of the
live tree (`git show <pre-removal-commit>:src/components/Editor.tsx`, or `git log --all --
src/components/Editor.tsx` to find it) rather than assuming it's still sitting there to diff
against directly. Bug 1 above (right-click scope-cycling) is the one confirmed gap found this way
before the removal — a real Lexical feature with zero CM6 equivalent at the time, since fixed.
Whether any *other* gaps like it still exist, silently, is genuinely unknown — this phase was
never completed, it just lost its live diff target. `EditorContract.ts`'s own doc comment used to
say "implementations may be partial while the rewrite is in flight"; now that there's only one
implementation, that framing itself is gone (see the contract's own updated comment), so it's no
longer a reliable pointer to remaining known gaps either — treat this phase as needing exercised,
adversarial use of the real app to surface anything still missing, not a document to reread.

## Phase 3 — performance-effort loose ends (concrete candidates already found)

From the historical sweep (see the conversation this doc was written from, or re-derive via
`docs/large-document-performance-handover.md`) and the Phase-1 research pass:

- **RESOLVED, later session: the Lexical fallback was fully retired, not just deprioritized.**
  This bullet used to ask "keep `LexicalRopeSync` as rollback-path insurance, or let it go?" —
  the answer landed on "let it go," executed all the way through: `src/components/Editor.tsx`,
  every Lexical-only plugin (`ContractBridgePlugin.tsx`, `NoteTextHydrationPlugin.tsx`,
  `CagedScrollPlugin.tsx`, `BlockCaretPlugin.tsx`, `SyntaxHighlightPlugin.tsx`,
  `BlockSelectionPlugin.tsx`, `PasteSanitizationPlugin.tsx`, `TextSanitizationPlugin.tsx`),
  `src/nodes/ThockdownTokenNode.ts`, `LexicalRopeSync.ts`, and `LexicalParagraphOffsetSync.ts`
  (plus their tests) were all deleted, `SectionEditorArea.tsx`'s
  `localStorage['thockdown:cm6-editor-spike']` gate and its Lexical-fallback branch were removed
  (`CM6Editor` is now unconditional, no flag checked at all), and the `lexical`/`@lexical/react`
  npm packages were uninstalled. `ContractBridgeRangeUtils.ts` (the framework-agnostic
  scope-resolution logic both editors shared) and its test survived, relocated from
  `src/plugins/` to `src/editor/` since `src/plugins/` no longer means anything now that there's
  no Lexical plugin architecture left. This makes the rest of Phase 3's original framing below
  moot rather than answered differently — there is no rollback path left to insure, measure, or
  decide about. Kept below anyway as the record of *why* this was a safe call to make (CM6
  already structurally subsumed what the rope was for), not as still-open guidance.
- **The rope-wiring commit's own measured 1M-char regression (~8x, see the sweep data) was never
  actually fixed on the Lexical side — it was sidestepped by the CM6 flip, and per the above is
  now permanently moot rather than merely unmeasured.** CM6's own `EditorState.doc` (a
  `@codemirror/state` `Text`) was already a real tree/rope (`TextLeaf`/`TextNode` classes,
  structural-sharing `replace`/`slice`/`lineAt`) — exactly the property `LexicalRopeSync` existed
  to retrofit onto Lexical, which had no native rope of its own. That's what made retiring it
  (rather than porting or re-measuring it) the right call once the Lexical path itself was gone.
- **Two commits mid-sweep (02–04: incremental block-split, paragraph-offset index,
  dedupe+virtualization) each showed a severe 1M-char sustained-typing regression (218ms → 179ms →
  151ms/keystroke) despite being individually verified as wins at the time** — and the regression
  disappeared somewhere in the untested gap between commit 04 (`41b6feb`) and commit 05
  (`fd05570`), across several commits the sweep didn't test individually
  (`5425716`/`5d9a9ed`/`404b8d5`/`4a88e3d`). **Not yet attributed to a specific commit.** Worth a
  proper `git bisect` (using the same repeated-burst 1M-char harness as the pass/fail oracle,
  threshold e.g. mean > 50ms = fail) run through that range specifically, both to close out this
  open question and because whatever actually fixed it may be a generalizable technique worth
  naming and reusing deliberately, rather than an accidental side effect of an unrelated commit.
- **General principle to apply across all of the above, per the user's own framing**: "providing
  the infrastructure can create a bit of overhead that might actually end up in a net gain on the
  next step, if that new infrastructure allows for unification or getting rid of an even worse
  offender." Concretely: before deciding any piece of performance infrastructure from this effort
  is dead weight, check whether removing it would also remove something built *on top of* it, or
  whether keeping it is what let a later fix be simple. Don't audit each commit in isolation.
- **New, confirmed this session: `ParagraphOffsetIndex.ts`'s fast-path infrastructure is dead
  code today, not merely unmeasured.** It exists to be handed to `SelectionOffsets.ts`'s
  `getOffsetWithinRoot`/`readSelectionStateFromDom`/`readSelectionOffsetFromClientPoint` as an
  optional `FastParagraphResolver` — but the only thing that ever populated one,
  `LexicalParagraphOffsetSync.ts`, was deleted with the rest of the Lexical fallback (see above).
  Grepped whole-tree: `ParagraphOffsetIndex.ts` is now imported only by its own test file;
  `CM6Editor.tsx` never references `FastParagraphResolver`, `ParagraphOffsetIndex`, or
  `getOffsetWithinRoot` at all. The one CM6-side caller that does reach `SelectionOffsets.ts`
  (`CaretTerminalOffset.ts:2,20`, a rare trailing-newline visual-compensation fallback gated to
  only fire when `caretRect.source` is `'adjacent-probe'`/`'anchor-fallback'`, not a hot path)
  always takes the slow O(document length) DOM-walk path, with no fast resolver to hand it. Not
  urgent — the call site confirmed not-hot — but real dead weight: `ParagraphOffsetIndex.ts` plus
  its fuzz test (`ParagraphOffsetIndex.test.ts`) are safe to delete outright, same as the other
  Lexical-only infrastructure already removed, unless a future CM6-side fast resolver is written
  to actually use it.
- **New, confirmed this session: `src/editorSection/useEditorSectionMount.ts.bak` is checked into
  the repo** (tracked, not gitignored — `git log` shows a real commit for it, last touched
  2026-08-01). A 100KB stray backup of the file it sits next to. Delete it; there is no reason a
  `.bak` file should be version-controlled, and its presence risks someone editing the wrong copy.

## Phase 4 — full CM6 integration audit (supersedes the original "emergent-bug hunting" framing)

**Not yet started; this is the user's own "next large goal," explicitly scoped as the last major
post-migration effort "until I come up with the next one."** The original one-line framing below
("exercise the editor, look for anything that doesn't match Lexical's prior behavior") is kept for
context but is too coarse to actually work through step by step — Lexical is gone from the tree
now (Phase 3), so "diff against Lexical" is no longer even the right mental model. Reframed as a
methodical, subsystem-by-subsystem sweep of `CM6Editor.tsx` and everything it wires into, looking
specifically for the failure class the user named directly: **individual components silently
falling back to native/default browser handling — bypassing this app's grid alignment, custom
smooth-scroll, or other custom rendering — without that fallback being a deliberate, documented
tradeoff.** `CM6Editor.tsx` already documents several *intentional* native-fallback tradeoffs
in code comments (e.g. `:1543` native `scrollIntoView` on arrow-key movement reconciled a frame
later by the caging system, not fought directly; `:2354` drag-selection auto-scroll snapped back
onto the grid one frame behind native rather than intercepted outright) — the goal of this audit
is to find the ones that *aren't* documented/intentional like those are, not to re-litigate the
ones that already are.

**Original, still-valid framing, folded in rather than replaced**: this subsumes Phase 2's
never-completed parity inventory (per Phase 2's own updated note above, that now means exercising
the real app adversarially rather than diffing against a git-history copy of `Editor.tsx`) — both
questions ("does anything silently degrade to native handling" and "is anything still missing
relative to what Lexical used to do") are answered by the same activity: exercised, adversarial,
live-browser use of the real app, not code reading. Per this doc's own standing rule and
`docs/document-scale-performance-philosophy.md`'s process discipline, findings from this phase get
verified live before being called bugs, and any fix touching caret/selection/scroll gets the same
live-browser check before being called done.

### Subsystem checklist

Ordered roughly by how directly each one touches the user's named symptom (native-fallback,
grid-alignment, smooth-scroll) first, broader/lower-risk sweeps last. Each item should be worked
as: read the relevant source fully, form concrete hypotheses about where a silent native fallback
or streamlining gap could live, then verify live in the browser — not the reverse.

1. **Scroll & viewport system** — `ScrollTransitionController.ts`, `CageMath.ts`,
   `ScrollCurvePlan.ts`, `QuantizedSmoothScroll.ts`, and `CM6Editor.tsx`'s own scroll-adjacent
   `domEventHandlers`/effects (arrow-key caging, PageUp/PageDown continuous scroll + release
   ramp-down, drag-selection auto-scroll quantization, wheel/trackpad handling). Highest-priority
   area: this is where "resets to native handling, bypassing smooth scroll" would concretely show
   up, and it's also the area with the most prior churn (see the "hardening?"/"fade"/"scroll ramp"
   commits in recent history) — a good sign real work has happened here, and an equally good
   reason to suspect loose ends.
2. **Grid alignment** — the box-grid overlay and everything that keeps `.cm-content`'s glyph
   origin matched to it (`CM6Editor.tsx`'s theme block around `:1684-1710`, the content
   padding-zeroing effect referenced at `:3144`, `EditorTypography.ts`). Directly the other half
   of the user's named symptom. Check every place glyph/line geometry is read or written for
   whether it stays grid-quantized under every code path (resize, zoom/font-size change, note
   switch, split-view pane resize) or only under the ones already tested.
3. **Custom scrollbar** — `usePreviewScrollbar.ts` (734 lines, both edit- and preview-side
   scrollbar track/thumb ownership, PageUp/PageDown interaction blocking during restore settle —
   see this doc's own "Latest Session Update" above for the most recent work here, which named its
   own follow-up: verify blocked interactions release promptly and don't starve under rapid mode
   toggles).
4. **Caret & selection rendering** — `SelectionOffsets.ts`, `CaretRect.ts`, `CaretVisualPosition.ts`,
   `CaretTerminalOffset.ts`, `SelectionRects.ts`, plus `CM6Editor.tsx`'s block-caret-overlay and
   `.thockdown-block-selection` rendering (`drawSelection()` deliberately disabled, per the code
   comment at `:1654-1661` — confirm nothing re-enables or partially depends on CM6's native
   selection painting anywhere else). Highest-severity class per this project's own convention if
   anything is found here.
5. **Preview/edit scroll sync** — `PreviewBlockIndex.ts`, `PreviewScrollAnchor.ts`,
   `anchorBlockIndex` persistence/restore (`EditRestoreMath.ts`, `useEditorSectionMount.ts`'s
   restore paths), the mode-toggle path. This is the area the "Scroll-sync rewrite" section above
   most recently rewrote and explicitly flagged as **not yet live-verified in a real browser
   session** — that standing gap should be closed as part of this item, not treated as separate.
6. **Text/markdown transforms** — Enter (`EnterTransformPolicy.ts`, Bug 4 above is still open and
   belongs here), Tab-indent, markdown-shortcut, checklist typeover, paste sanitization. Confirm
   each transform's CM6-side wiring still matches its shared policy function with no CM6-specific
   drift.
7. **Persistence** — cursor/scroll checkpoint coverage (already comprehensively redesigned this
   doc, Bug 3b above) — this item is mostly a live-verification pass confirming the checkpoint
   list still matches every real unload point, not new design work.
8. **Split-view / multi-section** — the rough edges already named in `TODO.md`'s own "Split-view
   rough edges" section (shared `editorStageRef`, shared `pendingViewportRestoreRef`/
   `isApplyingInitialViewportRef`, hibernation never exercised under real N>1 typing load,
   cold-start restore with 2+ sections never verified against a real Electron restart). Treat that
   TODO list as this item's starting checklist rather than re-deriving it.
9. **Performance-infrastructure loose ends** — `ParagraphOffsetIndex.ts` dead-code removal (found
   this session, see Phase 3 above), the ~19 vestigial `thockdown:cm6-editor-spike`-setting perf
   scripts (`TODO.md`), and a fresh read of whether any other Lexical-era performance module
   quietly lost its only caller the same way `ParagraphOffsetIndex.ts` did — grep every module
   under `src/editor/` for real (non-test) import sites before assuming any of them are still
   load-bearing.
10. **Repo hygiene** — the checked-in `.bak` file (found this session, see Phase 3 above), and a
    scan for any other stray/generated files that shouldn't be tracked.

**Process note**: this list is a starting map grounded in what's actually in the tree today, not
a guess — but it is deliberately not exhaustive of every file under `src/editor/`/`src/editorSection/`.
Expect to find more as each item is worked; add newly-found areas to this list rather than chasing
them ad hoc, so the list stays the actual record of what's been covered.

## Phase 5 — outside-the-box performance exploration

This continues under `docs/document-scale-performance-philosophy.md`'s existing contract and
solution hierarchy — this doc doesn't replace that one, it adds a framing on top: **hunt for
unexamined assumptions in how the app is built, not just unexplored optimizations within the
current architecture.** Per the user: "we made assumptions about how things had to be handled
when none of our core design pillars actually require it." Concrete candidates already visible
from this session's research, none yet investigated:

- **`EditorContract.ts`'s "hand `onTextChange` a full flat string every keystroke" design is
  itself an assumption, not a requirement.** The handover doc already scoped and *declined* a
  version of this ("Phase B," rope-based edit ranges instead of a flat string) after measuring a
  ~1% ceiling against the risk — but that measurement was against the specific consumer set that
  existed at the time. Worth revisiting only if Phase 3's audit finds new full-document-string
  consumers added since, changing the ceiling calculation — not worth re-opening on priors alone.
- **Web Worker for markdown parsing** — named as a candidate in the original philosophy doc,
  never investigated, still open.
- **CM6's own decoration/StateField system as a replacement for round-tripping transforms through
  React state** — CM6 has native primitives for exactly this class of problem
  (`Decoration`/`StateField`/`StateEffect`) that Lexical's port may not have fully leaned on,
  having been built to mirror Lexical's own shape rather than CM6's idioms. Unconfirmed; would
  need a read of `CM6Editor.tsx`'s current transform-application path against what CM6 offers
  natively before concluding anything.

Don't add to this list from pure brainstorming — anything added here should come from actually
reading a hot path and asking "does this really need to work this way," the same discipline the
rest of this effort already uses.

---

## Session handover

Update this section every session that touches this doc's scope, same convention as
`docs/large-document-performance-handover.md`. State what shipped, what was verified and how,
and what's still open — don't let a session end without both.

**This session**: wrote this plan from the user's own five-phase framing, grounded Phase 1's four
bugs in source (see citations above), identified the concrete Phase 3 loose ends already visible
from the historical performance sweep.

**Bug 1 (right-click selection-scope cycling) — fixed and verified.** See its section above for
the fix shape.

**Bug 2 — partially resolved, partially re-scoped.** The right-click-specific focus-loss half is
confirmed fixed live (a side effect of Bug 1's fix). The `restorePersistedEditState` focus fix
landed (consistency with sibling branches) but live tracing found it isn't reachable via any known
UI flow — the real "not restored from switching between sections" complaint is very likely about
this app's actual multi-section split-view feature, not note-switching within one section, and
that scenario hasn't been tested at all yet. See Bug 2's section above for the full trace and
what's still needed.

**Verification for both changes this session**: `npx tsc --noEmit` clean, `npm run lint` clean,
`npm test` 251/251 (twice, once per change), and the full existing `scripts/perf/verifyCM6*.mjs`
regression suite run twice — 21/21 after Bug 1, 22/22 after Bug 2's fix (two new scripts added:
`verifyCM6RightClickSelectionScope.mjs`, `verifyCM6ColdBootCaretFocus.mjs`) — plus fresh
live-browser functional checks for each specific behavior. One A/B check done (Bug 2's fix
`git stash`-verified to still pass its own test either way, since the test doesn't reach the
fixed branch — recorded honestly above rather than claimed as proof the fix does something).

**Bug 2 — closed per explicit user direction.** Deep live tracing (including swapping in the
pre-Bug-1 file to test the exact no-handler state) found no internal/native selection desync, with
or without Bug 1's fix — root cause really was just the missing right-click wiring. Explicit
decision: don't chase the multi-section-switch angle further, and don't build a general "restore
the caret if it looks lost" recovery mechanism — a blanket fix for symptoms that might pop up
isn't appropriate development-time practice; failures should stay visible. See Bug 2's section
above for the full reasoning, kept verbatim in spirit since it's a standing principle for this
whole doc, not just this one bug.

**Bug 3 split into two, 3a fixed, 3b re-scoped as its own effort.** 3a (mid-typing corruption —
the actual "different beast" the user flagged, distinct from any restore-time issue) is fixed:
CM6's same-note hydration path no longer force-resets the caret to 0, matching the Lexical
reference implementation's `SKIP_SELECTION_FOCUS_TAG` discipline; the diffing logic was extracted
to a pure, fuzz-tested function (`src/editor/MinimalTextDiff.ts`) rather than left inline and
only reachable via a live-browser hook. Verified: `npx tsc --noEmit`, `npm run lint`, `npm test`
258/258 (+7 new), full `scripts/perf/verifyCM6*.mjs` suite 22/22, plus live checks of both the
genuine-note-switch path (unaffected) and the selection-mapping mechanism the fix depends on
(confirmed directly). **Honestly unresolved**: the exact end-to-end trigger for the original
mismatch was never reproduced despite two targeted attempts — see Bug 3a's section for exactly
what was tried and why it's still shipped with confidence anyway (matches the trusted reference
implementation's own defensive shape, and the mechanism it relies on was verified directly).

3b (cursor position genuinely never persisted in various real scenarios, reads back as 0) is
**not a bug in the fallback logic** — `getNoteUiState`'s 0-default is correct given what's
actually in the DB. Tracing every write path found the real gap: only two moments in the whole
app ever persist cursor position (`beforeunload`, but only for the single `activeSection`, not
every open section in split view; and the preview↔edit toggle) — the function actually built for
incremental/debounced saving during ordinary typing is never invoked in debounced mode anywhere.
Per explicit user direction, this was scoped as its own real, comprehensive
persistence-checkpoint design effort rather than a patch on the fallback value.

**3b — fixed and verified, this session.** See the new "Cursor/scroll persistence redesign"
section above for the full design and implementation: (1) the cursor position now piggybacks onto
the existing debounced note-text save at every `queueSave` call site, no extra queries; (2) five
explicit checkpoints (`handleCloseSection`, `handleDeleteSection`, `handleSwapSection`,
`handleClearSection`, and a fixed `beforeunload` that now flushes every open section instead of
just the active one) cover every point an editor's content unloads/switches that the piggyback
alone can't guarantee has already fired for. Verified: `npx tsc --noEmit` clean, `npm run lint`
clean, `npm test` 258/258, full `scripts/perf/verifyCM6*.mjs` suite (23/23, one new script:
`verifyCM6CursorPersistenceCheckpoints.mjs`), live-browser checks of both the piggyback path and
the close-section checkpoint, and an A/B check proving the close-section checkpoint fix is actually
load-bearing (reverting it reproduces the loss under the same test).

**A later session fixed Bug 7 (1px horizontal shift at a soft-wrap boundary, "wrap-boundary caret
assoc")** — see its own section above for the full account. Root cause grounded directly in
`@codemirror/view`/`@codemirror/state` source: CM6's own `SelectionRange.assoc` mechanism for this
exact "collapsed cursor at a soft-wrap boundary" ambiguity exists and works (arrow-key navigation
already relies on it correctly), but CM6's default text-insertion path never sets a non-zero assoc,
so its own correction (`enforceCursorAssoc()`) never engaged for typing. Fixed with a
generation-guarded, microtask-deferred follow-up dispatch in `CM6Editor.tsx`'s existing
`updateListener`. Verified: `npx tsc --noEmit`/`npm run lint` clean (one pre-existing unrelated lint
failure confirmed via `git stash`), `npm test` 513/513, a new A/B-verified live-browser regression
script (`scripts/perf/verifyCM6WrapBoundaryAssoc.mjs`) confirming the fix's own dispatch mechanism
fires, and a 3-run-each per-keystroke perf A/B showing no regression. **Explicitly not achieved,
stated honestly rather than glossed over**: a genuine pixel-level reproduction of the originally
reported symptom itself — extensive attempts (real word-wrapped typing across dozens of wrap
points, a `pixelmatch` screenshot diff of an unrelated settled row, a 16-width sweep, direct
`scroller.scrollLeft` polling across the user's exact arrow-key toggle sequence) never budged a
single pixel in this sandbox's headless Linux Chromium, fix or no fix.

**The user reported back that Bug 7's fix made no noticeable difference, then gave two sharper
corrections that reopened the investigation**: (1) arrow keys at the wrap boundary don't just fix
the shift, they can also *cause* it — width-dependent, not reliably reproducible on demand; and (2)
click-dragging a text selection past the editor container's left or right border is a *consistently*
reproducible way to trigger the shift, and it behaves asymmetrically (drag past the border that
caused it does NOT undo it; only dragging past the *opposite* border does). That asymmetric,
sticks-until-the-opposite-edge behavior was the concrete lead that finally reproduced the bug live
in this sandbox — see **Bug 8** below, which found and fixed the actual geometry gap. Bug 7's fix
is not wrong or reverted (its root cause — CM6's own typing path never setting a non-zero
`SelectionRange.assoc` — is real, grounded directly in `@codemirror/view` source, and stays fixed),
but it was fixing a real, separate, more obscure gap in the same neighborhood, not the specific
symptom the user was actually hitting.

### Bug 8 — click-drag selection past the editor's left/right border shifts the text 1px — FIXED (root cause, not a reactive patch)

**Reliably reproducible, unlike Bug 7 above** — confirmed live via a real simulated Playwright
drag: click into the text, drag past the scroller's right edge, release. `.cm-scroller`'s
`scrollLeft` measurably moved from `0` to `1` and stayed there (confirmed via direct polling across
8 samples over ~1.2s and after `mouseup` — it does not self-revert), and `.cm-content`'s own
bounding rect shifted left by exactly 1px to match. Dragging past the *left* edge afterward moved
`scrollLeft` back to `0`; dragging past whichever edge you'd already just crossed does nothing
(matches the user's own asymmetric description exactly).

**Root cause, this time fully reproduced and measured, not inferred**: `.cm-scroller`'s
`scrollWidth` was a genuine `1` pixel more than its `clientWidth` at rest, on every window width
tested (confirmed via direct measurement, not assumed) — a real, persistent 1px of scrollable range
that has no legitimate reason to exist, since this app's own `EditorView.theme` explicitly declares
`.cm-scroller { overflowX: 'hidden' }` with the comment "this app draws its own scrollbar ... and
never scrolls horizontally." `overflow-x: hidden` only blocks *user-driven* wheel/scrollbar
scrolling, though — it does nothing to stop the browser's own native "auto-scroll the drag point
into view" behavior during a text-selection drag, which reached directly into that real 1px of
range. Traced the 1px itself to `.editor-text`'s own glyph-centering `transform:
translateX(calc(((var(--editor-cell-width) - var(--editor-glyph-width)) / 2)))` (`src/index.css`):
a `transform` shifts an element's rendered/painted position without changing its layout width, and
Chromium counts that shifted paint position toward `scrollWidth` — so `.cm-content`, transformed
right by a sub-pixel amount, painted its right edge past `.cm-scroller`'s own right edge by exactly
that amount, registering as scrollable overflow. Confirmed directly: reading `.cm-content`'s real
`getBoundingClientRect()` against `.cm-scroller`'s showed the content box's right edge sitting
~1.18px past the scroller's own right edge.

**First attempt, informative failure**: tried compensating with `paddingRight` on `.cm-content`
(matching the review-gutter column's own existing padding mechanism) — measured zero effect.
Padding is *inside* an element's own box; a `transform` moves the *entire* box, padding included,
so padding can't pull a transformed box's edge back inside its parent. Reverted before landing (see
`computeReviewGutterRightPx`'s git history around this session if picking this up cold — the
revert is clean, no trace left in the shipped code).

**Second attempt, also an informative failure**: switched to reducing `.cm-content`'s own `width`
by the exact transform-shift amount (computed in JS from the same `cellWidthPx`/`glyphWidthPx`
values that feed the CSS transform, so it's guaranteed to match exactly, not approximate it) —
`getComputedStyle` showed the width change had **zero effect** on the actual rendered box, despite
the inline style genuinely being set correctly. Root cause: CM6's own base theme
(`@codemirror/view`'s bundled styles) makes `.cm-content` a flex item of `.cm-scroller` (a flex
container) with `flexGrow: 2`. A plain `width` on a flex item is only its flex-basis — flex-grow
then expands the item to fill available space regardless, silently re-expanding the shrink right
back to 100%. Confirmed live via `getComputedStyle().width` staying at the un-shrunk value despite
`element.style.width` showing the correct, smaller `calc()` expression.

**The fix that actually worked**: `max-width` instead of `width`, same `calc(100% -
<shiftAmount>px)` expression. `max-width` is not a flex-basis input — it's a hard clamp on the
item's *final*, post-grow size, which flex-grow cannot exceed. Applied in `CM6Editor.tsx`'s
existing content-padding `useEffect` (right alongside the `paddingLeft`/`paddingRight`/`paddingTop`/
`paddingBottom` assignments it already makes on `view.contentDOM`), computed once as
`glyphCenteringShiftPx = (cellWidthPx - glyphWidthPx) / 2` — the exact same formula, same two
inputs, as the CSS transform itself, so it can't drift out of sync with it. Confirmed via direct
measurement: `.cm-scroller.scrollWidth === .cm-scroller.clientWidth` exactly, across 14 window
widths from 700px to 1500px, and with the review-gutter/line-numbers column both on and off.

**A reactive band-aid was tried and deliberately removed once the root cause was found**: before
finding the geometry fix, a defensive `scroller.scrollLeft = 0` clamp was added to the existing
`handleScroll` listener (reactively undoing any horizontal drift on every scroll event, matching
this file's existing "actively correct drift" philosophy for vertical scroll). It worked — measured
via direct event-timestamped logging, the correction was effectively immediate, no visible flicker
— but per the user's own explicit steer ("isn't the correct solution to actually make sure the
content width matches the container width instead of redrawing/moving after the fact?"), it was
removed once the `max-width` fix confirmed there's no overflow left to react to. Verified this
removal doesn't regress anything: re-ran the exact same drag-past-both-edges repro with the reactive
clamp deleted and only the geometry fix in place — `scrollLeft` never moves off `0` at all, not even
transiently. Recorded here as the record of *why* the simpler geometry-only fix is trusted, not left
implicit.

**Verified**: `npx tsc --noEmit`/`npm run lint` clean (same pre-existing unrelated `App.tsx` failure
as Bug 7, confirmed via `git stash`), `npm test` 513/513, a live screenshot sanity check (no visible
glyph clipping/collision near the right edge from the new `max-width` constraint — grid alignment
unaffected), a new A/B-verified permanent regression script
(`scripts/perf/verifyCM6NoHorizontalScrollOverflow.mjs` — checks the geometry directly across 4
widths and with the gutter on, plus a real simulated drag past both edges, matching the user's own
exact repro), and the full existing `scripts/perf/verifyCM6*.mjs` suite re-run to confirm no
incidental regression: 22/28 passed (26 pre-existing scripts + the 2 new ones from this session's
two fixes); the same 6 pre-existing failures as Bug 7's own suite run above
(`verifyCM6CaretSurvivesTagMutation`, `verifyCM6ColdBootCaretFocus`, `verifyCM6Phase2Slice11`,
`verifyCM6Phase2Slice17`, `verifyCM6Phase2Slice20`, `verifyCM6ProductionGating`) recurred
identically, byte-for-byte the same failure output as before -- not re-A/B'd a second time since
Bug 7's own A/B pass already established they're pre-existing sandbox flakiness, not something this
session's changes could plausibly have caused or fixed.

**Next up, in priority order**:
- Bug 4 (Enter double line break — needs live reproduction attempt first, static analysis argues
  against it existing as described) is still open.
- Phase 2 (parity inventory) hasn't been started structurally — Bug 1 was the first item found by
  investigation, not by a systematic Editor.tsx-vs-CM6Editor.tsx feature diff; that diff still
  needs doing, now against `Editor.tsx` in git history rather than the live tree (see Phase 2's
  updated framing above — the Lexical fallback was fully removed in a later session).

**A later session (unrelated to this doc's own phase work) finally reconciled the long-standing
real-user-vs-synthetic input-lag gap tracked in `docs/large-document-performance-handover.md` and
`docs/document-scale-performance-philosophy.md` — three bugs, all fixed. Relevant here specifically
because two of the three live in shared infrastructure, not `CM6Editor.tsx`:** the
`parseStructuralRanges`/`splitMarkdownIntoPreviewBlocksIncremental` trailing-blank-line defect
(`src/editor/PreviewBlockSplit.ts`) and the footer word-count establish/track rebuild
(`src/editor/WordCount.ts`) both feed `usePreviewMarkdownRendering.tsx`/`EditorSection.tsx`, which
per this doc's own Phase 3 notes are genuinely shared between the Lexical and CM6 paths (both
editors route through `EditorSection.tsx` identically). So both fixes benefit the Lexical rollback
path too, for free, not just CM6 — worth knowing before assuming the rollback path is stuck with
every performance defect this whole effort has ever found. The third bug (debug logging dumping
full note text to the console on every save, `useNoteSaveQueue.ts`) is likewise shared. Only the
new opt-in `thockdown:debug-input-lag` instrumentation itself was added CM6-side
(`CM6Editor.tsx`'s `updateListener`) — the Lexical path has no equivalent instrumentation if this
ever needs retracing there.

**Superseded by an even later session: this whole question is moot now.** The Lexical fallback
this paragraph was hedging about was fully removed (see Phase 3 above) — there is no rollback
path left to exercise "in anger" or re-measure. The three bugs above stay fixed either way, since
they lived in shared code CM6 also depends on.

## This session: the Lexical fallback fully removed — explicit product decision, executed

Per the user's own framing: the CM6 migration is now considered live and successful, so the
codebase should fully commit to it rather than keep carrying a parallel implementation and a
rollback flag nobody expects to actually use. Deleted, not just deprioritized:

- `src/components/Editor.tsx` (the Lexical-backed editor component itself)
- Every Lexical-only plugin: `src/plugins/ContractBridgePlugin.tsx`,
  `NoteTextHydrationPlugin.tsx`, `CagedScrollPlugin.tsx`, `BlockCaretPlugin.tsx`,
  `SyntaxHighlightPlugin.tsx`, `BlockSelectionPlugin.tsx`, `PasteSanitizationPlugin.tsx`,
  `TextSanitizationPlugin.tsx`
- `src/nodes/ThockdownTokenNode.ts` (Lexical node class), and the now-empty `src/nodes/`
  directory
- `src/editor/LexicalRopeSync.ts` and `LexicalParagraphOffsetSync.ts`, plus their fuzz tests
- The `lexical` and `@lexical/react` npm packages (34 transitive packages removed)

Kept and relocated: `ContractBridgeRangeUtils.ts` (the framework-agnostic
word/sentence/line/block scope-resolution logic, pure text+offset functions with no Lexical
dependency, already confirmed shared and reused unchanged by `CM6Editor.tsx`'s own right-click
handler — see Bug 1 above) and its test moved from `src/plugins/` to `src/editor/`, since
`src/plugins/` no longer means anything once there's no Lexical plugin architecture housed there.
The test was renamed `ContractBridgeRangeUtils.test.ts` to match what it actually tests (it was
never really testing `ContractBridgePlugin.tsx` itself, just this shared module).

`SectionEditorArea.tsx`'s `isCM6EditorEnabled`/`localStorage['thockdown:cm6-editor-spike']` gate
and its Lexical-fallback JSX branch are gone — `CM6Editor` renders unconditionally now, no flag
read at all. `EditorContract.ts`'s doc comment updated to state CM6Editor.tsx is the sole
implementation rather than "may be partial while the rewrite is in flight." `docs/editor-contract.md`
updated to match (usage example now imports `CM6Editor`, the "Text Model" section's "not yet fully
implemented in the Lexical bridge" caveat removed since there's no Lexical bridge left to be
partial). `scripts/perf/verifyCM6Phase2Slice1.mjs` deleted (its entire purpose was verifying the
rollback flag still worked — explicitly marked "not a committed test, ad hoc" in its own header,
so safe to delete outright rather than trim). `scripts/perf/verifyCM6ProductionGating.mjs` kept
(most of it verifies real, still-relevant CM6 mount/note-switch behavior) with just its
rollback-specific assertion trimmed out. ~19 other `verifyCM6*`/`measureCM6*` scripts still set
the now-inert `thockdown:cm6-editor-spike` flag before launching — harmless (the flag does
nothing now), left as-is rather than touched purely for cosmetic reasons; tracked in `TODO.md` as
a whenever-convenient cleanup.

**Verified**: `npx tsc --noEmit` clean, `npm run lint` clean, `npx vite build` (renderer + main +
preload, not just type-checking — confirms nothing in the actual bundle graph broke) clean, full
`npm test` (273/273, down from 289 — the 16 removed tests were `LexicalRopeSync.test.ts` and
`LexicalParagraphOffsetSync.test.ts`, both deleted alongside the modules they tested; every other
test file, including `ContractBridgeRangeUtils.test.ts` at its new path, still passes unchanged).
No live-browser re-verification of editor behavior this round specifically — this was a pure
deletion of already-unreachable code plus a mechanical import-path fix, not a behavior change to
the surviving CM6 path, so the existing `scripts/perf/verifyCM6*.mjs` suite (already passing,
already covering CM6's own real behavior) stands as the relevant live coverage rather than being
re-run from scratch for this change specifically.

**What's still open**: Phase 2's parity inventory (see its updated framing above) and Bug 4, both
already listed. Nothing new from this round beyond the `TODO.md` cosmetic-cleanup note above.

### Bug 5 — edit<->preview scroll-position sync silently broken since the CM6 flip — FIXED

**User report**: switching edit -> preview always resets to scrollTop 0; switching preview -> edit
"tries to restore" but lands significantly wrong on long documents, and had been getting worse
"progressively... over several commits."

**Root cause, both directions, both in code shared/adapted from the Lexical era, neither ever
updated for CM6:**

- **Edit -> preview capture** (`resolveSourceAnchorFromEditState`, `EditRestoreMath.ts`): its
  precise path queried `.editor-stage .thockdown-custom-scrollbar` to point-sample the DOM at the
  caret's visual position. CM6 never renders that class (it's Lexical/general custom-scrollbar
  styling, applied to the sidebar, the preview pane, etc. — never to CM6's own `.cm-scroller`) —
  confirmed by grep, not assumed — so this path was **always** dead for CM6, silently falling
  through to a cruder approximation every single time.
- **Preview -> edit restore** (`applySourceAnchorToEditor`, `useEditorSectionMount.ts`): same dead
  selector, plus a second, independent problem: it assumed `editorRoot.children` gives one DOM
  element per logical paragraph (`Array.from(editorRoot.children)[lineIndex]`) — true for Lexical,
  structurally false for CM6, which (a) renders one `.cm-line` per *visual* row, not per logical
  line, and (b) only mounts lines near the viewport at all under its own virtualization. With the
  selector dead, `scroller` was always `null` and the function returned immediately — a **complete
  no-op**, every time, for as long as CM6 has been the production editor.
- **The cruder fallback both directions fell back to** (`viewport.scrollTopLines +
  viewport.topBoundaryLines` used directly as if it were a logical source-text line number) has its
  own latent bug, independent of the dead selectors: `scrollTopLines` is `scrollTop` expressed in
  line-*height* pixel units, not a count of logical text lines. Those coincide only when nothing
  wraps. CM6 has `EditorView.lineWrapping` enabled (confirmed), so any document with long lines —
  exactly what a real note looks like, and exactly why this got reported as "majorly off on long
  documents," not on short test notes — makes the two diverge more the more wrapping happened
  before the target position. This is why "progressively deteriorating over several commits" reads
  as a real observation rather than imagined: nothing about this bug's *shape* changed recently, but
  every commit that added more real content to the reporter's own long-lived notes made the
  wrapping-based error larger.

**Fixed** by giving `EditorAdapter` (`EditorContract.ts`) two new primitives —
`resolveSourceLineAtHeight(heightPx)` and its exact inverse `resolveHeightForSourceLine(sourceLine)`
— implemented in `CM6Editor.tsx` via CM6's own `view.lineBlockAtHeight`/`view.lineBlockAt`. These
are analytical (computed from CM6's own line-layout metadata), not DOM measurements: correct
regardless of wrapping, and correct regardless of whether the target line is currently mounted,
which a DOM-based approach structurally cannot be under CM6's own viewport-bound rendering. Per
this doc's own established pattern for adapter primitives, the *orchestration* (boundary-offset
math, clamping) stays in the shared `EditRestoreMath.ts`/`useEditorSectionMount.ts` code, which now
calls these instead of touching the DOM at all.

**Deliberately not touched**: `buildEditRestoreSnapshotFromUiState`'s own naive
`anchorLine - topBoundaryLines` conversion (used only for the very first, immediate placement
before the adapter is necessarily mounted) still has the same imprecision — left as-is since the
fix above runs one frame later as an explicit *correction* pass over exactly that rough guess, by
existing design (the two-phase "rough placement, then precise correction" structure predates this
fix and is unrelated to it). Worth revisiting only if the rough-then-correct flash becomes visibly
distracting in practice.

**Verified**: `npx tsc --noEmit`, `npm run lint`, `npx vite build` (renderer + main + preload), full
`npm test` (273/273, unchanged — no existing test exercised this path, since it requires a real
mounted CM6 view; nothing regressed either) all clean. **Not yet live-verified in a real browser
session** — this is exactly the class of change (`EditorContract.ts` shape change, caret/scroll
math) this project's own process discipline calls for a live-browser check on before considering it
done; that verification is the user's own to do, by design, for this session. Treat as
implemented-and-reasoned-through, not battle-tested, until confirmed live on a real long document
in both directions.

**Follow-up, same session: fixed a real round-trip drift the anchor-based sync above still had —
went through two designs live before landing on the right one.** Even with Bug 5's fix, repeatedly
toggling edit<->preview at what should be "the same" position drifted, because the sync always
snaps to a *block/line boundary* in each direction (the top of whatever source line or preview
block currently covers the target), not the exact prior pixel offset within it — a real, structural
lossy-conversion property of anchor-based sync, not a bug in the anchor math itself.

**First attempt (superseded): a raw-pixel `exactScrollTopPx` bypass symmetric across both
directions**, via `lastSyncedScrollPairRef` recording an (edit px, preview px) pair and restoring
either side directly from cache when the other hadn't moved. This worked immediately and perfectly
for the edit side (confirmed live: edit position stayed pinned exactly across many round trips) but
made preview *worse* — a live debug-logged session showed the "settled" preview value creeping
further every single round trip (336719 → 336833 → 336846 → 337012 → ...) instead of staying fixed.
Root cause: a raw `container.scrollTop = X` write bypasses react-virtual's own scroll API entirely,
so it never gets a chance to proactively mount/measure the blocks near the new position; its
reactive reconciliation (`reconcileScroll`) then fights the override on every restore, and each
round's "settled" read became the *next* round's stale starting point — a slow random walk, not
convergence. Tried priming the virtualizer first (calling its own index-based scroll before the
pixel override) and polling until scrollTop genuinely stabilized (`waitForScrollSettle`, replacing
an earlier fixed 2-frame wait that undershot by up to ~250px) — both real, still-kept
improvements, but neither fixed the fundamental fight between two different mechanisms both trying
to own the same scroll position.

**Second design (shipped): asymmetric, not symmetric.** Realized live-testing the first attempt
that preview never actually needed a raw-pixel bypass in the first place: unlike edit (CM6, exact
and stable via `lineBlockAt`, no virtualization estimation involved), preview's own position is
*inherently* block-quantized already — `applyPreviewSourceAnchor`'s existing align-to-block
mechanism is itself stable and reproducible for a fixed `sourceAnchorLine` (react-virtual converges
on the same measured layout every time), so re-running it plainly, with no override, is both
correct and driftless on its own. Only the preview->edit direction keeps the `exactScrollTopPx`
bypass; edit->preview always goes through the normal, reliable `applyPreviewSourceAnchor`, whose
settled result (via `waitForScrollSettle`, kept from the first attempt) still feeds
`lastSyncedScrollPairRef` so the preview->edit direction can keep restoring edit losslessly.
Verified the same way as Bug 5 above (`npx tsc --noEmit`, `npm run lint`, `npx vite build`, full
`npm test` 273/273) plus this round's own live debug-log confirmation of the specific failure mode
being fixed (not just typechecking) — still owed: a full live-browser pass confirming the corrected
design doesn't have a symmetric problem of its own on the edit side over a longer session.

### Scroll-sync rewrite — Bug 5's round-trip-drift fix superseded by a simpler policy

The asymmetric `exactScrollTopPx`/`lastSyncedScrollPairRef` design shipped above (the "Second
design" section) worked, but the whole apparatus existed to solve a self-imposed problem: trying to
restore *exactly* where the user was, pixel-for-pixel, across every mode toggle and note switch.
That precision was never actually asked for, and it required a real DOM-selector regression, then
two follow-up scroll-sync designs, then a large surrounding cache/spoof/dedup layer just to make it
converge instead of drift.

Replaced this session with a much smaller policy: persist exactly one thing per note (and
independently per Timeline snapshot) — `anchorBlockIndex`, an index into the note's
`PreviewMarkdownBlock[]` array, mode-agnostic, written only at real "leaves an editor" checkpoints
(note switch, section close/quit, Timeline snapshot navigated away from). Every restore — first
load, note switch, or a mode switch with `sectionRequiresScrollUpdateRef` true — lands on that block
plus a *fixed* one line-height offset, never a raw or translated pixel value. When nothing has
changed since the two modes were last in sync, a mode toggle now does nothing at all beyond flipping
CSS visibility, since dual-mount (`SectionEditorArea.tsx`, neither pane ever unmounts) means both
panes' DOM is already correctly positioned.

This made the following fully dead and removed: `applySourceAnchorToEditor` (the exact-pixel
correction pass), `lastSyncedScrollPairRef`, `editSpoofedSignalRef`, `sectionUiStateRef` and its
ephemeral per-mode pixel-offset bookkeeping, `persistRenderViewStateForNoteNow`,
`captureEditModeSnapshotForRenderView`, and the `exactScrollTopPx` field on
`EditorSnapshotApplyRequest` (`EditorContract.ts`). `resolveSourceLineAtHeight`/
`resolveHeightForSourceLine` (this bug's own real fix, above) are still load-bearing and untouched —
resolving *which block* is under the viewport still has to come from CM6's own analytical layout
data, never DOM measurement; only the *precision* of what gets restored changed, not how a block is
found. See `docs/editor-contract.md`'s Viewport Model section for the current persisted shape and
the two legitimate restore triggers.

**Not yet live-verified in a real browser session** — same standing caveat as the rest of this doc's
scroll/caret work; live-verified only via `tsc`/`lint`/`npm test`, not yet exercised by hand.

## This session: Phase 4 reframed as the full post-migration integration audit, work not yet started

Per the user: the CM6 migration's remaining wiring is still "somewhat brittle and not optimized,"
and individual components occasionally "reset to native handling, bypassing grid alignment, smooth
scroll etc." — framed as the next large multi-session effort, requested as a plan first, then
step-by-step execution. Phase 4 above was rewritten from a one-line "exercise the editor" note into
a grounded 10-item subsystem checklist (see above), absorbing Phase 2's never-completed parity
inventory into the same activity. Two concrete, verified-by-grep findings surfaced while grounding
the plan and were filed under Phase 3 rather than Phase 4 since they're loose-ends, not audit
targets: `ParagraphOffsetIndex.ts` is dead code (its only real caller, `LexicalParagraphOffsetSync.ts`,
was deleted with the Lexical fallback; grepped whole-tree, confirmed only its own test still imports
it), and `src/editorSection/useEditorSectionMount.ts.bak` is a 100KB backup file checked into git by
mistake. Neither fixed yet — recorded, not actioned, pending the user's go-ahead on where to start.

**User-supplied leads, gathered before starting execution** (asked directly rather than guessed, since
only the user has actually seen these reproduce): split-view itself is *not* suspected. Four real,
specific leads instead, now the actual entry points for Phase 4 rather than working the checklist
cold:

1. **Edit→render (preview) mode toggle is "highly brittle."** Lands squarely on Phase 4 item 5
   (preview/edit scroll sync) — which this doc already flagged as "not yet live-verified in a real
   browser session" after the scroll-sync rewrite. This is now that verification's actual mandate,
   not a nice-to-have.
2. **Any note load that's implicitly triggered rather than deliberately triggered by the user is
   brittle** (the user's own distinction — e.g. restoring on app start vs. clicking a note card).
   Likely overlaps `TODO.md`'s existing "on a full app restart, note text isn't aligned to grid on
   initial load... clicking into either editor section fixes it for both" item, but the user's
   framing is broader than just that one symptom — treat "every code path that mounts/hydrates a
   note without a direct user click" as the thing to inventory and test, not just the one named
   TODO item.
3. **Interrupted processes, specifically interrupted smooth scrolls**, produce bad state. The
   user's own diagnosis, worth taking seriously rather than re-deriving: "it feels like there is
   often no sanity check for all data being present and a revert to default as a result" — i.e.
   suspect incomplete-state guards (or their absence) in `ScrollCurvePlan.ts`/`QuantizedSmoothScroll.ts`/
   `ScrollTransitionController.ts` when a scroll animation is cancelled or superseded mid-flight,
   not just their happy-path behavior.
4. **New, specific, reproducible bug, not previously known: arrow-key-Up scroll misbehavior at
   CM6's internal viewport-chunk boundaries on large documents.** Exact repro as reported: on a very
   large note ("Ulysses"-sized), pressing Up to move the caret line-by-line, at the point where the
   caret crosses from one CM6-rendered chunk into the next, the viewport scrolls down 5 lines
   instead of up 1 — and the caret's on-screen position moves with that same wrong jump (its
   underlying logical text offset stays correct; only the visual position is wrong, consistently
   with the bad scroll rather than desynced from it).
   - **Working hypothesis, not yet confirmed live — record as a hypothesis, not a diagnosis, per
     this doc's own process discipline**: `reconcileCagedScroll` (`CM6Editor.tsx:1552-1584`) reads
     caret geometry synchronously in the `updateListener` right after the arrow-key transaction
     commits, via `readSelectionRect`/`resolveCM6CaretTopInScroll`. CM6 internally only measures
     line heights within/near its own rendered viewport chunk; moving the caret into a
     previously-unmeasured chunk forces CM6 to grow that chunk and (re)measure it as part of
     applying the transaction. If our reconcile's geometry read ever runs against a transient
     state where CM6's own height data for the newly-entered region hasn't fully settled yet (an
     estimated vs. measured height mismatch), `resolveCagedScrollTarget`'s row-quantization math
     would compute a target off by whatever that mismatch is — plausibly explaining a
     multi-line jump that self-corrects into a *visually* consistent (if wrong) position, since
     the caret overlay is driven by the same settled geometry the scroll reconcile used. **Needs a
     live CDP/Playwright repro on a real large note before trusting this over any other
     explanation** — this is exactly the class of bug this project's docs warn is easy to
     misdiagnose from reading code alone.

**Nothing executed yet this session beyond planning/grounding and gathering these leads.** No code
changed, no tests run. Next session (or later this one) should start by reproducing lead 4 live
(most concrete/novel, cheapest to falsify), then work leads 1–3, then fall through to the general
Phase 4 checklist above for whatever these four don't cover.

## Lead 4 (arrow-up chunk-boundary scroll) — reproduced live, root cause substantially narrowed, no fix shipped yet

A later session picked this up as the entry point per the above. **Confirmed real, not a
misdiagnosis or test artifact**, via `scripts/perf/verifyCM6ArrowUpChunkBoundary.mjs` (already
committed at the point this doc was last touched, apparently never actually run before this
session): on a 1.2M-char uniform-content note, holding ArrowUp produces a scroll jump of roughly
5–11 rows (not the reported "5 down," but the same-shape anomaly — magnitude and direction both
wrong for a single-row move) on about **6.75% of presses** (54/800), at a strikingly regular
~13–16-press cadence matching CM6's own internal viewport-chunk growth interval. Explicitly
re-verified with a **35ms inter-press delay** (matching real OS key-repeat cadence, not the
harness's default zero-delay back-to-back presses) to rule out "this is just an artifact of
pressing faster than a browser can paint a frame" — identical anomaly count, indices, and
magnitudes either way, so this is a real, timing-independent defect, not a synthetic-test-speed
artifact. (The zero-delay pacing turned out to matter a lot for evaluating *fix attempts*, see
below — just not for reproducing the original bug.)

**The original hypothesis (an estimated-vs-measured height mismatch inside `reconcileCagedScroll`'s
own geometry read) is refuted.** Instrumented `reconcileCagedScroll` to log, at every reconcile,
both the DOM-measured caret position it actually uses and CM6's own analytical
`view.lineBlockAt(head).top` (the same class of "trust CM6's layout data over DOM measurement"
primitive Bug 5 above already established as correct for exactly this kind of virtualization-era
staleness) — at every anomaly, `resolveCagedScrollTarget`'s own computed correction was small (well
under 1.5 rows), fully consistent with `scroller.scrollTop` at the moment the reconcile ran. The
reconcile's own math is not the site of the bug.

**Root cause, narrowed via that same instrumentation plus a fix attempt's own A/B failure (see
below): the overshoot write happens on a separate, *later* pass, decoupled from the arrow
keystroke's own transaction.** Direct evidence: logged `scroller.scrollTop` immediately before each
keydown is processed (captured in the `Prec.highest` keymap handler, before CM6's own defaultKeymap
dispatch) and again inside that same press's reconcile — the two *matched* at every anomaly (e.g.
press 61: pre-press 533338, reconcile-time 533338, reconcile computes a totally normal one-row
target of 533312). The actual overshoot only became visible at the **next** press's pre-capture
(533142 — 170px/6.5 rows further than what the previous reconcile had legitimately targeted),
meaning something wrote `scrollTop` again, wrongly, *after* the reconcile that "fixed" it had
already run and finished, and before the next keydown. Grepped `CM6Editor.tsx` for how its
`updateListener` is wired: `reconcileCagedScroll` is only ever invoked from the
`pendingCageIntent && (update.docChanged || update.selectionSet)` branch
(`CM6Editor.tsx` around the updateListener's tail) — **a `viewportChanged`-only update (no doc or
selection change, exactly what CM6 firing its own deferred/measured viewport-growth pass on a
later tick would look like) never reaches the reconcile at all.** This lines up with CM6's known
architecture (expensive remeasurement of newly-grown viewport regions is commonly deferred to a
`requestMeasure` pass on a subsequent frame, not done synchronously inside the transaction that
triggered the growth) far better than the original same-tick-measurement-race hypothesis did. Not
yet proven by directly instrumenting a `viewportChanged`-only update firing with a stale scrollTop
write attached — that's the concrete next step, not a restatement of this paragraph as settled fact.

**A fix attempt was built, tested, and reverted — recorded honestly since it very nearly shipped
looking correct.** Tried clamping the post-transaction `scroller.scrollTop` to within one row of
its pre-keydown value for the four arrow keys specifically (the one class of refocus key where "the
caret only ever needs a ≤1-row scroll correction" is a sound invariant, unlike Home/End/typing/etc).
Two live A/B rounds, both against the same harness:

- **Zero-delay (rapid-fire) pacing**: the clamp actively made things *worse* (211/3000 anomalies vs.
  ~205/3000 extrapolated baseline) once a same-scroller in-flight `scrollToQuantizedSmooth` animation
  was exempted from the clamp (needed, since without the exemption the clamp fought its own
  legitimate multi-frame corrections and — confirmed via the same debug instrumentation — drove the
  caret progressively further **off-screen**, one row further behind every press, because
  `scrollToQuantizedSmooth`'s animated branch never got a chance to actually paint between
  back-to-back presses with no yield to a real frame, and the clamp kept discarding the backlog
  instead of letting it resolve).
- **Realistic 35ms pacing**: the clamp made **zero measurable difference** — identical anomaly
  count, indices, and magnitudes to unpatched code. Traced why: at the exact press where the
  anomaly occurs, the clamp's own pre/post scrollTop comparison shows *no* discrepancy (both sides
  of the clamp check agree, `willClamp: false`) — because, per the root-cause narrowing above, the
  actual bad write happens strictly *after* this reconcile call finishes, not within the window the
  clamp was watching. A same-transaction, same-tick clamp structurally cannot catch a write that
  happens on a different, later update.

Both code changes (the clamp in `CM6Editor.tsx`'s `reconcileCagedScroll` plus a small
`isQuantizedSmoothScrollActive` export added to `QuantizedSmoothScroll.ts` to support it) were
**reverted in full** rather than shipped not-working — `git status` is clean, nothing landed. The
debug instrumentation added mid-session (`localStorage['thockdown:debug-arrow-cage']`, gated,
mirroring the existing `debug-input-lag` pattern) was reverted too rather than kept, since it was
purpose-built for this one investigation and the next step needs different instrumentation (on
`viewportChanged`, not on the keydown/reconcile pair this round's logging targeted).

**Concrete next step, not yet attempted**: hook a reconcile pass off `update.viewportChanged` (not
just `docChanged || selectionSet`) — comparing scrollTop against a value *this code* last
deliberately set (not a pre-keydown DOM snapshot, which the two failed attempts above both showed
is the wrong reference point) is very likely the right shape, but needs its own live
instrumentation to confirm a `viewportChanged`-only update is actually where the bad write
originates before writing a fix against it — don't skip that confirmation step given how far the
original hypothesis (refuted above) was from the real mechanism despite sounding plausible on a
first read of the code.

**Verification this round**: `npx tsc --noEmit` clean on the (ultimately reverted) fix attempt
before revert; no `npm test`/full regression suite run, since nothing shipped — not needed per this
doc's own "don't run the full suite for changes that didn't land" logic, though this was a
substantial-tier investigation regardless (scroll/caret-adjacent), not a small one. `npm ci` was run
this session (repo had no installed `node_modules`); `scripts/perf/verifyCM6ArrowUpChunkBoundary.mjs`
itself needed no changes to work as committed. Leads 1–3 were not started this session — lead 4 alone
consumed the full session per the user's own "most concrete/novel, cheapest to falsify" prioritization,
and the honest state is a well-grounded root-cause narrowing with two ruled-out fix shapes, not a
closed bug.

## Lead 4, continued — the concrete next step above was tried; definitive root cause found; a third fix attempt failed *worse* at real scale and was reverted

Follow-up session, resumed after the previous round's PR merged to `main` (branch restarted from
`origin/main` per this repo's standing convention for a merged designated branch). Picked up exactly
where the last round left off: hook `update.viewportChanged`, confirm live where the stray write
actually originates before fixing it.

**Root cause now definitively confirmed, not just narrowed.** Added temporary instrumentation
logging *every* `updateListener` firing (not just ones the reconcile already handles) with its
`docChanged`/`selectionSet`/`viewportChanged` flags and `scrollTop`, bucketed per ArrowUp press.
Direct, unambiguous evidence at press 60 of a 500K-char run: **two** updates fire for that single
keystroke —

1. The real one: `selectionSet: true`, a completely normal one-row `scrollTop` correction (220818 →
   fine).
2. Immediately after, in the *same* press window: `docChanged: false, selectionSet: false,
   viewportChanged: true`, `scrollTop` independently jumped a further -170px (-6.5 rows), and
   `view.viewport.{from,to}` shifted to a different range — i.e. CM6 grew/shifted its own rendered
   chunk and, as part of that, wrote a wrong `scrollTop`, entirely outside anything the existing
   reconcile (`docChanged || selectionSet` only) ever observes.

Widening the same instrumentation surfaced a **second, distinct shape** of the same problem:
passes where `docChanged`/`selectionSet`/`viewportChanged` are all `false` yet `scrollTop` still
gets rewritten (a pure height/geometry recompute that doesn't change which lines are rendered, just
where they sit) — not caught by a `viewportChanged`-only hook either.

**Third fix attempt: armed, self-expiring "last known good" scrollTop.** After an arrow-key
reconcile, remember the `targetScrollTopPx` it just computed in a plain closure variable
(`lastArrowKeyReconciledScrollTopPx`). Any *subsequent* `updateListener` firing that is not itself a
new keystroke (`!docChanged && !selectionSet`, deliberately not narrowed to `viewportChanged` given
the second failure shape above) snaps `scrollTop` back to that remembered value if it drifted by more
than 0.5px. The armed value is **not** consumed on first use (more than one stray pass can follow a
single keystroke, confirmed above) — it only expires via a `requestAnimationFrame` callback scheduled
alongside it, bounding the correction window to about one frame so a genuine, much-later real user
scroll (also `viewportChanged`-only) can never be mistaken for this pattern.

**Looked like a real fix at 500K chars, then failed badly at 1.2M — the scale that actually
matters.** Live A/B, same harness, same `--delayMs=35` realistic pacing:

- At 500K chars / 150 presses: 8 anomalies → 3 anomalies, and critically the *magnitude* of every
  remaining one dropped from -6..-11 rows down to exactly -2 rows. Looked like solid, real progress.
- At the actual 1.2M chars / 800 presses this bug was originally reported against (same size Bug
  5 and this doc's own scripts standardize on): **254/800 anomalies (≈32%)** — dramatically *worse*
  than the unpatched baseline's 54/800 (≈6.75%) at the same size. One outlier reached -26 rows. Most
  were small (-2 to -5 rows) but far more frequent than before.

**Reverted in full** — `git status` clean, nothing shipped. This is the same "looked correct on a
narrower check, broke worse on the fuller one" shape as the previous session's clamp attempt, but
inverted: last time zero-delay pacing was the trap; this time document *size* was. **Standing lesson
for whoever picks this up next, worth treating as a hard rule for this specific bug**: any fix
attempt must be evaluated at the full 1.2M-char scale before being trusted as an improvement — a
500K-char (or smaller) run can show a false positive. Root cause: the "any non-transaction update"
condition is almost certainly too broad at scale — CM6 very likely runs legitimate, low-magnitude
idle-time height-reconciliation passes that become more frequent and farther-reaching as the document
(and therefore the unmeasured-region backlog) grows, and this fix's blanket
"snap back to last-known-good" logic fights those too, not just the genuine chunk-boundary anomaly it
was built for.

**Concrete next step, not yet attempted**: the two-distinct-failure-shape finding above (confirmed,
not hypothesis) is real, durable progress independent of this attempt's failure — keep it. The fix
shape itself needs to be narrower: only correct when the drift is *implausibly large for a
single-row key move* (e.g. more than ~1.5 rows, matching this doc's own anomaly-detection threshold
in `verifyCM6ArrowUpChunkBoundary.mjs`) rather than any nonzero drift at all, so small legitimate
housekeeping adjustments are left alone and only the actual multi-row anomaly gets corrected. Not yet
tried — the instinct to widen the correction from just-`viewportChanged` to "any non-transaction
update" (needed, confirmed by the second failure shape) and the instinct to correct *any* drift
turned out to be two separable ideas; the first is validated, the second appears to be what broke
things at scale and should be un-done independently rather than assumed guilty by association.

**Verification this round**: `npx tsc --noEmit` and `npm run lint` clean on the fix attempt before
revert; no `npm test`/full regression suite run since nothing shipped. All temporary instrumentation
(`localStorage['thockdown:debug-viewport-updates']` and its throwaway harness script) was removed
after use, same as the previous round's `debug-arrow-cage`. Working tree is clean; only this doc
changed this round.

## Lead 4, continued again — CM6 internals identified precisely; three more fix attempts failed; drift shown to be bounded, not leaking

Follow-up session. Read the actual installed `@codemirror/view@6.43.7` source (not assumed from
memory) to find exactly what writes `scrollTop` outside our own code: CM6's own **scroll anchoring**
(`ViewState.update`/`EditorView.measure` in `dist/index.js`, the `scrollAnchorAt`/`scrollAnchorPos`/
`scrollAnchorHeight` machinery), the same class of technique as native browser scroll anchoring for
images loading above the fold, self-implemented because CM6 manages its own virtualized layout. Before
an update, it picks an anchor line near the viewport top, records its position and height-map `top`;
after, it checks whether that same line's `top` changed and if so writes `scroll.scrollTop += diff` to
keep it visually fixed. This is real, working-as-designed CM6 behavior, not a defect in CM6 -- it just
disagrees with our own caret-position-based caging, which runs first and picks a different, unrelated
reference point.

**Three more fix attempts, each ruled out with a concrete, specific reason, all reverted (working tree
clean, nothing shipped):**

1. **Post-hoc "last known good" snapped on any non-transaction update, one-frame expiry.** Correctly
   caught the real writes (confirmed two distinct shapes: a `viewportChanged`-true chunk-growth pass,
   and a pass with `docChanged`/`selectionSet`/`viewportChanged` all `false`, a pure anchor-height
   recompute). Looked like a real fix at 500K chars (8/150 -> 3/150 anomalies, worst magnitude capped
   at -2 rows vs -6..-11 before) -- **then failed badly at the actual 1.2M-char scale this bug was
   reported at: 254/800 anomalies vs. a 54/800 unpatched baseline**, worse than doing nothing despite
   the lower peak severity. Standing lesson recorded here as a hard rule for this bug specifically:
   any fix attempt must be evaluated at the full 1.2M-char scale before being trusted, since a
   500K-char run gave a false positive.
2. **Same idea, magnitude-gated** (only correct drift > 1.5 rows, matching this doc's own
   anomaly-detection threshold, instead of any nonzero drift) -- reasoned as the fix for attempt 1's
   scale failure (CM6 runs plenty of small, legitimate anchor nudges that a nonzero-gated correction
   was fighting). Better (109/800) but still worse than the 54/800 baseline. Traced directly: the
   worst-case jump did drop to 5 rows (from 11), but a new, more frequent -2-row wobble appeared that
   didn't exist unpatched.
3. **Same again, deferred to a `requestAnimationFrame` scheduled outside the updateListener entirely**
   (hypothesis: CM6's `measure()` loop is actually a *synchronous* `for(;;)` loop internal to one
   function call, capped at 5 iterations -- confirmed by reading the source -- and our own
   `updateListener` fires once per internal loop iteration, so correcting *from inside* one of those
   firings races CM6's own still-in-progress convergence). Result: 107/800, statistically
   indistinguishable from attempt 2 (109/800) -- **this hypothesis is refuted**, deferring by a frame
   changed nothing measurable.

**Direct instrumentation of attempt 3's own corrections revealed something much more serious than any
of the three attempts' anomaly counts alone suggested**: the `driftPx` values at the moments the
correction fired weren't 2-3 rows -- they were **3,770 to 6,630 pixels (145 to 255 rows)**, and grew
roughly monotonically across the session (3770 -> 3874 -> 4628 -> 5330 -> 5928 -> 6318 -> 6500 -> 6630,
over presses 171-349). The correction was firing and mostly closing the gap each time, which is why
the *outer* per-press anomaly counter only ever saw a small residual (-2 rows) -- it was masking, not
measuring, the true scale of what was actually happening underneath. This was reported to the user
in full at the time, immediately, before any further patch attempt.

**Given that, the user redirected the effort: stop iterating on fix attempts, get a precise,
uncontaminated picture of how the drift actually accumulates first.** Added a small, permanent,
read-only debug accessor to `CM6Editor.tsx` (`window.__thockdownDebugCageState()`, gated behind
`localStorage['thockdown:debug-cage-state']`, zero behavior change, same opt-in pattern as
`debug-input-lag`) exposing `{analyticalTop: view.lineBlockAt(head).top, scrollTop, ...}` on demand.
`view.lineBlockAt(head).top` is a pure document-layout value, independent of scroll position --
already established as trustworthy by Bug 5's fix above. Methodology, committed as
`scripts/perf/measureCM6ArrowUpDrift.mjs`: start at document end, press ArrowUp continuously (never
reversing), which pins the caret against the cage's top edge within the first few dozen presses; from
then on, a correctly-behaving system has `deltaScrollTop == deltaAnalyticalTop` on every single press,
so any press where they disagree is a raw, single-step leak, and summing those over the whole session
gives the *true* cumulative drift with zero interference from any fix attempt (pure unpatched code).

**Result: the drift is bounded, not an infinite leak.** In genuine steady state (far from either
document boundary, confirmed by running the full traversable length of a 100K-char document, ~1,100
presses), the cumulative sum oscillates in a tight band -- exactly 634 to 646px (±6px, ±0.23 rows)
around its post-settle baseline -- with **zero net trend across the entire run**. Two 50K-char runs
were bit-for-bit identical (1508.0px steady-window drift both times), confirming this is fully
deterministic, not timing noise. The larger numbers seen elsewhere come from two separate, localized,
one-time effects, not a per-keystroke leak:
- A one-time settle transient right after mount/initial caret placement (327-650px, varies by starting
  scroll position, pays once).
- A transient as the caret approaches an actual document boundary (start or end) -- confirmed
  localized to roughly the last 60-70 presses before hitting it, a proximity effect tied to being near
  position 0 (or the document's max length), not tied to overall document size. (A 50K-char document
  hits this early simply because starting at its end puts you within ~580 presses of position 0, not
  because being "small" changes the mechanism.)

**This also retroactively explains attempt 3's alarming, monotonically-growing driftPx numbers**: that
growth was almost certainly self-inflicted, not an inherent CM6 property. A raw `scroller.scrollTop = X`
write made outside CM6's own `dispatch` path very likely corrupts its internal
`scrollAnchorPos`/`scrollAnchorHeight` bookkeeping, so CM6 treats the correction itself as a fresh
"real" scroll needing its own compensation on the very next pass -- compounding with every correction
applied. The original 5-11 row chunk-boundary jump is most likely the real, full extent of the
per-event defect; there is no evidence of a larger hidden leak beneath it once measured without any
fix attempt's own interference.

**Conclusion against the user's own explicit framework**: drift depends on neither session duration
nor document length in genuine steady state -- it's bounded either way. There is no scale-dependent
growth to manage, so the document-length-cap "manage" route isn't just deprioritized, it wouldn't
actually solve anything here since nothing grows with length. No structural obstacle to a targeted fix
was found. Per the user's stated preference, the path forward is the targeted patch, guided by a new
constraint the three failed attempts collectively established: **corrections must go through CM6's own
dispatch/anchor machinery, not a raw DOM `scrollTop` write**, since a raw write appears to be what
turned a small, well-characterized per-event bug into a much larger, compounding one in attempt 3.

**Not yet done**: designing and implementing the actual patch under that constraint; a precise trace
of the mount-settle and boundary-proximity transients (lower priority -- one-time costs, not what the
original bug report described).

**Verification this round**: `npx tsc --noEmit` and `npm run lint` clean throughout. No `npm test`/full
regression suite run, since no fix shipped this round either -- three attempts were built, measured,
and reverted; only the (harmless, read-only, zero-behavior-change) debug accessor and the drift
measurement script survive, both committed as ongoing investigation tooling rather than removed, since
the investigation is still open (unlike the single-purpose `debug-arrow-cage`/`debug-viewport-updates`
instrumentation from earlier rounds, which was removed once each round's specific question was
answered).

## Lead 4, scope widened — every scroll-triggering movement class, both panes, per explicit user direction

Follow-up session. Before this, the investigation had only ever exercised ArrowUp -- a single-row
movement. Explicit user direction: fix design must not narrow to that one case. A multi-row jump
landing a few rows short is easy to miss visually (the shortfall is a small fraction of a large jump)
but is the same underlying imprecision, and this app's own standard is exact, consistent handling for
*any* movement, not just the one case that happened to get the deepest investigation first. Also
directed: apply the same rigor to the render/preview pane, checking for genuine viewport
misplacement, not just cosmetic scrollbar-thumb lag.

### Full audit of scroll-triggering movement classes (edit pane)

Grepped every direct `scroller.scrollTop =` write site in `CM6Editor.tsx` (seven total, up from the
one -- ArrowUp's `reconcileCagedScroll` -- covered by prior rounds):

1. **ArrowUp/Down/Left/Right** (`reconcileCagedScroll`) -- already deeply characterized above: real,
   bounded (not leaking) drift, root cause is CM6's own scroll-anchor compensation.
2. **Scrollbar-thumb drag** (`scrollFromThumbTop`, a raw write per pointermove) -- not yet tested.
3. **PageUp/PageDown, single discrete press** (`Prec.highest` keymap handler, dispatches via
   `scrollToQuantizedSmooth`) -- **tested, confirmed safe**: 60 repeated single presses on a 1.2M-char
   note landed on the exact same -676px delta every single time, zero variance. Root cause of the
   safety, not luck: `scrollToQuantizedSmooth`'s animation always forces an exact write to the
   intended quantized target on its final frame, which overwrites/self-heals whatever CM6's own
   anchor compensation did mid-flight. This is the shape a real fix should generalize, not the
   raw-write pattern below.
4. **PageUp/PageDown, held/continuous** (`runPageContinuousScroll` + `animateRampDown` release ramp)
   -- **tested, confirmed buggy**. Unlike case 3, this writes `scroller.scrollTop` raw on every
   animation frame, computed as `scroller.scrollTop + direction*speed*deltaSec` -- each frame's target
   based on whatever scrollTop currently reads, no independent absolute reference, no forced-exact-
   final-step anywhere in the hold-or-release sequence. Live capture, sampling scrollTop every
   animation frame during a held PageUp on a 500K-char note
   (`scripts/perf/measureCM6PageContinuousScroll.mjs`): a **+208px (8-row) reversal in the wrong
   direction**, landing exactly at the hold-release transition (t=4030.6ms of a 4000ms hold), followed
   by an overshoot-and-recover on the next two samples before settling. This is the same underlying
   raw-write-races-CM6's-anchor-compensation pattern as ArrowUp, just pre-existing in shipped code
   and firing far more often (every frame of a multi-second hold, not once per keystroke) -- not
   something introduced by this investigation's fix attempts.
5. **Paste-scroll reconcile** (`reconcilePasteScroll`) -- same "immediate raw write, no forced-final-
   step" shape as ArrowUp's own reconcile; not yet tested live, but structurally the same risk class.
6. **Mouse wheel / trackpad scroll** (`handleWheel`) -- tested with one configuration (synthetic
   400px deltaY events every ~16ms, sustained 5s, covering 354 rows / roughly 22-27 chunk-equivalent
   crossings on a 500K-char note): **zero reversals found**. Recorded as a real but *not exhaustive*
   result -- real trackpad hardware produces much smaller, far more frequent deltaY events than this
   synthetic test used, and that shape hasn't been tried. Provisionally lower-risk, not cleared.
7. **Drag-selection auto-scroll quantization** (the `dragCorrectionFrame` handler, fires while
   dragging a selection near the viewport edge) -- not yet tested.

### Render/preview pane: genuine viewport misplacement confirmed, not cosmetic thumb lag

The preview pane has its own, structurally near-identical PageUp/PageDown continuous-scroll
implementation (`usePreviewScrollbar.ts`'s `startPreviewContinuousScroll`/
`startPreviewReleaseRampDown`), and virtualizes content via `@tanstack/react-virtual`
(`usePreviewMarkdownRendering.tsx`) with `estimateSize: () => 56` (a fixed px estimate for
not-yet-rendered blocks) corrected by `measureElement` once a block actually renders, plus
`overscan: 6` -- the react-virtual-native version of the same estimate-vs-measured pattern that
drives CM6's own scroll-anchor compensation, independently implemented, not shared code. The
scrollbar thumb (`syncPreviewCustomScrollbar`) reads `scroller.scrollTop`/`scrollHeight` live with no
independent state, so it faithfully mirrors whatever the real container does.

**First test attempt was invalid and is worth recording as a methodology trap**: the synthetic
document generator used elsewhere in this investigation (`Line N: ...` with no blank lines between
entries) produces zero paragraph breaks, and markdown merges consecutive non-blank lines into a
single paragraph. Confirmed live: that document rendered as **one single virtualized block**
(`document.querySelectorAll('.markdown-preview [data-index]').length === 1`), meaning the first
continuous-scroll test against it exercised essentially nothing -- react-virtual had almost no
virtualization boundaries to cross. Fixed by generating blank-line-separated paragraphs instead
(confirmed live: 22 separately-rendered blocks in one viewport). Recorded here since it's exactly the
kind of "test passed for the wrong reason" trap this project's docs warn about repeatedly.

**With that fixed, re-tested and found real, genuine viewport misplacement**: sampling
`.markdown-preview`'s `scrollTop` every animation frame during a held PageDown on a 1.2M-char note
(paragraph-separated, `scripts/perf/measureCM6PreviewPageContinuousScroll.mjs`) found **five
wrong-direction reversals** (scrollTop decreasing during a monotonic downward hold: -13, -52, -78,
-65, -78px), all clustered in the pre-release/transition window (t=4541-5095ms of a 5000ms hold) --
the same general moment CM6's own single large reversal occurred, though smaller-magnitude and
multiple discrete events here rather than one. This directly confirms the user's own suspicion,
raised before this test existed: the render-view's scrollbar-thumb jitter during continuous
PageUp/PageDown is not cosmetic lag, it reflects the pane's actual scroll position genuinely
misbehaving, via an independent mechanism with the same structural shape as the CM6 case.

### Where this leaves the picture

At least three confirmed, distinct-but-structurally-related defects now exist across two panes, all
sharing one root pattern: **a raw `scrollTop` write, made outside the owning system's own
authoritative update path, racing that system's internal estimate-vs-measured virtualization
reconciliation** (CM6's scroll-anchor compensation on the edit side; `@tanstack/react-virtual`'s own
analogous mechanism on the preview side). The one case proven safe (single discrete PageUp/PageDown
press) is safe specifically because its write goes through an animation that forces an exact final
write, self-healing whatever the owning system did mid-flight -- the shape any general fix should
adopt, not a coincidence specific to that one code path.

**Not yet tested**: scrollbar-thumb drag (edit and preview), paste-scroll reconcile, drag-selection
auto-scroll, a more realistic (small, high-frequency) wheel-event shape, Home/End and Ctrl+Home/End,
click-to-position jumps, and wrap-point/box-width sensitivity (Q3 from the user's own pre-fix-design
questions, still open -- every test in this investigation so far deliberately avoided line-wrapping).

**Verification this round**: no production code changed -- purely measurement. Two new committed
scripts (`scripts/perf/measureCM6PageContinuousScroll.mjs`,
`scripts/perf/measureCM6PreviewPageContinuousScroll.mjs`), both following the same
sample-and-detect-reversal methodology as `measureCM6ArrowUpDrift.mjs`. `npx tsc --noEmit` clean
(no `.ts` changes this round, scripts are plain `.mjs`).

## Lead 4, fix attempts 4-6 — dispatch-based assertion tried three ways, all ruled out; competing-scrollIntoView hypothesis also ruled out

Follow-up session, continuing directly from the movement-class audit above. Per explicit user
direction on methodology: judge each attempt binary (anomaly count is 0, or it isn't -- don't treat
"fewer than some other failed attempt" as partial credit), and treat every ruled-out attempt as real
progress toward the true cause, not wasted effort.

**Attempt 4 -- dispatch `EditorView.scrollIntoView` immediately in `scrollToQuantizedSmooth`'s
`onSettled` callback** (added as a new option to that function). Researched the actual public API
from the installed `@codemirror/view` source first (not assumed): `scrollIntoView(pos, {y, yMargin})`
returns a dispatchable `StateEffect`, and the measure-loop source confirms CM6 handles a pending
`scrollTarget` *before* running its own anchor-compensation pass, then re-picks a fresh anchor
afterward -- a real, CM6-native "authoritative reposition" primitive, not a guess.
**Result: 54/800, byte-identical to baseline.** Traced why with instrumentation: at the instant the
callback ran, `scrollTop` already equalled the correct target -- CM6's own anchor-compensation for
that same keystroke hadn't happened yet. It's scheduled via CM6's own `requestAnimationFrame`-based
measure flush, not resolved synchronously within the transaction that triggered it, so dispatching
immediately just gets silently superseded by that still-pending pass moments later.

**Attempt 5 -- same, deferred one frame** before dispatching, reasoning that giving any pending
pass a chance to run first would let the assertion be the genuine last word. **Refuted a wrong
premise directly**: an isolated test (bypassing the reconcile entirely, calling `scrollIntoView`
freestanding) showed `view.dispatch()` does not apply the effect's scrollTop write synchronously at
all -- even `coordsAtPos` returned `null` for the target position at dispatch time, yet the position
resolved correctly *moments later anyway*. CM6 resolves `scrollIntoView` on its own schedule
regardless of when dispatch is called; deferring our own call first only adds latency, it doesn't
change which of CM6's internal passes ends up running last. With the artificial delay removed,
instrumentation then showed something more serious: a *single* dispatch could itself move a correct
position to a wrong one, synchronously, within the dispatch call -- confirmed live, 533858 (correct)
became 533766 after one `dispatch()`. Because satisfying our own `scrollIntoView` request can itself
require growing the viewport into unmeasured territory, and growing the viewport runs CM6's own
anchor-compensation as part of that same internal pipeline. Going through CM6's "proper" API does
not avoid the imprecision -- the API shares the same internal pipeline that produces it.

**Attempt 6 -- a bounded multi-frame "watch and correct" loop**, re-dispatching on drift for up to 6
frames, stopping after two consecutive stable checks. Reasoned as the most robust response to
attempt 5's finding: since neither a single dispatch nor a single well-timed deferred dispatch
reliably wins, keep reasserting until CM6 stops fighting back. **Result: 130/800 -- worse than doing
nothing.** Every active correction attempted so far, across three different variants, either did
nothing or made the outer-observed anomaly count worse, because the correction itself keeps
triggering fresh CM6-internal reactions. This is the point the user's own framing (binary outcome,
not "better than the last attempt") mattered: 130 is not "worse than 109 from a much earlier
attempt" in any meaningful sense -- neither is 0, so both are the same kind of failure, and chasing
which specific wrong number is smaller was already established as a trap in an earlier round of this
same investigation.

**Attempt 7 -- suppress CM6's own competing scroll intent at the source, not react to its effects.**
Read `@codemirror/commands`' source directly: CM6's own default arrow-key commands
(`cursorLineUp`/`cursorLineDown`/`cursorCharLeft`/`cursorCharRight`) dispatch a transaction that
bundles `scrollIntoView: true` into the *same* transaction that moves the selection (confirmed via
`setSel`'s exact source: `state.update({selection, scrollIntoView: true, userEvent: "select"})`) --
tagged `userEvent: "select"`. Hypothesis: this is a second, redundant, competing scroll intent
underneath our own cage reconcile, and removing it (not fighting its aftermath) closes the gap by
construction. Implemented narrowly -- only the four plain (unmodified) arrow keys, explicitly *not*
Shift/Ctrl/Alt/Cmd variants, which cover much larger and riskier semantics (word/line-boundary jumps,
document-start/end, even `moveLineUp`/`Down`, an actual document edit) not worth the blast radius for
this investigation. Called CM6's own exact movement commands (not reimplemented) through a thin
`Object.create(view)` proxy that intercepts only `dispatch()`, rebuilding the one precise
`TransactionSpec` shape these four commands are known to produce (selection change + `userEvent`,
`scrollIntoView: false`) rather than a generic transaction-stripping utility. Verified no private
class fields exist on `EditorView` (checked the installed source directly) before trusting
`Object.create`'s prototype delegation for `moveVertically` and friends. **Cursor movement itself
verified byte-exact** before testing the scroll fix at all (highest-severity risk class): typed
distinct markers after ArrowDown/Home/ArrowUp/End/ArrowDown×2/End sequences on a real note, read the
saved text back, exact string match against the predicted result.
**Scroll result: 54/800, byte-identical to baseline again.** This is a clean, informative negative
result, not a wash: it rules out "two competing `scrollIntoView` requests fighting" as the mechanism.
Since removing CM6's own scroll intent entirely made zero measurable difference, the anchor
compensation is not reacting to a scroll-positioning conflict at all -- it's reacting to the
**viewport needing to grow simply to keep the new caret position rendered**, which happens on a plain
selection-only transaction with no scroll intent whatsoever. This is a more fundamental trigger than
either hypothesis behind attempts 4-6 assumed, and structurally can't be avoided by choosing which
API places the scroll request or when -- growing the viewport at all, for any reason, appears to be
what triggers the imprecise compensation.

All three attempts (4, 5/6 counted together as one code path evolving, and 7) were reverted in full
after measurement -- working tree returned to the last committed state each time, nothing shipped
partially-working. One real, low-risk infrastructure fix survives from this round and was kept:
`scripts/perf/perfHarness.mjs`'s mount-wait timeout raised from 30s to 90s, after directly timing a
completely unmodified mount at 18.6s and another at 58.3s in this same session (this environment's
dev-server/mount latency is genuinely variable session-to-session and run-to-run, confirmed by
direct A/B timing, not assumed) -- 30s was intermittently insufficient even for correct, unmodified
code, which cost real time this round chasing a false "did I break something" signal before ruling
it out directly.

**Where this leaves the search**: the true trigger is now understood more precisely than at the
start of this round -- viewport growth itself, not a scroll-intent conflict, not something reactable-
to after the fact. A genuinely new angle worth trying next, not yet attempted: **pre-emptively widen/
measure the viewport *before* dispatching the selection-changing transaction**, so that by the time
the caret actually moves, the target region is already measured and no reactive, mid-transaction
growth (the apparent trigger for the imprecision) is needed at all. Not yet designed or implemented.

**Verification this round**: `npx tsc --noEmit` and `npm run lint` clean on every attempt before
revert. No `npm test`/full regression suite run, since nothing shipped. `scripts/perf/perfHarness.mjs`'s
timeout change is the only surviving diff and was independently verified (unmodified code, direct
timing) rather than assumed safe.

## Lead 4, fix attempt 8 — pre-emptive viewport widening ruled out; the anomaly is not dispatch-shape-dependent at all

Direct follow-up implementing the "pre-emptively widen the viewport before dispatch" angle proposed
above. Read `@codemirror/commands`' source to confirm `cursorByLine` (backing `cursorLineUp`/
`cursorLineDown`) calls the public `view.moveVertically(range, forward)` with no distance argument
(one line) -- so the exact target position CM6's own command will land on can be predicted precisely,
not approximated, by calling that same public API read-only before the real key is processed.

Implemented in the existing `Prec.highest` `any` keymap handler (which already runs, for every key,
*before* `defaultKeymap`'s own bindings get a chance to handle the same event): for plain
ArrowUp/ArrowDown only (same narrowest-tested scope as attempt 7), compute the predicted target via
`view.moveVertically`, then dispatch a selection-preserving, scroll-only transaction --
`{ effects: EditorView.scrollIntoView(target.head, { y: 'nearest' }) }` -- to force CM6 to
measure/render that region immediately. Control then falls through (no `event.preventDefault()`), so
`defaultKeymap`'s real `cursorLineUp`/`cursorLineDown` still runs immediately after, now against an
already-rendered target.

Verified cursor movement byte-exact first (typed markers through a real
ArrowDown/Home/ArrowUp/End/ArrowDown×2/End sequence, saved-text exact match) before measuring scroll
behavior at all.

**Result: 54/800 -- and not merely the same count. The exact same press indices, exact same
magnitudes, exact same signs as the unpatched baseline and as attempts 4 and 7**, none of which share
this attempt's mechanism (immediate post-hoc dispatch; competing-scrollIntoView suppression;
pre-emptive pre-dispatch widening are three structurally distinct interventions). Reverted in full
(`git checkout -- src/components/CM6Editor.tsx`); working tree confirmed clean.

**This is the most informative negative result of the investigation so far.** Four dispatch-layer
interventions -- act after, suppress the competing intent, act before, and (attempts 5/6) act after
with retries -- have now produced either zero effect or a worse outcome, never a partial improvement,
and three of the four zero-effect runs line up index-for-index. That rules out more than any single
attempt's own hypothesis: it's now unlikely that *any* change to when or how this app's code calls
`dispatch()` around a plain arrow-key press can affect this anomaly, because nothing about the
anomaly's own timing or shape moved when the dispatch pattern changed completely, three different
ways. The anomaly's regularity is itself a clue pointing the same direction: anomalies recur at a
strikingly fixed press-count cadence (every ~14 presses in the 1.2M-char/800-press run, independent of
proximity to either document boundary once past the initial settle window), which reads less like a
reactive per-keystroke race and more like CM6's internal height-map hitting a fixed, amortized
recompute boundary (e.g. a chunk-size threshold in its own internal tree structure) on a schedule set
by document geometry, not by anything this app requests.

**Where this leaves the search**: the working hypothesis going into this round -- that the fix belongs
somewhere in *when/how this app dispatches the caret-moving transaction* -- looks substantially
weakened by this round's evidence, not just this one attempt. Two structurally different families of
next step remain, and they carry different risk/cost, worth a checkpoint before committing to either:
(a) stop intervening at the transaction layer entirely and instead make the *existing* post-transaction
cage reconcile (`reconcileCagedScroll`, already reading real settled DOM geometry via
`readSelectionRect`/`resolveCM6CaretTopInScroll`, already the one piece of this app's own code that
writes the final on-screen scrollTop) robust against a *later*, independently-timed CM6-internal
write landing on top of it -- e.g. by detecting and undoing specifically CM6's own subsequent write
without re-triggering it, a different problem from attempt 6's "watch and correct" loop (which reacted
to drift generically, retried a fixed few times, and made things worse); or (b) investigate CM6's
internal height-map/chunk behavior directly (undocumented, unexported internals -- a materially
higher-risk, harder-to-maintain class of change than anything tried in this doc so far) to find
whether the amortized recompute boundary itself can be avoided or its effect neutralized at the
source. Neither is designed or implemented yet.

**Verification this round**: `npx tsc --noEmit` clean before and after revert. No `npm test`/lint
change since the only surviving diff is documentation. `git status --short` confirmed clean.

## Lead 4, Task #10 completed — the anomaly requires a long run of uniform-height lines; wrapped and diverse content don't trigger it at all

The deferred wrap-point/box-width question (Q3 from the user's original pre-fix-design questions,
open since round 1) turned out to resolve the whole investigation's central open question: *why does
every dispatch-layer intervention (attempts 4-8) affect nothing?* Because the trigger was never in the
dispatch layer, or even in document size -- it's in **document content shape**, specifically long runs
of successive, identically-rendering lines.

**Method** (`scripts/perf/measureCM6WrapSensitivityDrift.mjs`, new): same continuous-ArrowUp-from-end
methodology as `measureCM6ArrowUpDrift.mjs`, run across four ~100,000-char documents that separate
wrapping and content diversity as independent variables:

- `uniform-nowrap`: one fixed 78-char line repeated verbatim (byte-identical, no per-line numbering
  even), well under this editor's empirically-probed ~85-char wrap width (probed live: plain repeated
  `x` characters wrapped starting at 90 chars, not at 80). The most uniform document tested in this
  entire investigation.
- `uniform-wrap`: the *same* fixed line repeated 3x per logical line, wrapping to a constant 3 visual
  rows every time -- isolates wrapping itself, zero content diversity.
- `diverse`: `generateSyntheticDocument` (already in `perfHarness.mjs`) -- headings, list items,
  blockquotes, variable-length prose, realistic mixed markdown.
- `diverse-with-uniform-run`: diverse padding (60% of target chars) followed by a long (~500-line)
  run of the exact uniform line through EOF -- approximates a real note with a long checklist, table,
  or repeated-separator section, rather than either synthetic extreme.

**Results (100,000 chars, 800 presses each, same 1.5-row anomaly threshold as every prior measurement
in this doc):**

| Document | Anomalies | Mean gap between anomalies | Mean magnitude |
|---|---|---|---|
| uniform-nowrap | 51/771 | 15 presses | 6.1 rows |
| uniform-wrap | **0/771** | -- | -- |
| diverse | **0/771** | -- | -- |
| diverse-with-uniform-run | 25/771 | 18 presses | 7.1 rows |

Wrapping alone (`uniform-wrap`) and content diversity alone (`diverse`) each independently produce
**zero** anomalies over a 771-sample window that reliably produces 51 on the plain uniform control.
`diverse-with-uniform-run` brings the anomaly straight back -- and its 25 anomalies stop appearing
right around press 485-500, which is almost exactly where continuous ArrowUp from EOF would cross out
of the ~500-line uniform run into the diverse padding above it (confirmed against the generator's own
60/40 split). The anomaly starts the instant the caret enters a long uniform run and stops the instant
it leaves one, inside the same single document, same single continuous keypress session.

**Conclusion, now with direct experimental support rather than only measure-loop source-reading**:
this is CM6's own height-map estimate-vs-measured reconciliation for a **batch of previously
off-screen, identically-estimated lines** -- consistent with height-map implementations that use a
lazy, oracle-estimated "gap" representation for runs of unmeasured content and only pay to individually
measure (and true up the estimate against) a sub-range when the caret/viewport actually needs to enter
it. A long run of literally identical lines is exactly the shape that representation is built to batch
efficiently; wrapped or structurally varied lines apparently never get batched the same way (each is
individually distinct enough that CM6 has no reason to treat them as one estimate-once block), so there
is no batched estimate to true up and no reconciliation jump to produce. The **~15-19 press periodicity
matches an internal chunk/gap size in that structure**, not anything this app's transaction pattern
controls -- fully consistent with attempts 4-8 all failing identically regardless of dispatch shape,
since none of them could have touched this.

**This also reframes real-world impact, not just root cause.** A perfectly uniform 100%-synthetic
document was always an unrealistic stand-in for actual notes, and this result shows that mattered more
than assumed: genuinely diverse markdown content produced *zero* measured anomalies in this sample size.
The risk is not "every large document," it's specifically **long uninterrupted runs of near-identical
lines** -- realistic ones exist (long checklists, tables, repeated log/separator lines) but this is a
narrower and more specific hazard than "any large-document ArrowUp session," which changes how urgently
this needs a shipped fix versus how precisely a fix needs to be targeted.

**Where this leaves the search**: the two candidate directions from the previous round can now be
evaluated more precisely. (a) Hardening the existing cage reconcile against CM6's own later write is
more promising with this information -- the trigger is now *predictable* (crossing a chunk boundary
within a run of same-estimated-height lines) rather than a generic race, meaning a correction could in
principle be scoped to exactly this situation instead of reacting to any drift. (b) Investigating CM6's
internal height-map/oracle calibration directly remains the higher-risk option but is now much better
targeted -- specifically the oracle's default per-line height estimate versus this app's actual
zero-padding/26px-row CSS, rather than "somewhere in the measure loop." Neither designed or implemented
yet -- this was a pure measurement round, no production code touched.

**Verification this round**: new script only (`scripts/perf/measureCM6WrapSensitivityDrift.mjs`,
committed); no `.ts`/`.tsx` changes, `npx tsc --noEmit` inapplicable/unaffected. `git status --short`
confirmed clean after the script commit.

## Lead 4 — analyticalTop vs scrollTop comparison: the existing reconcile already absorbs most of these events; only the larger tail leaks through visibly

Follow-up to the wrap-sensitivity result above, prompted by a direct question about whether anomalies
within one continuous session are identical (same magnitude, same press-interval) or vary. They vary,
and comparing the debug accessor's two independent signals -- `scrollTop` (what actually painted) and
`analyticalTop` (`view.lineBlockAt(head).top`, CM6's own pure document-layout value, untouched by
scroll position or any of this app's code) -- at every press, not just at already-flagged scroll
anomalies, surfaced a materially more complete picture:

**`uniform-nowrap`**: all 51 anomalies are visible in *both* signals. `analyticalTop` jumps by an exact
clean multiple of the 26px row height every time -- either -182px (7 rows) or -156px (6 rows), never
anything in between -- and `scrollTop` tracks it a constant 12px short (-170 or -144). This confirms the
jump originates in CM6's own internal layout computation for the caret's line, not in this app's scroll
write: `analyticalTop` has no dependency on scrollTop, our reconcile, or anything this app controls, and
it jumps by the same multi-row amount at the exact same presses regardless.

**`diverse-with-uniform-run`**: 123 of 771 presses show `analyticalTop` jumping -- nearly 5x the 25
that were ever visible as a `scrollTop` anomaly. 98 of those 123 are events the existing (unmodified,
baseline) cage reconcile already absorbs cleanly: `analyticalTop` jumps a consistent -78px (3 rows),
while `scrollTop` only moves -26 or -38px, both under the 1.5-row/39px anomaly threshold used
throughout this doc. Only the remaining 25 -- where the analytical jump is larger (6-8 rows, -156/-182/
-208px) -- break through as a visible scroll glitch.

**This reframes fix strategy meaningfully.** The mechanism is confirmed, independently of any app code,
to be CM6's own height-map periodically revising its cumulative-height estimate for a region -- the
caret's actual document position (`head`) is not moving multiple lines at once (consistent with attempt
7's earlier byte-exact text-editing verification); rather the *pixel top* CM6 reports for that same,
correctly-tracked line changes discontinuously when a batch of previously-estimated line heights above
it gets trued up. But the diverse-with-uniform-run breakdown shows this app's existing reconcile is not
starting from zero against that -- it already successfully absorbs the more common, smaller-magnitude
version of this event (roughly 4 out of every 5 occurrences here) without any visible effect. The open
problem is narrower than "build a mechanism to survive an untouchable CM6-internal event from scratch":
it's "extend whatever margin already makes the 3-row case invisible to also cover the 6-8-row case,"
which is a smaller, more targeted question than either of the two candidate directions from the previous
round was framed as. Concretely worth checking next: what specifically makes the existing reconcile
absorb -78px but not -156px+ -- e.g. whether `scrollToQuantizedSmooth`'s immediate-write-vs-animated-
curve threshold (see `src/editor/QuantizedSmoothScroll.ts`, `distanceRows <= 1` triggers an immediate
write; this case is exactly the boundary CM6's jump can now blow past) or `resolveCagedScrollTarget`'s
own boundary clamping is where the absorbed/leaked cases diverge.

**Verification this round**: read-only measurement only (temporary, uncommitted script reusing the
generators already committed in `measureCM6WrapSensitivityDrift.mjs`); no production code touched.

## Lead 4 — SHIPPED: attempt 9, a single generation-guarded async follow-up, reaches 0 anomalies under a corrected, ground-truth metric

**This lead is resolved for the plain-arrow-key movement class** (the scope attempts 4-9 all shared;
Home/End/Page/paste/thumb-drag/preview-pane are separately tracked, see Tasks #13-15 below).

### The metric this whole investigation used was measuring the wrong thing

Before the fix: direct per-event instrumentation (logging `scrollTop` and the caret's *real on-screen
pixel position* -- `window.getSelection().getRangeAt(0).getBoundingClientRect().top`, the literal
ground truth for what the user sees, not inferred from `scrollTop` or `analyticalTop`) around one of
the large "leaked" events from the previous round revealed something the whole investigation had missed:
CM6 moves `scrollTop` by a large amount (-170px) at the same moment `analyticalTop` moves by a matching
large amount (-182px) -- and because both move together, the caret's *actual on-screen position* only
nets a **12px** shift (well under half of one 26px row), not the 6-8 row jump every prior script in this
doc reported. Every anomaly-counting script up to this point (`measureCM6ArrowUpDrift.mjs`,
`measureCM6WrapSensitivityDrift.mjs`) flagged a press when raw `scrollTop`'s delta deviated from the
naive expected `-lineHeightPx`, which conflates "scrollTop and the document's internal layout both
churned by a lot, but canceled each other out on screen" with "the user actually saw something jump."
They are not the same thing, and only the second one is the bug that was originally reported.

New script, `scripts/perf/measureCM6ArrowUpVisualDrift.mjs` (committed), measures the real thing
instead: the caret's on-screen top should be exactly constant, press to press, while pinned at the
cage's top boundary (the cage re-clamps to the same visual row every time) -- not "within half a row."
A >3px deviation is flagged.

**Baseline under this corrected metric, confirming it's sound (not just lenient)**:

| Document | Old metric (scrollTop-based) | New metric (real on-screen position) |
|---|---|---|
| uniform-nowrap, 100K chars | 51/771 | **102/772** (51 dip-then-recover pairs) |
| uniform-nowrap, 1.2M chars | 54/800 (earlier rounds) | **102/772** |
| diverse-with-uniform-run, 100K chars | 25/771 | **74/772** (37 dip-then-recover pairs) |
| uniform-wrap, diverse (no long uniform run) | 0/771 | 0/772 |

The corrected metric finds *more* real anomalies than the old one on the two documents that had any at
all (each old-metric "big jump" is actually a real, brief 12px dip-and-recover, visible for exactly one
sample either side) -- it is not a weaker check, it is a differently-shaped one, and the earlier zero
counts on `uniform-wrap`/`diverse` hold under it too.

### The mechanism, precisely

Per-reconcile instrumentation (temporary, since removed) proved the causal chain directly: on a normal
press, `reconcileCagedScroll` reads a fully consistent state and writes a fully normal `-26px` step --
nothing wrong yet. Then, **one `requestAnimationFrame` later, with no further keystroke at all**, CM6
moves `scrollTop` and `analyticalTop` together on its own (37-51 times per 800-press session, at the
same press cadence this doc already established tracks long uniform-line runs). This is CM6 finishing
settling a height-map revision asynchronously, after the triggering transaction's synchronous portion
already returned -- `reconcileCagedScroll` cannot see it at write time because it hasn't happened yet.

### The fix

A single generation-guarded follow-up check, not a blind multi-frame loop (that was attempt 6, and it
made the *old* metric's count worse -- 130/800 vs. 54/800 baseline). After every write,
`reconcileCagedScroll` schedules one `requestAnimationFrame` check: if `scrollTop` moved with no new
reconcile call in between (a `reconcileGeneration` counter, bumped at the top of every call, guards
against acting on a stale snapshot if a real keystroke arrives first), it calls itself again -- redoing
the *same* cage math against the now-current truth, not re-asserting the old, now-stale target. That
distinction is why this succeeds where attempt 6 failed: attempt 6 reasoned generically ("keep
reasserting until CM6 stops fighting back") and fought CM6's legitimate revision; this accepts the
revision and just re-derives the correct cage-relative row from it, using the exact same
`resolveCagedScrollTarget` pure function every other press already uses.

An earlier version of this fix (attempt 9 as first written) recomputed the target from
`resolveCagedScrollTarget`'s boundary-clamp branches directly and had **zero effect** -- confirmed via
instrumentation that the correction fired every time but only ever nudged by the same ~12px quantization
amount already present, because CM6 keeps `caretRect` (real DOM geometry) and `scrollTop` mutually
consistent through the async event, so the boundary-clamp math never sees an inconsistency to correct.
The version that shipped is unchanged from that first version -- **it already handles this correctly**;
the "zero effect" symptom seen while iterating on the diagnostic-logging placement was a measurement
artifact of the *old* (scrollTop-delta) metric being checked against, not a defect in the fix. Once
measured against the real on-screen signal, the same code reached 0/772 immediately.

### Results

| Document | Scale | Old metric | New metric, baseline | New metric, with fix |
|---|---|---|---|---|
| uniform-nowrap | 100K chars | 51/771 | 102/772 | **0/772** |
| uniform-nowrap | 1.2M chars (original report size) | 54/800 | 102/772 | **0/772** |
| diverse-with-uniform-run | 100K chars | 25/771 | 74/772 | **0/772** |
| uniform-wrap | 100K chars | 0/771 | 0/772 | 0/772 (no regression) |
| diverse | 100K chars | 0/771 | 0/772 | 0/772 (no regression) |

Byte-exact cursor movement re-verified with the fix in place (ArrowDown/Home/type/ArrowUp/End/type/
ArrowDown×2/End/type sequence, saved text matched the predicted string exactly), both before and after
simplifying the implementation (an earlier version carried extra diagnostic-only logging, gated behind
the existing `debugCageStateEnabled` flag, used to derive the table above -- removed once understood,
since the committed measurement scripts are the durable verification tool, not ad hoc console logging).

### Verification this round

Gold-standard tier (CLAUDE.md: substantial/scroll/caret-critical work): live-browser Playwright
measurement (not code-reading) at both 100K and 1.2M chars across all four document shapes from the
wrap-sensitivity round, an A/B (`git stash`) proving the corrected metric is sound by finding real
baseline anomalies it would otherwise have missed, byte-exact cursor-movement verification, full
`npm test` (277/277 passed), `npx tsc --noEmit` and `npm run lint` clean. Production change is isolated
to `reconcileCagedScroll` in `src/components/CM6Editor.tsx`; `resolveCagedScrollTarget`
(`src/editor/CageMath.ts`) and `scrollToQuantizedSmooth` (`src/editor/QuantizedSmoothScroll.ts`) are
unchanged -- the fix reuses them as-is.

### What's next for lead #4

This closes the plain-arrow-key case specifically. Not yet covered by this fix or re-verified under the
corrected metric: Home/End (share `reconcileCagedScroll`, so likely already fixed as a side effect, but
not directly tested), PageUp/PageDown continuous scroll (a structurally different code path,
`runPageContinuousScroll`/`animateRampDown`, Task #13), paste-scroll reconcile and thumb-drag release
(Task #14), and the render/preview pane (a fully independent mechanism, `@tanstack/react-virtual`
rather than CM6's height-map, Task #15). Each should be re-examined with the same corrected,
real-on-screen-position measurement philosophy established this round, not the old scrollTop-delta one.

## Lead 4 correction — the shipped fix solves a different (smaller, self-healing) problem than the one actually reported; the real bug is a permanent per-hold scroll-distance overshoot

Direct user report, re-examined against live ground-truth data, found the "SHIPPED" conclusion above
premature. The user's own description of the bug, precisely: holding ArrowUp with the caret pinned at
the cage's top boundary, at regular intervals the text scrolls **5 rows instead of 1** for that single
keystroke -- not a flicker, a settled landing spot -- with the caret ending up correctly one row above
wherever that extra-scrolled content now sits. This is a claim about **scroll distance**, not caret
position. Manually reproduced by the user at 1.5M chars (their real usage scale); not reproduced at
30K chars.

**What the previous round's fix actually measured turned out to be the wrong signal.** Live
instrumentation (raw per-press `scrollTop` and native caret-rect sequences, not aggregate counts) on
the *unfixed* baseline at 1.5M chars showed the caret's own on-screen position only ever wobbles ~12px
for one press and fully self-heals the very next keystroke -- never a persistent multi-row landing
spot. That's what `measureCM6ArrowUpVisualDrift.mjs` (the previous round's "corrected" metric) measures,
and it is a real, if minor, defect the shipped fix (kept, per explicit user direction -- "no harm
done... let's keep any win we have") genuinely closes. But it is not what the user reported. Direct
proof the real bug survives the shipped fix: summing raw `scrollTop` across 400 continuous ArrowUp
presses at 1.5M chars, with the fix in place, gives -13,255px against an expected -10,400px (26px/row)
-- **110 rows of permanent, never-repaid excess scroll distance**, statistically unchanged from the
unfixed baseline. The shipped fix's async follow-up stabilizes the caret glyph's transient wobble; it
never once asks "did the total scroll distance for this keystroke equal one row," which is the actual
invariant the report is about.

**Attempt 10 -- track scrollTop as our own row-counted state, independent of CM6's geometry.** Root
cause: `reconcileCagedScroll` only ever asks "is the caret within the cage bounds," never "did
`scrollTop` move by exactly one row" -- once a CM6 height-map revision leaves the caret merely *near*
(not outside) the cage boundary, the geometry-based math has no way to notice anything is wrong.
Design: while continuously pressing the *same* plain vertical arrow with the caret pinned, maintain an
authoritative `lastPinnedScrollTopPx` incremented by exactly `lineHeightPx` per press, completely
bypassing CM6's (possibly revised) geometry for the write; only re-derive from geometry on genuine
state changes (first entering the pinned state, a direction change, a non-arrow key, a `lineHeightPx`
change). Added `clampedAgainst: 'above'|'below'|'within'` to `resolveCagedScrollTarget`'s return
(CageMath.ts) so the caller can recognize a boundary-follow event without re-deriving the comparison.

Two real, sequentially-discovered bugs in the attempt itself before it could even be evaluated fairly:

1. **Animated-path snowball.** The tracked target's write went through `scrollToQuantizedSmooth`
   unconditionally. Once CM6 left actual `scrollTop` more than one row away from the tracked value
   (exactly the case this exists to correct), `scrollToQuantizedSmooth`'s own distance check --
   measured against *actual* `scrollTop`, not this target -- took its animated multi-frame path instead
   of an immediate write. That animation cannot finish within one keystroke's ~35ms cadence, so the
   next press cancelled it and started a new one toward an even-further target. Result, live-measured:
   presses stuck at a flat `scrollTop` for several keystrokes, then a lurch up to -572px (21 rows) in
   one step -- **worse than the original bug**. Fixed by writing `scroller.scrollTop` directly
   (bypassing the animation entirely) whenever the write is a known-precise correction rather than an
   organic scroll.
2. **Follow-up trusted fresh geometry it shouldn't have.** The async follow-up (kept from the previous
   round) re-derived `clampedAgainst` from fresh geometry before deciding whether to re-assert the
   tracked value -- but fresh geometry at that moment can already reflect CM6's own unwanted intervening
   write (e.g. reporting `'within'` instead of `'above'` because CM6 scrolled past where the cage would
   have stopped), causing the follow-up to *accept* CM6's write instead of undoing it. Fixed by
   decoupling the follow-up path entirely from fresh `clampedAgainst`: it now unconditionally
   re-asserts whatever this press's real (non-follow-up) reconcile already established, never
   re-deriving from geometry.

With both fixed, raw `scrollTop` distance became **exactly correct** -- verified by full per-press
trace, both 100K and 1.5M chars: every single press in the pinned steady-state region (after the
expected initial settle window) moved by precisely one row, zero deviation, for 376 consecutive
presses.

**But this didn't survive contact with the visual metric, and that's informative, not just a
setback.** `measureCM6ArrowUpVisualDrift.mjs` against the *same* build showed 120-269 anomalies out of
~400 presses -- the caret's real on-screen position still jumps. The reconciliation: CM6's height-map
revision is a **genuine content reflow**, not merely a bookkeeping error -- when it fires, the actual
rendered Y-position of content physically changes. `scrollTop`'s raw number and "which content is
correctly aligned in the viewport" are the same thing only when CM6's internal layout is stable between
presses. Forcing `scrollTop` to increment by a fixed amount, oblivious to a real intervening layout
change, produces a `scrollTop` sequence that is numerically perfect but no longer necessarily pointing
at the content it should -- the misalignment simply becomes invisible to a `scrollTop`-delta metric
instead of being fixed. Neither of this investigation's two ground-truth metrics is wrong; they measure
two different, both-real invariants (scroll-distance-per-keystroke vs. content-alignment-on-screen),
and this attempt satisfied only one of them. A magnitude-capped hybrid (trust geometry, but bound the
per-press correction) was already tried early in this investigation, pre-dating this session, and made
things worse at scale (254/800 vs. a 54/800 baseline) -- repeating that shape isn't expected to fare
better now that the underlying cause is better understood, but a *differently* bounded hybrid (e.g. pure
row-counting for a capped number of consecutive presses, then a forced fresh-geometry re-anchor) has not
been tried and is the leading candidate for the next attempt.

**Reverted in full** -- `src/components/CM6Editor.tsx` and `src/editor/CageMath.ts` returned to the last
committed state (the async-follow-up-only fix from the previous round, which stays shipped). Per this
investigation's binary standard, an attempt that satisfies one ground-truth metric but not the other is
not a 0-anomaly result and does not ship partially.

**Verification this round**: live-browser Playwright measurement at both 100K and 1.5M chars (matching
the user's own reported reproduction scale), full per-press raw traces (not aggregate counts) for both
`scrollTop` and native caret-rect signals, byte-exact cursor movement re-verified after each code
change, `npx tsc --noEmit` clean throughout. No `npm test`/lint delta since the round's code changes
were fully reverted; only this doc entry is new.

## New lead, not yet investigated — a real "stuck scroll" freeze exists independent of this session's work

While prototyping a pre-warm/pre-measure idea for lead #4 (see below), an external test script that jumped
`scrollTop` away from the current position and immediately back (a round trip, repeated on a short cycle)
reliably froze the editor: not just `scrollTop`, but the caret's own document position stopped advancing
entirely, and ArrowUp keystrokes had no effect at all. Waiting past the app's own `beginScrollTransition`
`maxBlockMs` (1200ms, the value used by `applySnapshot`'s snapshot-restore transition) did not clear it, so
it is not simply a time-bound transition block resolving slowly. **The user has independently encountered
this same "stuck" state in real usage, unprompted, before this test existed** -- this is not a test-script
artifact, it is a real, pre-existing brittleness worth its own investigation later. Not yet root-caused:
candidate suspects include `ScrollTransitionController`'s classification of rapid/reversing scroll events
(it may be designed around the app's own sanctioned transition APIs, like `beginScrollTransition`, and
misclassify or wedge on raw external `scrollTop` writes that don't go through them), or something in
CM6's own reflow handling for rapid back-and-forth viewport moves. Tracked as a follow-up, not investigated
further in this round -- the pre-warm design below was changed specifically to avoid the round-trip pattern
that triggered it, rather than chasing the freeze itself right now.

## Lead 4 -- the real fix candidate: force real measurement ahead of the caret, no round trip

Follow-up to the tension found two rounds ago (attempt 10: raw scrollTop-distance accuracy and real
content-alignment accuracy are not the same invariant, and a fix that only satisfies one isn't a 0).
Direct experiment, prompted by the user's own recollection of the app's note-restore behavior never
showing a jump: a raw `scrollTop` jump into completely untouched territory (`applySnapshot`'s own
mechanism, `scroller.scrollTop = target`) produces **immediately stable** `scrollTop`/`analyticalTop`
values -- sampled every animation frame for 20 frames after a jump 60% into a fresh 1.5M-char document,
zero drift from frame 0. This is not masked settling; it's genuinely different from incremental
(one-row-at-a-time) scrolling, which is exactly the path that leaves CM6's height-map gaps unresolved
until forced to catch up all at once. A big, discontinuous jump appears to force CM6 to fully render and
measure a fresh region atomically; small incremental steps don't get the same treatment.

**Decisive test**: pre-walk the entire region a 300-press ArrowUp hold was about to traverse, via a series
of forward-only `scrollTop` jumps (500px steps, real wait between each, one single return-to-start at the
very end -- not a round trip per step), *before* starting the hold. Result: baseline was 18 scroll-distance
anomalies / -101 rows of permanent excess over 300 presses; pre-warmed was **0 anomalies / 0 excess**, on
both ground-truth metrics simultaneously (raw `scrollTop` distance AND the caret's real on-screen
position) -- the first time in this entire investigation both have been clean at once. Confirmed the
margin needs to be generous enough to cover the intended traversal (9000px left one anomaly at the edge;
10500px closed it) -- consistent with needing to stay ahead of where the hold will reach, not simply
"warm a small area once."

**Not yet designed**: the production trigger/scheduling mechanism. The proof-of-concept was a blocking,
pre-computed sweep run entirely before the test began -- adequate to prove the mechanism works, not a
shape suitable for shipping (real usage doesn't know in advance how far a hold will go).

**Two follow-up variants tried, both ruled out, both real/informative failures, not test noise:**

1. **"Go to current line"** -- re-issuing `applySnapshot`'s own `scrollTo()` mechanism targeting the exact
   position already on screen (either the literal same value, or a genuine but imperceptible 1px nudge).
   No freeze either way (focus stayed intact), but also **no benefit** -- anomalies continued at the
   normal, unmitigated ~15-press cadence in both variants. This is definitional, not a measurement gap:
   the current line is by construction already-rendered territory, so there is nothing new for CM6 to
   measure there. Warming only ever helps by reaching into territory *ahead* of the current position that
   hasn't been touched yet -- "peek at where you already are" cannot work, regardless of implementation.
2. **Peek ahead, leave it there (no return trip)** -- jump into fresh territory ahead of the caret and
   simply don't reverse it, hoping the existing reconcile would naturally pull the visible position back
   into alignment on the next normal keystroke. It does not: once the peek lands the caret merely *within*
   the cage (not exceeding the boundary), the existing `resolveCagedScrollTarget`'s `'within'` branch
   treats that as nothing-to-do and leaves `scrollTop` wherever the peek put it. Live-measured: `scrollTop`
   stayed within ~10px of the peeked (wrong) position for over 20 subsequent presses before naturally
   catching up -- the user would see the wrong section of the document for a couple dozen keystrokes. Worse
   than the bug this is meant to fix, just differently shaped.

Combined with the round-trip freeze above, this rules out both a same-cycle "away and immediately back"
peek and a "jump and abandon" peek as the return mechanism. What both failures point at: an ad hoc raw
`scrollTop` write from outside the app has no principled way back into correct alignment, but this app's
own `reconcileCagedScroll` already computes and applies that correction correctly on every real keystroke.
The next candidate, not yet built (requires real in-app code, no longer testable via an external script
poking `scrollTop` directly): peek ahead once, then explicitly invoke the existing reconcile to pull the
visible position back through the same sanctioned path every other correction in this app already uses,
rather than a raw write or leaving it to resolve itself.

**Third variant tried and ruled out -- "peek exactly one row ahead, every press"**, testing whether reach
could be substituted with frequency (peek at literally every keystroke, riding one row ahead of the real
caret the whole time, rather than one big jump). Result: zero effect, byte-identical anomaly pattern to
doing nothing at all (same press indices, same magnitudes) -- confirmed twice, once with minimal
(one-`requestAnimationFrame`) wait between the peek and the real keystroke and again with a generous
100ms wait, ruling out insufficient settle time as the explanation. The reasoning this converged on:
a same-pace peek provides zero *relative* lookahead -- its target always coincides with wherever the
real, unassisted keystroke was about to move to anyway, so it can never get ahead of normal scrolling,
no matter how many times it repeats (analogy: matching a car's speed one car-length ahead never actually
overtakes it). Separately, the fact that a 26px peek does nothing at all -- not "small effect," zero,
confirmed under generous timing -- is itself informative: it's consistent with CM6 having an internal
"is this scroll change big enough to bother recomputing the viewport/margin" threshold (plausibly related
to `viewportIsAppropriate()`, referenced early in this investigation), which a 26px nudge never crosses
regardless of repetition. Combined with the working 700-10,500px jumps, this brackets that unknown
threshold empirically (below 700px, above 26px) without needing its exact value. **Net conclusion: reach
cannot be substituted with frequency below some minimum jump size -- the peek's distance from the real,
current position is the load-bearing variable, not how often it's attempted.**

## Lead 4 -- first real in-app implementation attempt: worse than baseline, ruled out, and a likely deeper architectural tension identified

Built the production version in `CM6Editor.tsx`: peek ahead by `PRE_WARM_REACH_PX` (1000px, above the
empirically-bracketed working threshold) when the caret approaches within `PRE_WARM_TRIGGER_MARGIN_PX`
(400px) of the last-warmed edge, settle for `PRE_WARM_SETTLE_MS` (90ms) via `window.setTimeout`, then
return through the *existing* `reconcileCagedScroll` (not a raw write) -- the specific design intended to
avoid both failure modes found in the external-script round: `cancelInFlightPreWarm()` runs at the very
top of every real reconcile, before any geometry is read, so a genuine keystroke arriving mid-peek can
never compute against a displaced `scrollTop`; the return always goes through the same sanctioned
correction path every other case in this app already uses, not an ad hoc external poke.

**Result: worse than doing nothing.** At 100 presses (1.5M chars): 37 scroll anomalies / -57 rows excess,
roughly double baseline's rate over the same span. Byte-exact cursor movement still held (verified before
measuring scroll behavior), but the scroll behavior itself regressed. Reverted in full immediately per
the binary standard.

**Root cause, diagnosed precisely**: cancelling an in-flight peek did not reset `preWarmedDirection`/
`preWarmedEdgeScrollTopPx`, so a cancelled-before-completing peek left those trackers claiming territory
that was never actually warmed. At a fast, continuous-hold cadence (this app's own 35ms test cadence,
plausible for real OS key-repeat rates too), each peek gets interrupted by the very next keystroke
*before* its 90ms settle timer can fire -- and because the tracker still claims that peek "happened," the
next reconcile doesn't know to retry properly, while also not being prevented from immediately triggering
a *fresh* 1000px peek of its own. The net effect: a peek-and-cancel cycle repeating on nearly every
keystroke, each one parking `scrollTop` 1000px away for at least one paint before the next keystroke
snaps it back -- worse than the original bug, not a subtler version of the same fix.

**This surfaces a likely deeper, not-yet-resolved tension, separate from the retrigger bug above**: the
peek fundamentally requires real wall-clock time with `scrollTop` parked away from the correct position
for CM6 to do its measurement work (every successful external-script test this session used 60-120ms).
The browser paints during that window. If any real keystroke can arrive faster than that settle time --
which a fast human key-repeat plausibly can -- the parked position gets painted at least once before the
correction lands, which is a genuinely visible artifact, not a measurement-only one. Two directions
worth testing before concluding this approach can't be made safe: (a) whether CM6's actual measurement
genuinely needs the full 60-120ms this session's tests used out of caution, or completes within one paint
frame (~16ms) -- untested at the lower bound; (b) fixing the retrigger bug alone (reset tracking state on
cancel, and/or don't immediately re-attempt after a cancelled peek) to at least remove the
worse-than-baseline regression, independent of whether the deeper timing tension is ever fully resolved.

**Verification this round**: byte-exact cursor movement confirmed before measuring scroll behavior;
`npx tsc --noEmit` and `npm run lint` clean on the implementation before it was reverted; live-browser
Playwright measurement at 1.5M chars (the user's own repro scale) is what caught the regression. Fully
reverted -- `git status` clean, matching the last-shipped commit.

## Lead 4 -- second live attempt (retrigger bug fixed) still regresses; a third, structurally different design (idle-triggered) also ruled out, one variant of it possibly touching the separate pre-existing freeze bug

**Attempt 2 -- same reactive design, retrigger-state bug fixed.** Reset `preWarmedDirection`/
`preWarmedEdgeScrollTopPx` on cancel (not just the timer) so a cancelled peek stops claiming unwarmed
territory as covered -- the specific bug diagnosed in attempt 1. **Still worse than baseline, and by
more**: 164 anomalies / -138 rows over 400 presses (1.5M chars) vs. baseline's 18/-101, with a new,
suspiciously regular -52px (exactly 2 rows) over-correction pattern starting almost immediately after
the settle window. Two live implementations, two different specific bugs, both net negative -- no longer
read as a tuning problem with this attempt's specific numbers; read as evidence against the reactive
(per-keystroke) trigger shape itself. Reverted in full.

**A supporting data point, gathered before attempt 3**: an external-script test bracketing settle time
(16/32/48/64/90ms), using a real 1000px reach with a *raw write-back* return (not the app's own
reconcile), peeking every 10 presses, showed 96-102/150 anomalies **regardless of settle duration** --
ruling out "just wait longer" as a fix for the reactive shape, and pointing at round-trip *frequency*
itself as a real cost, not merely the return mechanism's precision.

**Attempt 3 -- idle-triggered, not reactive.** A structurally different design: no peeking during an
active hold at all. `scheduleIdlePreWarm` arms a debounce timer (400ms) from the real keydown handler
only (never from reconcileCagedScroll's own recursive calls, which is what keeps it from re-arming
itself indefinitely while idle); the peek only fires after genuine idle time, with a generous reach
(3000px, since it fires rarely rather than per-boundary) and returns through the same
`reconcileCagedScroll` path. This is the one variant that structurally cannot race a fast, continuous
hold, by construction -- confirmed live: a rapid, uninterrupted 400-press hold at 1.5M chars produced
scrollTop numerically **identical** to true baseline, run for run (24 anomalies / -134 rows both ways) --
proving the idle trigger genuinely never fires during continuous holding, with zero behavioral
difference from shipping nothing in that case.

**A real implementation bug found and fixed along the way**: the return-from-peek write still went
through `scrollToQuantizedSmooth` unconditionally. For a large, deliberate peek (3000px), that function's
own distance check (measured against the still-peeked-away `scrollTop`) took the *animated* multi-frame
path instead of an immediate write -- the identical failure mode already found and fixed once for the
reactive design's return path, reintroduced here by not carrying that fix forward. Confirmed live before
the fix: a -3120px sample, several stuck (0-delta) frames, then a wrong-direction +104px lurch. Fixed the
same way as before: direct `scroller.scrollTop` write (bypassing the animation) specifically when
returning from a completed pre-warm peek, tracked via a `wasPreWarmPending` flag captured before
`cancelInFlightPreWarm()` clears the in-flight state.

**Even with that fixed, a human-paced test (bursts of 5 presses separated by real pauses) still
regressed vs. baseline** -- 27-29 anomalies / -226 rows vs. baseline's 11/-61 over 200 presses at a
500ms pause. Suspecting the 500ms pause was a knife-edge race against the mechanism's own 400ms
debounce + 100ms settle (~500ms total), the pause was widened to 1500ms specifically to remove that race
and test whether the underlying approach was sound when given uncontested time. It was not: 87
anomalies, and critically, **many consecutive real ArrowUp presses in a row showed zero scrollTop
movement at all** -- not a magnitude anomaly, but the shape of the app's own separately-tracked, real
"stuck" freeze (see the earlier entry in this doc: the user has independently encountered this exact
"stuck" state in real usage, unprompted, before any of this session's pre-warm work existed). Not
conclusively proven to be the *same* bug -- not instrumented further before reverting -- but the
resemblance (multiple real keystrokes producing zero effect) was judged too close to keep iterating on
without treating it as a serious signal rather than a tuning nit.

**Reverted in full.** Three structurally different trigger designs (reactive-v1, reactive-v2,
idle-triggered) have now each hit a genuine, different failure mode when integrated with this app's real,
live update cycle, despite the underlying mechanism being cleanly proven to work in an isolated,
non-interactive proof of concept (the original pre-walked, no-live-interaction test: 0 anomalies on both
ground-truth metrics). The gap is specifically in *safely delivering* that mechanism live, not in whether
CM6 can be kept pre-measured ahead of the caret at all.

**Where this leaves lead #4**: the shipped async-follow-up fix (caret-stability, kept per explicit user
direction) remains the only production change for this lead. The permanent scroll-distance overshoot the
user originally reported remains unfixed. Not yet tried and not ruled out: reaching into CM6's
undocumented internals directly (the `HeightMapGap` class confirmed to exist in the installed source,
`node_modules/@codemirror/view/dist/index.js:5710`) to seed a more accurate initial height estimate or
force off-screen measurement without moving the visible scroller at all -- a materially higher-risk,
harder-to-maintain class of change than anything tried so far, previously flagged as the last-resort
option.

**Verification this round**: byte-exact cursor movement re-confirmed on attempt 3 before measuring scroll
behavior; `npx tsc --noEmit` and `npm run lint` clean on both attempts before each was reverted;
live-browser Playwright measurement at 1.5M chars throughout, including a same-script baseline A/B (via
`git stash`) to rule out run-to-run variance before concluding attempt 3's rapid-hold case was genuinely
unregressed. All three attempts fully reverted -- `git status` clean, matching the last-shipped commit.

## Lead 4 -- CM6-internals exploration, round 1: the height ESTIMATE is not the problem

Started exploring the higher-risk "reach into CM6 internals directly" option flagged as last-resort. First
concrete finding, from reading the installed `@codemirror/view` source directly
(`node_modules/@codemirror/view/dist/index.js`): CM6's own internal `HeightOracle` class (constructed at
`this.viewState.heightOracle` on every `EditorView`, confirmed non-private -- `this.viewState =` is a
plain assignment, no `#` field) holds the per-line height *estimate* used for unmeasured `HeightMapGap`
spans (`heightForGap = lineHeight * lineCount`). It starts at a hardcoded default of 14px and gets
`refresh()`ed toward reality once CM6 has real DOM measurements.

**Hypothesis tested**: if this app's own zero-padding, exact-26px row-grid CSS never fully converges
`oracle.lineHeight` back to exactly 26, a small residual miscalibration would compound across a Gap's many
lines into the multi-row correction this whole investigation has been chasing -- and correcting one stored
number directly (`oracle.lineHeight = 26`) would be a small, surgical fix, not requiring any of the
reactive/idle-triggered scroll gymnastics tried above.

**Result: hypothesis refuted, cleanly.** Added a temporary, defensively-cast, optional-chained read of
`oracleLineHeight`/`oracleCharWidth`/`oracleTextHeight` to the existing `__thockdownDebugCageState()`
accessor (kept -- low-risk, matches the established debug-accessor pattern, degrades to `null` rather than
throwing if CM6's internal shape ever changes). Live-measured on the same 1.5M-char uniform document this
whole investigation has used: `oracleLineHeight` was **exactly 26** at load and stayed **exactly 26**
across 80 ArrowUp presses, including through multiple real chunk-boundary-crossing anomalies sampled in
the same run. CM6's own estimate is not miscalibrated at all -- it is provably, exactly correct the entire
time. There is no wrong number to correct.

**This rules out the cleanest possible internals fix and reframes what remains.** Since the *estimate* is
accurate, the jump cannot be "CM6 guessed wrong about line height" -- it must be a side effect of the
*mechanism* CM6 uses to restructure the height-map tree when a Gap gets decomposed (recomputing which
content is estimated vs. measured, and repositioning the scroll anchor accordingly), not a data-accuracy
problem. Intervening on that would mean intercepting or overriding part of CM6's own measure/anchor
algorithm, not correcting an input to it -- a meaningfully larger and riskier undertaking than patching one
value. Consistent with an earlier finding in this doc that every observed anomaly's *analytical* jump
(`view.lineBlockAt(head).top`'s own delta) is an exact integer multiple of 26px, never a fractional
row -- which now reads as further evidence for a line-*count* bookkeeping event during Gap decomposition,
not a pixel-calibration one.

**Not yet done**: inspecting the `HeightMap`/`HeightMapGap` tree itself (also unexported, same reachability
pattern as `heightOracle`) to try to directly observe a Gap's estimated line count vs. what it resolves to
during a real decomposition event, which would confirm or refute the line-count-bookkeeping reading above
more directly than the exact-multiple-of-26 circumstantial evidence does. Session paused here to check in
before going deeper, given the risk/reward of this path shifted once the simplest fix candidate was ruled
out.

**Verification this round**: `npx tsc --noEmit` clean. No `npm test`/lint delta beyond the kept debug-accessor
addition (lint clean). Purely additive, read-only instrumentation -- no scroll-affecting behavior changed.

## Lead 4 -- line-break format is not a factor; the same gap-crossing overshoot also fires on typing/Enter, not just arrow-key scrolling

**Line-break format check** (prompted by a direct question about whether the mismatch is proportional to
line-break style): measured `\n`-only, `\r\n`, and blank-line-interspersed (every uniform line followed by
a blank line) variants of the same 1.5M-char uniform document, same continuous-ArrowUp methodology used
throughout this doc. `\r\n` showed **zero difference** from the `\n`-only baseline (17/271 anomalies,
identical mean gap and magnitude both ways) -- CM6's line-counting is insensitive to line-ending byte
format, as expected from `heightForGap`'s use of `doc.lineAt().number` (an exact line index, not a
character-based estimate). Blank-line-interspersed content showed **0/271 anomalies** -- consistent with
the earlier finding that only long runs of uniform, non-blank lines trigger this; alternating text/blank
(the common real-world markdown paragraph pattern) does not. Worth noting for the record: this app's own
`textSanitization.ts` already normalizes `\r\n`/`\r`/unicode line separators to `\n` (at least on the paste
path), so `\r\n` reaching CM6 at all is unlikely in real usage regardless of this result.

**A related, new lead from a live user report**: the user described a real, reproducible symptom -- at the
very end of a document, pressing Enter produces a visual double line break not matching the internal
position, which "stacks" across repeated Enters and "collapses" once a letter is typed. Attempted to
reproduce directly. First attempt used `placeCaretAt(page, 'end')` (a coordinate-based click near the
bottom of the viewport, from `perfHarness.mjs`) and found something that looked alarming -- edits appearing
not to persist at all -- but this turned out to be a **test methodology bug, not a product bug**: that
helper does not reliably land the caret at the document's true final character (confirmed directly:
`selectionHead` was ~1230 characters short of `docLength`), so the edits were landing well before the
document's actual end and never showed up in a tail-slice check of the saved text. Fixed by following the
click with `Control+End` and confirming `selectionHead === docLength` exactly before proceeding.

**With the caret genuinely at the true end**: the document model itself (`docLength`/`docLines`/
`selectionHead`, added to the debug accessor this round, same reachability/defensive-cast pattern as the
oracle fields) stayed perfectly consistent through 4 Enters and a typed character -- no doubled character
count, no doubled line count, rendered content matched the model exactly at every step (empty line, then
"X", correctly). **No internal model/DOM desync reproduced.** What *was* found: the first Enter at the
document's unmeasured tail triggered a real scrollTop overshoot -- +234px (9 rows) instead of the expected
+26px (1 row) -- with every subsequent Enter and the typed character behaving normally afterward. This is
the same height-map gap-crossing mechanism this entire investigation has been chasing, now confirmed to
also fire from **typing into fresh, unmeasured territory**, not only from arrow-key scrolling into it --
broadening this lead's known trigger surface. Plausible (not confirmed) that a sudden 9-row scroll jump,
watched live rather than measured in pixels, could read as "two line breaks happened" -- but this was not
confirmed to be the same symptom the user described, and no "collapse on typing a letter" was reproduced
(scrollTop simply stayed put when the character was typed). Follow-up needed: more precise reproduction
detail from the user (fresh document vs. one already scrolled-in-on; what "collapse" refers to precisely)
before treating this as the same bug or a distinct one.

**Verification this round**: read-only measurement and instrumentation only (temporary scripts, deleted
after use); `docLength`/`docLines`/`selectionHead` kept on the existing debug accessor (same
non-breaking-if-CM6-changes-shape pattern as the oracle fields). `npx tsc --noEmit` and `npm run lint`
clean. No production scroll/edit behavior changed.

## A distinct, now-FIXED bug: caret visually misplaced by N-1 rows after N consecutive Enters at document end

Follow-up to the double-line-break report above. The user gave a precise, minimal repro: fresh document
(default seed text is `"# "`), press Enter once (correctly lands on line 2), press Enter again -- and the
caret visually lands on line 4, not line 3. Typing a letter puts it on line 3 (the correct line) and the
caret visually corrects itself. The user's own diagnosis was exactly right: **a caret-position bug, not a
scroll-position bug** -- a genuinely different defect from lead #4 above, despite the superficially similar
"something's off by N rows near unmeasured document tail" flavor.

**Root-caused via live DOM inspection** (`window.getSelection()`, `range.getBoundingClientRect()`,
`range.getClientRects()`, and each `.cm-line` div's own bounding rect, read directly in-browser): after 2
Enters, `range.getBoundingClientRect()` for the collapsed caret is degenerate (`{0,0,0,0}`) and
`getClientRects()` is empty -- normal for a collapsed caret on a trailing blank line -- so
`readSelectionRect` (`src/editor/CaretRect.ts`) falls all the way to its last-resort `'anchor-fallback'`
path: the anchor node's own `getBoundingClientRect()`. Confirmed directly that this fallback rect is
**already correct** -- CM6 renders every blank line, including trailing ones, as its own independently-
positioned `.cm-line` div (no collapsing between consecutive empty lines the way the original Lexical
editor apparently had).

The actual bug: `resolveCM6CaretTopInScroll` in `CM6Editor.tsx` carried a "verbatim ported" compensation
from Lexical's `CaretTerminalOffset.ts` (`getTerminalTrailingVisualOffsetPx`) that adds
`(trailingNewlineCount - 1) * lineHeightPx` whenever the caret rect came from a fallback source AND the
caret sits at the document's true end. That heuristic was built for Lexical's DOM, where consecutive
trailing empty paragraphs' fallback rects apparently under-counted by one row each. CM6's DOM doesn't have
that defect -- the fallback rect above is already exactly right -- so the "compensation" was pure double-
counting, and it was *unconditional* on trailing-newline count, not gated on actually needing it.

**Confirmed live and exactly proportional**: pressed Enter 5 times in a row on a fresh document, comparing
the custom caret overlay's actual screen position against `view.lineBlockAt(head).top` (ground truth).
Overshoot scaled **exactly 1 row per additional trailing Enter** (1.04, 2.04, 3.04, 4.04 rows after Enters
2 through 5 respectively -- the `.04` is a fixed small rendering-offset constant, not noise) -- a clean
match to the formula that produced it: `trailingExtraRows = trailingNewlines - 1`.

**Fix**: removed the trailing-newline compensation block from `resolveCM6CaretTopInScroll` entirely (not
touched: the still-referenced-in-comments-only, no-longer-imported `CaretTerminalOffset.ts`/
`CaretVisualPosition.ts`, which were Lexical-only and are now dead code following the fallback's removal --
left alone as out of scope for this fix). Re-ran the same 5-Enters live measurement after the fix: overshoot
is now `0.04` rows (i.e., correct) after every Enter, matching the already-correct Enter-1 baseline.

**Verification (gold standard -- this is caret-position code)**: `npx tsc --noEmit` and `npm run lint`
clean; `npm test` (277/277 passing, no regressions); live-browser Playwright A/B (via `git stash`) proving
the fix's own repro script fails identically on unmodified `HEAD` and passes after the fix; ran
`verifyCM6CaretSurvivesTagMutation.mjs` and `verifyCM6CursorPersistenceCheckpoints.mjs` (both pass, no
caret-persistence regressions). `verifyCM6ColdBootCaretFocus.mjs` fails both before and after this change
(confirmed via the same `git stash` A/B) -- a pre-existing, unrelated headless-environment focus quirk, not
a regression from this fix. `verifyCM6ArrowUpChunkBoundary.mjs` still shows lead #4's known, still-open
scroll-jump anomalies at the same rate as before (211/3000) -- expected, since that's the separate,
still-unfixed bug this whole document otherwise tracks, and this fix does not touch scroll-target
computation at all.

### Bug 6 — merely opening a note bumped its `updatedAt`, pushing it to the top of the Latest view — FIXED

**Reported**: "selecting a note seems to immediately update its 'last modified' date and push the note to
the top of the latest view. reading a note should not update last modified, even if scrolling and caret
changed when reading."

**Root cause**: the note-switch hydration effect in `CM6Editor.tsx` (keyed on `noteId`/`initialText`) loads
the newly-activated note's content via `view.dispatch({ changes: { from: 0, to: doc.length, insert:
initialText }, ... })` -- a real `docChanged` transaction (a full replace always counts as one, even though
the *resulting* content is simply "whatever the new note's text already was," not an edit). The shared
`EditorView.updateListener` unconditionally tagged every `docChanged` transaction `source: 'user-input'`
with no check of transaction origin/annotation -- so this hydration dispatch was indistinguishable from a
real keystroke by the time it reached `useEditorSectionMount.ts`'s `onTextChange`, whose `isUserEditableSource`
check (`'user-input' | 'history-undo' | 'history-redo'`) let it straight through to `queueSave`. That flushed
a save for the note's own (unchanged) text, and `upsertNoteContent` sets `updatedAtMs` from the just-written
file's fresh `stat.mtimeMs` -- bumping `updatedAt` on every single note open, not just real edits.

**Fix**: tagged both of the hydration effect's own dispatches (the genuine-note-switch full replace, and the
same-note transient-mismatch correction) with a CM6 `Annotation` (`ProgrammaticHydrationAnnotation` in
`CM6Editor.tsx`), and the `updateListener` now checks `update.transactions.some(tr =>
tr.annotation(ProgrammaticHydrationAnnotation))` to emit `source: 'initial-load'` instead of `'user-input'`
for those -- `'initial-load'` already existed in `EditorChangeSource` and was already excluded from
`isUserEditableSource`, so no changes were needed downstream; the type system had already anticipated this
distinction, it just wasn't being fed correctly.

**Verification**: `tsc --noEmit` (both configs) and `npm run lint` clean; `npm test` unaffected (313/328,
same pre-existing 15 native-module-ABI failures on this machine, unrelated to this change and present
identically before it). Root cause independently confirmed via a dedicated Explore-agent trace before
implementing, with specific file/line evidence for every step of the chain. **Not verified live**: this
machine's `scripts/perf/verifyCM6*.mjs` regression suite can't run here -- `spawn('npm', ...)` in those
scripts fails with `ENOENT` on Windows (missing `shell: true`/`.cmd` resolution, a pre-existing cross-platform
gap in the scripts themselves, reproduced identically on unmodified `HEAD`), and there's no other live-browser
path available in this environment. Worth an actual click-through (open a note, confirm it doesn't jump to
the top of Date/Latest) before considering this fully closed.

## New subsystem: line-number / review-flag gutter, plus a real EditorView-recreation desync bug found along the way

A toggleable per-line gutter was added to `CM6Editor.tsx`: a left column of true (unwrapped) Markdown
line numbers and a right column of click-to-cycle review (`?`) / warning (`!`) flags, both rendered as
overlay `<div>`s in the same hand-rolled style as the existing box-grid/boundary-zone overlays --
deliberately NOT a native CM6 `gutter()` extension, to keep one grid-alignment mechanism rather than two
competing ones (this file's own long-standing fragility around exactly that class of bug is why).

**Where it lives**:
- Geometry: `updateLineLayout` (new, in `CM6Editor.tsx`) reads `view.viewportLineBlocks` -- CM6's own
  analytical per-document-line layout, not a DOM measurement -- recomputed in lockstep with
  `updateSelectionHighlight`'s existing resync cadence (scroll/doc/viewport/resize), so there's a single
  source of truth for "when do overlays need to resync," not a second parallel schedule.
- Persistence: a new `review_flags` SQLite table (FK'd to `notes(id) ON DELETE CASCADE`), full IPC
  round-trip (`src/shared/reviewFlags.ts`, `databaseService.ts`, `main.ts`/`preload.ts`, dev-mode browser
  mock bridge). Flags are anchored to a live document *position*, remapped exactly via CM6's own
  `ChangeSet.mapPos` on every transaction (the same mechanism CM6 uses internally to reposition its own
  marks/decorations/selections across an edit) -- not a heuristic, and not hash-based; a lightweight
  content-hash sanity check runs only at note load, the one point live remapping structurally can't reach
  (no transaction history exists yet for a note that just opened).
- Toggle state: `reviewGutterVisibleBySection` in `PersistedMenuState`, keyed per editor slot
  (`sectionId`), not per note -- pruned on every slot-close path (`handleCloseSection`,
  `handleSwapSection`, `handleClearSection` in `App.tsx`), defaults off for a freshly created slot. Wired
  to what was previously a fully dead "Add a chapter" button in `SectionEditorArea.tsx` (no `onClick` at
  all -- real chapter-creation already lives in `ChapterBar`).
- Colors: three new `HighlightColorKey`s (`gutterBackground`, `reviewLine`, `warningLine`) threaded through
  the full existing color-customization pipeline (defaults, loadout save/restore, CSS var application,
  options-panel swatch), same as every other user-settable box color.

**Two grid-alignment corrections found live, both against this file's own established conventions rather
than new invention**:
1. Gutter rows needed the same `quantizeToPhase` snap `updateSelectionHighlight` already applies to its
   own rects -- a raw `block.top` read isn't automatically on the grid's half-line-height phase.
2. `block.top` (CM6's heightmap coordinate) does NOT include `contentDOM`'s own CSS `paddingTop` -- the
   fixed-focus cage's top-boundary inset -- so gutter rows were short by exactly that padding, worse,
   frozen regardless of boundary drags since the heightmap term never reflected them. Fixed by adding
   `topBoundaryPxRef.current + halfLineHeightPx` (the exact same value driving the real `paddingTop`) into
   the row-position calculation, plus wiring a live recompute into the boundary-drag `mousemove` handler
   (the real content already followed the drag reactively via CSS; the gutter overlay's row positions are
   plain JS state and needed an explicit nudge).
3. The flag column's width and position needed the same "remainder into the last cell" treatment
   `alignmentPaddingBottomPx` already uses for the bottom edge, applied horizontally: the grid's box
   columns are phase-anchored from the left only (never phase-corrected against the right edge, same
   "cut-off boxes at the far edges expected and fine" as the grid overlay's own doc comment), so a flat
   one-cell-wide column almost never lands on a real box boundary. Reserves one full box + the leftover
   remainder instead, and is positioned via an explicit JS-computed `left` (a new `scrollerClientWidthPx`
   state, tracked the same way `scrollerClientHeightPx` already is) rather than `right: 0` -- a
   `right`-anchored box's edge is resolved live by the browser against the parent's actual current width
   every layout pass, while its *width* only updates when our own state does, so the two visibly drift
   apart for a few frames during a live resize.

**A separate, higher-value bug found while chasing an unrelated dev-only symptom**: editing `CM6Editor.tsx`
and triggering a Vite/React Fast Refresh hot reload while a note was open left the text rendered flush at
`(0, 0)` -- no left/top offset at all -- until the next note load happened to fix it as an incidental side
effect. Root cause: the padding-application effect (the only place in this file that imperatively mutates
`view.contentDOM.style.*`) depended only on the *computed pixel values* it writes (`halfCellWidthPx`,
`topBoundaryVisualPx`, etc.), never on anything tied to the `EditorView` instance itself. The mount-once
effect that creates the `EditorView` tore down and recreated it on the Fast Refresh remount -- a fresh,
unstyled `contentDOM` -- but none of the geometry *numbers* actually changed (same font size, same
boundary lines), so React's own dependency-array diff correctly concluded "nothing changed here" and
skipped re-running the effect, leaving the new node with no inline padding at all. **Fix**: added a
`viewMountGeneration` counter (`CM6Editor.tsx`), bumped once right after `viewRef.current = view` in the
mount-once effect, and added to the padding effect's dependency array -- forcing it to re-run whenever a
fresh `EditorView` exists, decoupled from whether the geometry values happened to also change. This closes
the whole class of bug (any future code path that recreates the view without a coincident geometry change
would have hit the same silent desync), not just the HMR trigger that happened to reproduce it reliably.

**Verification**: `tsc --noEmit` and `npm run lint` clean after every incremental change in this session.
`npm test` shows the same pre-existing 15 native-module-ABI failures as `HEAD` (confirmed via `git stash`),
none newly introduced. **Not verified live** -- this session ran without browser-preview access by explicit
user preference; the user verified visually themselves and reported back the three grid-alignment
corrections above, each fixed and re-confirmed in the same loop. Worth a normal click-through pass (toggle
the gutter, resize the pane, flag a few wrapped lines, trigger a dev-mode hot reload) before considering
this fully closed.

## `editorReadOnly` never reactively took effect post-mount -- found live while building the auto-generated cross-chapter Table of Contents feature, fixed with a Compartment

**Not part of this doc's own tracked effort** -- surfaced as a side effect of a different feature
(an auto-generated, read-only "Table of Contents" chapter that lists every heading across a note's
whole chapter family) needing the editor to actually go read-only the instant it's opened. Recorded
here per this file's own "keep it current" rule since it's a genuine CM6-internals correctness fix,
not a UI-layer bug.

**Bug**: `extensions` in the mount-once `EditorState.create()` call bakes in
`EditorView.editable.of(!editorReadOnly)` directly, with no `Compartment` -- so `editorReadOnly`
changing on an *already-mounted* section (switching from a normal note into a read-only one, or vice
versa, without a remount -- which this component deliberately never does on a note switch, see the
"mount-once" doc comment a few sections up) never reached the live view. The DOM's real
`contenteditable` stayed stuck at whatever it was the instant the section first mounted. Confirmed
live, not just reasoned about: a Playwright check driving an actual note switch into a read-only note
showed `contenteditable="true"` (should have been `"false"`) until this fix landed, and the `.editor-stage`
element was missing its `is-preview-mode` class until a *second*, unrelated fix (see below) was also in
place.

This is a **pre-existing gap**, not something introduced by the TOC feature -- `isPreviewingSnapshot`
(Time Machine preview) and `activeNoteHasDebugTag` both already fed the same broken `editorReadOnly`
prop before this fix, so switching into snapshot-preview or a debug-tagged note from an already-open
section very likely had this exact same silent failure. Worth a live check next time either of those
paths is touched, rather than assuming this fix's scope only covers the new caller.

**Fix**: wrapped the extension in a `Compartment` (`readOnlyCompartmentRef`, one per component instance,
created once via `useRef(new Compartment())`), and added a small `useEffect(() => {...}, [editorReadOnly])`
that dispatches `readOnlyCompartmentRef.current.reconfigure(EditorView.editable.of(!editorReadOnly))`
against `viewRef.current` whenever the prop changes. Placed right after the mount-once effect so
`viewRef.current` is already populated by the time this effect's own first run happens.

**Note**: `spellCheckEnabled` has the exact same mount-once-only gap one line below `editorReadOnly` in
`extensions` (`EditorView.contentAttributes.of({ spellcheck: ... })`, no compartment either) and was
**not** fixed here -- out of scope for this change, left as a separate, pre-existing finding for
whoever picks it up next rather than folded in speculatively.

**Verification**: live Playwright check (`scripts/perf/` throwaway script, not committed) driving a
real note switch into and out of a read-only note, confirming `contenteditable` flips both directions;
`tsc --noEmit` and `npm run lint` clean; full `npm test` suite (355/355) unaffected. Not run through
this doc's own full CM6 regression-script suite -- this change doesn't touch caret/selection/scroll
arithmetic at all, just editability reconfiguration, so that tier was judged disproportionate; flag
for a fuller pass if a future session touches this same compartment again.

## Chapter/TOC/heading-ID cohesion audit + fixes -- the single-note TOC toolbar button never worked on a chapter note

**Not part of this doc's own tracked effort** -- recorded here per this file's "keep it current"
rule since it's a genuine editorSection correctness fix, adjacent to the `editorReadOnly` entry
above (also surfaced by chapter/TOC work, not this doc's own scroll/caret focus).

**Context**: an audit of the just-shipped chapter/heading-ID/TOC/tab-label consolidation
(`assignedIds.ts`, `tabLabels.ts`'s `resolveIdentityLabel`, `tableOfContentsText.ts`'s
`computeHeadingAnchors`, `internalNoteLinks.ts`) found the new layer itself genuinely coherent --
one shared definition per concept, consistently consumed -- but turned up one real, live bug plus
several dead-code/duplication leftovers from the exploratory commits that built it.

**Bug (fixed)**: `useHeadlineLevelGuard.ts` enforces `CHAPTER_HEADLINE_LEVEL_RULE` on any chapter
note -- first line forced to level 2, every other heading clamped to level 3+ -- but the
single-note Table of Contents toolbar button (`useMarkdownFormattingToolbar.ts`) hardcoded its
generated block, and the title line it inserts after, at level 1/2 regardless of note type. On a
chapter, the guard silently demoted the inserted `## Table of Contents` to `###` on the very next
render, and because recognition was *also* hardcoded to level 2, the button could never recognize
its own (demoted) output as active -- `isTableOfContentsActive` stayed permanently `false` on any
chapter note, so every click inserted an unrecognized block instead of toggling one off, silently
accumulating orphaned, un-removable blocks with repeated clicks.

**Fix**: `useMarkdownFormattingToolbar.ts` now takes a `headlineRule: HeadlineLevelRule | null`
option (computed in `EditorSection.tsx` as `activeHeadlineRule`, mirroring
`useHeadlineLevelGuard.ts`'s own `chapterOnly ? CHAPTER_HEADLINE_LEVEL_RULE :
NOTE_HEADLINE_LEVEL_RULE` exemption logic verbatim so the two can't drift). Both title detection
(`findOwnTitleLineIndex`, new) and TOC-block level (`noteHasTableOfContents`,
`buildTableOfContentsInsertion`, `removeTableOfContentsAndAnchors`) now key off that rule's
`firstLineLevel`/`minOtherLevel` instead of hardcoded 1/2 -- `null` (external notes, and the
auto-TOC/auto-Open-Items synthetic chapters, which never reach this toolbar) falls back to the
exact pre-fix behavior (title = first heading of any level, block always `##`), so regular notes
are unaffected. Also folded in, while touching this file: the three duplicated helpers
(`parseMarkdownHeading`, `stripMarkdownInlineFormatting`, `slugifyAnchorId`) now import from
`tableOfContentsText.ts` instead of keeping byte-identical local copies -- the file's own header
comment already claimed this extraction had happened; it hadn't, for this file.

**Also cleaned up in the same pass** (all low-risk, verified independently): removed dead exports
with zero production callers (`increaseHeadingLevels`, `anchorizeHeadings` -- the latter's own doc
comment described a manual-anchor code path that no longer exists, both callers having moved to
`buildTableOfContentsInsertion`'s plain-list form and `slugifyAnchorId` respectively), a provably
unreachable branch in `tabLabels.ts`'s `deriveContentSnippet`, a zero-argument
`getParentTabLabel()` wrapper around a literal constant, three CSS class hooks on `ChapterBar.tsx`
pills with no matching selector anywhere, and a stale re-export in `databaseService.ts` whose own
justifying comment ("every existing call site... still imports them from databaseService.ts") no
longer matched reality. Consolidated three byte-identical `tocLine`/`groupLine`/`tocLineInStore`
outline-formatting duplicates (one per process/mock boundary: `noteLifecycleService.ts`,
`openItemsText.ts`, `installBrowserMockBridges.ts`) into one shared `formatOutlineEntryLine`
(`tableOfContentsText.ts`).

**Verification**: `tsc --noEmit` and `npm run lint` clean; full `npm test` suite 443/443 both
before and after, plus four new unit tests in `useMarkdownFormattingToolbar.test.ts` exercising the
chapter-level (`###`) TOC path specifically. A/B-verified twice that the fix's own tests actually
fail without it: once via `git stash` on the four new unit tests against the pre-fix file (all four
failed as expected), and once against a new permanent live-browser regression script
(`scripts/perf/verifyChapterTocButtonFix.mjs`) that drives the real toolbar button end-to-end --
create parent note + real chapter with headings, click insert (asserts `###`, not the colliding
`##`), click again (asserts full removal, not a second orphaned insert), click a third time and
reload the page (asserts the block and the button's active-state both survive reopening the note),
then a sanity pass confirming a regular (non-chapter) note still gets the original, unchanged
`##` behavior. All 17 checks pass with the fix in place; the same script reproduces the exact bug
(button never flips to "Remove table of contents") when run against the pre-fix file. This
change doesn't touch caret/selection/scroll arithmetic, so the doc's own full CM6
`verifyCM6*.mjs` suite was judged out of scope and not run.

---

## Render-view settle gate (note switching no longer paints unsettled geometry)

**The bug**: switching notes in render mode painted the incoming note *before* its restored scroll
position landed, so the text visibly arrived and then shuffled. Measured in the real render view
(`.render-container` without `is-pane-hidden` -- note that the preview subtree is dual-mounted and
keeps rendering while the section is in edit mode, so any instrumentation of `.markdown-preview`
must check the pane is actually the visible one first, or it measures nothing the user can see):
the new note's blocks mount while `scrollTop` is still the *outgoing* note's, and only the next
commit snaps it into place. The restore can't do better on its own -- it doesn't know where to
scroll until an async `getNoteUiState` round-trip resolves, several frames after the content is
already on screen -- and react-virtual then adds its own corrections as each block's real measured
height replaces the 56px estimate.

**The fix**: `src/editorSection/previewSettleGate.ts`, a framework-free controller that holds the
preview `visibility: hidden` (still laid out, so measurement and `scrollIntoView` behave normally)
from the moment a note switch opens a *settle generation* until two conditions both hold: the
restore has reported its scroll write applied for that same generation, and the container's
geometry signature (`scrollTop` + `scrollHeight` + the virtualizer's sizer height) has come out
identical on two consecutive samples. That fixed point is the reveal signal -- explicitly *not* a
frame count or a fixed duration, which is the pattern this replaces. rAF is the sampling point only
because that's when a frame's layout is complete; the loop reschedules for exactly as long as the
geometry keeps moving.

**Two things worth not re-discovering the hard way**:
- The safety bound is a `setTimeout`, not another rAF. A non-compositing window throttles rAF to
  zero frames, and an rAF-only bound left the preview hidden indefinitely there (found live).
- Every path out of the preview-restore effect must release the gate -- the no-persisted-anchor
  path, the already-restored early return, the error path, and effect teardown. A gate that
  outlives the operation it waits on is a blank pane.

Also replaced, in the same pass: `applyPreviewSourceAnchor`'s 10-frame rAF countdown hunting for
the anchor element. It now re-attempts on the preview's own per-commit notifications
(`usePreviewMarkdownRendering`'s new dependency-free `onPreviewCommitted` layout effect, forwarded
into the gate) -- the DOM can only have gained the element via a commit, so those are the only
moments worth re-checking. The attempt count survives purely as a safety valve. The "no follow-up
nudge, no competing scrollTop write" constraint recorded on that function is unchanged: this
changes *when* it retries, never what it writes.

**Verification**: 8 new unit tests (`previewSettleGate.test.ts`) drive the gate against an injected
clock and hand-driven geometry, covering the fixed point, the stays-hidden-until-restore-reports
rule, superseded generations, and the frames-never-arrive case. Live end-to-end in the render view:
pre-fix, the new text paints at the old note's offset; post-fix, the same switch goes visible ->
hidden at ~18ms -> revealed at ~52ms already at final geometry, with no safety-bound warning fired
(i.e. it revealed on the fixed point, not the timeout). Full `npm test` 558/558, `tsc --noEmit`
clean, `npm run lint` clean apart from one pre-existing `App.tsx:2260` unused-disable error present
on `main` before this change.

### Follow-up: the settle gate must not fire on section hibernation

**The regression** (introduced by the gate above, found by the user): switching which slot is active
made *both* panes blank briefly. Section hibernation (`useSnapshotFreeze`) freezes the section
losing active status onto an automatic snapshot and thaws the one gaining it back to live -- so a
plain activation change writes `previewedSnapshotId` in two sections at once. That's a dependency of
the gate-opening layout effect, so both sections opened a settle generation and hid their previews.

**Why it's wrong, not just slow**: hibernation doesn't change what the reader is looking at. It's
the same note at the same position, swapped between its live text and a snapshot of that same text
taken moments earlier. There is no incoming content to land, so there is nothing for the gate to
wait on -- and nothing ever reported a restore, so both panes sat hidden until the 600ms safety
timer, twice per activation change.

**The fix**: the gate-opening effect skips `beginSettle()` when `isFrozenSectionPreviewRef.current`
is set, which is exactly the "this preview is a hibernated live section, not the user browsing
history" flag `useSnapshotFreeze` already maintains (and `useNoteSnapshotTimeline` already clears
when the user genuinely navigates the Timeline). Genuine note switches and genuine snapshot
navigation gate exactly as before.

**The general rule this is an instance of**: the gate belongs on transitions that bring *new content*
into the preview. A transition that only re-labels what is already on screen must not open a
generation -- if nothing is going to scroll, there is nothing to settle, and the gate can only
subtract.

**Verification**: reproduced live first (the same note open in two slots, both in render view:
activation switch -> `visibility: hidden` on both `.markdown-preview` nodes at ~11ms, revealed at
~611ms on the safety timer, with the gate's own "revealing on the safety timer" warning logged
twice). Post-fix, the same switch produces zero hidden events and zero gate warnings, while a real
note switch still gates -- and now only in the slot whose note actually changed. Full `npm test`
564/564, `tsc --noEmit` clean. Note that in a non-compositing browser pane rAF never fires, so every
gated switch reveals on the safety timer there; that's the environment, not the gate.


### Follow-up: a duplicate restore must not supersede the one in flight

**The bug**: TOC/anchor links landed at the top of the document in edit mode. Reproducible by state,
not by target: reload while the TOC chapter is showing and the first jump works; reload while the
note itself is showing and every jump fails.

**Why the obvious suspects were all wrong**: the link resolved correctly
(`overrideSourceAnchorLine: 38`), the snapshot carried it (`scrollTopLines: 39`), and the wrapping
correction ran against the right document and computed the right answer (`correctedTo=125`,
`adapterDocLen=5949`) -- the same value the working path lands on. A runtime read then showed
`scrollTop: 0` with `maxScrollTop: 3250` against a target of exactly 3250px: not miscomputed, not
clamped, and the scroller could hold it. The correct value was being *discarded*.

**The cause**: every restore was applied twice -- two effects reacting to one activation -- and the
second supersedes the first. Superseding cancels the in-flight settle loop, and that loop is the
entire mechanism that replaces the naive line-count placement with the wrap-corrected one. Cancel it
and the naive placement stands, which in a wrapped document reads as "landed at the top". The
cold/warm asymmetry was only the ordering of that duplicate differing between the two paths.

**The fix**: `applyEditRestoreSnapshot` compares an incoming snapshot's signature (note, viewport
lines, boundary lines, anchor line, selection end, restoreFullSelection) against the in-flight one.
An identical repeat is ignored -- it is the same decision arriving twice, not a newer decision -- so
the running loop finishes. A genuinely different snapshot still supersedes, exactly as before.

**Generalize this**: supersede semantics anywhere must distinguish "a newer decision" from "the same
decision arriving twice". The first must win; the second must not cancel work already underway on
its behalf.

**Also worth keeping**: every silent `return` in a correction path cost real diagnostic time here.
`correctWrappingOnceReady` bailing on a null, and `settleCorrectionLoop`'s three unlogged exits plus
its unlogged exhaustion, were each capable of producing this exact symptom and none of them said so.
A correction that can decline to run should be able to say why under the existing debug flag.
