# Large-Document Editor Performance — Handover

Written for a fresh Claude Code conversation picking this up mid-stream. Not part of the
project's own `docs/V*` ledger (that's a different, earlier rewrite-phase sequence) — this
is scoped specifically to editor/preview performance under large notes, and can be deleted
once that's addressed and folded into whatever the project's normal docs become.

**Read `docs/document-scale-performance-philosophy.md` first.** That document is the standing
contract this working log is tracked against — the benchmark, the solution hierarchy, and the
process discipline (measure-first, fuzz-verify incrementality, live-browser-check) all live
there and apply to everything below, not just the specific items already found.

## Where this came from

A prior session fixed input lag from **held-key autorepeat** (Backspace/Delete, or any held
printable key) — lag that scaled with *typing speed*, on notes of any size. That work
shipped as four merged PRs (#14–#17), coalescing the preview commit onto a single rAF during
rapid input and splitting the preview into independently memoized per-block `ReactMarkdown`
calls. See git history for #14–#17 if the specifics matter; superseded by the section below
for anything about `PreviewBlockSplit.ts` specifically.

That axis (typing-speed-driven lag) was done. **This doc is about the other axis: a note
large enough that a single frame's worth of work exceeds budget regardless of how fast you
type** — pasting a huge document, opening a huge note, or just holding a key inside one that
already has thousands of lines.

## The original diagnosis in this doc was wrong — corrected by live measurement

The first version of this doc identified `readCanonicalRootText()` in
`ContractBridgePlugin.tsx` as "the real remaining hot spot" for large notes, based on reading
the code, not measuring it. **A live-browser measurement (Playwright against a real
12,000-line note, `performance.mark`/`measure` around the candidate functions) showed this
was wrong by two orders of magnitude.** `readCanonicalRootText()` cost ~10–40ms per call even
on a 12,000-line note — real, but not the dominant cost.

The actual dominant cost was `splitMarkdownIntoPreviewBlocks()` in
`src/editor/PreviewBlockSplit.ts`: a full remark structural parse of the **entire document**,
run on every single keystroke (not gated by `deferPreviewOnRapidInput` at the per-call level —
that toggle only changes how *often per second* this fires, not its O(document length) cost
per call). Measured on the 12,000-line note: **~1.6–4.6 seconds per call**. A 40-keystroke
held-key burst took **148.8 seconds wall-clock** (3.7s/keystroke), of which this one function
accounted for 130.7s (88%). Initial mount of the same note took 12s wall-clock, ~3.2s of which
was two calls to this same function.

Lesson for whoever reads this next: this codebase's own stated discipline is "measure before
you fix," and this doc itself violated that the first time around by trusting code-reading
over live numbers. Don't skip the measurement step even when a diagnosis looks obviously
right from reading the source.

## Fixed in this round

**`splitMarkdownIntoPreviewBlocks()`'s per-keystroke O(document length) cost — fixed.**
Added `splitMarkdownIntoPreviewBlocksIncremental()` alongside the original (now used only as
the correctness fallback + ground truth), wired into `usePreviewMarkdownRendering.tsx` via a
`useRef`-held cache (updated in a `useLayoutEffect`, not during render, to stay Strict-Mode
safe). It reuses the previous call's structural block ranges for whatever leading/trailing
span of the document the edit didn't touch, and only re-runs remark's parser across a small
window near the edit — see the doc comment on the function in `PreviewBlockSplit.ts` for the
full safety argument (worth reading in full before touching this again; it covers two
distinct hazard classes and they are *not* symmetric):

- **Head-side (backward) hazard**: CommonMark constructs whose meaning depends on the single
  line *after* them (setext heading underlines, list-interrupts-paragraph rules). Bounded to
  exactly one line, handled by always including one whole neighboring block in the reparse
  window as buffer — safe by construction, no verification needed.
- **Tail-side (forward) hazard, found by the fuzz test, not reasoned out in advance**: some
  constructs are forward-*unbounded* — an unclosed code fence or HTML block absorbs lines
  until it finds its own terminator, however far away that is. Editing a fence's own
  delimiter can turn a previously-closed fence into one that swallows everything up to the
  next real closing fence, arbitrarily many blocks later — not bounded to one neighboring
  block the way the head-side hazard is. **An earlier version of this fix trusted a one-block
  tail buffer symmetrically with the head side, and the seeded fuzz test caught it producing
  wrong output within 42 random edit steps.** This is exactly the class of bug the "already
  attempted and reverted" section below warns about from the *previous* round — a plausible
  incremental-caching assumption that's provably wrong, caught only by actually checking
  output against ground truth rather than reasoning about it. The fix: before trusting the
  tail buffer, probe by reparsing the window plus the next cached tail range together and
  confirming the boundary between them lands in the same place; if it doesn't, fall back to a
  full reparse for that one call (always correct, just not faster).

Verification for this fix, in order: a seeded fuzz test (`PreviewBlockSplit.test.ts`) running
~1,000 random edit steps across 3 seeds, every step checked against a full-parse ground
truth, specifically targeting adjacency-sensitive edits (blank-line insert/delete around
`---`/`===`, list markers interrupting paragraphs, and direct code-fence delimiter
perturbation); `npx tsc --noEmit`; `npm test` (153/153 passing, up from 136 — 17 new tests);
`npm run lint`; and a live-browser check exercising typing, Enter/Tab/Ctrl+B transforms, and
a live setext-merge edit, watching for console errors. Re-measured post-fix on the same
12,000-line note: the 40-keystroke held-key burst dropped from **148.8s to 17.0s wall-clock
(8.8x)**; the instrumented function itself dropped from ~3267ms/call to ~17ms/call (~189x);
paste-block latency for this function dropped from ~3.6s to ~0.5s.

**`readCanonicalRootText()`'s doubled per-plain-keystroke cost — also fixed, per this doc's
own prior "zero risk" recommendation.** The four pre-commit call sites (Tab-transform,
character-insert-transform, markdown-shortcut-transform, Enter-transform, all in
`ContractBridgePlugin.tsx`) now read `previousTextRef.current` instead of re-deriving
canonical text via a fresh `root.getChildren()` walk — that ref is guaranteed to already hold
exactly what a fresh read would return at the point these handlers fire (before this
keystroke's own edit has committed). Cuts the character-insert-transform path's
`readCanonicalRootText()` calls in half. The `registerUpdateListener` body's own call is
unavoidable and untouched — it's the one call site that actually needs to detect *whether*
anything changed, which requires reading current tree state.

**`getOffsetWithinRoot()`'s O(document length) caret/selection offset walk in
`SelectionOffsets.ts` — fixed, in a follow-up round after this doc's "residual per-keystroke
cost" note below sent the investigation here.** A CDP CPU profile (`Profiler.start`/`.stop`
over a real Playwright session, not just `performance.mark` around guessed candidates) on a
held-key burst found this function alone at **1926.92ms self-time / 9277 samples** — by far
the largest attributable cost remaining after the two fixes above, and called from every
`readSelectionStateFromDom`/`readSelectionOffsetFromClientPoint` site in
`ContractBridgePlugin.tsx` (i.e. on every keystroke, click, and selection-change tick). It
walked every paragraph element in the DOM to accumulate "everything before the caret"'s
length — genuinely O(document length) per call, and per this codebase's own
`getIndexWithinParent()` (confirmed O(index) by reading Lexical's source), nothing in the
framework offered a shortcut.

Fixed with a new persistent, incrementally-maintained data structure —
`src/editor/ParagraphOffsetIndex.ts` — a positional treap (randomized balanced BST) keyed by
paragraph identity, augmented with subtree length sums, giving O(log n) prefix-offset
queries and O(log n) insert/remove/update regardless of document size *or where the edit is*
(unlike a flat prefix-sum array, which would still be O(n) for edits near the start of a huge
document — this was written specifically against the "page 1 must feel identical to page
1,000" bar in `docs/document-scale-performance-philosophy.md`, not just against the
held-key-at-the-end benchmark this whole investigation started from). Kept in sync with a
live Lexical editor by `src/editor/LexicalParagraphOffsetSync.ts`, via two listener types
whose exact semantics were derived empirically (see that file's doc comment, and the
throwaway jsdom spikes in this round's git history) rather than assumed from Lexical's types:
`registerMutationListener(ParagraphNode)` filtered to `'created'`/`'destroyed'` only
(`'updated'` also fires for a paragraph's *siblings* on any insert/remove — sibling-pointer
churn, not a content change) for structural sync, and `registerUpdateListener`'s
`dirtyElements` for length-change sync (a plain text edit fires *zero* `ParagraphNode`
mutations, confirmed live — only `dirtyElements` catches it). Wired into
`SelectionOffsets.ts` as an *optional* `FastParagraphResolver` parameter threaded through
`getOffsetWithinRoot`/`readSelectionStateFromDom`/`readSelectionOffsetFromClientPoint` — the
resolver supplies only *inputs* (which paragraph, its prefix offset, its length, whether it
has a next sibling), and the existing, already-tested boundary-disambiguation logic stays as
one shared implementation for both the fast and slow paths, so they can't silently drift
apart. Every resolution step returns `null` on any doubt, which the caller always treats as
"fall back to the O(document length) walk" — never as a resolved answer.

Verification, in order: `ParagraphOffsetIndex.test.ts` — the treap alone, fuzzed against a
naive array reference across 5 seeds × 500 steps plus a 10,000-paragraph structural check;
`LexicalParagraphOffsetSync.test.ts` — the *sync to a real Lexical editor* (the part that
can't be fuzzed in the abstract), driving actual `editor.update()` calls (text edits,
Enter-splits, Backspace-merges, multi-paragraph paste, deletes) in jsdom across 3 seeds × 150
steps, checking the fast path against the slow DOM walk for *every* selectable point in the
document after *every* step; `npx tsc --noEmit`; `npm run lint`; full suite (174/174 passing,
up from 153). Then a live-browser check specifically because this touches caret placement —
the highest-severity surface in this codebase (a wrong offset here doesn't just look wrong,
it can make a keystroke edit the wrong location): real mouse clicks at document start/middle/
end on a 5,000-line note, typed markers landing exactly where clicked, Enter/Backspace line
counts, and undo, with console-error monitoring throughout. One live-browser result looked
like a regression at first (Enter increased the line count by 2, not 1) — traced by
`git stash`-ing this round's changes and re-running the *identical* script against the
pre-fix code, which reproduced the exact same result. **Confirmed pre-existing, unrelated app
behavior, not a regression** — noted here so it isn't mistaken for one again, but intentionally
not investigated further as out of scope for this axis of work.

Re-measured post-fix (same CDP CPU profile method, same 12,000-line note, 20-keystroke held-key
burst): `getOffsetWithinRoot` **no longer appears in the profile's top 30 functions at all**
(previously #1, 1926.92ms). Total profiled JS self-time for the burst roughly halved:
**11,083ms → 5,463ms**. `normalizeInternalText`'s total cost also dropped ~5x (939ms → 180ms)
as a side effect — most of its previous call volume was `getOffsetWithinRoot`'s own
per-paragraph normalization on every walk.

## What's still open

**A pre-existing Enter-key line-count bug, found incidentally while verifying the caret-offset
fix — not a performance issue, not caused by anything in this doc, not investigated further.**
Repro: click to place the caret mid-word inside an existing paragraph, type a few characters,
press Enter once. The document's line count increases by **2**, not 1 (confirmed via
`document.querySelector('[contenteditable="true"]').innerText.split('\n').length` before/after
in a live browser). A following Backspace correctly restores the original line count, so
there's no state corruption — the caret/selection model stays internally consistent, this is
just an Enter split producing one extra paragraph somewhere it shouldn't. Confirmed to predate
this document's entire caret-offset-index change: reproduced identically via `git stash` on
the commit that added `ParagraphOffsetIndex`/`LexicalParagraphOffsetSync`, i.e. it's already
present in whatever commit merged PR #19 (the block-split fix), and quite possibly further
back than that — this doc's testing never exercised Enter mid-paragraph before this round.
Not triaged beyond that single repro; the most likely starting point is
`applyMarkdownEnter()` in `src/editor/MarkdownContext.ts` (what
`resolveMarkdownEnterTransform()` in `EnterTransformPolicy.ts` delegates to for the actual
text/selection transform), but this hasn't been read closely enough yet to say more than
"look there first."

**Initial mount / note switch for a brand-new (uncached) huge note — preview pane now
virtualized; re-measurement still owed.** The incremental block split only ever helped once
there was a previous call's cache to diff against, and the paragraph offset index only once
populated; the very first render of a note had neither, so both fell straight to their
full/slow paths — measured at ~9.8–12s wall-clock for a 12,000-line note (~3s of which was the
unavoidable first full parse). Root-caused (in a since-deleted, now-folded-in handover doc,
`docs/preview-virtualization-handover.md`) to the preview pane mounting every markdown block's
`ReactMarkdown` output unconditionally on first render, regardless of viewport.

Fixed by virtualizing the preview pane with `@tanstack/react-virtual` (`useVirtualizer` in
`src/editorSection/usePreviewMarkdownRendering.tsx`): only blocks near the viewport (plus a
small overscan buffer) ever mount real `ReactMarkdown` output now, with per-block height
estimated then corrected via `measureElement`/`ResizeObserver` as each block actually renders.
`usePreviewScrollbar.ts`'s thumb math needed no changes — the virtualizer's own total-size
wrapper div is real DOM sized to `getTotalSize()`, so `scroller.scrollHeight` stays accurate
automatically. Three consumers that used to assume every block was always real DOM were
updated:

- `applyPreviewSourceAnchor` (`useEditorSectionMount.ts`, edit-mode/note-open scroll restore)
  and `scrollToAnchorInPreview` (`usePreviewMarkdownRendering.tsx`, `$anchor` link navigation)
  now resolve the target block's index (`resolvePreviewBlockIndexForSourceLine`, a new binary
  search in `src/editor/PreviewBlockIndex.ts`, unit-tested) and call
  `virtualizer.scrollToIndex` to force the target to mount *before* the existing DOM-anchor
  query runs, retrying that query across a few animation frames rather than assuming one frame
  is enough.
- `jumpToPreviewDocumentFindHit` (`useDocumentFindNavigation.ts`) needed no change — its
  existing proportional-scroll fallback (predates this effort) already handles "couldn't
  establish an exact DOM position" gracefully, which a virtualized-out match now also falls
  into.
- `resolvePreviewSourceAnchorFromContainer` (`useEditorSectionMount.ts`) needed no change either
  — it only ever cares about whichever block sits at/near the container's top edge, which by
  construction is always inside the virtualizer's mounted window.

A custom `scrollToFn` was added so react-virtual's own imperative scrolling routes through this
app's existing scroll engines instead of its native-`scrollTo` default: an instant snap
(`scroll-behavior: auto` forced, matching the existing restore-on-open convention) for
restoration, or this app's curve-based `scrollToNonQuantizedSmooth` (which already supports
being re-targeted mid-flight) for deliberate navigation like anchor clicks — letting
react-virtual's own estimate-correction pass (`reconcileScroll`, fires once a virtualized-out
target's real height is measured) re-plan the animation smoothly instead of jumping.

**Re-measurement not yet done.** This session had no Playwright/Chromium available in its
environment (unlike whatever environment produced the wall-clock numbers above — this was a
plain Windows dev machine with neither installed, and installing a browser binary solely for a
one-off measurement wasn't judged worth the footprint given this project's standing preference
for manual over automated browser verification). `npx tsc --noEmit`, the full test suite
(184/184, up from 174 — 10 new tests for `resolvePreviewBlockIndexForSourceLine` and the new
`findAnchorDefinitionLine` helper), and lint all pass, but the actual initial-mount wall-clock
improvement on a genuinely large note has not been re-measured against the ~9.8–12s baseline
above. Whoever verifies this manually should also note the new number here.

**`normalizeInternalText`/`canonicalizeParagraphSegments`'s 180ms/159ms — fixed, and it was
NOT irreducible as this doc previously guessed.** A follow-up session traced every call in the
plain-keystroke path and found this full-document-length pass ran up to 4-6 times per
keystroke, not once: two calls in `ContractBridgePlugin.tsx` (`emitSelectionIfChanged`,
`refreshSelectionModelFromDom`) called `readCanonicalRootText()` solely to read `.length` for
a clamp parameter that never touches string content; three more
(`useEditorSectionMount.ts`'s `onTextChange` binding, `useNoteSaveQueue.ts`'s `queueSave`,
`EditorSection.tsx`'s `currentEditorText` memo) re-normalized text that was already canonical
by construction. All four fixed by reusing already-known values (`previousTextRef.current`,
`event.text`, a length known to be redundant with what `flushSave` re-derives before actually
using it) instead of re-deriving from scratch — the same "trust a ref that's synchronously
kept in sync" pattern this file already used for the pre-commit call sites. A plain keystroke
now does essentially 1 full-document pass (the one inside `registerUpdateListener` that must
read current tree state to detect *whether* anything changed), not 4-6. Verified via
`npx tsc --noEmit`, `npm run lint`, full suite (174/174, no regressions) — not yet
re-profiled live; see the note at the end of this section.

**The remaining per-keystroke cost is now diffuse, not dominated by one function, and one line
reference below needs re-verification before being trusted.** Post caret-offset fix (prior to
the `normalizeInternalText` fix above), the CPU profile's top entries were: an uninstrumented
native/`(program)` bucket (2.6s of the 5.5s total — likely DOM APIs, event dispatch, GC
bookkeeping, not straightforwardly actionable); an anonymous function attributed to
`EditorSection.tsx:547` (313ms) — **re-checked this round: line 547 in current source is a
bare destructured identifier (`setTabBarMode`), not a function; the profiler's blamed location
has drifted, most likely a dev-server source-map offset from the profiling build, not a stale
doc. Don't plan a fix against that line number as given — re-profile fresh first.** The
closest legitimate candidate nearby if picking up this specific thread:
`activeNoteDocumentStats` (`EditorSection.tsx:696-711`) — a genuine O(document length)
`.trim()`/`.split(/\s+/u)` word-count over the entire document on every keystroke, for the
always-visible status bar, with no coalescing during a rapid held-key burst (unlike its
sibling preview commit, which already has `deferPreviewOnRapidInput`). Also still open:
Lexical-internal `cloneEditorState`/`getModernOffsetsFromPoints` (220ms/205ms — framework
cost, not this codebase's own); `computeInlineStateAtOffset`/`resolveMarkdownSelectionContext`
in `MarkdownContext.ts` (99ms/82ms — confirmed called exactly once per keystroke, not
redundant; genuine O(caret-offset) work with no incremental cache, a legitimate future target
needing a `ParagraphOffsetIndex`-style cache, not a dedup). None of these dominate the way
`splitMarkdownIntoPreviewBlocks`, `getOffsetWithinRoot`, or the normalize redundancy did;
picking up this thread means either accepting the current state as a reasonable stopping point
(per `docs/document-scale-performance-philosophy.md`'s own risk/gain framing) or profiling
several smaller things rather than chasing one more big win. **This whole section needs a
fresh CPU profile before further action** — it was last measured before this round's
normalize-dedup fix, and the `EditorSection.tsx:547` mismatch above means the line-level
attributions here shouldn't be trusted at face value even where the ms totals are probably
still roughly right.

**Already attempted and reverted (previous round, still applies — don't redo this specific
approach to `readCanonicalRootText`'s `registerUpdateListener` cost).** The natural-seeming
fix is to cache each top-level paragraph's text, keyed by comparing the paragraph *node
object* to what was seen last tick (same object ⇒ reuse cached text, skip
`.getTextContent()`). **This is unsound and was proven wrong live, not just in theory.**
Confirmed in Lexical's own source (`getWritable()` in `node_modules/lexical/Lexical.dev.mjs`):
editing a `TextNode` only clones *that node* — `getWritable()` does not cascade a clone up to
the parent `ParagraphNode`. The parent is merely marked in `dirtyElements`
(`internalMarkParentElementsAsDirty`), but keeps the *same object reference* across edits to
its own child. So "same paragraph object as last tick" does **not** mean "paragraph text
unchanged." Live repro: typing "Alpha paragraph" character-by-character with this cache in
place left the DOM correctly showing "Alp" after three keystrokes while the cached canonical
text stayed stuck at `"A"` — a silent divergence between what's on screen and what the app
thinks the note contains, i.e. a data-loss bug, not a perf bug. It shipped past unit tests
because those tested the pure caching function against a *wrong* mental model of Lexical
internals, not the real integration — a live-browser check is what caught it. (The
`PreviewBlockSplit` incremental fix in this round hit the *same class* of bug via the
code-fence hazard above — different code, same lesson: a plausible caching assumption about
this codebase's parsing internals needs empirical verification, not just careful reasoning.)

The *correct* signal for a `registerUpdateListener`-based incremental fix here is Lexical's
own `dirtyElements`/`dirtyLeaves` (from `registerUpdateListener`'s payload — confirmed present
in `LexicalEditor.d.ts`, not a private API, and now also confirmed *live* via
`LexicalParagraphOffsetSync`'s own use of it, see above), which does reliably reflect
"something in this subtree changed" regardless of object identity. Still not attempted for
`readCanonicalRootText()`'s own `registerUpdateListener` walk specifically — the follow-up
investigation this note asked for happened, but the CPU profile pointed at
`getOffsetWithinRoot` as the dominant cost instead (now fixed, see above), not this. Revisit
only if a future profile shows this specific walk mattering again; `canonicalizeParagraphSegments`
sits at 159ms in the latest post-fix profile, which is close to the *irreducible* cost of
producing a document-length string once per edit (see "What's still open" above) rather than
clearly attributable to redundant work the way the old caret-offset walk was.

**Not investigated at all yet — two candidate paths for genuinely huge notes (initial mount,
not per-keystroke):**

1. **Move markdown parsing to a Web Worker.** Strongest guarantee (a slow parse literally
   can't compete with keystroke handling on the main thread), but real integration cost:
   `src/editorSection/usePreviewScrollbar.ts`'s custom-scrollbar sync, and the source-anchor
   resolution in `src/editor/EditRestoreMath.ts` / `src/editor/PreviewScrollAnchor.ts`
   (`resolvePreviewSourceAnchorFromContainer`, `findPreviewSourceAnchorElement`), all assume
   *synchronous* DOM access to the already-rendered markdown (`querySelectorAll` for
   `[data-source-line]` elements happening in the same tick as the edit). Moving the parse
   off-thread turns rendering into an async round trip, and those call sites would need
   rethinking.
2. **Virtualize the preview pane** (render only visible blocks + a buffer, à la
   react-window). Reduces DOM node count and initial-mount cost to O(viewport), not
   O(document length) — the per-block split from #16 doesn't help here, since it still
   mounts every block regardless of whether it's on screen. Same complication as above: the
   source-anchor and scrollbar-sync code currently assumes every block is in the DOM at all
   times; virtualizing would need those made virtualization-aware. Given the ~9-12s initial
   mount is mostly *not* the parse (per the measurement above), this is now the more likely
   of the two to matter for that specific number.

## Environment notes for the next session

- `node_modules` is not installed by default in a fresh container — run `npm install` (or
  `npm ci`) first.
- Live-browser verification pattern used throughout: `npm run dev:browser -- --port 5183
  --strictPort` in the background, then drive it with Playwright using
  `NODE_PATH=/opt/node22/lib/node_modules node <script>.js`, or `require()` it directly from
  `/opt/node22/lib/node_modules/playwright` in a `.cjs` script (NODE_PATH is ignored by
  Node's ESM resolver, so a plain `.mjs` with a bare `import 'playwright'` will fail even with
  NODE_PATH set — use `.cjs` + `require()`, or `.mjs` + a full path import), and
  `chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })`.
  To seed a large note without fighting the UI: `window.thockdownNotes.createNote({
  initialText })` then `window.thockdownSections.setActiveNote(sectionId, noteId)` (browser
  dev mode's mock IPC bridge, `src/dev/installBrowserMockBridges.ts`), then reload — opens
  straight into it.
- For attributing a residual/diffuse cost to specific functions (not just "wall clock got
  slower"), a CDP CPU profile beats bracketing guessed candidates with `performance.mark`: via
  Playwright, `const client = await page.context().newCDPSession(page); await
  client.send('Profiler.enable'); await client.send('Profiler.setSamplingInterval', {interval:
  100}); await client.send('Profiler.start'); /* ...drive the interaction... */ const {profile}
  = await client.send('Profiler.stop');` — then aggregate `profile.samples`/`.timeDeltas`
  against `profile.nodes` by `callFrame.functionName`. This is what actually found
  `getOffsetWithinRoot` as the dominant cost in this round, after `performance.mark` around
  the two functions this doc had already instrumented showed nothing dominant.
- Verification bar for any change here: `npx tsc --noEmit`, `npm test` (174/174 passing as of
  this writing, no known pre-existing failures), `npm run lint`, **and** a live-browser check
  — three times now, a change here has passed its own unit tests while still being wrong (or,
  in one case, looked wrong live and turned out to be an unrelated pre-existing issue —
  confirmed by `git stash`-ing the change and reproducing the same live result against
  unmodified code, which is the reliable way to tell the two apart rather than guessing). Only
  a live check, or a fuzz test comparing against ground truth across many random inputs (not
  hand-picked cases), has ever caught the real regressions in this doc's history.
- This branch's PRs (#14–#17) were all opened against `main` and merged directly (`merge`
  method, not squash/rebase) once each was independently verified; follow the same pattern
  for any follow-up here rather than stacking onto old branch state.
