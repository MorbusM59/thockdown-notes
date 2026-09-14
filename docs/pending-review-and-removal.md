# Pending review and removal

A parking place for machinery that looks like it no longer earns its keep, found
while doing something else.

## Why this exists

The expensive failure mode in this codebase is not a bug, it is a *layer*: a fix
that moved a problem rather than solving it, then a second fix on top of the
first, then the original cause getting solved somewhere else entirely — leaving
two mechanisms nobody dares touch because nobody can say what they still do. The
preview's fitted height model was three such layers deep before it was deleted,
and the defect that actually mattered (a completed survey being thrown away one
frame later) had been hiding *behind* one of them for months.

Noticing that is cheap and happens constantly. Acting on it is not: proving a
mechanism is dead means finding every caller, understanding what it was for, and
verifying nothing regresses without it. That is a whole task, and doing it in the
middle of another one is how a two-hour job becomes a day.

So: **write it down here and keep going.** The list is what makes a dedicated
cleanup mission possible later, with its own budget, instead of a permanent slow
leak of half-investigated suspicions.

## What belongs here

- Machinery that appears to have been superseded but is still wired in.
- Corrections that exist to compensate for a problem that has since been fixed at
  the source.
- Caches, fallbacks, and defensive branches whose triggering conditions may no
  longer be reachable.
- Type/state distinctions that survived the thing that made them meaningful.
- Anything where the honest note is "I could not tell whether this still does
  something, and finding out was not this task's job."

## What does NOT belong here

- **Bugs.** Something that is wrong goes in `TODO.md` or gets fixed. This list is
  for things that may be *pointless*, not things that are broken.
- **Dead code you just wrote.** If it is yours and it is unused, delete it now —
  that is a one-line judgement, not a mission. Three unused members of
  `PreviewWindowApi` were removed on the spot rather than listed here, and that
  is the standard.
- **Style preferences.** "I would have written this differently" is not a removal
  candidate.
- **Anything you have already proven is dead.** Remove it and say so.

## How to write an entry

Four things, and the last one is what makes the list usable months later:

1. **What** — the symbol, file, and what it currently does.
2. **Why it is suspect** — what changed that might have made it redundant.
3. **What would have to be true to remove it** — the condition a cleanup mission
   has to verify. This is the actual work, stated in advance.
4. **Where it was noticed** — so the reasoning can be recovered from that
   session's own notes.

Delete entries when they are resolved, in either direction: removed, or
confirmed load-bearing (in which case the finding belongs in a doc comment on
the code itself, so the next reader does not re-suspect it).

---

## Open entries

### Legacy data migrations and upgrade paths — pre-release inventory

**What.** Code that exists only to read or upgrade data written by earlier
builds. The app has never been released, so none of it protects a real user; the
goal is a first release without this baggage. (The typography key migrations —
font size and line spacing — were already removed on 2026-09-11.) Grouped by
where the data lives; line numbers are approximate, as of that date.

*Settings file (app state):*
- `stateService.ts`, texture materials (~288): an old single `editorStage`
  texture key is split into `editorEditText` / `editorRenderText`.
- `stateService.ts` (~475) and `appState.ts` (~216): the pre-curve-model render
  smooth-scroll keys, still read as a fallback.
- `App.tsx` hydration (~6707): `reviewFlagsVisibleBySection` seeded from the old
  combined `reviewGutterVisibleBySection`, for states saved before the
  line-number / review-flag split.
- `App.tsx` hydration (~6767): the app-wide `selectedNoteId` from before split
  view.

*Layout presets (loadouts / `.tdl`):*
- `databaseService.ts` (~509–547) and `App.tsx` (~927–948): the old single
  `selection` and `textEmboss` highlight colours, split into edit / render (/ UI)
  variants. Two copies — remove them together.

