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

**The pre-existing "Enter-key line-count bug" flagged above — investigated and closed: not a
code defect, a measurement artifact.** A follow-up session traced this with live instrumentation
(Playwright + a real DOM, `applyMarkdownEnter`/`replaceEditorTextFromCanonical` behavior checked
directly, plus the actual saved note text read back after the debounced save flushed) rather than
re-trusting the original `innerText.split('\n').length` repro. Findings: the Lexical DOM always
gained exactly **one** `<p>` element per Enter (verified via `querySelectorAll('p').length`
before/after), and the canonical saved note text always gained exactly **one** `\n` (verified by
reading the note back through `window.thockdownNotes.loadNote()` after the save debounce). The
`+2` the original repro saw is an artifact of measuring "line count" via a contenteditable's
`innerText`: Chromium inserts an extra blank line between every pair of adjacent block-level `<p>`
elements when serializing `innerText` (margin-collapse becomes a rendered blank line), so a
document of *N* paragraphs reports `2N-1` lines via `innerText`, not `N`. Splitting one paragraph
into two via Enter takes *N* to *N+1*, which under that formula always inflates the naive
`innerText`-based count by 2 regardless of where in the document it happens — exactly matching the
original repro's symptoms (the `+2` always reproducing, and Backspace always cleanly reverting it,
since nothing was ever actually wrong with the underlying data). No source change was needed;
added a regression test instead
(`EnterTransformPolicy.test.ts`, "splits a plain line into exactly one additional line when Enter
lands mid-word") asserting directly against the canonical text model (not `innerText`) that a
mid-word Enter on a plain line only ever adds one `\n`, so a future regression here would fail on
the correct signal instead of reintroducing this same measurement confusion.

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

**Re-measured, one session later, once Playwright was actually set up (see "Environment notes"
below).** Synthetic 1.5M-character note (far larger than the 12,000-line note the ~9.8-12s
baseline above was measured on), `npm run dev:browser` + real Chromium via Playwright, note
freshly created then the page reloaded so the app boots straight into it: edit-mode DOM
populated with the full document in **~1.6-2.1s wall-clock**, roughly an order of magnitude
better than the old baseline despite the much bigger document. Caveat this needs to be
carried forward: this was measured in `npm run dev:browser` (Vite serving the renderer as a
plain web page, the mock IPC bridges in `src/dev/installBrowserMockBridges.ts` standing in for
Electron's real preload/IPC/SQLite path), not the packaged/real Electron app — a user report of
an actual Ulysses-sized (~1.5M character) note taking **~8s** to switch to in the real app has
not been reconciled with this ~2s browser-mode number. Next session should profile the real
Electron app directly (Playwright has first-class support for this via its `_electron` module —
launch the built/dev main process instead of a browser tab) before assuming the gap is fully
explained by Electron/real-IPC overhead rather than something this measurement missed.

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

**The remaining per-keystroke cost is diffuse, not dominated by one function — re-profiled
fresh this round on the actual reported scale, and re-prioritized: this is now the active
target, not a residual to defer.** A user reported ~3s per keystroke on a real ~1.5M-character
note (Ulysses-sized) in the real app; re-profiled here on an equivalent synthetic 1.5M-char
note via `npm run dev:browser` + Playwright (see "Environment notes"). The absolute numbers
below (~85-170ms/keystroke) don't match the ~3s report, and that gap is *not yet explained*
(see the initial-mount section above — same open question, likely the same root cause: this
was dev-mode-browser, not the real Electron app, on different hardware). But per the user's own
framing, the exact multiplier doesn't matter: even ~85ms against this doc's "must feel instant"
bar is already roughly two orders of magnitude too slow, so this diffuse cost is the thing to
fix regardless of whether it's currently manifesting as 85ms here or 3s there.

Two rounds of fresh profiling this session, both confirming the same shape:

1. **CDP JS-sampling profile** (`Profiler.start`/`.stop`, single keystroke, caret at document
   start *and* separately at document end — both ~168-174ms wall, no meaningful difference by
   position, and a 30-keystroke sustained burst showed no accumulation, 77-100ms/keystroke
   throughout). Top entries: an uninstrumented `(program)` bucket (~220ms) and `(idle)`
   (~51ms — this is profiling-window overhead, not real cost), then named app functions, all
   individually small: `normalizeInternalText` (8.5ms), `resolveMarkdownSelectionContext`
   (6.8ms), Lexical-internal `getModernOffsetsFromPoints`/`cloneEditorState` (5.8ms/3.8ms),
   `normalizeForComparison` (`useNoteSnapshots.ts`, 2.9ms), `sanitizeTextFragment` (1.7ms),
   `splitMarkdownIntoPreviewBlocksIncremental` (1.1ms — already-optimized residual, fine), an
   anonymous function at `EditorSection.tsx:549` (9.8ms — **re-check this line number fresh
   before trusting it**, the exact same source-map-drift issue this doc already flagged once
   for `:547` in a prior round; don't assume it's stayed put).
2. **Full CDP category-level trace** (`Tracing.start` with `devtools.timeline` +
   `disabled-by-default-devtools.timeline` + `v8` categories — a proper breakdown by
   Layout/Style/Paint/JS, not just a JS call-stack sample) over the same single keystroke, to
   answer what the `(program)` bucket above actually *is*. **Layout (10.8ms), Paint (7.8ms),
   Raster (8.5ms), and Commit (17.7ms) are all small — ruled out as the dominant cost.** The
   big buckets are `EventDispatch` (223ms) wrapping `RunTask` (154ms), `v8.callFunction`
   (123ms), and `FunctionCall` (70ms) — these overlap/nest (they sum to more than the wall-clock
   keystroke time), so read them as "the native keydown dispatch runs a long synchronous JS
   handler chain," not as additive distinct costs. **Conclusion: this is not idle browser
   overhead, not GC, not layout thrash — it's genuine, legitimate synchronous JS execution
   spread across many small functions in the handler chain**, matching the JS-sampling profile's
   shape. Death by a thousand cuts, not one villain.

**One hypothesis tested and refuted, worth recording so it isn't retried:** given the edit-mode
Lexical editor is *not* virtualized (unlike the preview pane now) and has zero CSS
`contain`/`content-visibility` anywhere (`src/styles/` — confirmed empty on both), the natural
guess is that every keystroke forces a layout recalculation across all ~9,000+ unvirtualized
paragraph DOM nodes. **Tested directly, not just reasoned about**: injected
`content-visibility: auto` (+ a rough `contain-intrinsic-size`) onto every direct child of
`.editor-text` via `page.addStyleTag`, no source changes, and re-ran the same keystroke-burst
timing. **It made things worse** (mean 104.8ms vs. 84.5ms baseline, max 167ms vs. 104ms) — and
the category trace above independently confirms Layout itself was never the big cost anyway.
Don't retry CSS containment on the edit-mode editor as a fix for this without new evidence.

**Concrete next step**: build incremental/cached versions of `normalizeInternalText`/
`canonicalizeParagraphSegments` (`src/editor/TextPolicy.ts`) and `resolveMarkdownSelectionContext`
(`src/editor/MarkdownContext.ts`), the same pattern already proven twice in this effort
(`ParagraphOffsetIndex`'s O(log n) treap for caret offsets, `PreviewBlockSplit`'s incremental
reparse) — reuse prior work for whatever the edit didn't touch instead of a full-document pass
every keystroke. Also worth a closer look: the Lexical-internal `getModernOffsetsFromPoints`/
`cloneEditorState` costs are framework internals, not this codebase's own, so there may be
limited room to move there without a Lexical version change or a different selection-reading
strategy — don't assume these are fixable the same way as the app's own functions until
actually investigated.

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

**Preview-pane virtualization (previously listed here as candidate #2, "not investigated
yet") — now done, see the initial-mount section above.** The remaining candidate from that
original pair:

1. **Move markdown parsing to a Web Worker.** Still not investigated. Strongest guarantee (a
   slow parse literally can't compete with keystroke handling on the main thread), but real
   integration cost: `src/editorSection/usePreviewScrollbar.ts`'s custom-scrollbar sync, and
   the source-anchor resolution in `src/editor/EditRestoreMath.ts` /
   `src/editor/PreviewScrollAnchor.ts` (`resolvePreviewSourceAnchorFromContainer`,
   `findPreviewSourceAnchorElement`), all assume *synchronous* DOM access to the
   already-rendered markdown (`querySelectorAll` for `[data-source-line]` elements happening in
   the same tick as the edit). Moving the parse off-thread turns rendering into an async round
   trip, and those call sites would need rethinking. Given the CDP trace above shows the
   *parse* isn't the dominant per-keystroke cost anymore (the diffuse handler-chain cost is),
   this is now lower priority than the incremental-caching work described above — revisit only
   after that's exhausted.

## This round: committed perf harness, and the two functions this doc's "concrete next step" named

Per this doc's own prior "concrete next step" (incremental caching for `normalizeInternalText`/
`canonicalizeParagraphSegments` and `resolveMarkdownSelectionContext`, mirroring
`ParagraphOffsetIndex`/`PreviewBlockSplit`), both are now done. A user session explicitly asked
for structural work to be prioritized first, but per the philosophy doc's solution hierarchy
(incrementality before structural chunking, and chunking only after 1–4 are exhausted) the actual
next-in-line item was this incremental-caching work, not pagination or windowing the edit-mode
Lexical tree — confirmed with the user before starting rather than assumed.

**A committed, reusable measurement harness now exists** — `scripts/perf/perfHarness.mjs` +
`scripts/perf/measureInputLag.mjs`, run via `npm run perf:input-lag -- [flags]`. This replaces the
"reconstruct a throwaway Playwright script every session" workflow the Environment notes below
used to describe. It automates: starting `dev:browser`, generating a synthetic markdown document
of a requested character count, seeding it via the dev-mode mock IPC bridge and reloading,
placing the caret at `start`/`middle`/`end`, and measuring in one of three modes —
`burst` (real dispatched-keystroke wall-clock timing), `profile` (CDP JS call-stack sampling
aggregated by function name), or `trace` (CDP category-level trace for Layout/Paint/JS
attribution) — cleaning up the dev server and browser afterward regardless of outcome. Example:
`npm run perf:input-lag -- --mode=profile --chars=1500000 --keystrokes=30 --position=end`. Had to
work around two environment-specific snags not previously documented: (1) this environment's
pinned Playwright version expects a `chrome-headless-shell` build that doesn't match the
pre-installed `chromium-*` build under `PLAYWRIGHT_BROWSERS_PATH` — the harness resolves the
actual installed binary directly rather than running `playwright install`; (2) `npm run
dev:browser` spawns vite as a grandchild process, so the harness spawns it `detached: true` and
kills the whole process group (negative PID) on cleanup — a plain SIGTERM to the `npm` process
left the dev server (and its port) running after the script exited.

**`resolveMarkdownSelectionContext`'s inline-state/line-index scan — fixed.** Confirmed via a
fresh CDP profile (this harness, synthetic 1.5M-character note, 20-keystroke burst) as the
dominant remaining O(document length) cost: `computeInlineStateAtOffset` (188.6ms) and
`countLineIndex` (104.1ms) across the burst with the caret at the document end, both *absent*
from the same profile with the caret at the document start — direct confirmation of the
position-dependent signature the philosophy doc's benchmark forbids. Root cause: this function is
recomputed on *every* keystroke regardless of which transform fired, via
`useMarkdownFormattingToolbar.ts`'s `useMemo(() => resolveMarkdownSelectionContext(...), [currentEditorText, editorSelection])`
— it drives the toolbar's bold/italic/heading/list/code active-state highlighting, not just the
rarer Tab/Enter paths this doc previously assumed were the main callers.

Fixed with `resolveMarkdownSelectionContextIncremental` in `MarkdownContext.ts`, following the
same "one shared implementation, two starting points" discipline as `SelectionOffsets.ts`'s
`FastParagraphResolver`: the original per-character scan (`computeInlineStateAtOffset`) was
generalized into `scanInlineStateFrom(text, startCursor, initialState, offset)`, so the exact same
code path handles both the O(document) ground truth (`startCursor=0`) and the fast path (starting
partway through the document with a cached `initialState`) — they cannot silently drift apart the
way two independent implementations could. A new `InlineStateLineCache` (held in a `useRef`,
committed in a `useLayoutEffect` after render — not during the `useMemo` itself, matching
`usePreviewMarkdownRendering.tsx`'s established Strict-Mode-safe pattern) tracks, per line, the
scan state *entering* that line and its character offset. On each edit: common-prefix/suffix line
diffing (same technique as `PreviewBlockSplit.ts`) finds the unaffected head/tail, and recomputes
forward from the edit only until a line's freshly-computed entering state matches what it was
cached as before — the CodeMirror/incremental-tokenizer stabilization trick, since (unlike
`PreviewBlockSplit`'s block boundaries) this scan has no backward hazard but does have the same
forward-*unbounded* hazard class: opening or closing a fence/inline-code run changes state for
every following line, however far away the real terminator is. Line offsets need no such
stabilization (pure arithmetic, no toggle coupling) so the untouched tail's offsets are
unconditionally correct to shift-and-copy regardless of whether state has stabilized yet.

Verified: a seeded fuzz test (`MarkdownContext.test.ts`, 3 seeds × 200 steps, checked at ~7
different caret positions per step against `resolveMarkdownSelectionContext`'s full-scan ground
truth) specifically targeting fence/backtick/asterisk perturbations and unmatched delimiters;
`npx tsc --noEmit`; `npm run lint`; full suite (205/205, up from 185); and a live-browser check
(this count climbed further to 224/224 later in the same session with the noteTitle.ts and
textSanitization equivalence tests added below -- noted once here rather than chasing every
intermediate count through this doc)
(real Playwright Chromium, not the embedded pane) confirming the toolbar's Bold/Code-block
buttons correctly activate/deactivate at several caret positions in a small note, **and** — the
strongest test of the forward-propagation logic — a ~19,000-line synthetic note with an unclosed
` ``` ` fence two lines in and never closed: the "Code block" toolbar button correctly showed
active after moving the caret all the way to the document end, with the canonical saved text
(read back through the real save pipeline, not just the DOM) confirmed byte-correct after typing
there. Zero console errors throughout.

Re-measured (same harness, same 1.5M-char note): `computeInlineStateAtOffset` and `countLineIndex`
no longer appear in the profile's top 25 functions at all (previously 188.6ms/104.1ms combined
per 20-keystroke burst). Burst wall-clock at document start and end are now statistically
indistinguishable (~121–122ms mean either way) — confirming the position-dependence itself is
gone, which is the specific defect this fix targeted, per "page 1 must feel identical to page
1,000."

**`canonicalizeParagraphSegments`/`normalizeInternalText`'s per-keystroke full-document
re-normalization — fixed, with a smaller residual than hoped, worth flagging precisely.** Two
call sites hit this on every keystroke: `ContractBridgePlugin.tsx`'s `registerUpdateListener`
(previously the only one this doc tracked) and, newly confirmed this round,
`NoteTextHydrationPlugin.tsx`'s hydration-check effect (keyed on the `text` prop, which changes
every keystroke) — both re-ran `normalizeInternalText` across *every* paragraph's text regardless
of which one actually changed. Fixed with `canonicalizeParagraphSegmentsIncremental` in
`TextPolicy.ts`: unlike the two functions above, there's no cross-segment coupling here at all
(`normalizeInternalText` is a pure per-segment transform), so plain prefix/suffix common-segment
reuse is exact — no stabilization probe needed. A shared `CanonicalizeParagraphSegmentsCache`
(threaded through as an optional parameter, same shape as the `FastParagraphResolver` pattern) is
reused across all three call sites in `ContractBridgePlugin.tsx` (mount, context-menu,
`registerUpdateListener`) plus `NoteTextHydrationPlugin.tsx`'s own — safe to share since the
diffing only ever compares "current raw segments" against "whatever was cached last," never
caring which call site produced that cache.

Verified: a seeded fuzz test (new `TextPolicy.test.ts`, 3 seeds × 200 steps, comparing against
`canonicalizeParagraphSegments`'s full recompute) covering insertion/deletion/edit of segments
including tabs, CRLF, and empty segments; `npx tsc --noEmit`; `npm run lint`; full suite; live
save-pipeline readback (above) confirming no data corruption.

Re-measured: `normalizeInternalText`'s own cost dropped from 163.4ms to 21.3ms per 20-keystroke
burst (~7.7x) — the actual regex-heavy normalization work is now skipped for unchanged
paragraphs, as intended. But `canonicalizeParagraphSegmentsIncremental` itself still costs
~100.6ms per 20-keystroke burst (~5ms/keystroke) on the 1.5M-character note — **a real residual,
not fully eliminated, and worth naming precisely rather than claiming this is done**. Root cause:
with the caret at the document end, only the *last* segment changed, so the prefix-diff loop
(`oldSegments[i] === newSegments[i]`) must compare ~20,000 segment pairs before finding the
mismatch — each comparison is a full string content compare (`===` on two separately-constructed,
not-reference-equal strings from `child.getTextContent()`), which is cheap native `memcmp`-bound
work, not the expensive regex-driven cost this fix actually removed, but it still touches every
paragraph once per keystroke and so is still, technically, O(document length) — just with a far
smaller constant. This is the same class of residual `PreviewBlockSplit.ts`'s own incremental
split already carries (its `oldLines`/`newLines` diff has the identical shape) and was previously
judged acceptable there for the same reason; recorded here rather than silently accepted, per this
doc's own rule that every fix states what remains. **Concrete next step for this specific
residual**: key the diff off Lexical's own `dirtyElements`/mutation-listener signal (the same
signal `LexicalParagraphOffsetSync` already uses) instead of raw content comparison, so only the
paragraphs Lexical itself marked dirty are ever touched — true O(edit locality) instead of
O(document length) via cheap ops. Not attempted this round; the string-diffing approach was
chosen first because it needed no Lexical-identity plumbing into either call site, and the
resulting win (session's stated priority: eliminate O(document)-scaling defects) was captured
either way.

**Total per-keystroke wall-clock barely moved despite both fixes landing real, measured,
function-level wins — recorded plainly rather than glossed over.** Burst wall-clock mean on the
1.5M-character note: 125.22ms/keystroke before this round, 121.28ms/keystroke after (caret at
document end) — about a 3% change, not proportional to the ~31% drop in total sampled JS time
(3599.7ms → 2490.6ms per 20-keystroke burst) or to either fixed function's near-total
disappearance from the profile. This is consistent with, not a contradiction of, the "what's still
open" section above: the remaining per-keystroke cost was already characterized as diffuse
("death by a thousand cuts, not one villain") before this round, and this round's fixes correctly
addressed two specific, real, position-dependent O(document) defects without being the dominant
contributor to the total. Per this doc's own review checklist ("every fix... should state
explicitly what remains, not just the one just fixed"): the next largest attributable entries in
the post-fix profile are `(anonymous) @ EditorSection.tsx:549` (339.9ms/20 keystrokes — **treat
this line number with the same suspicion this doc has flagged twice before for different line
numbers in this same file; it's very likely dev-bundle source-map drift, not a real 340ms
function, and needs verification against a production-adjacent build before anyone spends time on
it**), Lexical-internal `cloneEditorState`/`getModernOffsetsFromPoints` (132.6ms/100.3ms — per
this doc's existing note, may not be fixable without a Lexical version change), and
`normalizeForComparison` (`useNoteSnapshots.ts`, 54.2ms) / `sanitizeTextFragment`
(`textSanitization.ts`, 53.4ms) — both untouched this round, both flagged as residual candidates
in an earlier profile too, still not investigated.

## This round: three more O(document) residuals fixed, and the dev-mode-vs-production gap is now measured (not closed)

Following up on the previous round's "state what remains" list (`canonicalizeParagraphSegmentsIncremental`'s own memcmp-bound residual, the Lexical-internal floor, and the still-diffuse majority of per-keystroke cost), a user session asked specifically: what's the path to sub-2ms input response regardless of document length, and what O(n) calls are actually left? Investigating that question surfaced three more real per-keystroke O(document length) call sites this doc hadn't caught yet, all now fixed, plus — the more consequential outcome — the first real measurement of the actual packaged Electron app, which this doc has flagged as an open gap twice before and never closed until now.

**`deriveNoteTitleFromText` (App.tsx → moved to `src/shared/noteTitle.ts`) — fixed.** Called on every keystroke via `updateActiveNoteTitlePreview` (every character/Enter/Tab/markdown-shortcut transform calls it with the new full text) to keep the note's displayed title live. Its own semantics are more expensive than they look: `.find()` for a `# heading`-shaped line searches the *whole document*, not just near the top, and for the common case of a plain-prose note with no heading, that search fails all the way to the end before falling back to the first content line — meaning this was already effectively O(document length) even for completely ordinary notes, not just a pathological case.

Fixed with `deriveNoteTitleIncremental`, keyed per-note (`Map<noteId, NoteTitleCache>` in App.tsx, since split-view sections editing different notes can call the same shared callback). The incremental scheme is a "first match anywhere" cache with a real asymmetry worth naming: the region *before* a known match is a reusable invariant (nothing there can match, or an earlier line would already be the answer), but the region *after* a known match was never actually scanned — `.find` stops at the first hit — so there's no cached information about it at all. That makes most edits O(1) (an edit anywhere after the title-determining line doesn't touch the cache), but editing away the line that currently determines the title falls back to an O(suffix length) rescan — always correct, just not fast for that one specific edit (which is rare). Verified: a fuzz test (`noteTitle.test.ts`, 3 seeds × 300 steps, specifically targeting "edit away the heading" as the hazard case) against `deriveNoteTitleFromText`'s full-scan ground truth; `tsc`/`lint`/full suite; and a live-browser check that specifically exercised the hazard case (removed a heading from a 5,000-line note) and confirmed the displayed title actually updated rather than staying stale — the highest-value thing to check live, since a stale-cache bug here would be silent and easy to miss in isolation.

**`sanitizeTextFragment` inside `NoteTextHydrationPlugin.tsx`'s hydration-check effect — partially fixed.** This effect reruns on every keystroke (keyed on the `text` prop). It called `normalizeInternalText(sanitizeTextFragment(text))` — provably redundant: `sanitizeTextFragment`'s own `normalizeLineSeparators` + tab-replace already cover everything `normalizeInternalText` checks for (BOM, `\r`/`\r\n`/U+2028/U+2029, tabs), so its output already satisfies `normalizeInternalText`'s postcondition and calling it again is a no-op — same bug shape as last round's `readCanonicalRootText` redundancy, missed the first time because it's a different function pair. Removed the redundant wrapper (roughly halves this line's cost) and locked in the equivalence with a dedicated test (`textSanitization.test.ts`) so a future change to either function can't silently reintroduce a real difference without the test catching it. `sanitizeTextFragment` itself is still a full-document call every keystroke — not made incremental this round (its multi-regex chain, including a Unicode property-escape emoji matcher, would need real care to diff safely at anything other than line granularity, and even line-granularity diffing here would only be safe *after* `normalizeLineSeparators` establishes real `\n` boundaries, since the raw input can't be trusted to already be `\n`-delimited the way this doc's other line-diffing fixes could assume). Flagged as a smaller remaining residual, not fully closed.

**`useNoteSnapshots.ts`'s `normalizeForComparison` — fixed, and this one actually was worse than plain O(document).** `snapshotIdsMatchingPresent` re-normalized *every saved snapshot's content* against the live text on every keystroke (`[liveText, snapshots]` deps, and `liveText` changes every edit) — O(document length × snapshot count), not just O(document length). Snapshot content is immutable once fetched, so there was no reason to ever re-normalize it more than once per fetch. Fixed by memoizing each snapshot's normalized content keyed on the `snapshots` array (a plain `useMemo`, no custom incremental logic needed — snapshots have no cross-record coupling to reason about), and hoisting the one unavoidable `normalizeForComparison(liveText)` call so it's shared between `snapshotIdsMatchingPresent` and `hasPendingManualChanges` instead of computed twice. Straightforward memoization restructuring, not a new caching algorithm with a hazard class to fuzz-test — verified via `tsc`/`lint`/full suite and a live-browser check of the present-state-circle UI element. That live check surfaced something worth recording precisely: the circle didn't visibly toggle after creating a manual snapshot in this test setup — confirmed via `git stash` (same technique this doc has used before) that the *identical* behavior reproduces against the unmodified pre-fix code, so this is a pre-existing characteristic of the test setup or app, not a regression from this change. Not investigated further — out of scope for this round.

**A committed harness for the real packaged Electron app now exists** — `npm run perf:input-lag:electron -- [flags]` (`scripts/perf/measureInputLagElectron.mjs`, reusing most of `perfHarness.mjs`'s shared functions). This closes a real capability gap: every measurement in this doc before this round was `npm run dev:browser` (Vite serving the renderer as a plain web page with mock IPC bridges), never the actual Electron app a user runs. Getting this working in this environment required solving three problems, all worth keeping for the next session:

1. **Chromium's sandbox refuses to run as root** (`Running as root without --no-sandbox is not supported`) — this container runs as root, so both the harness and any manual Electron launch need `--no-sandbox`.
2. **No real display** — this environment has none; `xvfb-run -a` (available, confirmed) provides a virtual one. The npm script wraps this automatically; a bare `node scripts/perf/measureInputLagElectron.mjs` will hang waiting for a window that never opens.
3. **`better-sqlite3`'s prebuilt native binary is compiled against the host Node's ABI, not Electron's bundled Node's ABI** (`NODE_MODULE_VERSION` mismatch) — Electron's main process crashed on `new Database(...)` before ever opening a window, silently as far as Playwright's `_electron.launch()` is concerned (`firstWindow()` just times out with no indication why; the real error only appeared by launching Electron directly and capturing its own stdout/stderr). Fixed with `npx electron-rebuild -f -w better-sqlite3` — not committed as a dependency change, since it rebuilds a native binary in `node_modules` rather than touching anything tracked; re-run it (or `npx @electron/rebuild`, the current package name) whenever `npm install` has refreshed `node_modules` since the last Electron measurement.

The harness also discovered, by reading `electron/main.ts`'s `resolveDataRoot()` rather than assuming: this app's SQLite data root is `<repo>/data` whenever `app.isPackaged` is false (true for this unpackaged `electron dist-electron/main.js` launch style, not a real electron-builder package) — `--user-data-dir` does *not* redirect it, only Electron's own internal cache paths. The harness clears `<repo>/data`'s contents before and after each run for a fresh DB, deliberately preserving the git-tracked `data/.gitkeep` placeholder rather than removing the whole directory (an earlier version of this cleanup did exactly that and had to be caught and reverted via `git status`/`git checkout` mid-session — worth remembering as a reason to always diff-check after any script that does its own filesystem cleanup, not just after edits made through normal tools).

**What the real measurement actually found — this reconciles part of the doc's long-standing open question, but opens a new one.** Same synthetic 1.5M-character note, same harness, both `dev:browser` and the real Electron app, all post-fix:

| | dev:browser, caret at end | Electron, caret at end | Electron, caret at start |
|---|---|---|---|
| Burst wall-clock mean/keystroke | ~113ms | ~142ms | ~16ms |
| Profile: total sampled JS / 30 keystrokes | ~3467ms | ~4731ms | ~3921ms |

Two things, read together, don't fully resolve into one clean story:

- **The real app is not faster than dev:browser — if anything, slightly worse.** This refutes the hypothesis (carried in this doc since the very first round) that a meaningful fraction of the measured per-keystroke cost was dev-tooling/HMR-runtime noise that a production build would strip out. It doesn't; the diffuse "thousand cuts" cost (`EventDispatch`/`RunTask`/`v8.callFunction`/`FunctionCall` dominating a full category-level trace, same shape as every prior round's finding, now independently reconfirmed on the real app) is real application cost, not dev-mode artifact. Function-level attribution on the real app is far less useful than on `dev:browser` — production JS is minified (`kD`, `M5`, `cv`, single/double-letter identifiers), and this build doesn't currently emit source maps, so a CDP JS-sampling profile is only useful category-by-category here, not function-by-function, until that's set up.
- **But burst wall-clock and profiled sampled-JS-time disagree with each other about how much caret position matters on the real app specifically.** Burst timing shows a stark ~8.8x difference between caret-at-start (~16ms) and caret-at-end (~142ms) — a much starker position signature than `dev:browser` shows post-fix (~121ms either position, i.e. this doc's fixes *did* remove the position-dependence there). But the *profiled* sampled-JS-time for the same two positions on Electron is much closer (~3921ms vs ~4731ms, ~17%) — nowhere near an 8.8x gap. These two signals, from the same app, measuring the same thing, don't agree, and this session did not resolve why before running out of scope for this round. Recorded as an open finding rather than guessed at, per this doc's own process discipline — candidate explanations *not yet checked*: CDP's `Profiler.start()` session itself may add real overhead that changes relative timings under profiling vs. unprofiled execution (a known general caveat for sampling profilers, not confirmed here specifically); GC pressure accumulating differently over the course of a burst depending on position (the category trace's `MinorGC`/`V8.GCScavenger` entries were a meaningfully larger fraction of total time on Electron than in earlier `dev:browser` traces, consistent with — but not proof of — this); or a one-time scroll/render settling cost from `placeCaretAt`'s own scroll-to-end step bleeding into the first several keystrokes of the burst window specifically for the "end" position (the per-keystroke burst numbers don't show the front-loaded pattern this would predict, which argues against it, but wasn't conclusively ruled out either).
- **The user's originally-reported multi-second-per-keystroke lag on a real Ulysses-sized note remains unreconciled even now.** The worst single keystroke measured this round, on the real packaged app, in this environment, was ~212ms — genuinely bad against this doc's "must feel instant" bar, but still roughly 15-40x faster than a multi-second report. This environment's Xvfb + software-rendered (SwiftShader) GPU path, and the fact that this is an unpackaged dev-style Electron launch rather than a true `electron-builder` output (asar-packed, code-signed, run on real user hardware), are both plausible remaining gaps — neither has been tested.

**Concrete next steps, in priority order**: (1) resolve the burst-vs-profile disagreement on Electron specifically — repeat the category-level trace (not just JS sampling) at both caret positions, since that measurement doesn't carry the same profiler-overhead caveat, and see whether Layout/GC/EventDispatch shift with position the way burst timing suggests; (2) get source maps into the production build (`build.sourcemap: true` in `vite.config.ts`, or point the CDP profiler at the dev-mode build's source-mapped bundle instead) so function-level attribution is possible on Electron, not just category-level; (3) if feasible, test against a true `electron-builder`-packaged build, not just the unpacked `electron dist-electron/main.js` launch style this harness uses today.

## This round: the burst-vs-profile disagreement on Electron — resolved, and it was the burst number that lied

Picking up the previous round's #1 concrete next step directly: repeat the category-level trace at both caret positions on the real Electron app (not just JS sampling, since trace mode doesn't carry the profiler-overhead caveat), then decide whether the ~8.8x burst-timing gap is real. Used the existing `measureInputLagElectron.mjs`/`perfHarness.mjs` harness unmodified — no source or script changes were needed to get an answer, just running it more times than the previous round had budget for.

**The category-level trace shows no meaningful position effect, in either direction.** Same 1.5M-character note, 30-keystroke burst, `--mode=trace`:

| category | caret at end | caret at start |
|---|---|---|
| EventDispatch | 10990.3ms | 11642.4ms |
| RunTask | 7589.1ms | 8389.9ms |
| v8.callFunction | 4991.0ms | 5771.4ms |
| Layout | 289.6ms | 382.5ms |
| MinorGC | 595.8ms | 626.3ms |

Every bucket is within about 6-20% of its counterpart, and `start` is if anything slightly *higher* here — the opposite direction from the previous round's burst-timing claim that `end` was the slow one. Layout/Paint/Raster/Commit are all small at both positions, same conclusion as every prior round's trace. Re-running `--mode=profile` at both positions (same note, same burst size) landed in the same small-effect band: 6524.0ms (end) vs 5823.4ms (start) total sampled JS, a ~12% gap in the same direction the previous round's profile found (~17%, end higher) — this direction and rough magnitude *does* reproduce across sessions, unlike anything burst mode produced (below).

**Burst mode itself does not reproduce its own result when simply re-run.** Same harness, same flags, same note, run back-to-back, each invocation a fresh `_electron.launch()` (per the harness's own design — a new process, new DB, new note every time):

| launch order | position | mean ms/keystroke |
|---|---|---|
| 1st (this session's very first Electron launch) | end | 17.4 (front-loaded: 53.5, 45.9ms, then settling to ~10-18ms for the rest of the burst) |
| 2nd | start | 176.0 |
| 3rd | end | 178.9 |
| 4th | start | 165.8 |
| 5th | end | 175.8 |
| 6th | start | 166.3 |
| 7th | end | 200.3 |

Five of the seven independent launches — both positions represented — land in a ~165-230ms band with no meaningful position split (end vs. start differ by single-digit percent, matching the trace/profile magnitude, not 8.8x). Only the *very first* Electron launch of the session was qualitatively different, and what made it different wasn't position — it was a front-loaded decay from ~50ms down to a ~10-15ms floor partway through the burst, a pattern that never recurred on any of the other six launches (including five more at `end`/`start` after it). Nothing in the harness or the app distinguishes "first launch this container has ever done" from any other launch — no warm/cold-path branch exists in the code for this — so this reads as a one-off environmental transient (first-ever Xvfb/Chromium/Electron process startup in a fresh container: page cache, dynamic linker resolution, V8 code cache, CPU frequency scaling all cold exactly once), not a reproducible position signature.

**Conclusion: burst wall-clock was the misleading measurement, not the profile.** `measureKeystrokeBurstMs` (`perfHarness.mjs`) times `await page.keyboard.press()` with `performance.now()` in the Playwright/Node driver process — that measures a full CDP round trip (Node driver → Electron main process → renderer → back), not renderer-side execution time directly. A single 30-sample run of that round trip, in this environment (Xvfb virtual display, software-rendered/SwiftShader GPU, a shared/constrained container CPU, a fresh process launch every invocation), is evidently subject to enough scheduling/startup jitter to swing by an order of magnitude between otherwise-identical runs — confirmed directly above, not inferred. The CDP JS-sampling profile and category-level trace instead sample the browser's own call stack/timeline internally at a fixed high frequency over the whole window and aggregate; that structurally averages out the external process-boundary jitter burst timing is fully exposed to, which is exactly why they reproduced consistently (small, single-digit-to-teens-percent effect, same rough magnitude and direction across separate sessions) where burst timing did not (three qualitatively different outcomes for the same code path across seven runs: a large gap one direction, then five runs clustering flat regardless of position). Of the three candidate explanations the previous round listed and didn't check — profiler overhead, GC-by-position, and a `placeCaretAt` settling cost — none of them turned out to be it: burst mode was unstable even with *no* profiler attached, GC's category-trace share doesn't differ meaningfully by position, and the one run that showed front-loaded decay was the first launch of the session at `end`, not a `placeCaretAt`-scroll-to-end artifact that would need to recur every time `end` is measured (it didn't, on the other three `end` runs).

This closes the disagreement this doc has carried as open since the previous round: the two signals don't disagree because there's a real, undiscovered 8.8x position-dependent cost hiding somewhere the profiler can't see — they disagree because a single 30-keystroke burst sample, in this specific containerized/Xvfb Electron setup, isn't a reliable way to resolve a real effect this small (~10-20%) from run-to-run noise. **This doesn't make burst mode worthless in general** — it's what originally caught the 148.8s→17.0s and multi-second-scale regressions earlier in this project's history, where signal dwarfed noise by two-plus orders of magnitude. It specifically isn't trustworthy at the ~10-20%-effect scale on the real Electron app in this environment. For any future comparison at that scale here, prefer `--mode=profile`/`--mode=trace`, or if burst mode must be used, average several independent full-relaunch runs rather than trusting one.

**The user's originally-reported multi-second-per-keystroke lag remains open and is untouched by this finding** — every number in this round, including the anomalous one, is still two-to-three orders of magnitude faster than that report. Nothing here narrows that gap; see the previous round's own list of untested candidates (Xvfb/SwiftShader software rendering, unpackaged vs. `electron-builder`-packaged build) for where to look next.

## Environment notes for the next session

- `node_modules` is not installed by default in a fresh container — run `npm install` (or
  `npm ci`) first.
- **The embedded Claude Browser pane tool is not reliable for this project — don't fight it,
  use a real Playwright browser instead.** Confirmed this round: the pane reports
  `document.visibilityState === 'hidden'` / `document.hidden === true` *permanently*, even
  after explicitly fronting the tab — Chromium heavily throttles rAF/timers for a page that
  believes it's backgrounded, which silently breaks anything relying on `requestAnimationFrame`
  (most of this app's scroll/virtualization code) and makes timing measurements meaningless.
  Screenshots in that pane also time out ("not compositing frames"). DOM reads via
  `javascript_tool`/`get_page_text` still work there for quick inspection, but for anything
  involving scrolling, timing, or virtualization behavior, use the setup below instead.
- **A committed, reusable harness now exists for the common case — `npm run perf:input-lag --
  [flags]` (see `scripts/perf/perfHarness.mjs`/`measureInputLag.mjs`).** It automates everything
  in the manual recipe below (start `dev:browser`, generate a synthetic document, seed + reload,
  place the caret, drive a keystroke burst, clean up) in one of three modes — `burst` (wall-clock),
  `profile` (CDP JS sampling), `trace` (CDP category trace). Reach for this first; only fall back
  to a bespoke throwaway script for something the flags don't cover (a specific edit sequence, a
  non-keystroke interaction, etc.), and prefer extending the harness over writing another one-off
  if the need looks reusable. Two environment-specific gotchas the harness already works around,
  worth knowing if writing a bespoke script instead: (1) this environment's pinned Playwright
  version can expect a different browser build (`chrome-headless-shell`) than what's actually
  pre-installed under `PLAYWRIGHT_BROWSERS_PATH` (a `chromium-*` build) — resolve and pass
  `executablePath` explicitly rather than running `playwright install` (off-limits per this
  environment's setup) or trusting Playwright's own default resolution; (2) `npm run dev:browser`
  spawns vite as a grandchild process, so a plain SIGTERM to the `npm` process on cleanup can
  leave the dev server (and its port) running — spawn detached and kill the process group
  (negative PID) instead.
- **A second harness measures the real packaged Electron app — `npm run
  perf:input-lag:electron -- [flags]`** (`scripts/perf/measureInputLagElectron.mjs`, same flags
  as the browser harness). This is the ONLY way to get a number that isn't `dev:browser`'s mock-
  IPC/HMR-runtime environment, and per this round's own finding, the two do NOT agree, so don't
  treat `dev:browser` numbers as a stand-in for the real app without also spot-checking here.
  Requires, all confirmed necessary this round (see "This round" above for how each was found):
  1. `xvfb-run -a` wrapping the whole command (this environment has no real display; the npm
     script does this automatically, a bare `node .../measureInputLagElectron.mjs` will hang).
  2. `--no-sandbox` (Electron/Chromium refuse to run sandboxed as root, and this container runs
     as root) — the harness passes this itself when launching.
  3. `npx electron-rebuild -f -w better-sqlite3` (or `npx @electron/rebuild`, current package
     name) run at least once per `node_modules` refresh — the prebuilt `better-sqlite3` binary
     `npm install` fetches targets the host Node's ABI, not Electron's bundled Node's ABI, and
     without this the main process crashes on its first `new Database(...)` call *before opening
     a window*, which Playwright's `_electron.launch()`/`firstWindow()` only reports as a bare
     30-second timeout with no indication why. If this harness ever mysteriously times out on
     `firstWindow()` again, launch Electron directly
     (`xvfb-run -a node_modules/.bin/electron --no-sandbox dist-electron/main.js`, piping
     stdout/stderr) before assuming anything else — that's how this specific failure was found.
  4. A `vite build` first (the harness runs this itself unless `--skip-build` is passed) — this
     produces `dist/` (renderer) and `dist-electron/main.js`/`preload.mjs` in one invocation (the
     electron plugin runs three separate vite builds back to back). Don't run the full `npm run
     build` for this — that also invokes `electron-builder` to produce real installers, which is
     slow and unnecessary for measurement, and may not have the platform tooling this container
     needs for nsis/dmg packaging anyway.
  Function-level CDP profiling is much less useful against this production build than against
  `dev:browser` — the bundle is minified with no source maps configured, so profiled function
  names are meaningless single/double-letter identifiers. The category-level trace mode doesn't
  have this problem (it doesn't need names) and is the more reliable mode to reach for here.
- **Manual recipe, for anything the harness doesn't cover (Windows; the previous version of this
  note described a Linux sandbox with paths like `/opt/node22` that don't apply here — that
  environment-specific detail is gone, don't chase it)**:
  1. `npm install -D playwright` (already added as a devDependency — should already be present
     in a fresh checkout; if not, add it) then `npx playwright install chromium` (~190MB
     download, one-time per machine, not committed/cached in the repo) — or resolve the
     pre-installed binary directly per the gotcha above, if `playwright install` isn't available.
  2. `npm run dev:browser -- --port 5183 --strictPort`, backgrounded.
  3. A plain `.cjs` script (not `.mjs` — same ESM/NODE_PATH friction noted before generally
     applies) placed *inside the project directory* (so `require('playwright')` resolves via
     the project's own `node_modules` — a script in an external scratch/temp directory will
     fail to resolve it), run via plain `node script.cjs`.
  4. To seed a large note without fighting the UI: `window.thockdownNotes.createNote({
     initialText })` then `window.thockdownSections.setActiveNote(sectionId, noteId)` (browser
     dev mode's mock IPC bridge, `src/dev/installBrowserMockBridges.ts`) — **then reload the
     page** (`page.goto` again, or `location.reload()`); this bridge call only updates
     *persisted* section state, it does not push a live update into the already-running React
     app. Confirmed working end-to-end across rounds for documents up to 1.5M characters.
  5. Verified this genuinely gives a non-backgrounded page (`document.hidden === false`),
     unlike the embedded pane — `requestAnimationFrame`-based polling and real scroll/timing
     measurements work correctly here.
- For attributing a residual/diffuse cost to specific functions, two complementary CDP
  techniques, both via `const client = await page.context().newCDPSession(page)`:
  - **JS call-stack sampling** (`Profiler.enable` → `Profiler.setSamplingInterval({interval:
    100})` → `Profiler.start` → *drive the interaction* → `const {profile} =
    await client.send('Profiler.stop')`; aggregate `profile.samples`/`.timeDeltas` against
    `profile.nodes` by `callFrame.functionName`). This is what found `getOffsetWithinRoot` as
    the dominant cost in an earlier round, and the diffuse handler-chain shape in this round.
  - **Full category-level tracing** (`Tracing.start({categories: 'devtools.timeline,
    disabled-by-default-devtools.timeline,blink.user_timing,v8', options:
    'sampling-frequency=10000', transferMode: 'ReportEvents'})`, collect `Tracing.dataCollected`
    events, `await new Promise(r => { client.once('Tracing.tracingComplete', r); /* drive the
    interaction */ client.send('Tracing.end') })`, then aggregate event `dur` (for `ph: 'X'`
    complete events) or matched `B`/`E` begin/end pairs by `name`). This is what a plain JS
    profiler *can't* tell you: whether time is going into Layout/Paint/Raster/Commit versus
    JS execution. New this round — the JS profiler alone couldn't distinguish "uninstrumented
    native `(program)` bucket" from "the browser is relayouting the whole document" from "this
    is just event-dispatch overhead wrapping legitimate JS"; the category trace resolved that
    ambiguity directly (see "what's still open" above) instead of leaving it as a guess.
  - **A quick CSS-only experiment via `page.addStyleTag` is a cheap way to test a layout/paint
    hypothesis before touching source at all** — used this round to test (and refute)
    `content-visibility: auto` on the editor's paragraphs; no source edit needed to get a real
    answer, just inject the style, re-run the same timing script, compare.
- Verification bar for any change here: `npx tsc --noEmit`, `npm test` (224/224 passing as of
  this writing, no known pre-existing failures), `npm run lint`, **and** a live-browser check
  — three times now (across earlier rounds), a change here has passed its own unit tests while
  still being wrong (or, in one case, looked wrong live and turned out to be an unrelated
  pre-existing issue — confirmed by `git stash`-ing the change and reproducing the same live
  result against unmodified code, which is the reliable way to tell the two apart rather than
  guessing). Only a live check, or a fuzz test comparing against ground truth across many
  random inputs (not hand-picked cases), has ever caught the real regressions in this doc's
  history. Also true of live-browser checks aimed at *diagnosing* rather than verifying a fix:
  this round, a live repro of a reported scrolling bug (an unrelated continuous-scroll
  max-speed-setting regression, not part of this doc's scope — see `TODO.md` — where a quick
  fix looked numerically correct in an automated test but made the real bug *worse* in live
  use, and was reverted) initially failed to reproduce with a synthetic first attempt, and a
  live keystroke-cost repro here didn't match the reported multi-second number at all — both
  are recorded above as open gaps rather than papered over, since asserting "fixed" or "not a
  real issue" without matching the original report would repeat exactly the mistake this doc's
  process discipline exists to prevent.
- This branch's PRs (#14–#17) were all opened against `main` and merged directly (`merge`
  method, not squash/rebase) once each was independently verified; follow the same pattern
  for any follow-up here rather than stacking onto old branch state.
