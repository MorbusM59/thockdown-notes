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

### Bug 2 — caret disappears after the right-click dead-end; not restored by section-switch, only by full note reload

Two distinct mechanisms, confirmed from source, not yet live-verified end-to-end:

- **CM6's custom caret overlay is hard-gated on native DOM focus.**
  `CM6Editor.tsx:1008-1080`, `updateCaret()` line 1025:
  `if (document.activeElement !== view.contentDOM) { setCaretStyle(null); return; }`. Whenever
  focus isn't literally on `.cm-content`, the caret overlay is invisible — confirmed by contrast
  with `updateSelectionHighlight`, whose own comment (`CM6Editor.tsx:1097-1103`) explicitly notes
  it "doesn't require focus the way `updateCaret` does."
- **Right-click dead-end → focus loss, and nothing recovers it.** Per Bug 1, right-click pops the
  native context menu (no interception). Depending on how that menu returns focus,
  `document.activeElement` can end up off `.cm-content` — and `CM6Editor.tsx` never calls
  `.focus()` on its own content DOM anywhere (`grep -n "\.focus(" src/components/CM6Editor.tsx`
  → zero hits). Once lost, nothing brings it back except the user manually clicking into the
  text. **Likely resolves naturally once Bug 1 intercepts right-click properly** (the handler can
  keep/restore focus explicitly) — but confirm live after the Bug 1 fix rather than assuming.
- **A real, separate gap in the section-switch restore path.** Selection state itself *is*
  correctly restored on note switch — `adapter.applySnapshot({ selection, ... })`
  (`CM6Editor.tsx:2569-2648`) sets `view.state.selection` via `view.dispatch(...)` regardless of
  which editor is active, through the shared `applyEditRestoreSnapshot`
  (`useEditorSectionMount.ts:622-712`). But **`restorePersistedEditState`
  (`useEditorSectionMount.ts:1464-1467`) — the path taken whenever a note is opened for the first
  time this session — never passes `focusAfterApply: true`**, and `applyEditRestoreSnapshot`
  defaults that option to `false` (line 623). So nothing calls `.focus()` on the editor on that
  path, `document.activeElement` stays wherever the user last had it (e.g. a sidebar button), and
  `updateCaret()` keeps the overlay hidden until a manual click. Contrast: the synchronous
  "click a different note in the sidebar" path (`EditorSection.tsx:366-465` →
  `useEditorSectionMount.ts:1425-1433`) *does* pass `focusAfterApply: true` and should work.
  **Fix**: either pass `focusAfterApply: true` from `restorePersistedEditState` too, or make
  `applyEditRestoreSnapshot`'s default `true` and opt out the few callers (Time Machine preview,
  `ZERO_EDITOR_SELECTION` paths) that deliberately don't want focus stolen. Decide which by
  checking what Lexical's `Editor.tsx` did on the equivalent path before this migration — that's
  the actual parity bar, not a guess.
