# Split-View Editor Sections — Handover

Written for a fresh Claude Code conversation picking this up mid-stream, ideally with direct
workspace file access (Claude Desktop's Code tab / a workspace folder attached), not the
patch-file workflow this was built with. Not part of the project's own `docs/V*` ledger
(that's Joe's own versioned sequence) — this is scoped specifically to the split-view
initiative and can be deleted once that work is done and folded into whatever the project's
normal docs become.

**This supersedes an earlier version of this file** — the extraction is now substantially
further along (the entire editor mount landed since it was first written), and one piece
previously described as an open design question (same-note-in-two-sections) is resolved and
shipped, not open.

## The goal

Thockdown Notes currently has one global editing "session": one active note, one tag/tab
bar, one Time Machine timeline, one editor. The goal is side-by-side editor **sections**
with a draggable divider — each section functionally identical to what exists today (own
tab bar, own timeline, own scroll), minimum 300px wide, as many as horizontal space allows.

## The approach, and why

Joe's framing, which everything below follows: **build a perfectly hardened, replicable
module first, then create clean instances.** Concretely — extract every per-note concern
currently living as one-off global state in `App.tsx` into a parameterized custom hook
(same shape as the codebase's own pre-existing `useNoteSnapshots(noteId, liveText, ...)`),
verify each extraction is *behavior-identical* to the single-pane app before moving to the
next concern, and only once every concern is a clean hook do we build the actual multi-pane
UI on top.

`App.tsx` was ~13,100 lines when this started. It's ~11,244 now. The extraction is
functionally **complete** — `App.tsx` no longer owns any editor-mount internals directly,
only orchestration that calls into the assembled hooks. What's left is rewiring three
already-extracted hooks to actually *read from* the assembled state (currently mechanical,
not architectural — see "What's left" below), then the split-view UI itself.

Every patch has been small, independently reviewable, and verified three ways before being
handed over: `npx tsc --noEmit` clean, `npm run test -- --run` (same 5 pre-existing
failures every time, see below — never introduce new ones), and applied via `git apply
--check` against a **fresh clone of the actual last-pushed commit**, not just the working
tree. Keep doing this with direct file access too — point it at the real repo instead of a
scratch clone, but keep the same three checks before calling anything done.

**Pre-existing test baseline** (not yours to fix, just don't make it worse):
`src/plugins/ContractBridgePlugin.test.ts` and `src/editor/SnapshotTimelineCurve.test.ts`
have 5 failing assertions between them, present before any of this work started.

**Lint**: whole-repo lint has heavy pre-existing debt, not a useful signal. Run `npx eslint
<files you touched>` directly instead. New files created during this effort are lint-clean
except for `useEditorSectionMount.ts`, which has 13 pre-existing "missing dependency"
warnings — every one individually traced back to the *original* code before extraction and
confirmed pre-existing, not introduced. Don't "fix" them reflexively; several are refs
(correctly exempt from deps by React convention) and the rest (`notes`, several state
setters, a couple of stable-identity callbacks) were already omitted in the source this was
extracted from. Changing them now would be a real behavior question, not a lint cleanup.

## The core extraction trick (why every patch has been low-risk)

When state moves from a raw `useState`/`useRef` in `App.tsx` into a hook, **the hook call is
destructured into locals with the exact same names as before**. Every downstream reference
— JSX, other functions, dependency arrays — needs zero changes, because the identifier
resolves the same way regardless of which file actually declares it. This is *the* reason
even a ~1,000-line relocation (the final editor-mount patch) shipped as a diff you could
actually review, instead of a rewrite.

**Gotcha #1 — the persisted-state snapshot ordering conflict.** `buildMenuStateSnapshot`
(the persisted-app-state builder) is defined early in `App.tsx`, before several hooks it
wants values from even exist yet. Fix used repeatedly: keep a `useRef` mirror updated by a
plain assignment right after the hook call, have the snapshot builder read the *ref*
instead of closing over the hook's value, and drop that value from the snapshot builder's
own dependency array.

**Gotcha #2 — the reverse ordering conflict, discovered late and repeatedly during the final
editor-mount extraction.** Several things the mount hook needs as *input* are themselves
defined in `App.tsx` *after* where the hook has to be called (because `activateNote`, called
much earlier, needs the hook's *output*). Three different fixes were used depending on the
actual shape of the problem — **pick the cheapest one that actually fits, don't reach for
ref-indirection by default**:
- If the dependency is itself independently relocatable (nothing between its old and new
  position needs it) — **just move it earlier.** Done for `useNoteSaveQueue` when `queueSave`
  turned out to be needed before its original position. This is the best outcome when it's
  available: zero indirection, no proxy objects, done.
- If the dependency is a plain reactive value used inside another hook's own effect
  dependency array (so it *must* trigger re-runs correctly) — **derive it internally**
  instead of injecting it, if the ingredients to derive it are already available early.
  Done for `isPreviewingSnapshot`: rather than inject the late-computed boolean, the hook
  derives it from `previewedSnapshotId !== null`, which it already has. Documented inline
  why this is equivalent to the fuller version in every real code path.
- Only if neither of those fits — **stable ref-proxy**: a `useRef` created early holding a
  no-op default, a trivial `useCallback` wrapping `.current(...)` passed into the hook as
  the "stable" value, and a **plain assignment** (not a `useEffect`) placed immediately after
  the real function's own definition, wherever that ends up. Used for `queueAppStateSave`,
  `updateActiveNoteTitlePreview`, `writeDebugEntry`, `activeNoteHasDebugTag`, and four
  markdown-formatting functions shared with toolbar buttons. Note this is arguably *more*
  correct than the original code for the cases where the original had these missing from a
  `useMemo`/`useCallback`'s own dependency array (see the lint note above) — a ref proxy is
  never stale, an under-specified dependency array can be.

**Gotcha #3 — `RefObject` vs `MutableRefObject` typing.** In this project's `@types/react`
(18.2.64), `useRef<T | null>(null)` resolves to `MutableRefObject<T | null>`. If a hook's
return-type interface declares a ref field as `RefObject<HTMLDivElement | null>` explicitly,
passing it to a JSX `ref=` prop fails to typecheck. Fix: declare it as plain
`RefObject<HTMLDivElement>` (no explicit `| null` — `RefObject<T>` already bakes that in).

## What's landed (chronological, all pushed to `main`)

1. **`editor_sections` + `note_tabs.sectionId` schema.** One seeded default section
   (`DEFAULT_EDITOR_SECTION_ID = 'default'`, position 0). `note_tabs` primary key is
   `(sectionId, noteId)`. Blank-slate, no migration — pre-beta, Joe's explicit call.
2. **`measly` → `thockdown` rebrand.**
3. **`src/tabBar/useSectionTabs.ts`** — tag bar + pinned/temp tab bar.
4. **`src/find/useDocumentFind.ts`** — query state, case-sensitivity, hit computation. Does
   *not* include jump-to-hit/replace-in-place — those needed the not-yet-extracted editor
   mount at the time and still live in `App.tsx`, reading `documentFindHits` back out.
5. **`activeSectionId` infrastructure** (inline in `App.tsx`) — `markSectionActive(sectionId)`,
   wired via focus/mousedown/keydown capture on `.editor-viewer-frame`.
6. **`src/editorSection/useSnapshotFreeze.ts`** — the freeze/thaw mechanism. **This is fully
   shipped, correct, and no longer an open design question** — see the dedicated section
   below, since a later turn nearly re-litigated it as still-open by mistake.
7. **`src/editorSection/useActiveNoteId.ts`**, **`useDisplayedNoteText.ts`**,
   **`usePreviewedSnapshot.ts`**, **`useDisplayedNoteSelection.ts`**,
   **`useDisplayedNoteRenderMode.ts`** — sequential slices moving `activeNoteId`,
   `activeNoteText`/`editorTextVersion`/`latestEditorTextRef`, `previewedSnapshotId`,
   `editorSelection`/`latestEditorSelectionRef`, and `isPreviewMode` into section-scoped
   hooks. Each shipped as its own tiny, independently-verified patch.
8. **`src/editorSection/useNoteSaveQueue.ts`** — `queueSave`/`flushPendingSaveNow` and a
   `cancelPendingSave()` (mirrors the pattern used for `cancelPendingEditUiStatePersist`
   later). Also relocated `isExternalNote`/`isSameNoteSummary` to `shared/noteLifecycle.ts`
   during this slice, since both were used well beyond just this concern.
9. **A real bug fix, unrelated to the extraction**: `handleNavigateSnapshot` never captured
   the live caret/scroll position before switching into a Time Machine preview, so "return
   to present" restored a stale position from whatever *other* event last happened to touch
   the cache. Fixed by capturing synchronously before the switch, only when actually leaving
   live editing (not when scrubbing between two historical snapshots).
10. **`src/editor/EditRestoreMath.ts`** — relocated seven pure functions and their types
    (`EditRestoreSnapshot`, `EditViewportTelemetry`, `resolveSourceAnchorFromEditState`,
    `buildEditRestoreSnapshotFromUiState`, etc.) out of `App.tsx` *before* the stateful
    editor-mount work, since both the mount hook and code staying in `App.tsx` needed them
    and duplicating ~200 lines of math was worse than a shared import. Also folded
    `isAllowedNonEditorFocusTarget` out of scope entirely during this pass — it lives near
    the editor-mount cluster but its call sites are scattered across unrelated UI, not the
    editor itself.
11. **`src/editorSection/useEditorSectionMount.ts`, part 1** — refs (`adapterRef`,
    `editModeSnapshotByNoteIdRef`, and the rest), the position-memory functions, the restore
    primitive (`applyEditRestoreSnapshot`), and the three focus functions needed to resolve
    it internally (`restoreEditorSelection`, `focusEditorInEditMode`,
    `scheduleFocusEditorInEditMode`).
12. **`useEditorSectionMount`, part 2 — the rest of it.** `bindings` (the full
    `EditorBindings` object: `onTextChange`/`onSelectionChange`/`onTabIndentTransform`/
    `onMarkdownShortcutTransform`/`onCharacterInsertTransform`/`onEnterTransform`/
    `onViewportChange`), `applyProgrammaticEditorText`, `toggleRenderViewMode`, the
    mode-toggle transition effect, the note-activation-restore effect, the preload-snapshot
    effect, the render-view scroll-restore and scroll-persist effects, the
    snapshot-preview-change effect, and `seedInitialViewport` (a genuine redesign, not a
    transplant — replaces a separate `useEffect` that used to watch a ref, with a function
    called directly from bootstrap; see Gotcha #2's first bullet for the pattern that made
    this possible, and the "known open issue" below for what's *not* yet done here).
    `App.tsx` no longer owns any editor-mount internals directly after this patch.

All of 3, 4, 6, and 7–9 are called exactly **once** today, with `DEFAULT_EDITOR_SECTION_ID`
hardcoded as the `sectionId` argument. That's intentional, matching `useNoteSnapshots`'
existing shape — see "the approach" above.

## Freeze/thaw — shipped, correct, not an open question

Flagging this explicitly because a later conversation almost re-opened it as unresolved by
mistake, checking against an outdated mental model instead of the actual shipped code.
**Only one section is ever active/live at a time, by construction** — so "two sections both
live with the same note, needing sync" isn't a case the architecture has to manage, it's a
state the architecture never allows to occur. There is no remaining seam here.

The mechanism (in `useSnapshotFreeze.ts`, using the pre-existing `previewedSnapshotId` /
`isPreviewingSnapshot` Time Machine preview machinery):

- **On losing active-section status**: if the section was showing live text
  (`previewedSnapshotId === null`), flush the pending save, create a snapshot through the
  *normal* `saveNoteSnapshot` path (ordinary dedup/compaction applies), and freeze the
  section to that new snapshot's ID. If already showing a specific historical snapshot
  (genuine manual Time Machine browsing), leave it alone.
- **On regaining active-section status**: only switch back to live if the section was live
  *at the moment it lost focus* (tracked via `wasLiveWhenLastActiveRef`, which **defaults to
  `true`** — a section that's never been hibernated behaves normally the first time). A
  section that was already parked on a historical snapshot stays exactly where it was.
- **Deliberately, not incidentally**: switching from a live section to a different section
  showing the *same* note does not jump that other section to live — it keeps showing
  whatever it's frozen at. Rearrange paragraphs live in one pane while comparing against a
  stable older version in the other, without the comparison text shifting underneath you.
- Snapshots created this way are automatic (`isManual: false`) — compaction-eligible, not
  pinned forever just because a section happened to hibernate on them.
- Race handled: if a section is reactivated while its freeze-snapshot IPC call is still in
  flight, the async callback checks whether the section is still inactive before applying
  the result.

`saveNoteSnapshot` returns the resulting snapshot's ID now (was `Promise<void>`) —
threaded through `databaseService.ts` → `noteLifecycleService.ts` → the shared IPC type →
the browser dev-mode mock — specifically to support this.

**Currently wired to the single global `previewedSnapshotId`**, same "correct today, only
exercised once section #2 exists" situation as the rest of this effort.

## What's left

1. ~~Rewire `useSectionTabs` / `useDocumentFind` / `useNoteSnapshots`...~~ **Done.** Turned
   out `useEditorSectionMount` itself has no `sectionId`-bearing output to read from — it
   only *takes* `activeNoteId`/`activeNoteText`/etc. as input, themselves produced by the
   already-section-scoped hooks (`useActiveNoteId`, `useDisplayedNoteText`, ...). The actual
   gap was narrower: `useDocumentFind` and `useNoteSnapshots` (unlike `useSectionTabs`,
   `useActiveNoteId`, etc.) took no `sectionId` parameter at all. Fixed:
   - `useDocumentFind`'s options gained `sectionId: string` (`src/find/useDocumentFind.ts`),
     unused internally for now — same `void sectionId` placeholder pattern as
     `useActiveNoteId`.
   - `useNoteSnapshots` gained `sectionId` as its new first positional parameter
     (`src/editor/useNoteSnapshots.ts`), same placeholder treatment.
   - Both call sites in `App.tsx` now pass `DEFAULT_EDITOR_SECTION_ID` explicitly.
   - New: `src/shared/assertSectionIdsConsistent.ts` — a dev-only (`import.meta.env.DEV`)
     tripwire, called once from `App.tsx` right after the three call sites, asserting the
     `sectionId` handed to `useSectionTabs`/`useDocumentFind`/`useNoteSnapshots` all agree.
     Trivially true today (same hardcoded constant three times) — the point is to catch a
     *future* second-section wiring pass that updates some of these call sites but misses
     one, which most of these hooks can't detect on their own since they don't read
     `sectionId` internally yet.
   - Note: `useNoteSaveQueue` (`src/editorSection/useNoteSaveQueue.ts`) still has no
     `sectionId` parameter at all, unlike its siblings — out of scope for this pass (not
     named in the original ask), but worth folding in whenever it's next touched.
2. ~~Bootstrap vs. `activateNote` viewport-restore unification~~ **Done** (code written; live
   cold-start testing still pending — see below). Bootstrap now fetches the initial note's
   own `getNoteUiState` (in parallel with `loadNote`, same shape as `activateNote`'s
   `Promise.all`) and builds an `EditRestoreSnapshot` via the same
   `buildEditRestoreSnapshotFromUiState` `activateNote` already uses, with the app-level
   `appState.viewport` demoted to just the `fallbackViewport` input (used only when the note
   has no saved UI state of its own yet — a brand new note, or the very first note ever
   created). Concretely, in `App.tsx`'s bootstrap effect: `loaded`/`initialUiState` now load
   together, `initialRestoreSnapshot` replaces the old viewport-only `initialViewport`, and
   `updateEditModeSnapshotCache(initialRestoreSnapshot)` is called before
   `seedInitialViewport(initialRestoreSnapshot)` — mirroring `activateNote`'s own
   `updateEditModeSnapshotCache(preloadedSnapshot)` step.
   - **The race guard is preserved, not dropped.** The obstacle found while investigating
     this (see the now-resolved-in-code version of the known-issue write-up below) was that
     `seedInitialViewport`'s `isApplyingInitialViewportRef`/`pendingViewportRestoreRef`
     guard — which stops `queueAppStateSave` from persisting a spurious intermediate
     viewport over the one just restored — isn't something `applyEditRestoreSnapshot`
     (`activateNote`'s restore primitive) carries. Resolution: `seedInitialViewport` in
     `useEditorSectionMount.ts` keeps owning that guard and its exact existing rAF-retry/
     staleness-check structure; it now takes an `EditRestoreSnapshot` instead of a bare
     `PersistedViewportState`, and its one `adapter.applySnapshot(...)` call gained
     `selection: snapshot.fullSelection` / `selectionScrollBehavior: 'preserve-scroll'` —
     same two fields `applyEditRestoreSnapshot` passes for the same call, applied through
     the guarded function instead of the unguarded one. Deliberately not a call to
     `applyEditRestoreSnapshot` itself — see the updated doc comment on `seedInitialViewport`
     in `useEditorSectionMount.ts` for why folding the two together would either lose the
     guard or force it onto a codepath (note-switching) that has no reason to know about it.
   - **Not carried over**: the `applySourceAnchorToEditor` scroll-into-view behavior
     `applyEditRestoreSnapshot` also does (scrolling to the exact paragraph a note was
     scrolled to, via DOM measurement) — left out to keep this change's surface area
     minimal and testable; `seedInitialViewport` restores viewport line-counts and full
     selection, not the source-anchor scroll nicety. Worth folding in later if cold start
     is confirmed working, but wasn't worth the added DOM-measurement risk in the same pass.
   - `tsc --noEmit` clean, tests at the standard 5-failing baseline (unchanged), lint
     unchanged (`useEditorSectionMount.ts` still exactly 13 pre-existing warnings; the
     bootstrap effect in `App.tsx` already had an intentionally-empty `[]` dependency array
     with several missing-dep warnings pre-existing before this change — two more names
     were added to that already-accepted list, nothing newly non-compliant).
   - **What's not yet verified: live cold start.** Nobody has actually launched the app from
     a clean state and confirmed a note's cursor position/scroll now survives a restart the
     way it survives a note switch. This is exactly the "no test suite exercises this" gap
     called out below — next step is Joe running `npm run dev` and checking: (a) quit/reopen
     restores cursor position and scroll, not just viewport boundaries; (b) a truly first-ever
     note (no saved UI state) still opens cleanly with the old zero-default behavior; (c) no
     regression in the existing "don't save a spurious 0/0/0 viewport during the restore
     race" protection specifically.
3. **Then, and only then: the actual split-view UI.** Draggable divider, 300px minimum
   (soft — enforced at section-creation time, not live-enforced during resize; window
   resize pauses recalculation while dragging, then redistributes proportionally on
   release), the "+" button at the tab bar's right edge (right-click primes close,
   left-click opens a new section to its right — same visual language as the existing
   tag/tab-mode toggle at the left edge). Section layouts persist separately from the
   existing UI "design" loadout system — `editor_sections.name` already anticipates
   naming sections and saving them as collections, a stated future feature.
4. **Hibernation rendering.** Inactive sections should skip wiring `onTextChange`/
   `onSelectionChange` (nothing produces those events in a pane nobody's typing in) but
   *keep* `onViewportChange` (each section keeps its own scrollbar). `Editor.tsx`'s
   `editorReadOnly` prop currently only toggles `contentEditable` and caret visibility — it
   does not yet skip attaching those bindings. New work, not something to assume already
   works.
5. **Explicitly deferred, Joe's own words, don't build unprompted**: dragging a tab between
   sections; dragging a note from the sidebar onto a specific section (sidebar always opens
   into the leftmost/default section for now).

## Resolved: bootstrap's viewport seed vs. `activateNote`'s per-note restore

**Status: code written (see "What's left" item 2 above), live cold-start testing still
pending.** Kept here for the reasoning trail, not because it's still open.

`activateNote` (stays in `App.tsx`) has its own complete per-note restore mechanism: every
note switch persists the outgoing note's position, loads the new note, builds a restore
snapshot from its saved UI state, caches it.

Bootstrap's `seedInitialViewport()` call used to be a *different*, narrower mechanism — it
only restored the app-level "last known viewport shape" (top/bottom boundary line counts)
from `window.thockdownState`'s persisted app state, not from any specific note's own saved
position (cursor, scroll, source anchor). It existed because on cold start, the editor's
viewport boundaries need *some* seed value before the first note's own restore data is even
meaningful.

The unification (bootstrap's first load becomes just another call to whatever `activateNote`
uses) was deferred initially because cold start is the hardest path in this app to verify
without actually launching it from a clean state, and getting it wrong risks "app doesn't
start," not "one feature misbehaves."

**The obstacle that made a naive version of this risky, found on a later investigation
pass:** swapping bootstrap's `seedInitialViewport` call for `activateNote`'s
`applyEditRestoreSnapshot` outright would have silently dropped a race guard that lives in a
*different* function. `seedInitialViewport` sets `isApplyingInitialViewportRef.current =
true` and `pendingViewportRestoreRef.current = viewport` before applying
(`useEditorSectionMount.ts`); `onViewportChange` only clears both once the editor reports
back a viewport matching what was seeded. `queueAppStateSave` (`App.tsx`, ~line 4607) checks
both refs and bails while they're set — this is specifically what stops a spurious
intermediate 0/0/0 viewport event, which can arrive right after `applySnapshot`, from getting
persisted over the viewport that was just restored. `applyEditRestoreSnapshot`
(`activateNote`'s restore primitive) never touches either ref — it doesn't need to, because
note-switch restores aren't behind `queueAppStateSave`'s guard the same way. Dropping this
guard would produce no compile error and no failing test — just an intermittent
lost-viewport-on-cold-start bug under real timing, the same silent-failure shape as the
`internalId` → `assignedId` incident below.

**Resolution actually shipped:** `seedInitialViewport` keeps owning the guard and its
existing rAF-retry/staleness-check structure unchanged; it now takes a full
`EditRestoreSnapshot` (built the same way `activateNote` builds one, via
`buildEditRestoreSnapshotFromUiState`) instead of a bare `PersistedViewportState`, and its one
`adapter.applySnapshot(...)` call gained `selection`/`selectionScrollBehavior` — restoring
cursor position and scroll on cold start the same way every other note switch already did,
without touching (or duplicating) the guard logic. Not carried over: the
`applySourceAnchorToEditor` scroll-into-view nicety `applyEditRestoreSnapshot` also does —
left out to keep the change's surface area minimal; can be folded in later once cold start
itself is confirmed working live.

**Live-tested by Joe, confirmed working**: typing into an existing note, closing, reopening
— caret position and scroll restore correctly, editor has focus. Creating a new note, typing,
closing, reopening — text and correct note load with caret at the right position.

**Follow-up noted, not a regression from this change, don't chase it now**: in one of two
tests of the new-note case, the editor didn't have focus and the caret wasn't visible on
reopen (fixed itself after switching notes away and back). Joe's read, and it matches: this is
a pre-existing intermittent focus/caret-visibility bug that's shown up before without
reliable repro, not something this patch introduced — bootstrap never called
`focusAfterApply`/`focusEditorInEditMode` before this change either, only
`seedInitialViewport`'s viewport (and now selection) application. Worth hardening later with
a real repro, not worth chasing blind right now.

**Second follow-up noted, also pre-existing, also out of scope for this pass**: scroll
position restores on cold start now, but as an approximation, not the exact pixel/line
position. Cause: `buildEditRestoreSnapshotFromUiState` (`EditRestoreMath.ts`) prefers the
block/paragraph-based `sourceAnchorLine` over the raw persisted `scrollTop` whenever an
anchor is available (`anchorLine !== null` branch) — likely built anchor-first to keep edit
↔ render-view scroll syncing stable across the two views' potentially different layouts, not
for the cold-start case specifically. This same function is what `activateNote` already uses
for every regular note switch, so the imprecision predates today's change entirely — it just
became visible for cold start too once cold start started reusing the same restore path.
Whether the anchor-based approach should still win when restoring the *same* view (where the
exact `scrollTop` that was captured is trivially valid) is a real, separate question — not
attempted here.

## Standing limitation, not a TODO

Every patch through this effort is `tsc`-clean and test-clean, but that's "provably not
obviously broken," not "provably correct under real timing." Focus timing, DOM measurement
races, rAF-retry timing (`seedInitialViewport`'s adapter-ready loop, `applyEditRestoreSnapshot`'s
same pattern) are exactly the category of bug that doesn't show up in a type checker or a
unit test. This isn't something to fix, it's something to keep in mind: verified in this
document's sense means "carefully traced and type/test-checked," not "watched work in the
running app." Direct file access closes part of this gap (test against the real tree
instead of a scratch clone) but not the interactive-testing part — that still needs Joe.

## One thing to double check on pickup

A field rename (`internalId` → `assignedId` on `NoteSummary`) landed *between* a patch being
generated and being applied once already, silently breaking cross-note link resolution with
no compile or test failure to catch it. **Always re-pull and grep for the exact current
field/type names you're about to reference before extracting** — don't trust names from
earlier in this document, or from memory of earlier patches, without checking the live tree
first.
