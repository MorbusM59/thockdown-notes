# Split-View Editor Sections — Handover

Written for a fresh Claude Code conversation picking this up mid-stream. Not part of the
project's own `docs/V*` ledger (that's Joe's own versioned sequence) — this is scoped
specifically to the split-view initiative and can be deleted once that work is done and
folded into whatever the project's normal docs become.

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
UI on top. `App.tsx` was ~13,100 lines / 627 hooks when this started; it's meaningfully
smaller now and should keep shrinking.

Every patch so far has been small, independently reviewable, and verified three ways before
being handed over: `npx tsc --noEmit` clean, `npm run test -- --run` (same 5 pre-existing
failures every time, see below — never introduce new ones), and applied via `git apply
--check` against a **fresh clone of the actual last-pushed commit**, not just the working
tree. Keep doing this even with direct file access now — it's what's made ~10 sequential
patches land without a single regression.

**Pre-existing test baseline** (not yours to fix, just don't make it worse):
`src/plugins/ContractBridgePlugin.test.ts` and `src/editor/SnapshotTimelineCurve.test.ts`
have 5 failing assertions between them, present before any of this work started. Confirm
this is still the *only* thing failing after any change.

**Lint**: the whole repo has heavy pre-existing lint debt (`npm run lint` already fails
project-wide with `--max-warnings 0`). Don't use whole-repo lint as a signal. Do run
`npx eslint <files you touched>` directly — every new file added so far lints clean, and it
should stay that way.

## The core extraction trick (why every patch has been low-risk)

When state moves from a raw `useState`/`useRef` in `App.tsx` into a hook, **the hook call is
destructured into locals with the exact same names as before** (`const { activeNoteId,
setActiveNoteId } = useActiveNoteId(sectionId)` instead of `const [activeNoteId,
setActiveNoteId] = useState(...)`). Every downstream reference — JSX, other functions,
dependency arrays — needs zero changes, because the identifier resolves the same way. This
is *the* reason 40-write-site relocations (e.g. `activeNoteText`) have shipped as ~80-line
diffs instead of thousand-line rewrites. Keep using it.

**One recurring gotcha this produces**: `buildMenuStateSnapshot` (the persisted-app-state
snapshot builder) is defined early in `App.tsx`, before most of the hooks it wants values
from even exist yet (those hooks need `activateNote`/`flushPendingSaveNow`/etc. as
dependencies, which are defined later). Solution used twice already (`tabBarMode`,
`isDocumentFindCaseSensitive`): keep a `useRef` mirror updated by a small `useEffect` right
after the hook call, have `buildMenuStateSnapshot` read the *ref* instead of closing over
the hook's returned value, and drop that value from its dependency array (refs don't need
to be deps). Restoring a persisted value into a hook that's declared later works the
opposite way — a bridge `useState<T | null>(null)` set once during bootstrap, passed into
the hook as `initialX`, applied via a one-shot internal `useEffect` keyed on that prop.
Expect this pattern again for `previewedSnapshotId` and anything else already in
`PersistedMenuState`.

**Another gotcha, already resolved, don't rediscover it**: in this project's `@types/react`
(18.2.64), `useRef<T | null>(null)` resolves to `MutableRefObject<T | null>`, not
`RefObject<T | null>`. If a hook's return-type interface declares a ref field as
`RefObject<HTMLDivElement | null>` explicitly, passing it to a JSX `ref=` prop fails to
typecheck (`RefObject<T>` already bakes in `| null` per its own definition — `readonly
current: T | null` — so the extra `| null` produces a structurally-different, rejected
type). Fix: declare it as plain `RefObject<HTMLDivElement>` (no explicit `| null`).

## What's landed (chronological, all pushed to `main`)

1. **`editor_sections` + `note_tabs.sectionId` schema** — `electron/databaseService.ts`,
   `src/shared/sections.ts` (new). One seeded default section (`DEFAULT_EDITOR_SECTION_ID =
   'default'`, position 0) on fresh install. `note_tabs` primary key is now
   `(sectionId, noteId)`. Blank-slate, no migration path — pre-beta, explicitly Joe's call.
2. **`measly` → `thockdown` rebrand** — 340 replacements, 21 files, including a real file
   rename (`MeaslyTokenNode.ts` → `ThockdownTokenNode.ts`) and the `window.measlyNotes` etc.
   bridge names. Also renamed `internalId` → `assignedId` on `NoteSummary` (Joe's own
   follow-up commit, not mine — mentioned here because it caused a real regression once,
   see below).
3. **`src/tabBar/useSectionTabs.ts`** — tag bar (add/remove/rename/reorder/`$id` assignment)
   + pinned/temp tab bar, fully extracted. Pulled `isArchivedNote`/`isDeletedNote` into
   `src/shared/noteLifecycle.ts` and tag helpers into `src/shared/tags.ts` since both were
   used well beyond just the tab bar.