- **Why a full page reload "just works" wasn't confirmed from source** — the cold-boot path
  (`seedInitialViewport`, `useEditorSectionMount.ts:1726-1767`) also never calls `.focus()`.
  Working theory, not verified: after reload the user naturally clicks into the note to start
  typing, which focuses `.cm-content` via ordinary click-to-focus (correctly routed today since
  CM6's contentDOM carries the shared `editor-text` class, `CM6Editor.tsx:1516` — confirmed
  already fixed, don't re-flag), whereas a sidebar switch doesn't require any click inside the
  editor. Confirm this live before writing it into a fix's justification.
- **Named, acknowledged gap already in the source, independent of the above**:
  `CM6Editor.tsx:2040-2047`'s own comment states the port of `CagedScrollPlugin.tsx`'s
  `handleKeyUp`/`handleWindowBlur`/`handleVisibilityChange` only covers page-scroll-relevant
  parts, explicitly excluding "caret-refocus state not yet ported." Worth checking whether this
  is actually the same underlying gap as the bullet above before building two fixes for one bug.

### Bug 3 — caret jumps back to document start (offset 0)

Concrete fallback-to-zero site found, shared by both editors (not CM6-specific):
`src/editor/EditRestoreMath.ts:165-198`, `buildEditRestoreSnapshotFromUiState()` — line 184
defaults `persistedCursor` to plain `0` whenever `overrideCursorPos`/`uiState?.cursorPos` isn't a
finite number (i.e. whenever `window.thockdownNotes.getNoteUiState()` returns
`null`/`undefined`/malformed — new note, an IPC race, or a caught failure). This function is
called from five sites — `useEditorSectionMount.ts:1293`, `:1335`, `:1385`, `:1455`, and
`EditorSection.tsx:393` — i.e. essentially every restore path funnels through this one fallback.
**Fix direction**: don't silently default to 0 on a missing/malformed UI-state read; distinguish
"genuinely a brand-new note" (0 is correct) from "failed to read persisted state" (should
preserve whatever the DOM/editor currently shows, or retry, not silently relocate the user's
cursor). Needs a decision on which of the 5 call sites can tell those two cases apart today and
which can't.

Two *intentional* zero-resets exist and must not be conflated with the bug above:
`ZERO_EDITOR_SELECTION` (`EditRestoreMath.ts:21`) used for entering a Time Machine snapshot
preview (`useEditorSectionMount.ts:1658-1663`, "no saved cursor of its own, show from the top")
and the fallback when leaving preview back to a note with no cached edit-mode state
(`:1671-1679`), plus one analogous use in `useNoteSnapshotTimeline.ts:252-253`. These are product
behavior, not the bug being chased.

No "brittle" comment/TODO exists in-repo — that word is the user's own characterization, not a
quoted source finding. Treat the fallback above as the concrete substance behind it, but stay
open to more sites turning up once this is exercised live (Phase 4's job, not this one).

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

Not yet inventoried. Bug 1 above (right-click scope-cycling) is the first confirmed item in this
bucket — a real Lexical feature with zero CM6 equivalent, not a bug in the usual sense. Before
starting broader work here: build an actual checklist by diffing `Editor.tsx`'s feature surface
(every `domEventHandlers`/keymap entry, every plugin it mounts) against `CM6Editor.tsx`'s, the
same way the Bug 1 investigation did for right-click specifically — rather than waiting for users
to report gaps one at a time. `EditorContract.ts`'s own doc comment ("implementations may be
partial while the rewrite is in flight") is the authoritative list of what was *known* incomplete
at flip time; cross-check against it first since it may already enumerate gaps nobody's hit yet.

## Phase 3 — performance-effort loose ends (concrete candidates already found)

From the historical sweep (see the conversation this doc was written from, or re-derive via
`docs/large-document-performance-handover.md`) and the Phase-1 research pass:

- **`LexicalRopeSync` is Lexical-only, and CM6 doesn't need it — confirmed, not assumed.**
  CM6's own `EditorState.doc` (a `@codemirror/state` `Text`) is already a real tree/rope
  (`TextLeaf`/`TextNode` classes in `node_modules/@codemirror/state`, structural-sharing
  `replace`/`slice`/`lineAt`), which is exactly the property `LexicalRopeSync` was built to
  retrofit onto Lexical, which has no native rope of its own. `LexicalRopeSync` is wired into
  Lexical's hot path only (`ContractBridgePlugin.tsx:213`/`:499-500`,
  `NoteTextHydrationPlugin.tsx:161`/`:190-191`) and is never imported by `CM6Editor.tsx` or
  anything it depends on. **This answers the "does CM6 replace the need for it" question: yes,
  structurally, for CM6 specifically** — CM6 already has what the rope was for. `LexicalRopeSync`
  remains real, working infrastructure for the Lexical *rollback path* only. Decide explicitly:
  keep it as rollback-path insurance (current state), or let it go if/when the Lexical fallback
  is ever retired — don't leave this as an implicit, undocumented state.
- **The rope-wiring commit's own measured 1M-char regression (~8x, see the sweep data) was never
  actually fixed on the Lexical side — it was sidestepped by the CM6 flip.** If the Lexical
  rollback (`localStorage['thockdown:cm6-editor-spike'] = '0'`) is ever used in anger — which per
  the above is the one scenario where `LexicalRopeSync` still matters — that regression is
  presumably still live today, unmeasured since. Before trusting the rollback path as a safe
  fallback, re-measure it (the sweep harness at `scripts/perf/measureRepeatedBursts.mjs` +
  `perfHarness.mjs` already does exactly this, just needs pointing at the Lexical path
  specifically, e.g. via the existing localStorage flag).
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
from the historical performance sweep. **Bug 1 (right-click selection-scope cycling) fixed and
verified** — see its section above for the fix shape; verification was `npx tsc --noEmit` clean,
`npm run lint` clean, `npm test` 251/251, and the full existing `scripts/perf/verifyCM6*.mjs`
regression suite (21/21 including the new `verifyCM6RightClickSelectionScope.mjs`) all passing
after the change, plus a fresh live-browser functional check of the new behavior itself.

**Next up, in priority order per the phase list above**:
- Bug 2 (caret disappearing after right-click dead-end / not restored on section-switch) — the
  right-click-specific half of this may already be resolved as a side effect of Bug 1 (the
  contextmenu handler now intercepts the event instead of falling through to the native menu),
  but that's not yet confirmed live — check first before writing new code for it. The
  section-switch `focusAfterApply` gap in `restorePersistedEditState`
  (`useEditorSectionMount.ts:1464-1467`) is a separate, still-open fix.
- Bug 3 (caret resets to offset 0) and Bug 4 (Enter double line break — needs live reproduction
  attempt first, static analysis argues against it existing as described) are both still open.
- Phase 2 (parity inventory) hasn't been started structurally — Bug 1 was the first item found by
  investigation, not by a systematic Editor.tsx-vs-CM6Editor.tsx feature diff; that diff still
  needs doing.
