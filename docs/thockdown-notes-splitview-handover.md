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

1. **Rewire `useSectionTabs` / `useDocumentFind` / `useNoteSnapshots` to read from the
   assembled `useEditorSectionMount` state** instead of the raw App-level bindings they
   currently receive. Concretely: `useSectionTabs` at `src/App.tsx` (search
   `useSectionTabs({`) and `useDocumentFind` (search `useDocumentFind({`) both still take
   `activeNoteId` from the top-level binding rather than explicitly from "this section's
   note"; `useNoteSnapshots(activeNoteId, currentEditorText, timelineCurveConstant)` is the
   same story. Functionally identical today (there's only one section, so "the top-level
   binding" and "this section's state" are the same value) — this is about making the *seam*
   explicit before there's a second section to prove it wrong. Mechanical, not a discovery
   pass, following the same preserve-names pattern as everything above.
2. **Bootstrap vs. `activateNote` viewport-restore unification** (see the known-issue
   write-up immediately below). Explicitly deferred to here — needs live testing to attempt
   safely.
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

## Known open issue: bootstrap's viewport seed vs. `activateNote`'s per-note restore

`activateNote` (stays in `App.tsx`) has its own complete per-note restore mechanism: every
note switch persists the outgoing note's position, loads the new note, builds a restore
snapshot from its saved UI state, caches it. This is already the thing a new section would
reuse for "load a note into me."

Bootstrap's `seedInitialViewport()` call is a *different* mechanism — it restores the
app-level "last known viewport shape" (top/bottom boundary line counts) from
`window.thockdownState`'s persisted app state, not from any specific note's own saved
position. It exists because on cold start, the editor's viewport boundaries need *some* seed
value before the first note's own restore data is even meaningful.

These are two real, distinct concerns, not duplicated logic — but there's a plausible
unification (bootstrap's first load becomes just another call to whatever `activateNote`
uses) that wasn't attempted. Reason: cold start is the hardest path in this app to verify
without actually launching it from a clean state — no test suite exercises "fresh install,
empty app state, first note ever loads" — and if this is gotten wrong the failure mode is
"app doesn't start," not "one feature misbehaves." This is exactly the kind of change to
make *with* Joe driving the app interactively, not blind.

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
