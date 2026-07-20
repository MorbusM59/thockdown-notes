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
3. **Then, and only then: the actual split-view UI.** Design settled (see "Design decisions:
   multi-section note targeting and the menu's new role" below for the reasoning); still to
   be planned and built:
   - Sections sit side by side separated by the app's regular 8px gap, which doubles as the
     drag handle. Each section: tag/tab bar, editor, scrollbar, Time Machine timeline +
     manual-save dot.
   - "+" button at the tab bar's right edge, present in both tag and tab mode, same visual
     language as the existing tag/tab-mode toggle at the left edge. Always creates a new
     section to the right of the one it's on. Disappears (tab bar spans full width again)
     when there's no room left for another section.
   - The left-edge button is the existing sidebar-collapse toggle **only on the leftmost
     section**; every other section shows a "close this section" (left-arrow) button there
     instead — a different button, not the same one repurposed by click type.
   - 300px minimum per section (soft — enforced at section-creation time, not live-enforced
     during resize; window resize pauses recalculation while dragging, then redistributes
     proportionally on release). Each additional section raises the *window's* minimum
     width by 300px (+ divider width), reusing the existing renderer→main IPC pattern that
     already does exactly this for sidebar visibility (`electron/main.ts`'s
     `win.setMinimumSize(...)` call keyed off a `setSidebarVisible`-style message — same
     shape, keyed off section count instead). This is what makes "forced closing" of a
     section a non-problem: the window physically cannot get narrower than what's open.
   - Section layouts persist separately from the existing UI "design" loadout system —
     `editor_sections.name`/`widthFraction` already anticipate this, including naming
     sections and saving them as collections (a stated future feature, not this pass).
   - **Real open problem, not yet designed**: every hook this effort extracted
     (`useActiveNoteId`, `useDisplayedNoteText`, `useSectionTabs`, `useDocumentFind`,
     `useNoteSnapshots`, `useEditorSectionMount`, `useSnapshotFreeze`, `useNoteSaveQueue`) is
     called exactly once in `App.tsx` today, hardcoded to `DEFAULT_EDITOR_SECTION_ID`. N
     sections needs an `<EditorSection sectionId>` component mounting its own instance of
     that whole hook stack — see "Open problem: what `<EditorSection>` actually looks like"
     below for what's resolved and what isn't.
4. **Hibernation rendering.** Inactive sections should skip wiring `onTextChange`/
   `onSelectionChange` (nothing produces those events in a pane nobody's typing in) but
   *keep* `onViewportChange` (each section keeps its own scrollbar). `Editor.tsx`'s
   `editorReadOnly` prop currently only toggles `contentEditable` and caret visibility — it
   does not yet skip attaching those bindings. New work, not something to assume already
   works. Also a real performance lever, not just correctness — see the performance section
   below.
5. **Explicitly deferred, Joe's own words, don't build unprompted**: dragging a tab between
   sections; dragging a note from the sidebar onto a specific section. (Superseded note: this
   doc used to say "sidebar always opens into the leftmost/default section for now" — that's
   now wrong, see below. The *drag-a-note-onto-a-specific-section* gesture is still
   deliberately deferred; that's a different, additional way to target a section, not how
   sidebar clicks resolve by default.)

## Design decisions: multi-section note targeting and the menu's new role

Settled during design conversation, not yet built. Two decisions, both falling out of the
same underlying principle: **there is exactly one active editor at all times (whichever had
the latest user interaction), and it is the sole authority on "the current note."**
Everything else either derives from that or must not fight it. A `#ff0000` outline around
the active section's container is the (deliberately unrefined-for-now) visual cue that makes
this legible to the user.

**1. `activateNote`/`selectNote` become per-section, not shared+parameterized.** Every piece
of state `activateNote` touches (`activeNoteId`, `activeNoteText`, the restore-snapshot
cache, `pendingViewportRestoreRef`) is already section-scoped or about to become so via
`<EditorSection>`. A shared, `sectionId`-parameterized `activateNote` would need the exact
same per-section setters/refs handed to it as arguments anyway — it would just relocate the
same per-section state one layer up and call it a parameter instead of a closure, buying
nothing. Worse, it would create a second place (alongside the already-shipped
`useSnapshotFreeze`) reaching into the same per-section state, which is exactly the kind of
seam this whole effort has been trying to design out. Each `<EditorSection>` gets its own
`activateNote`, closing directly over its own hook instances; the only thing it reaches
outward for is the shared `activeSectionId`, the same as `useSnapshotFreeze` already does.

**2. The sidebar's "open a note" action targets the currently active section, not a
hardcoded leftmost/default one.** Reasoning: the active note is *defined* as "whatever the
active editor shows." If clicking a note in the sidebar always forced it into a fixed
section regardless of which one is highlighted active, the app would have two competing,
contradictory answers to "what's the current note" — the visible outline, and a silent
hardcoded default that ignores it. That directly undermines the one thing the outline exists
to communicate. It also matters for the freeze/thaw design specifically: hardcoding the
target could reach into and mutate a section the user isn't currently driving, which is
precisely the class of "arbitrary logical intervention" freeze/thaw was built to rule out
elsewhere. Routing through the active section keeps that invariant — nothing changes except
the section you're demonstrably in control of — intact for sidebar actions too.

**3. The menu (sidebar) stops chasing the active note; it becomes a stable "file cabinet."**
With multiple sections and a tab bar, the tab bar is now what anchors "where is my note" --
the menu doesn't need to do that job too, and trying to do both jobs is exactly what made its
current logic "involved." Concretely, **this removes** the existing reactive-coupling effect
in `App.tsx` (~line 6804-6839, keyed off `isNoteDisplayedInCurrentMenu` /
`getNextActiveNoteIdAfterRemoval`) that today silently swaps the *active note* whenever the
sidebar's own filter/view state changes and the active note falls outside it (e.g. changing
the month filter while editing a note from a different month currently forces a different
note into the editor so the sidebar's highlighted item stays consistent). That's the same
"don't let browsing the menu reach into the editor" principle freeze/thaw already
established — the menu was just never brought in line with it before. After this change, the
menu only ever changes because the user directly changed it (typed a search, clicked a tag,
switched folders) or via the one deliberate exception below. It does **not** get re-scoped
per-section — it goes away entirely; there is nothing to multiply per `<EditorSection>` here.

**4. The one deliberate exception: clicking an already-selected tab "reveals" that note in
the menu.** Trigger: clicking a tab in a section's own tab bar that is already the section's
selected tab (a second click, not the first click that selected it). Scoped to whichever
note that specific section is currently showing. Full resolved algorithm:
   - Clear only whichever filter is actually hiding the note — a live sidebar/find search
     query, or a month/year filter chip — never filters that aren't in the way. (Not "clear
     everything unconditionally.")
   - Resolve the target view, in priority order:
     1. Note is deleted → switch to `trash`, select it there.
     2. Note is archived → switch to `archive`, select it there (expanding whichever
        primary/secondary/tertiary tree branches are currently collapsed so it's actually
        visible, not just present in the tree data).
     3. Otherwise (a normal note): if the *currently active* `sidebarMode` can already show
        it (i.e. we're already in `date` or `category`) → stay there, select it (in
        `category`'s case, also expanding collapsed branches as needed).
     4. Otherwise (currently in `find`/`options`/`trash`/`archive`, and the note is neither
        deleted nor archived, so none of those views can show it) → switch to `category`,
        select it there, **and** silently recompute `date` view's pagination (`currentPage`)
        so that if the user later flips to `date` view by hand, it's already on the right
        page — without actually switching to `date` now.
   - Should reuse existing code: `isNoteDisplayedInCurrentMenu`'s per-mode membership checks,
     the category/archive tree-building logic, and the date-view pagination math already in
     `App.tsx` are the same primitives the (now-removed) auto-chase effect used — this is
     mostly recombining them behind an explicit trigger instead of an automatic one, not
     writing new membership/pagination logic from scratch.

## Open problem: what `<EditorSection>` actually looks like

Flagged as "the crux of the whole feature" earlier in this effort, and the design
conversation above resolved the *policy* questions around it (per-section `activateNote`,
sidebar targeting, menu decoupling) without yet resolving the *mechanical* one: what the
component itself contains, and what stays at `App.tsx` level. Still open:

- **Bootstrap has to change shape, not just content.** The bootstrap-vs-`activateNote`
  unification already shipped (see "What's left" item 2) was explicitly a stepping stone
  toward this, not the destination: it taught bootstrap to restore *one* note's full state
  the same way `activateNote` does, but it still only ever loads *one* note into *one* set
  of top-level state, imperatively, before any `<EditorSection>` exists to own that state.
  Once sections are real components, bootstrap's job changes to: list sections
  (`window.thockdownSections.listSections()`, already implemented), determine which note
  each section shows, and let each `<EditorSection>` do its *own* entry restore on mount —
  it can no longer directly poke `setActiveNoteId`/`setActiveNoteText` etc. itself, because
  those won't be App-level state anymore once they live inside per-section hook instances.
- ~~Where "which note is section X currently showing" gets persisted isn't decided.~~
  **Resolved.** `note_tabs` stays exactly what it is today — the *pinned* tabs list only;
  browsing to a note without deliberately holding to pin it still creates no row (confirmed:
  this existing temp/pinned distinction is good, not something this effort should change).
  That means a pinned tab's row can't be the single source of truth for "the active note,"
  since the active note is very often an unpinned/temp one. So a new nullable
  `lastActiveNoteId` column goes on `editor_sections` itself instead — independent of
  whether that note happens to be pinned. Whether a given tab row renders as "the active one"
  is just `noteId === lastActiveNoteId`, computed at render time, not a stored flag — avoids
  a second copy of the same fact that could drift out of sync. Reconciled schema:
  ```sql
  CREATE TABLE editor_sections (
    id               TEXT PRIMARY KEY,
    name             TEXT,
    position         INTEGER NOT NULL,
    widthFraction    REAL,
    lastActiveNoteId TEXT REFERENCES notes(id) ON DELETE SET NULL
  );

  CREATE TABLE note_tabs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    sectionId TEXT    NOT NULL,
    noteId    TEXT    NOT NULL,
    position  INTEGER NOT NULL,
    addedAt   INTEGER NOT NULL,
    UNIQUE (sectionId, noteId),
    FOREIGN KEY (sectionId) REFERENCES editor_sections(id) ON DELETE CASCADE,
    FOREIGN KEY (noteId)    REFERENCES notes(id)            ON DELETE CASCADE
  );
  ```
  Changes from the schema currently live in `electron/databaseService.ts` (~line 2611-2630):
  `editor_sections` gains `lastActiveNoteId`; `note_tabs` gains a surrogate `id` (matching
  this file's own `ui_loadout_entries` convention: `INTEGER PRIMARY KEY AUTOINCREMENT`) and
  swaps its composite `PRIMARY KEY (sectionId, noteId)` for `UNIQUE (sectionId, noteId)` so
  the same "a note can't appear twice in one section's tab bar" invariant holds without that
  pair being the row's actual identity. No `isActive` column anywhere — deliberately not
  needed once `lastActiveNoteId` is the one source of truth. Blank-slate schema change, no
  migration path needed (same pre-beta policy as the original `editor_sections`/`note_tabs`
  addition).
- **"Chrome" outside any single section can no longer read one global `activeNoteId`.**
  Export-to-PDF/Markdown, spellcheck toggles, and any other App-level command that operates
  on "the current note" currently just reads the one `activeNoteId` local. Once that state
  lives inside per-section component instances instead of at `App.tsx` level, none of that
  chrome can reach it directly anymore — needs some form of registry/context that each
  `<EditorSection>` publishes its own `{ noteId, ... }` into, with "chrome" reading whichever
  entry matches the shared `activeSectionId`. **Confirmed to stay this shape** (global
  commands, always scoped to whichever section is active) — the registry/context mechanism
  itself is still to be designed, this just confirms the target behavior it needs to serve.
- **The existing ref-proxy workarounds (Gotcha #2) were built for exactly one call site.**
  `queueAppStateSaveRef`, `updateActiveNoteTitlePreviewRef`, `writeDebugEntryRef`,
  `activeNoteHasDebugTagRef`, and the four markdown-formatting-transform refs at the top of
  `App.tsx` exist to solve an ordering problem for a *single* `useEditorSectionMount` call.
  Some of these (markdown-formatting builders, `writeDebugEntry`) look like they're
  genuinely App-global and can stay shared, passed down to every `<EditorSection>` instance
  unchanged. Others (`queueAppStateSave`, `updateActiveNoteTitlePreview`) look more
  section-specific (a title preview belongs to one tab). Which is which hasn't been worked
  out — assuming they all generalize the same way would be a mistake.

## Performance considerations for multi-section

Not yet a problem (nothing's built), but worth designing around from the start rather than
discovering later:

- **N sections means N live Lexical editor mounts simultaneously**, not N-1 dormant
  placeholders — each with its own reconciliation, decorator nodes, custom scrollbar, and
  markdown syntax highlighting, even though only one section is ever actually being typed
  into. **Confirmed high priority, not a follow-up**: hibernation rendering (What's left,
  item 4 — `Editor.tsx` skipping `onTextChange`/`onSelectionChange` wiring for inactive
  sections) should land alongside the initial multi-section work, not after it. Every
  additional open section otherwise pays real per-keystroke/selection-event overhead for
  events nothing is listening to meaningfully, app-wide, not just in the section being typed
  in.
- **N-multiplied IPC calls on note load/switch** — `getNoteUiState`, `loadNote`,
  `getNoteSnapshots` all fire once per section on cold start / note switch. Local SQLite
  round-trips are cheap individually, but this scales linearly with section count, which
  matters more at cold start (all N sections restoring at once) than during steady-state use.
- **N independent debounced save timers and freeze-on-hibernate snapshot writes.**
  **Confirmed not a concern**: existing automatic-snapshot compaction already guards against
  this getting out of hand regardless of how much more frequently section-switching triggers
  freeze-snapshots than note-switching did — no separate mitigation needed here.
- **Divider drag must not thrash layout across N containers per frame.** CSS flex-basis/
  percentage-driven widths during drag, not per-frame JS-computed pixel widths for every
  section — the existing "resize pauses recalculation while dragging, then redistributes
  proportionally on release" plan already points this direction; worth being deliberate about
  it when this is actually built, not just an incidental consequence of however it's coded.

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

## Update: split-view is now fully built and working (handed off for bug-hunting)

Everything above describes the *plan*. As of commit `8761a85`, the plan is done — every phase
shipped, `tsc`/tests/lint clean at every step, and the core flows (create, close, drag-resize,
rename, swap) have been live-verified in `npm run dev:browser`. This section is a fresh
conversation's entry point: what exists, how it's wired, and the specific rough edges worth
hunting for next, rather than more phases to build.

**Commit sequence** (oldest to newest, all on `main`): `9063b7e` (all 16 section-scoped hooks +
`activateNote` moved into `EditorSection.tsx`, the single highest-risk step) → `32d0051`/`21f4ef5`/
`6cc8ebb`/`8057c3b` (chrome repointed through the section registry) → `7b9eae7` (bootstrap reads
`listSections()`, mounts one `<EditorSection>` per entry, CSS grid restructured into a flex row of
per-section columns) → `2fde9a2` (+/close buttons) → `cb741ab` (active-section red outline, draggable
dividers, identity tab with rename + swap-in-a-named-section) → `070145e` (fix: swapping a
*placed* section into a different slot now backfills its old slot instead of the pane count
silently shrinking) → `8761a85` (the width-resize policy rewrite below). Read commit messages in
order for the full reasoning behind each step; they're deliberately detailed.

**Where things live:**
- `src/editorSection/EditorSection.tsx` — one instance per section. Owns all 16 section-scoped
  hooks, `activateNote`, the identity-tab rename/swap-menu UI state, and self-registers into the
  registry (`sectionRegistryRef` in `App.tsx`) so chrome can resolve "the active section" without
  knowing how many exist.
- `src/editorSection/sectionRegistry.ts` — `SectionHandle` (extends every hook's result type) +
  `getActiveSectionHandle`. Chrome reads through `getActiveSection()` (imperative, ref-based) or
  `activeSection`/`activeSectionSnapshot` (reactive, for render-time reads) — never closes over
  section-owned state directly.
- `App.tsx` — `editorSections` state (the placed-section list from `listSections()`),
  `handleCreateSection`/`handleCloseSection`/`handleRenameSection`/`handleFetchSwapCandidates`/
  `handleSwapSection`/`handleDividerMouseDown`, and the `.editor-sections-row` JSX (a flex row of
  `.editor-section-slot` wrappers + `.editor-section-divider` elements, per `entry.id`).
- `src/shared/sectionWidths.ts` (+ `.test.ts`) — the pure, tested width-computation functions
  (`computeSectionWidthsForNewSection`, `computeSectionWidthsForClose`) implementing the resize
  policy below. Swap doesn't use these at all (see policy).
- `src/tabBar/SectionTabBar.tsx` — per-section tab bar: sidebar-toggle (leftmost only) /
  close-button (everyone else), tab/tag-mode toggle, identity tab (rename in place, right-click
  swap dropdown), "+" button (hidden via `canCreateSection` when there's no room for another
  300px section).
- `src/styles/layout.css` — `.editor-sections-row`/`.editor-section-slot`/`.editor-section-divider`/
  `.editor-section-column`. The old separate `tabbar`/`viewer` grid areas were merged into one
  `editor` area spanning both rows; each section is internally a flex column (tab bar fixed-height,
  editor/preview filling the rest), and N of those sit side by side in the row.

**The width/resize policy** (`src/shared/sectionWidths.ts`, confirmed correct by Joe against a
hand-worked example, unit-tested): sections size via `widthFraction` (persisted in
`editor_sections.widthFraction`) turned into a `flex-grow` weight with `flex-basis: 0`, so the
row's fixed-width 8px dividers never distort the split. On **create**, the new section (plus the
one new divider it introduces) is funded from its immediate left neighbor first, only cascading
proportionally to the *other* sections — capped at each one's own 300px minimum, re-running
against the remaining pool if a capped section's specific shortfall needs to come from elsewhere
— if the neighbor alone can't cover it; rounding overshoot grows the new section rather than
shorting anyone (total width is always exactly conserved). On **close**, the closed section's
entire width goes to its immediate left neighbor, nobody else changes. On **swap**: "dimensions
belong to the slot, not whichever section is showing in it" — swapping never creates or removes
a slot, so *no width math happens at all*; the incoming section just inherits the destination
slot's existing `widthFraction`, and a backfilled vacated slot inherits whatever width that slot
already had. Both create and close measure real DOM pixel widths via `sectionSlotElByIdRef`
(the same ref map the divider-drag handler already used) and persist the result through
`updateSectionWidths` as part of the same action — never left to CSS flex-grow to "just reflow."

**Known rough edges, not yet fixed** (flagged when built, still true):
- `editorStageRef` (App.tsx) is one shared ref across all sections, read only by a background-
  texture-sizing `ResizeObserver`. Harmless to editing/note independence, but the texture-sizing
  effect only ever tracks whichever section's stage DOM node mounted/updated last.
- `pendingViewportRestoreRef`/`isApplyingInitialViewportRef` are likewise still shared across
  sections (read by the now-largely-vestigial app-global `queueAppStateSave`), so one section's
  viewport-restore-in-progress window can transiently suppress another's save. Not a functional
  break, just an accepted simplification.
- In `npm run dev:browser` specifically, `appShellWidthPx` (the ResizeObserver-measured shell
  width driving the whole grid, including `canCreateSection`'s room check) was once observed
  stuck at a stale, too-narrow value after a sequence of interactions, hiding the "+" button
  even with plenty of actual room. Resizing the viewport by 1px didn't fix it; a full reload did.
  Never root-caused — worth a look if the "+" button vanishes unexpectedly, but may be a
  browser-mock-only artifact (no real Electron window resize events in that mode) rather than
  something that reproduces in the real app.
- Hibernation rendering (built earlier, Phase 3) has still never been exercised with real N>1
  typing load — worth confirming inactive sections actually stop wiring live-typing listeners
  now that N>1 is real, not just mechanism-in-place-but-inert.
- Cold-start restore has only been verified via full page reloads in the browser mock, not an
  actual Electron app restart with 2+ sections open.

**Verification discipline so far**: every commit is `tsc --noEmit` clean, `npm run test -- --run`
at the standing baseline (91/96 passing as of `8761a85` — 5 pre-existing failures in
`SnapshotTimelineCurve.test.ts`/`ContractBridgePlugin.test.ts`, unrelated to this effort, never
grown), and `npx eslint` on touched files shows no new problems beyond the pre-existing baseline
count. Every structural change (create/close/drag/rename/swap) has been live-clicked through in
`npm run dev:browser`, checking rendered DOM measurements and `localStorage`'s mock-store state
directly via `javascript_tool`, not just visual inspection — worth continuing that habit, since
this is exactly the class of bug (real layout/timing behavior) that doesn't show up in a
type-checker or a unit test.