*Database schema:*
- The `ensure…Column` helpers in `ensureSchema` (~4181–4291). **Checked, not
  assumed:** 10 of the 21 columns they add are already in their `CREATE TABLE`
  (notes: `sourceAnchorLine`, `sourceAnchorText`, `contentChecksum`,
  `previewBlockCache`; `note_snapshots.isFromDisk`; editor_sections:
  `lastActiveNoteId`, `fixedWidthPx`, `noteSlotInitialized`;
  `note_tabs.lastActiveChapterNoteId`; `chapters.chapterId`) — for those the
  helper is pure upgrade code. **11 are ALTER-only** — notes: `assignedId`,
  `anchorBlockIndex`, `chapterOnly`, `isAutoToc`, `isAutoOpenItems`,
  `isTimeless`, `detachedChapterParentId` / `Position` / `ChapterId` /
  `Sequence`; `note_snapshots.anchorBlockIndex`. A fresh install gets those ONLY
  through the ALTER, so those helpers are currently load-bearing, not legacy.
- `migrateMusicSongsSlotRange` (~3903): rebuilds `music_songs` to widen the slot
  CHECK for the sixth (Lounge) bucket.
- Editor-slot seeding (~4308): moves widths off `editor_sections.widthFraction` /
  `.fixedWidthPx` onto `editor_slots`. Those two section columns are kept but no
  longer written (~2529, ~4180: "retiring columns without a drop-column
  migration").
- `migrateChaptersToSingleParent` and `migrateChapterTagsToParent` (~4394,
  ~4420).

*Note content:*
- `parseLegacyMetadata` (~361, used ~899): reads a legacy metadata header (tags)
  out of `.md` files.
- `readStoredNoteContent` (~2270): falls back to snapshots for a note last
  written before content was stored.
- `EditorSection.tsx` (~832–852): backfills the from-disk baseline for an
  external note from before baselines existed.
- `useMarkdownFormattingToolbar.ts` `unwrapLegacyAnchorHeading` (~148–180):
  cleans out TOC blocks and anchor-linked headings from before the TOC stopped
  linking.
- `App.tsx` (~863) and `EditRestoreMath.ts` (~147–156): converts a pixel scroll
  position from the legacy per-note SQLite `scrollTop` column. Check whether
  this is still live before treating it as a migration.

*Mirrors:* `installBrowserMockBridges.ts` (~141, ~354) reproduces some of the
above for browser mode, and goes with them.

**Not baggage — keep.** Listed so a cleanup does not mistake them:
- `sanitizeDatabase`'s startup repairs: the search-index dedupe (~1024), the
  repair of ids links cannot express (~1074), the guide re-seal (~1176), and the
  missing note-id / chapter-id backfills (~1129, ~1211). They are idempotent and
  also repair restored, copied and synced databases, not only upgrades — their
  comments mention upgrades, but the passes stay. So do their tests
  (`databaseService.assignedIds.test.ts`).
- Wording only: "legacy proportional split" (`slotWidths.ts` and its tests,
  `App.tsx` ~7071) names a live fallback algorithm; the "CM6 migration" comments
  (`EditorContract.ts`, `CM6Editor.tsx`) are history, not data paths.

**Why it is suspect.** Pre-release: no install predates the current formats
except the developer's own, which has already run every one of these by running
current builds.

**What would have to be true to remove it.**
- Per item: the developer's own database and app state are already in the
  current format (they are). Then the reading code goes, together with the tests
  that exercise it — the migration cases in `databaseService.chapters.test.ts`
  and `databaseService.music.test.ts`, and the pre-feature TOC case in
  `useMarkdownFormattingToolbar.test.ts`.
- Schema, in this order: FIRST fold the 11 ALTER-only columns into their
  `CREATE TABLE` statements, THEN delete the `ensure…Column` helpers. Deleting
  them first breaks every fresh install. The retired `editor_sections` width
  columns can then leave `CREATE TABLE` too.
- After each removal: a fresh install (empty data root) builds the full schema
  and starts, and a restart round trip still holds.

**Noticed.** 2026-09-11, while removing the typography legacy migrations at the
user's request. Purging the rest was explicitly out of that day's scope; this
inventory is the handover for the mission that does it.

### `landOnDocumentEnd` — the 40-frame end-of-document correction

**What.** `usePreviewScrollbar.ts`'s `landOnDocumentEnd` / `landOnDocumentEndAfterJourney`:
a `requestAnimationFrame` loop, up to 40 frames, that forces `scrollTop` to the
maximum after a journey aimed at the end of the document, standing down if the
reader takes over.

**Why it is suspect.** Its own comment says it exists because a journey aimed at
the end could land at 19% of the document — a symptom of pixel targets computed
from estimated heights. Neither surviving path has that problem now: a windowed
document re-anchors onto the target block and lands exactly, and a continuous one
has every height measured. It may now be a correction with nothing left to
correct.

**What would have to be true to remove it.** That a track click at the very
bottom, and a Ctrl+End-style journey, land flush on both paths with the loop
removed — on a slow machine, where the original defect was worst.

**Noticed.** The windowing round; the audit that preceded it classified this as
"needs a real answer" and it got the minimum one (ask the document for its end
rather than the scroller's).

### The pixel fallbacks in the preview scrollbar

**What.** Four sites in `usePreviewScrollbar.ts` that compute a ratio or a target
from `scrollTop / (scrollHeight - clientHeight)` when the document-position API
has not answered: the `provisionalRatio` for thumb size, the `scrollRatio`
fallback, and the fallbacks in `jumpToRatio` and `goTo`.

**Why it is suspect.** They are described as "for the one frame before it can
answer at all -- not a second opinion". On a windowed pane those numbers describe
the mounted run rather than the document, so if one of them ever *does* fire, it
is wrong rather than approximate. Whether any of them is still reachable is
unknown.

**What would have to be true to remove it.** That the position API is non-null
for every frame in which the thumb is drawn, on both paths, including the first
frame after a note switch and after a mode toggle.

**Noticed.** The pixel-space audit before the windowing build.

### The scrollbar right-hold thumb watcher

**What.** `usePreviewScrollbar.ts`'s `watchThumbReachesCursor` recomputes the
thumb's position from `scrollTop / maxScrollTop` on every frame of a right-button
track hold, to decide when the thumb has reached the cursor.

**Why it is suspect.** It is a *second* implementation of thumb position, and it
disagrees with the real one — the thumb it is watching is placed from character
space. On a chunked document the two now describe different things entirely.

**What would have to be true to remove it.** That it can ask
`previewDocumentPositionRef` for the ratio it already publishes instead of
deriving its own, with the hold still releasing at the right moment on both
paths.

**Noticed.** The pixel-space audit; flagged as already-inconsistent and not fixed
during the windowing build.

### `surveyByGeometryRef` — the completed-survey cache

**What.** A 4-entry LRU in `usePreviewMarkdownRendering.tsx` keyed by geometry
signature, holding every block height a completed survey measured, so returning
to a geometry costs nothing.

**Why it is suspect.** It is cleared unconditionally on every note switch, so it
only ever pays off for toggling a setting back and forth *within one note*. Its
sibling, the fitted-model cache keyed the same way, is already gone. The survey
now runs only on continuous documents, which are the cheap ones to re-run.

**What would have to be true to remove it.** A measurement of what a re-survey of
a sub-50k document actually costs on a slow machine, against the complexity of
keeping the cache correct.

**Noticed.** The windowing round.

### `surveyModeRef`'s two-valued type

**What.** `const surveyModeRef = useRef<'idle' | 'calibrating'>('idle')`.

**Why it is suspect.** 'calibrating' meant "fitting a model from a sample" as
opposed to "measuring the whole document". There is only one mode now. The name
and the union both describe a distinction that no longer exists.

**What would have to be true to remove it.** Confirm nothing reads it for control
flow, then delete it or rename it to what it actually tracks (whether a survey is
in flight).

**Noticed.** Deleting the chunked virtualizer.

### `readLineMetrics`' `charsPerLine`, for the preview

**What.** `readLineMetrics` in `usePreviewMarkdownRendering.tsx` derives a
per-line character capacity from the typography probe as
`probeTextLength / probeLines`, and `countWrappedLines` turns it into a per-block
line estimate.

**Why it is suspect.** It is wrong twice over (an average is not a capacity --
102.5 measured against a real capacity of at least 127; and the blank separator
line absorbed into each block's text is counted as a rendered line), and its last
two consumers have both left. Block layout no longer depends on it now that
measured heights survive, and the chunked thumb is sized from measured character
density. What remains is the continuous path's first-frame estimate and
`ratioForSourceLine`'s guard.

**What would have to be true to remove it.** That the continuous path's first
commit looks acceptable without a per-block estimate at all (it has real heights
within a second), and that `ratioForSourceLine` can answer from measurements
rather than gating on line metrics. Otherwise it should be FIXED rather than
removed -- measure average character advance from a `white-space: pre` ruler and
divide the column width by it.

**Noticed.** Diagnosing the paragraph-spacing defect, then again when the thumb
moved to characters.

### `invalidatePreviewVirtualizerMeasurementsAfterIndex`

**What.** A helper that reaches into react-virtual's internals —
`measurementsCache`, `itemSizeCache`, `pendingMin`, `laneAssignments` — to
invalidate measurements after a given index following a local edit.

**Why it is suspect.** It is the source of the repository's one standing
TypeScript error (the private-shape cast no longer matches the library's types),
which means it is also the thing that keeps `tsc` from being clean. Whether the
partial invalidation it performs is still needed, now that only continuous
documents use the virtualizer, is unknown.

**What would have to be true to remove it.** That a local edit to a sub-50k
document re-measures correctly without it — or that a supported API now covers
what it was reaching in for.

**Noticed.** Every `tsc` run this session.

### `previewSettleGate`'s geometry signature

**What.** `previewSettleGate.ts` decides the preview has settled by watching
`scrollTop | scrollHeight | sizerHeight` hold still.

**Why it is suspect.** All three legitimately change on a windowed pane every
time the window shifts, which is constantly. The gate has not been re-examined
against that, and it controls whether the pane is visible during a restore — so
if it is wrong, the symptom is a preview that stays hidden.

**What would have to be true to remove it (or fix it).** Establish whether the
gate still fires correctly on a windowed document, and if not, what "settled"
should mean for a pane whose geometry never stops moving.

**Noticed.** The windowing build; listed as a known-unexamined risk when it
shipped.

### CM6Editor's same-note branch of the React→CM6 sync effect

**What.** The `else` branch of the note-switch hydration effect in
`CM6Editor.tsx` — the one that computes a minimal replacement and overwrites
the *live* document with React's view of it. Its own comment describes it as
existing for "transient mismatches" between `initialText` and CM6's document.

**Why it is suspect.** It is a correction path that writes over the editor's
own state, and nobody knows how often it actually fires. During the session
that made this effect read `previousTextRef` instead of rebuilding the
document, `computeMinimalTextReplacement` remained in the profile at ~54ms
per 10-keystroke run — but that function has a second per-keystroke caller
(`trackWordCount` via `WordCount.ts`), and the two were never separated. So
the branch may be running on every keystroke, or never. Both are worth
knowing: if it runs constantly, React and the editor are disagreeing about
the document on every keypress and the real defect is upstream; if it never
runs, it is a fallback whose trigger no longer exists.

**What would have to be true to remove it.** Instrument the branch (a counter,
not a profile attribution) across a real typing session and a note switch. If
it never fires, the same-note path can early-return and the branch goes. If it
does fire, find out what makes React's view diverge and fix that instead —
overwriting the live document is a symptom fix.

**Noticed.** While removing the per-keystroke `doc.toJSON().join('\n')` from
that same effect.

### CM6Editor's passive scrollbar-sync rAF loop

**What.** `runPassiveSync` in `CM6Editor.tsx` — an unconditional
`requestAnimationFrame` loop, started on mount and never stopped, that reads
`scrollTop`, `scrollHeight`, `clientHeight` and the track's `clientHeight`
every frame and re-syncs the custom scrollbar when any of them changed. Its
own comment says it exists to catch "anything those miss (e.g. scrollHeight
drift from an async font load reflow)".

**Why it is suspect.** It is a 60Hz poll standing in for events that exist. Of
the four values it watches, `scrollTop` already has a scroll listener,
`clientHeight` is already covered by the ResizeObserver on `view.scrollDOM`,
and the two genuinely unwatched ones — `scrollHeight` and the track height —
would be covered by observing `view.contentDOM` and the track element. So the
poll is a stand-in for two missing `ResizeObserver.observe` calls.

Measured cost is modest and should not be oversold: ~55ms of self-time across
a 5.8-second typing profile, roughly 1% of a core, continuous, whether or not
anything is happening. It reads layout every frame, but in practice the caret
update's own rAF has usually already flushed layout in the same frame, so it
is probably not adding a forced reflow on top — that was assumed and then
reasoned away, not measured.

**What would have to be true to remove it.** Two things, and the second is the
reason this was parked rather than done. First, establish that a
ResizeObserver on `contentDOM` plus one on the track really does fire for
every case the poll catches — the font-load reflow it names, and whatever
else went unnamed. Second, replace what the loop is *also* quietly doing:
it reads `viewRef.current` each frame and simply retries when the view or
track is not mounted yet, so it doubles as the mount-readiness wait. An
effect that runs once needs that handled explicitly.

Verify against the live scrollbar scripts (`verifyPreviewCharThumb`,
`verifyScrollbarSemantics`, `verifyEndOfTrackClick`, `verifyScrollSync`), not
by reasoning — this surface has a documented history of races where the thumb
stays hidden at 0/0.

**Noticed.** Auditing what remains per keystroke after the input-pipeline
rebuild; it showed up as continuous background cost rather than keystroke cost.

### findOwnTitleLineIndex scans the whole note when there is no title

**What.** `findOwnTitleLineIndex` in `useMarkdownFormattingToolbar.ts` looks
for the note's own title line -- the first heading at `titleLevel` -- by
walking every line and running `parseMarkdownHeading` on each. A note whose
first line is not a level-1 heading has no title, so the search finds nothing
and scans to the end.

**Why it is suspect.** `noteHasTableOfContents` calls it on every keystroke
(that call has to stay live -- it decides whether the toolbar button inserts
or removes), so a titleless note pays a full-document heading scan per
keypress. Measured at ~1.05ms per keystroke on a 400,000-character note after
the surrounding work was fixed; it would be roughly 4ms at 1.5M.

**What would have to be true to fix it.** `NOTE_HEADLINE_LEVEL_RULE` says only
the first line may be a level-1 heading, and `useHeadlineLevelGuard` enforces
that on every edit -- so in a well-formed note the search could stop at the
first heading of any level: if that one is not the title level, there is no
title. Confirm that the guard really does hold for every note that reaches
here (imported notes, chapter families, notes edited before the guard existed)
before relying on it, because the early exit changes the answer for a note
shaped `## A ... # B`, where the current code returns the later `# B`.

**Noticed.** Profiling a note with a table of contents, after the regeneration
effect that dominated it was fixed.

### AccordionSection's `forceOpenNonce` now has no callers

**What.** `AccordionSection` (`src/components/AccordionSection.tsx`) accepts a
`forceOpenNonce` prop: bumping the number force-opens the section, so a
control elsewhere in the app can send the user to a collapsed settings
section already unfolded. It had exactly one user -- the music player's
headphones button, which opened the sidebar's Options panel with the Music
accordion forced open.

**Why it is suspect.** The music player now owns its volume and reverb
controls directly (its headphones button swaps its own bottom row instead of
opening the sidebar), so the Music accordion is gone and with it the only
caller. The prop, its `useEffect`, and the "clear the one-shot intent when
leaving options mode" reset it needed in `App.tsx` are all now unexercised
machinery kept alive only by the component's own signature.

**What would have to be true to remove it.** That no other feature is about
to want "deep-link into a collapsed settings section" -- it is a reasonable
generic capability for a settings panel, and the next feature that needs it
would rebuild the same thing. Either find a second caller and keep it, or
confirm none is planned and delete the prop with its effect; do not leave it
half-alive.

**Noticed.** Moving the music volume/reverb sliders out of the options menu
and into the player's own sound-options row.

### `previewMeasurementPrewarm.ts` is gone but is still cited by five places

**What.** Three live code comments and two perf scripts point at
`src/editorSection/previewMeasurementPrewarm.ts`, which no longer exists (it
went with the virtualizer): `usePreviewMarkdownRendering.tsx:89` (a
`/** Progress of the background block survey */` doc line attached to
`OpenItemsToggleStore`, which is not that and never was),
`usePreviewMarkdownRendering.tsx:1207` (a section banner over what is now
just `spacerRef`/`charRulerRef`), `styles/components/editor.css:773` (the
"discovery progress" bar's own comment), and
`scripts/perf/measurePreviewSurveyThroughput.mjs` /
`scripts/perf/verifyPreviewPrewarmSafety.mjs`, both of which measure a survey
that no longer runs.

**Why it is suspect.** A survey exists to guess heights for blocks that are
not mounted. The continuous pane mounts every block and reads the browser's
own geometry; the windowed pane has no whole-document height for a survey to
be right about. So the mechanism has no remaining purpose in either pane --
which raises the real question the comments obscure: is the *discovery
progress bar* in the timeline slot still reachable at all, and if not, that is
a piece of UI plus its CSS plus its state that should go with the scripts.

**What would have to be true to remove it.** That nothing still drives the
discovery-progress UI (trace its state back to a producer that actually
fires), and that neither perf script measures anything a live pane still does
-- `measurePreviewSurveyThroughput` in particular is only meaningful if some
survey still has a throughput. Then delete both scripts, the CSS block, the UI,
and correct the two code comments. Do NOT merely repoint the comments at
another file: half of what they describe is the thing that should be deleted.

**Noticed.** Rebuilding the render view's page-margin and landing rules, where
the same removal had also left a dead `.preview-prewarm-first-block` selector
in `markdown.css` (deleted in that change).

### `PreviewScrollToSourceLineFn`'s `align` option is never read

**What.** The `align?: 'start' | 'center'` option on
`PreviewScrollToSourceLineFn` (`usePreviewMarkdownRendering.tsx`) is passed by
callers -- the restore passes `'start'`, find navigation passes `'center'` --
and the implementation has never looked at it. Both alignments land the block
at the same place; find navigation gets its centering from a separate
`scrollIntoView` correction in `scrollToRenderedElement` afterwards.

**Why it is suspect.** A parameter that changes nothing is worse than absent:
the restore reads as though it chose start-alignment deliberately, and a future
caller will reasonably expect `'center'` to centre.

**What would have to be true to remove it.** Either the two callers genuinely
want the same landing (drop the option, and let find navigation keep owning its
own centering), or centering belongs in the landing after all -- in which case
implement it in `previewLanding.ts` rather than re-adding a second corrective
scroll write. Deciding which is the whole task; the option cannot just be
deleted without answering it.

**Noticed.** Threading a real `offsetPx` through the same options object while
rebuilding the landing arithmetic.

### `documentFactsClient`'s main-thread fallback may have no reachable trigger

**What.** `ensureWorker()` in `src/editor/documentFactsClient.ts` catches a failed
construction and installs an `onerror` handler; both routes resolve every
pending request with `splitMarkdownIntoPreviewBlocksIncremental(text, null)` --
a full remark parse, on the main thread, of the whole document.

**Why it is suspect.** It is now the ONLY remaining way a full parse can reach
the main thread, and `previewBlockSplit.contract.test.ts` has to carve out an
explicit exception for this file to allow it. Its documented triggers are "an
environment without workers, a bundler that did not emit the chunk, a CSP that
refuses it". The app ships as Electron only; the chunk's emission is verified
in the production build; and the one plausible refusal -- Chromium blocking a
module worker over `file://`, which production does use -- was PROBED against
a packaged build during the 26-second-first-open round and the worker
constructed and replied normally. If nothing can trigger it, the exception in
the contract test is protecting a path that cannot run, and a 16-second
main-thread freeze is the thing being kept alive just in case.

**What would have to be true to remove it.** That no shipped configuration can
fail to construct this worker (Electron only, asar and unpacked, portable
build included -- the portable build resolves resources differently and was
not probed), and that a worker that dies mid-session has somewhere better to
go than a synchronous parse. "Somewhere better" is the real question: the
honest replacement is probably to leave the request unresolved and let the
pane stay in its PENDING state, which is already a real state that renders
correctly -- a note whose blocks never arrive is a note you can still read and
edit, whereas a 16-second freeze is not. Decide that before deleting anything.

**Noticed.** Making the split asynchronous end to end, where this became the
last exception to a rule the rest of the codebase now holds by construction.

### `hiddenSplitText`'s reasoning predates the split having a producer

**What.** `usePreviewMarkdownRendering` keeps `hiddenSplitText`, a frozen copy
of the text to split while the render pane is hidden, so that typing in edit
mode does not drive the split. Its long doc comment argues the case from a
measurement -- ~1 second per Enter on list-structured markdown -- taken when
the split ran synchronously in render on every keystroke.

**Why it is suspect.** That is no longer how the split is obtained. A cold
split now goes to the worker and the pane waits; only a warm incremental
update runs here, which is sub-millisecond by construction. The freeze the
mechanism was built to prevent is prevented twice over, and the mechanism has
a cost of its own: it is why the pane's split source can lag the document,
and it interacts with the async producer in a way nobody has thought through
(the seeded initial value is already an exception, now documented in place).

**What would have to be true to remove it.** That the incremental path really
is cheap for every keystroke shape on a large list-dense document -- the
original measurement said the split was pathologically slow there *whatever
the delta*, which if still true would mean the incremental path is not the
cheap thing this assumes, and that is worth re-measuring on its own before
touching anything. If it is cheap, `splitSourceText` collapses to
`renderedDisplayText` and the state, its effect and the seeding exception all
go.

**Noticed.** Making the split asynchronous, where the seeded initial value
turned out to be why a freshly-mounted section splits its first note even in
edit mode.

### The scrollbar's track-edge gap is written down twice

**What.** `SCROLL_TRACK_EDGE_GAP_PX = 3` in `usePreviewScrollbar.ts` (also read
by `CM6Editor.tsx`) and `--canonical-scroll-track-edge-gap: 3px` in
`tokens.css` are the same measurement, kept in agreement by hand. The token was
added so the escape-menu chrome's gauges could stop a full bar exactly where a
real thumb stops; the constant exists because the thumb's position is computed
in JS, which cannot read a token.

**Why it is suspect.** This is the drift shape the codebase already knows: a
rule stated once has to hold everywhere it applies, and two numbers that must
match but are not derived from each other will eventually not match. The
failure is silent and cosmetic-looking — a gauge a few pixels off a thumb reads
as sloppiness rather than as a bug — which is exactly the kind nobody chases.

**What would have to be true to remove it.** That one side can be derived from
the other at run time: either the scrollbar reads the computed token
(`getComputedStyle(el).getPropertyValue('--canonical-scroll-track-edge-gap')`)
once per layout pass rather than holding a literal, or the token is written
onto the root from the JS constant at startup. The first is preferable — the
stylesheet stays the single place a designer changes it — but it needs a check
that the read is not on a hot layout path, and that a missing or malformed
token has a defined answer rather than a NaN that silently pins every thumb to
the top.

**Noticed.** Making the chrome's gauges observe the same top gap a thumb keeps,
where the token had to be invented to say in CSS what JS already knew.
