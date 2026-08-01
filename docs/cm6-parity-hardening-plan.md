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

## Phase 4 — emergent-bug hunting and CM6 hardening

Not yet started. Exercise the editor rather than reason about it — per
`docs/document-scale-performance-philosophy.md`'s process discipline, this class of work lives
or dies on live-browser verification, not code review. Natural candidates once Phase 1/2 land:
a full pass through the existing `scripts/perf/verifyCM6*.mjs` regression-script suite (18
scripts as of the last count in the handover doc) plus deliberate adversarial use (rapid
note-switching, resize-during-edit, focus/blur churn, clipboard edge cases) looking for anything
that doesn't match Lexical's prior behavior.

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