4. **`src/find/useDocumentFind.ts`** — query state, case-sensitivity, hit computation.
   Deliberately does *not* include jump-to-hit or replace-in-place — those reach into
   `adapterRef`/`previewScrollRef` directly and belong with the not-yet-extracted editor
   mount. `App.tsx` still owns `handleJumpToDocumentFindHit` /
   `jumpToPreviewDocumentFindHit` / `replaceDocumentFindHit` /
   `replaceAllDocumentFindHits`, reading `documentFindHits`/`documentFindDirective` back out
   of the hook exactly like before.
5. **`activeSectionId` infrastructure** (inline in `App.tsx`, not its own file yet) —
   `markSectionActive(sectionId)`, wired via `onFocusCapture`/`onMouseDownCapture`/
   `onKeyDownCapture` on `.editor-viewer-frame`. Correct today, inert today (only one
   section exists so it can never change value) — real the moment a second section exists
   to take focus away. This is the switch `useSnapshotFreeze` reads.
6. **`src/editorSection/useSnapshotFreeze.ts`** — the freeze/thaw mechanism. Read the design
   section below before touching this; the semantics took several turns of back-and-forth
   with Joe to nail down and are *not* the obvious/naive design.
7. **`src/editorSection/useActiveNoteId.ts`** — first slice of moving the note-identity state
   itself. Just `{ activeNoteId, setActiveNoteId }`, nothing else.
8. **`src/editorSection/useDisplayedNoteText.ts`** — second slice: `activeNoteText`,
   `editorTextVersion`, `latestEditorTextRef`. Still ~40 write sites across `App.tsx` all
   calling the same setter names as before, unchanged.

All of 3, 4, 6, 7, 8 are called exactly **once** today, with `DEFAULT_EDITOR_SECTION_ID`
hardcoded as the `sectionId` argument. That's intentional — see "the approach" above.

## The freeze/thaw design — read this carefully before extending it

This is the one piece of genuinely new (not relocated) behavior, and it's specifically
designed to sidestep a hard problem rather than solve it head-on. Worth understanding *why*
before changing anything here.

**The problem it avoids**: if the same note is open in two sections, keeping them in sync
live would mean either two independent Lexical `EditorState`s with real-time replication
(collaborative-editing-grade machinery), or re-cloning rendered DOM on every keystroke.
Both rejected as out of scope. Line-wrapping is computed from container width, so "the
active editor's rendered range" doesn't have a stable mapping to a differently-sized second
pane's rendered range either — that idea was explored and explicitly abandoned (see
conversation history if it resurfaces).

**The actual design**: inactive sections are never live-synced. Instead, they display a
specific **Time Machine snapshot**, using the *existing* `previewedSnapshotId` /
`isPreviewingSnapshot` mechanism (already built for manual history browsing — see
`noteSnapshots.snapshotsById.get(previewedSnapshotId)?.content`). Concretely, per section:

- **On losing active-section status**: if the section was showing live text
  (`previewedSnapshotId === null`), flush the pending save, create a snapshot through the
  *normal* `saveNoteSnapshot` path (ordinary dedup/compaction applies — nothing
  special-cased, confirmed explicitly with Joe), and set the section's `previewedSnapshotId`
  to the new snapshot's ID. If the section was *already* showing a specific historical
  snapshot (user was genuinely browsing Time Machine), there's nothing to freeze — leave it
  alone, and remember that fact.
- **On regaining active-section status**: only switch back to live (`previewedSnapshotId =
  null`) if the section was live *at the moment it lost focus*. A section that was already
  parked on a specific historical snapshot stays exactly where it was.
- **This is deliberate, not a limitation**: if the same note is open in two sections and you
  switch from a live one to another section showing the same note, that other section does
  **not** jump to live — it keeps showing whatever it's frozen at. This lets a user rearrange
  paragraphs live in one pane while comparing against / copying from a stable older version
  in the other, without the comparison text shifting under them.
- **Snapshots created this way are automatic** (`isManual: false`), explicitly confirmed —
  they're compaction-eligible like any other auto-snapshot, not pinned forever just because
  a section happened to hibernate on them.
- **Race handled**: if a section is reactivated while its freeze-snapshot IPC call is still
  in flight, the async callback checks whether the section is still inactive before applying
  the result — a fast switch-back-in wins over a slow snapshot write.

`saveNoteSnapshot`'s return type changed from `Promise<void>` to `Promise<number>` (the
resulting snapshot's ID, whether newly inserted or an existing deduped one) specifically to
support this — updated across `electron/databaseService.ts` →
`electron/noteLifecycleService.ts` → `src/shared/noteLifecycle.ts` → the browser dev-mode
mock. All pre-existing callers just `await` it and ignore the return value; nothing else
broke.

**`useSnapshotFreeze` is currently wired to the *global* `previewedSnapshotId`**, not a
section-owned one — same "correct today, inert today" situation as everything else. Moving
`previewedSnapshotId` itself into per-section ownership is explicitly the **next** piece of
work (see below), and is what turns this from "provably correct logic with only one
possible input" into something actually exercised.

## What's left, roughly in order

1. **Move `previewedSnapshotId` ownership into per-section state.** ~22 read/write sites
   (manual Time Machine browsing: clicking the timeline, the present-state circle,
   hold-to-branch, compaction handling), all deeply threaded through snapshot
   restore/branch functions that also need `activeNoteId`/`noteSnapshots`. Confirmed **not**
   referenced by `buildMenuStateSnapshot`, so the ref-mirror dance isn't needed here — one
   less thing to worry about. This is what makes `useSnapshotFreeze` genuinely
   multi-instantiable rather than provably-correct-but-untestable.
2. **Save/debounce + `applyProgrammaticEditorText`.** The riskiest remaining piece —
   `queueSave`, `flushPendingSaveNow`, `saveTimerRef`, and `applyProgrammaticEditorText`
   itself, which reaches into `adapterRef` (the `EditorAdapter` imperative handle) directly.
   Text changes flow **down** via React state/props (the `<Editor initialText={...}
   key={...}>` re-sync path — `snapshotWriteText: false` in the adapter's capabilities,
   confirmed in `docs/V2_EDITOR_CONTRACT.md`), not through the adapter. Selection changes
   flow **through** the adapter (`snapshotWriteSelection: true`). Don't conflate the two
   mechanisms when extracting.
3. **Selection tracking** — `editorSelection`, `latestEditorSelectionRef`.
4. **Viewport / edit-mode-state persistence** — `persistRenderViewStateForNoteNow`,
   `persistActiveNoteEditModeStateNow`. `noteUiStates` itself (the viewport cache) should
   stay **shared/global storage**, keyed by `noteId` — if the same note is genuinely open in
   two sections, they read/write the same note's cache entry, which is fine and arguably
   desirable. Each section's hook only reads/writes the entry for whatever note *it*
   currently shows.
5. **Rewire `useSectionTabs` / `useDocumentFind` / `useNoteSnapshots`** to source
   `activeNoteId` (and `currentEditorText`) from the fully-assembled per-section hook
   instead of the current App-level bindings. Small mechanical change once 1–4 are done, not
   before.
6. **Then, and only then: the actual split-view UI.** Draggable vertical divider, minimum
   300px per section (soft — enforced only when *creating* a new section; window resize
   pauses recalculation while dragging, then redistributes proportionally across sections
   respecting minimums on release — sections define the window's own minimum width, not the
   other way around), the "+" button at the tab bar's right edge (same visual language as
   the existing tag/tab-mode toggle at the left edge; right-click primes close, left-click
   on the "+" opens a new section to its right). Section layouts (which sections exist, their
   relative widths) persist separately from the existing UI "design" loadout system — the
   `editor_sections.name` column already anticipates naming sections and saving them as
   collections, a stated future feature, don't design that door shut.
7. **Hibernation rendering.** Inactive sections should skip wiring `onTextChange` /
   `onSelectionChange` on their `<Editor>` instance (nothing produces those events in a
   pane nobody's typing in) but *keep* `onViewportChange` (each section keeps its own
   scrollbar, confirmed as a hard requirement). Note: `Editor.tsx`'s existing
   `editorReadOnly` prop currently *only* toggles `contentEditable` and caret visibility —
   it does **not** yet skip attaching those bindings internally. That's new work, not
   something to assume already happens.
8. **Explicitly deferred** (Joe's own words, don't build unprompted): dragging a tab from
   one section to another; dragging a note from the sidebar directly onto a specific
   section to open it there (sidebar always opens into the leftmost/default section for
   now — that's the *only* sidebar-to-section interaction that exists today).

## Facts about the existing editor architecture worth knowing before you extract it

- `src/editor/EditorContract.ts` + `docs/V2_EDITOR_CONTRACT.md` already define a formal,
  documented `EditorAdapter` (imperative: `getCapabilities`/`getSnapshot`/`applySnapshot`)
  /`EditorBindings` (`onTextChange`/`onSelectionChange`/`onViewportChange`, all
  independently-optional callbacks) contract. `src/components/Editor.tsx` already takes
  `noteId`/`initialText`/`adapterRef` as props — it was already built to be
  per-note-instantiable. **This means the Editor↔App boundary does not need redesigning.**
  The work is entirely on the `App.tsx` orchestration side.
- `previewedSnapshotId: number | null` is the existing single global "am I viewing history
  instead of live" flag, `null` = live. This is the exact mechanism `useSnapshotFreeze`
  repurposes; there's no new rendering path to build for "show frozen content," only the
  per-section state ownership.

## One thing to double check on pickup

`isArchivedNote`/`isDeletedNote`/tag helpers were relocated to `shared/` during the
`useSectionTabs` extraction (step 3). Joe's own later commit renamed `internalId` →
`assignedId` on `NoteSummary` *after* that patch was generated but *before* he applied the
internal-note-linking patch, which still referenced the old field name — silent regression
(cross-note links stopped resolving) that took a dedicated fix turn to catch, since nothing
failed to compile or test. **Always re-pull and grep for the exact current field/type names
you're about to reference before extracting** — don't trust names from earlier in this
document or from memory of earlier patches without checking the live tree first.
