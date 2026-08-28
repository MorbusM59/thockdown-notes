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

## This round: source maps landed (real win); the two other queued fixes were tried, measured, and reverted (real finding, not a loss)

Picked up this doc's own three queued items in priority order: (1) `canonicalizeParagraphSegmentsIncremental`'s memcmp residual keyed off Lexical's `dirtyElements`, (2) `sanitizeTextFragment` made incremental, (3) source maps in the production build. Per this doc's own process discipline — measure, don't assume, and a fix isn't done until it's re-measured — all three were implemented, fuzz-tested, and re-profiled before deciding anything. Only one held up.

**(3) Source maps — done, verified, real.** `build.sourcemap: true` in `vite.config.ts`, plus a source-map consumer added to `perfHarness.mjs`'s `aggregateCdpProfile` (`@jridgewell/trace-mapping`, new devDependency): for any profiled `callFrame` whose URL is a local `file://` path (the packaged Electron build) with a `.map` alongside it, `resolveCallFrameName` now looks up the original name/file/line instead of reporting the minified one. `dev:browser` needs no change (already unminified). Confirmed live on a real Electron profile: this app's own functions now show as `App @ App.tsx:1563`, `formatCreatedDate @ App.tsx:917`, `normalizePlainText @ SelectionOffsets.ts:12`, etc., instead of single/double-letter identifiers; third-party bundles with no map of their own (React, Lexical's `.prod.mjs`) still show minified names, which is expected and out of scope. This closes the second of this doc's three "concrete next steps in priority order" from the previous round.

**(1) and (2) — implemented correctly, fuzz-tested, verified against a real Lexical editor, then reverted because they measured slower, not faster.** Recorded in full because this is exactly the kind of finding this doc's own rule ("every fix... should state explicitly what remains") exists to prevent from being silently dropped, and because the *why* generalizes to any future attempt at the same idea.

- `canonicalizeParagraphSegmentsByKeyIncremental` (`TextPolicy.ts`): a new identity-aware incremental scheme keyed off `registerUpdateListener`'s real `dirtyElements` signal, so only paragraphs Lexical itself marked dirty (or whose key shifted position structurally) would ever have `getTextContent()` called on them at all — exactly what the previous round's residual analysis asked for. Correctness was verified thoroughly, not assumed: a pure-algorithm fuzz suite (3 seeds × 200 steps, including a deliberate "stale dirty signal" test proving the fast path is actually taken, not silently bypassed), *and* a real-Lexical-editor integration fuzz test (`TextPolicy.dirtyElements.test.ts`, 3 seeds × 150 steps of in-place edits/splits/merges/pastes/deletes against a real `createEditor()`, checked every step against full-recompute ground truth) — the same two-tier discipline `LexicalParagraphOffsetSync.test.ts` established for this exact signal. That integration test's own fuzz ops initially had a real bug worth recording: Lexical prunes a `TextNode` whose content becomes `""`, so `firstTextNodeAt(index)?.setTextContent(...)` on an already-emptied paragraph silently no-ops via optional chaining — caught by the fuzz test itself (not missed), fixed by creating a new TextNode when none exists.
- `sanitizeTextFragmentIncremental` (`textSanitization.ts`): line-granularity prefix/suffix caching for the four line-independent regex passes (tab replace, emoji strip, variation-selector strip, control-char strip) that run after `normalizeLineSeparators` establishes real `\n` boundaries — verified exact by inspection (none of the four patterns can match `\n`) and by a dedicated fuzz suite (3 seeds × 200 steps against `sanitizeTextFragment`'s full recompute).
- Both integrated (ContractBridgePlugin's `registerUpdateListener`, and `NoteTextHydrationPlugin`'s hydration-check effect respectively), then re-profiled the same way this doc always does: same 1.5M-character synthetic note, same `--mode=profile` harness, a genuine before/after within the *same* session (`git stash`/`stash pop` around the measurement, not numbers from a different session or environment). **Both measured flat-to-worse, not better**: canonicalization's combined per-call-site cost moved from a 105–134ms/20-keystroke band (old, 3 runs) to a 129–133ms band (new, 3 runs); sanitization moved from ~56–60ms to ~64–71ms. Confirmed this wasn't a fluke of the real app's noise with two isolated Node microbenchmarks (no browser, no DOM, no React) directly comparing the old and new algorithms on a 20,000-paragraph synthetic array — same result both ways, old consistently at or below new.
- **Root cause, once measured rather than assumed: the O(document length) cost these fixes targeted was never actually the per-item work (`getTextContent()`/regex), it was the surrounding array mechanics** — building a 20,000-element array, and joining 20,000 strings back into one, both **irreducibly O(document length)** for this codebase's "one flat canonical string" text model, done by *both* the old and new approaches equally. Skipping expensive-looking per-item work for unchanged items doesn't help once that per-item work was never the dominant cost at this scale — instrumenting the new canonicalization path directly (a temporary call counter) confirmed the dirty-skip logic was doing exactly what it was designed to do (real reads dropped from ~20,000/keystroke to ~1/keystroke) with no algorithmic bug, and it *still* didn't move the total. For `sanitizeTextFragmentIncremental` specifically, the `.split('\n')`/`.join('\n')` overhead of a 20,000-line array is itself real, non-trivial allocation work that can exceed what it was meant to save, since V8's regex engine already scans a long string for four simple, mostly-non-matching patterns quite fast in one pass.
- **Reverted rather than left in place unused**, per this codebase's own "no half-finished implementations" discipline and the CSS-`content-visibility` precedent earlier in this doc (tested, measured worse, reverted, recorded so it isn't retried without new evidence) — the new functions, their production call sites, and their tests were all removed; `git log`/PR history for this round has the full implementation if a future session wants to see exactly what was tried. **Don't retry "key it off dirtyElements/identity" for `canonicalizeParagraphSegmentsIncremental`'s or `sanitizeTextFragment`'s remaining O(document length) touch without new evidence that array/join mechanics themselves have gotten cheaper to skip** (e.g. a different canonical-text representation entirely — see below).

**This sharpens, rather than closes, this doc's biggest remaining item.** The "move to a Web Worker" and "diffuse, thousand cuts" framing already in this doc undersold one thing this round's negative result makes concrete: the floor on canonicalization/sanitization at this scale is not "some per-paragraph work is wastefully repeated" (that part *is* fixable and *was* fixed, e.g. `canonicalizeParagraphSegmentsIncremental`'s own earlier win, `readCanonicalRootText`'s de-duplication) — it's that **any scheme producing a single flat joined string of the whole document on every keystroke has an irreducible O(document length) floor**, no matter how cleverly the per-item work is skipped. The only way meaningfully below that floor is a different representation that never materializes the whole document as one string per edit (a rope/piece-table, or chunked/paginated canonical text) — which is exactly the "structural chunking, last resort" tier of `docs/document-scale-performance-philosophy.md`'s solution hierarchy, not something to reach for casually, but worth naming precisely as the actual next tier now that tier-1 (incrementality) has been tried against this specific residual and shown not to be enough.

**Concrete next steps, in priority order**: (1) if the remaining canonicalization/sanitization floor needs to come down further, the next real lever is *not* another incremental-caching attempt at the same functions (tried, shown insufficient) — it's whether `readCanonicalRootText`'s callers can tolerate something other than a single freshly-`.join()`ed string every keystroke (a lazy/rope-backed canonical text type), which is a materially bigger, riskier change than anything attempted so far and should be scoped as its own effort, confirmed with the user first, per this doc's own "confirmed with the user before starting rather than assumed" precedent; (2) get a true `electron-builder`-packaged build under this harness (still not done, still the most direct lever on the unreconciled multi-second user report); (3) `normalizeForComparison`/`sanitizeTextFragment`'s own remaining full-document cost (not the incremental attempt above — the base function itself) and the Lexical-internal `cloneEditorState`/`getModernOffsetsFromPoints` costs are both still un-investigated residual candidates from earlier rounds.

## This round: the rope lever, Phase 1 — a verified sync engine, deliberately not wired in yet

Picked up this doc's own #1 concrete next step (above): confirmed with the user first (per this doc's own precedent) that the rope/piece-table tier was worth attempting, then scoped it explicitly into two phases before writing anything, given how much bigger this is than anything else in this doc — Phase 1 (this round): build and verify a rope-backed sync engine as a standalone module, wired into nothing. Phase 2 (explicitly not started): migrate `onTextChange` and the hot consumers to actually use it. The user confirmed Phase-1-only scope before work began.

**Library decision: reuse `@codemirror/state`'s `Text` class rather than hand-roll a rope.** Checked concretely before deciding, not assumed: MIT-licensed, tree-shakeable (`sideEffects: false`, and direct inspection of the built module confirmed `Text`/`TextLeaf`/`TextNode` have zero references to the rest of that package's `EditorState`/`Facet`/`ChangeSet` machinery, so bundling only pulls in the relevant ~15-18% of the module), and its public API (`.replace(from, to, text)` → new `Text` via structural sharing, `.slice`/`.sliceString`, `.lineAt`/`.line`, `.iterRange`/`.iterLines`, `static of(lines)`/`static empty`) maps directly onto what every consumer surveyed below needs. Weighed against hand-rolling: this codebase has already been burned twice by subtle rope-adjacent correctness bugs caught only by fuzzing (the empty-TextNode-pruning bug in a fuzz test's own op generator, the forward-unbounded-hazard bugs in `PreviewBlockSplit`/`MarkdownContext`) — a mature, heavily-used library is the safer choice for the genuinely subtle part (chunk balancing, splitting), leaving this codebase's own new code scoped to the part that actually needs codebase-specific knowledge: syncing it to Lexical.

**Consumer survey done first, to make sure a rope is even the right target.** Audited every real consumer of the canonical text string (`ContractBridgePlugin.tsx`, `NoteTextHydrationPlugin.tsx`, `useNoteSaveQueue.ts`, `EditorSection.tsx`/`usePreviewMarkdownRendering.tsx`, `MarkdownContext.ts`, `noteTitle.ts`, `textSanitization.ts`, sidebar search, in-document find, snapshots) for what string operation each performs and whether it structurally needs a full materialized string every keystroke. Findings worth carrying forward:
- Several consumers already have genuinely incremental algorithms (`PreviewBlockSplit.ts`'s incremental split, `noteTitle.ts`'s incremental first-match search, `MarkdownContext.ts`'s incremental inline-state scan) but each independently re-derives "what changed" via its *own* full `text.split('\n')` on the same document every keystroke — real, currently-uneliminated duplicated O(n) work a shared rope/line-index could remove as a side effect of Phase 2, not just the join-floor itself.
- Some consumers (`useNoteSaveQueue.ts`'s `queueSave`, sidebar note search, the 60-second snapshot-autosave interval) already only need a flattened string rarely or never per keystroke — good, low-risk first migration targets whenever Phase 2 happens.
- `ParagraphOffsetIndex.ts`'s existing treap is genuine prior art for the identity-keyed, length-augmented half of a rope, but confirmed by direct read of `pull()`/`merge()`: it stores zero text and its split granularity is whole-paragraph-only (never sub-node) — it's a natural skeleton to reuse the *pattern* from, not something a content rope could be bolted onto directly.

**Built `src/editor/LexicalRopeSync.ts`**, structurally mirroring `LexicalParagraphOffsetSync.ts` as closely as possible (same two-listener strategy — `registerMutationListener` filtered to `created`/`destroyed`, `registerUpdateListener`'s `dirtyElements` for in-place edits — same `insertRun`-style batching for multiple paragraphs landing in one tick). Keeps its own private `ParagraphOffsetIndex` purely as offset/length bookkeeping (not shared with whatever instance the live app's caret placement uses), updated in lockstep with the rope so every `rope.replace()` call gets a precise, correct range instead of re-diffing two full strings.

**Two real bugs, both caught by the fuzz suite before either could reach a consumer, worth recording precisely since they're the crux of why this is genuinely subtle:**
1. Removing the document's *last* paragraph: the code initially only ever looked for a *trailing* separator to remove alongside it (matching the general "owned span" rule), but the last paragraph has none — the separator that needs removing is the one immediately *before* it (now-dangling, since nothing will follow the new last paragraph). Caught as a reproducible one-extra-blank-line mismatch across 4 of 5 fuzz seeds; root-caused with a minimal reproduction script, not by staring at the code.
2. Inserting a new paragraph directly after one that was previously the document's last: the code computed whether the *new* paragraph needs a trailing separator (correct), but never accounted for whether the *anchor* needed a new *leading* separator inserted alongside it — since the anchor, having been last, had none yet. Caught the same way (a minimal repro isolating a single Enter-split at the document's end reproduced `"charlie thhree"` instead of `"charlie t\nhree"` — the two paragraphs' text concatenated with no separator between them at all). Fixed by tracking a `needsLeadingSeparator` flag that's only ever true for the *first* key in a batch of same-tick insertions (every subsequent key in the same run was reached via a real `getNextSibling()`, which by construction means the previous key already got a trailing separator of its own).

**Verification**: the exact same real-Lexical-editor fuzz methodology `LexicalParagraphOffsetSync.test.ts` established (5 seeds × 150 steps of in-place edits, Enter-splits, Backspace-merges, multi-paragraph paste, deletes, checked against a full ground-truth recompute after *every* step) plus a temporary stress run at 15 seeds × 500 steps before finalizing (not committed — this doc's own bar for "how much fuzzing is enough" is satisfied by the committed 5×150, the wider run was extra confidence given how easy this class of bug is to get subtly wrong); a dedicated large-document scale test (10,000 paragraphs, edits at start/middle/end, matching this codebase's "page 1 must feel identical to page 1,000" bar); `npx tsc --noEmit`; `npm run lint`; full suite (235/235, up from 224). **No live-browser check this round** — deliberately, and stated explicitly rather than silently skipped: this module isn't wired into anything a user can observe yet, so there is no user-visible surface a live-browser check would exercise; the jsdom-based real-`createEditor()` fuzz suite already drives actual `editor.update()` calls exactly the way `LexicalParagraphOffsetSync.test.ts`'s own (already-shipped, already-trusted) equivalent does. A live-browser check becomes required, not optional, the moment Phase 2 wires this into anything user-facing.

**What's still open, explicitly**: this module is *not* wired into the live app. `onTextChange`'s `text: string` contract, and every hot consumer listed above, are completely untouched — none of them read from this rope yet, so none of this round's work has any effect on real keystroke latency yet. Per the phased scope agreed with the user, Phase 2 (migrating `onTextChange` and the hot consumers to avoid forcing a full flatten every keystroke, which is where the actual latency win would materialize) is a separate, not-yet-started effort — expect it to need its own consumer-by-consumer migration plan, its own fuzz/live-browser verification per consumer (especially anything caret/selection-adjacent, this codebase's own-stated highest-severity surface), and likely a change to `EditorContract.ts`'s wire shape per `docs/editor-contract.md`'s own rule ("extend `EditorContract.ts` first, then implement through `Editor.tsx`, then update this document").

## This round: the rope lever, Phase 2 proof-of-concept — a real, reproducible ~2x win for the one thing it touched, but not a dent in the aggregate yet

Before attempting a full consumer migration (the obvious-seeming "Phase 2"), traced where the flattened string actually lands: `setActiveNoteText` (`useEditorSectionMount.ts`) is a plain `Dispatch<SetStateAction<string>>` — core React state, set from ~9 call sites — and *every* downstream consumer (preview, word count, find, snapshots) reads from that state, not from `onTextChange` directly. Migrating any single consumer (e.g. `useNoteSaveQueue`, which only needs a string at its 350ms-debounced flush) doesn't save anything on its own: the full string still gets produced and pushed into that state every keystroke regardless, since `rope.toString()` is still O(document length) to produce, no better than today's `.join()`, as long as *any* consumer still forces it. Confirmed this with the user before proceeding rather than assuming a narrow migration would show a win.

Given that, ran a smaller, more fundamental experiment first, with deliberately zero blast radius on the rest of the app: is `rope.toString()` itself actually *cheaper* than today's array-build-and-join approach for producing the exact same string, given the rope avoids the diffing step entirely (edits applied via known offsets, not by comparing two full snapshots)?

**Wired `LexicalRopeSync` into `ContractBridgePlugin.tsx`'s `registerUpdateListener` — this one call site only.** Added a `ropeSyncRef` alongside the existing `paragraphOffsetSyncRef`, same lifecycle. `readCanonicalRootText(canonicalizeCacheRef)`'s call inside `registerUpdateListener` became `ropeSyncRef.current?.snapshot().toString() ?? readCanonicalRootText(canonicalizeCacheRef)` — rope-sourced when available, falling back to the existing path otherwise. Deliberately left every other call site untouched: the mount effect, the context-menu handler, and `NoteTextHydrationPlugin.tsx`'s own separate canonicalization all still use the original array+join approach exactly as before. **Zero changes to `EditorContract.ts`, `onTextChange`'s shape, or any consumer** — `text`'s type and semantics are identical; only how it's computed changed for this one call site.

**Measured a real, reproducible win for the specific thing being tested — but the honest caveat matters as much as the good news.** Same controlled methodology as the earlier reverted attempts (`git stash`/`stash pop` within the same session, `--mode=profile`, 1.5M-character synthetic note, caret at end), run via the source-mapped Electron harness (dev:browser's HMR-rebuilt bundle showed a misleading `(anonymous) @ ContractBridgePlugin.tsx:326` entry that didn't correspond to any code that should run during a plain keystroke burst — the same dev-bundle source-map-drift caution this doc has flagged twice before for this exact file; the Electron harness's static production source maps don't have this problem and were used for the real comparison instead). Summed every entry attributable to `ContractBridgePlugin`'s own text-production step (its `registerUpdateListener` callback body, `readCanonicalRootText`, the `children.map(getTextContent)` sweep, and — after the change — the rope's own `sliceString`/`toString`/`replace` calls), across two independent before/after pairs:

| | before (array + join) | after (rope) |
|---|---|---|
| Run 1 | ~134.8ms | ~50.3ms |
| Run 2 | ~109.9ms | ~54.5ms |

Both runs show roughly a **2x-2.7x reduction** in this specific, isolated cost — a real, reproducible win, unlike the two earlier attempts in this doc that measured flat-to-worse. Instrumentation confirmed why: the rope's `.replace()` already applied the precise edit when the mutation/dirty listeners fired, so producing the final string is *only* a tree-walk-and-concatenate (`sliceString`, ~10-12ms), with none of the array-build, prefix/suffix-compare, or copy-into-new-array overhead the old path pays on top of its own `getTextContent()` sweep.

**But total profiled JS time across the whole 20-keystroke burst did not show a matching, consistent drop** (4877→4480ms one run, 4304→4805ms the other — noise-dominated, no clear direction). This is not a contradiction: per this doc's own long-standing "death by a thousand cuts" finding, this specific cost was already a modest slice of a much larger diffuse total (`EventDispatch`/`RunTask`/`v8.callFunction`, React reconciliation, Lexical internals, GC), so a real, substantial improvement to one contributor doesn't necessarily move the aggregate outside its own run-to-run noise band. Recorded plainly rather than oversold — this doc's own rule that a result states what it does and doesn't prove.

**Decision, per the plan agreed with the user beforehand: keep it.** This is a real, positive, narrowly-scoped result, verified via the full test suite (235/235), `tsc`, `lint`, and a live-browser check (typing at document start/middle/end, Enter/Backspace merges, a rapid backspace burst, content verified byte-correct through the real save/load pipeline, zero console errors) — the required bar for anything touching the canonical-text/save path.

**What this validates, and what it doesn't, for the next session**: it validates that rope-based *string production* is a real lever worth pursuing further — the next natural step in this same vein is migrating `NoteTextHydrationPlugin.tsx`'s own separate, still-untouched canonicalization call site to the same rope (same low-risk, single-call-site pattern, no contract changes). **It does not yet validate the bigger "eliminate the flatten entirely for most consumers" migration** — that still requires replacing `setActiveNoteText`'s role in the data flow, which remains the separate, much larger, not-yet-started effort described above. The measured 2x win here is worth having regardless of whether that bigger migration ever happens, since it's already shipped, isolated, and doesn't require anything else to change to keep its value.

## This round: the rope lever, second call site — a real but smaller win, same pattern

Followed through on the previous round's own "next natural step": migrated `NoteTextHydrationPlugin.tsx`'s own separate canonicalization call site (its round-trip hydration guard, keyed on the `text` prop which changes every keystroke) onto the same rope, following the identical pattern — a `ropeSyncRef` populated by its own `LexicalRopeSync` instance, `readCanonicalRootText(canonicalizeCacheRef)`'s call replaced with `ropeSyncRef.current?.snapshot().toString() ?? readCanonicalRootText(canonicalizeCacheRef)`. Deliberately its own independent `LexicalRopeSync` instance, not shared with `ContractBridgePlugin`'s — matches this file's own pre-existing "each plugin owns its own copy of whatever sync state it needs" convention (`canonicalizeCacheRef` already worked this way before this round). No contract or consumer changes, same as before.

**Measured a real, but smaller, reduction** — same controlled `git stash`/`stash pop` + source-mapped Electron `--mode=profile` methodology, two independent pairs: 43.66ms→34.48ms and 40.13ms→30.87ms, both a consistent **~21-23% reduction**. Smaller in relative and absolute terms than `ContractBridgePlugin`'s own ~2x win from the same lever, and worth naming why rather than treating it as a weaker result: this call site's "before" cost was already lower to begin with (it's a lighter round-trip guard, not the full `onTextChange` dispatch path), so there's less redundant array/join work available to remove — the *rope* side of the equation is doing the same thing either way, there's just a smaller "before" to improve on here. Still real, still reproducible in the same direction across both pairs, still kept.

Verified the same way: full suite (235/235), `tsc`, `lint`, and a live-browser check specifically exercising this plugin's actual purpose (not just typing) — created two notes, typed into each, switched between them via `window.thockdownSections.setActiveNote`, and confirmed via `loadNote` readback that each note's saved content was correct with zero cross-contamination between them, zero console errors.

**Both of `readCanonicalRootText`'s hot-path call sites are now rope-sourced.** What remains from the original consumer survey, for whoever picks this up next: `canonicalizeParagraphSegmentsIncremental`/`readCanonicalRootText` are still used, unmodified, by `ContractBridgePlugin.tsx`'s mount effect and its context-menu handler (both rare, call-time-only paths — not worth the risk here) — and every other diffuse per-keystroke cost this doc has already catalogued (`EventDispatch`/`RunTask`/`v8.callFunction`, React reconciliation, Lexical-internal `cloneEditorState`/`getModernOffsetsFromPoints`, GC) is completely untouched by any of this round's work. The bigger "eliminate the flatten for most consumers" migration (replacing `setActiveNoteText`'s role) remains exactly as large and unstarted as the previous round described.

## This round: scoping the big "eliminate the flatten" migration, plus a small Phase A slice actually shipped

Per the previous round's own next-step framing (the "bigger... migration... requires replacing `setActiveNoteText`'s role in the data flow" — confirmed out of scope until explicitly greenlit), a user session asked specifically to scope this migration. Before writing any code, did a full producer/consumer audit of `activeNoteText` (the `useState` `setActiveNoteText` writes into, per `useDisplayedNoteText.ts`) across the whole app — every `setActiveNoteText(...)` call site (21 total) and every read of the state (direct or via `EditorSection.tsx`'s `currentEditorText` memo, the actual value most consumers read).

**Key scoping finding: the producer side is already narrow.** Of the 21 `setActiveNoteText` call sites, only 2 are genuinely hot (per-keystroke) — `useEditorSectionMount.ts`'s rAF-coalesced commit and its non-deferred `onTextChange` branch. The other 19 are already action-triggered (note switch, Tab/Enter/markdown-shortcut transforms, save-settle, protection/lifecycle actions). The actual problem is entirely on the *consumer* side, and it splits into two distinct issues, not one:

1. **Genuinely-every-keystroke consumers still pay a redundant re-derivation cost.** `splitMarkdownIntoPreviewBlocksIncremental` (preview render) and `resolveMarkdownSelectionContextIncremental` (toolbar active-state) both already do real incremental work internally, but both take a flat `text: string` and detect "what changed" by comparing two full strings (`text === previous.text`, an internal `.split('\n')`) rather than being handed precise edit ranges. A rope could hand them exact edit locations directly — this is the part that still needs `EditorContract.ts` extended (its `EditorTextChangeEvent.text`/`previousText`, `EditorSnapshot.text`, and all four `on*Transform` shapes are flat `string` today, confirmed by reading the file in full) and is genuinely the bigger, riskier, not-yet-started effort.
2. **Several consumers are hot for no good reason** — they recompute every keystroke regardless of whether their output is visible or about to be used. Three found, all fixable with zero contract change:
   - `documentFindHits` (`src/find/useDocumentFind.ts`) ran a full-document `normalizeInternalText` on *every* keystroke via its `useMemo`, even when the find bar is closed and the query is empty — `buildDocumentFindHits` (`src/editor/FindReplaceEngine.ts`) normalized `text` unconditionally, before checking whether the (already-normalized) query was empty.
   - The external-note "unsaved changes" hash effect (`App.tsx`) ran a full-document SHA-256 on every keystroke for file-backed notes, because it depends on the whole `activeSectionSnapshot` object and `App.tsx`'s `reportSectionHandle` does a shallow per-key diff across *all* of `SectionHandle`'s fields — since `activeNoteText`/`currentEditorText` are both fields on it, `activeSectionSnapshot` gets a new identity every keystroke, silently making everything keyed on the whole object hot. (Flagged, not fixed this round — see below.)
   - `activeNoteDocumentStats` (word/character count) — checked and left alone: it's displayed unconditionally whenever a note is open (`SectionEditorArea.tsx`, no visibility gate exists), so unlike the two above it's *correctly* hot, not accidentally hot. No incremental algorithm exists for word count; this is a genuine Phase-C "accept as floor" cost, not a Phase A target.

**Two of the three Phase A fixes shipped this round, no contract change, no fuzz test needed (both are behavior-preserving reorders/timing changes, not new incremental algorithms — see below for why the doc's usual fuzz-testing bar doesn't apply here):**

- **`buildDocumentFindHits`** (`src/editor/FindReplaceEngine.ts`): reordered to check the (short) query for emptiness *before* normalizing the full document, instead of after. Output is byte-identical for every input — the early-return path already existed, it just used to pay the expensive cost first. New `src/editor/FindReplaceEngine.test.ts` (this function had zero test coverage before) locks in the empty-query short-circuit plus basic case-sensitivity/CRLF-normalization behavior.
- **The external-note hash effect** (`App.tsx`, the `useEffect` around `currentExternalNoteHash`): wrapped the existing, byte-for-byte-unchanged `computeHash` async closure in a `window.setTimeout`/`clearTimeout` debounce on `SAVE_DEBOUNCE_MS` (imported from `useNoteSaveQueue.ts` — same cadence the save queue itself already uses), instead of running synchronously every time `activeSectionSnapshot` changes identity. Verified by reading (not guessing) what depends on `hasUnsavedChanges`/`currentExternalNoteHash`: `useNoteProtectionActions.ts`'s save/sync flows unconditionally set `hasUnsavedChanges: false` post-save rather than reading the debounced value, and — more importantly — `useEditorSectionMount.ts`'s `onTextChange` handler already has a *separate*, unmodified, synchronous `hasUnsavedChanges` update on every keystroke via a cheap string comparison (`canonicalText !== originalExternalText`), so the debounced SHA-256 path in `App.tsx` is a secondary reconciliation signal, not the only source of real-time feedback. This made the debounce safe to add without touching the more expensive-to-verify code path.

**Verification:** `tsc --noEmit`, `npm run lint`, full suite (241/241, up from 235 — the 6 new `FindReplaceEngine.test.ts` tests). Live-browser check (Playwright, real Chromium, not the embedded pane) for the find-bar change specifically — case-insensitive/case-sensitive search, clearing the query back to the empty-state path this fix touches, a second query after clearing, and a live edit while the find bar was open, all producing correct hit counts with zero console errors. **The hash-debounce change was not live-verified** — stated explicitly rather than silently skipped: browser-mock mode (`installBrowserMockBridges.ts`) has no ready-made path to open a note as "external" (that flow requires `window.thockdownExternalFiles`, not mocked), and rigging one up was judged disproportionate to the risk given the change is a timing wrapper around unchanged logic, verified safe by reading every downstream consumer of the value it produces (above). If a future session touches this code path again, that live-verification gap is still open.

**What's still open, explicitly, for whoever picks this up next:**

**The `App.tsx`/`SectionHandle` "structural hazard" flagged earlier in this same round turned out not to need a fix — checked, not assumed, in a same-round follow-up.** The concern was that `reportSectionHandle`'s shallow diff across *all* of `SectionHandle`'s fields means `activeSectionSnapshot` legitimately gets new `activeNoteText`/`currentEditorText` content every keystroke (correct — the text really did change), and the worry was that *other*, text-unrelated consumers keyed on the whole snapshot object would be needlessly re-triggered as collateral damage. Audited every reference to `activeSectionSnapshot` in `App.tsx` (16 total) directly: only one place in the entire file ever used the whole object as a dependency array entry (`[activeSectionSnapshot, ...]`) instead of a specific sub-field (`activeSectionSnapshot?.activeNoteId`, `?.isPreviewMode`, etc.) — the external-note hash effect, already fixed above. Every export/title-derivation call site that reads `activeNoteText` (`buildExportHtmlContent`, `handleExportPdf`, `handleExportMd`) goes through `getActiveSection()`, which reads directly from `sectionRegistryRef` (a ref, always live), never through `activeSectionSnapshot` — so it was never affected by this in the first place. No further action needed here; nothing left to fix under this heading.
- Phase B (the actual rope migration: extending `EditorContract.ts`, migrating `PreviewBlockSplit`/`MarkdownContext` to consume precise edit ranges instead of two-full-string diffing) is scoped but not started — this is the materially bigger, riskier piece, needs its own fuzz tests per consumer and mandatory live-browser verification for anything caret/render-adjacent, and should be confirmed with the user before starting per this doc's own standing precedent.
- Phase C (word count, find-when-actually-open, snapshot-diff comparison, export-title/hash paths) structurally still need a full string scan regardless of any future migration — these were confirmed, not assumed, to have no viable incremental algorithm today, and are the accepted floor, not a bug to keep chasing.

## This round: a true electron-builder-packaged build, measured — packaging itself is ruled out as the explanation for the user's multi-second report

Per this doc's own long-queued candidate ("a true `electron-builder`-packaged build under the perf harness — still never done, the most direct lever on the original, still-unreconciled user report of multi-second-per-keystroke lag"), built and measured one for the first time. Every prior Electron measurement in this doc launched `electron dist-electron/main.js` directly against the real `dist/` directory on disk — real IPC and real SQLite, but never through electron-builder's own asar-packing/native-module-rebuild pipeline, which is what an actual installed copy of this app runs.

**Built successfully via `npx electron-builder --linux dir`** (the `dir` target: asar-packed `app.asar` + real `release/<version>/linux-unpacked/` file layout, but skipping AppImage's own compression step — not needed to answer the packaging question, and avoids depending on `appimagetool`/network access this container may not have). electron-builder rebuilds native deps (`better-sqlite3`) against the packaged Electron's own ABI as part of packaging itself — no separate `electron-rebuild` step needed first.

**New harness: `npm run perf:input-lag:electron:packaged -- [flags]`** (`scripts/perf/measureInputLagElectronPackaged.mjs`, same flags/modes as `measureInputLagElectron.mjs`, reusing `perfHarness.mjs`'s shared functions). Launches the real packaged executable directly via Playwright's `_electron.launch({ executablePath, ... })` rather than `electron <script>`. One new wrinkle found and handled: a packaged (non-portable) build's `resolveDataRoot()` uses `app.getPath('userData')/data`, not `<repo>/data` (confirmed by reading `electron/main.ts` again, not assumed) — the harness passes a fresh `--user-data-dir` (a temp directory, cleaned up after each run) instead of clearing a repo-tracked directory, giving the same "fresh DB every run" guarantee the existing harness gets a different way.

**A real, useful gap in the existing source-map machinery surfaced and was fixed.** The first packaged `--mode=profile` run came back with only minified names (`WI @ index-DARAHYb0.js:555`, etc.) even though `build.sourcemap: true` is already on and the unpacked-launch harness resolves real names fine. Root cause, confirmed via `npx asar list app.asar` rather than guessed: a packaged build's script URL points *inside* `app.asar` (a single archive file, not a real directory), so `perfHarness.mjs`'s `loadTraceMapForUrl` — plain `fs.readFileSync`/`existsSync` from this script's own separate Node process, not Electron's asar-patched `fs` — silently failed to find `<script>.js.map` there even though the map genuinely is packed inside. Fixed by rewriting any `.../app.asar/<rest>` path to `REPO_ROOT/<rest>` before the file read: electron-builder's `files` config copies `dist/` into the asar root preserving its repo-relative structure, so the never-deleted, never-packed build-output copy at `<repo>/dist/...` is byte-identical to what's inside the archive — no need to touch the archive itself or add an `asar`-reading dependency. Verified: re-running `--mode=profile` on the packaged build now resolves this app's own functions the same way the unpacked harness always has (`App @ App.tsx:1564`, `EditorSection @ EditorSection.tsx:138`, `splitMarkdownIntoPreviewBlocksIncremental @ PreviewBlockSplit.ts:218`, etc.).

**Measured, same session, same synthetic 1.5M-character note, packaged vs. the existing unpacked-launch harness, both at caret-end:**

| mode | unpacked (`electron dist-electron/main.js`) | packaged (`electron-builder --linux dir`) |
|---|---|---|
| trace: EventDispatch (20-keystroke burst) | 4744.7ms | 4694.4ms / 4814.1ms (2 runs) |
| trace: RunTask | 3436.0ms | 3451.0ms / 3526.4ms |
| trace: v8.callFunction | 2246.7ms | 2195.7ms / 2232.1ms |
| profile: total sampled JS (3 runs each) | 2715.1 / 2643.2 / 2663.1ms | 2674.4 / 2666.7 / 2565.5ms |

**Conclusion: packaging itself is ruled out.** Every category-trace bucket and every profile-mode total lands within a few percent of its unpacked counterpart, well inside this environment's own established run-to-run noise band for these modes (~5-20%) — there is no meaningful asar/packaging-overhead signal here in either direction. One profile-mode run on the packaged build did come back anomalously low (273.1ms, a ~10x outlier) immediately after the source-map fix above — investigated rather than accepted at face value, since the doc's own prior finding was that profile mode (unlike burst mode) stays tightly reproducible; re-ran 3 more times and got 2674/2667/2566ms, confirming the low run was a one-off fluke (unclear cause — possibly transient container contention) and not a packaging-related effect, consistent with the trace-mode numbers gathered around it.

**Burst mode reconfirmed unreliable on this specific point too, not just previously.** Three runs each, packaged and unpacked: packaged landed in the same bimodal pattern the previous round's Electron burst investigation already root-caused as environmental (Playwright-round-trip) jitter, not a real signal — two runs at ~12ms mean, one at ~112ms mean; unpacked landed consistently in the ~104-115ms band across all three. This is the exact "burst mode isn't trustworthy at this effect scale in this environment" finding from two rounds ago, now additionally confirmed to apply identically regardless of packaging — use `--mode=profile`/`--mode=trace` for any future packaged-vs-unpacked comparison, per that round's own standing advice.

**What this does and doesn't resolve.** It rules out one of the two candidate explanations this doc had open for the still-unreconciled gap between this environment's worst-case measured numbers (~200ms/keystroke, any build style) and the user's reported multi-second-per-keystroke lag. The remaining, still-untested candidate is this environment's Xvfb + software-rendered (SwiftShader) GPU path versus real display/GPU hardware — nothing in this round's data speaks to that either way, since every measurement in this doc, packaged or not, has run under the same Xvfb/SwiftShader setup. That remains the next thing to test if real hardware ever becomes available to this effort, not something resolvable inside this container.

Verified: `tsc --noEmit`, `npm run lint`, full suite (241/241, unchanged — this round only touched `scripts/perf/` tooling and `package.json`'s scripts block, no `src/` changes). No live-browser functional check needed beyond what the harness itself already does (drives real typing through a real window) — this round is pure measurement/tooling, not an app-behavior change.

## This round: Phase B measured before being built — deprioritized, not attempted, based on real numbers

Per this doc's own "confirm scope before starting" precedent for Phase B (extending `EditorContract.ts`, migrating `PreviewBlockSplit`/`MarkdownContext` to consume precise rope edit-ranges instead of full-string diffing), the user greenlit a full push. Before writing the contract change, per this doc's own non-negotiable "measure before diagnosing" rule, profiled both target functions' *current* cost fresh (post this session's other fixes) — the scoping round's own analysis of these two functions was architecture-reasoning, not a fresh measurement of their actual current cost, and that turned out to matter.

**Fresh profile (unpacked harness, same 1.5M-character note, 20-keystroke burst, both caret positions):**

| | caret at end | caret at start |
|---|---|---|
| Total sampled JS | 2356.2ms | 2580.5ms |
| `splitMarkdownIntoPreviewBlocksIncremental` (`PreviewBlockSplit.ts`) | 24.45ms (~1.2ms/keystroke) | 31.42ms (~1.6ms/keystroke) |
| `resolveMarkdownSelectionContextIncremental` (`MarkdownContext.ts`) | 1.13ms (~0.06ms/keystroke) | 4.79ms (~0.24ms/keystroke) |

**Two findings that changed the decision:**
- `resolveMarkdownSelectionContextIncremental` (the toolbar bold/italic/heading-active-state path) is already essentially free — under a quarter-millisecond per keystroke at either position. There is no meaningful win available here; migrating it to rope edit-ranges would be pure risk for unmeasurable benefit.
- `splitMarkdownIntoPreviewBlocksIncremental`'s own diffing overhead (the `.split('\n')` + prefix/suffix line-compare loops Phase B would have eliminated) is real but small — ~1-1.6ms/keystroke, roughly 1% of the ~118-129ms/keystroke total on this note. The start-vs-end gap (1.2ms vs 1.6ms) is well inside this environment's normal run-to-run noise band, not the severe multi-x position blowup that flagged a genuine defect in earlier rounds (`getOffsetWithinRoot`'s old 1926ms self-time, `computeInlineStateAtOffset`/`countLineIndex`'s old position-only-present-at-one-caret-position signature) — so this doesn't read as a "page 1 must feel identical to page 1,000" violation at any alarming severity, just a small flat residual.

**Decision: don't build it, given a ~1% ceiling against the risk profile.** The contract extension this would have required (threading a precise edit-range through `EditorContract.ts`, plus new plumbing in `LexicalRopeSync` to accumulate a coalesced range across possibly-multiple Lexical listener firings within one update tick — a genuinely new mechanism with unverified cross-listener ordering assumptions) is exactly the shape of change two other functions in this same doc already went through: built, fuzz-tested, integrated, measured, and reverted (`canonicalizeParagraphSegmentsByKeyIncremental`/`sanitizeTextFragmentIncremental`, "This round: source maps landed" section above) because the real cost driver turned out not to be what the identity/dirty-tracking fix targeted. Spending a multi-round effort touching the render/toolbar-active-state contract for a measured ~1% ceiling, with a risk shape that already has one documented failure of the same pattern in this exact codebase, isn't a good trade — confirmed with the user before standing down rather than either silently dropping the greenlit task or building it anyway against the evidence.

**What this leaves as the actual state of the effort**: every remaining item this doc tracks is now either a confirmed accepted floor (Phase C: word count, open find, snapshot-diff, export-title/hash), an untestable-in-this-environment candidate (real display/GPU hardware vs. this container's Xvfb+SwiftShader), or a framework-internal cost with no clear lever (`cloneEditorState`/`getModernOffsetsFromPoints`). Phase B stays scoped in this doc (see the round above) as a documented, deliberately-not-taken option rather than a live next step — revisit only if a future fresh measurement shows a materially larger residual than the ~1% found here, e.g. if `PreviewBlockSplit`'s own algorithm changes in a way that makes its diffing step more expensive, or if a much larger document size than 1.5M characters is ever the real target scale.

No code changes this round — measurement only, so no new verification needed beyond confirming the existing suite still passes (241/241, unchanged).

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
  **Function-level CDP profiling against this production build now resolves real names, not just
  minified ones** — `vite.config.ts` sets `build.sourcemap: true`, and `perfHarness.mjs`'s
  `aggregateCdpProfile` resolves each sampled `callFrame` through the emitted `.map` file (via
  `@jridgewell/trace-mapping`) when one exists next to the built asset, falling back to the raw
  name otherwise. This app's own functions now show as `App @ App.tsx:1563`-style entries in
  `--mode=profile` output on the real Electron build; third-party bundles that ship without their
  own map (React, Lexical's `.prod.mjs`) still show minified names, which is expected — only this
  codebase's own source is mapped. The category-level trace mode still doesn't need any of this
  (it was never name-based) and remains the more reliable mode for Layout/Paint/JS-category
  attribution either way.
- **A third harness measures a true electron-builder-packaged build — `npm run
  perf:input-lag:electron:packaged -- [flags]`** (`scripts/perf/measureInputLagElectronPackaged.mjs`,
  same flags/modes). Despite the name above, `perf:input-lag:electron` launches `electron
  dist-electron/main.js` directly against the real `dist/` directory on disk — real IPC/SQLite, but
  never through electron-builder's own asar-packing + native-module-rebuild pipeline, which is what
  an actually-installed copy of this app runs. This harness runs `npx electron-builder --linux dir`
  (the `dir` target — asar-packed, real `release/<version>/linux-unpacked/` layout, skips AppImage's
  own compression step, which needs tooling/network this container may not have) and launches that
  executable directly via `_electron.launch({ executablePath })`. Confirmed this round: the two
  measure the same, within a few percent, on every mode — see "This round" above. Two things unique
  to this harness: (1) a packaged (non-portable) build's data root is `app.getPath('userData')/data`,
  not `<repo>/data` (`electron/main.ts`'s `resolveDataRoot`) — this harness passes a fresh
  `--user-data-dir` temp folder per run instead of clearing a repo directory; (2) source-map
  resolution for `--mode=profile` needed a fix in `perfHarness.mjs`'s `loadTraceMapForUrl` — a
  packaged build's script URL points inside `app.asar` (a single archive file, unreadable by this
  script's own plain, non-Electron-patched `fs`), so it now rewrites any `.../app.asar/<rest>` path
  to `REPO_ROOT/<rest>` before reading, since electron-builder's `files` config copies `dist/` into
  the asar root preserving repo-relative structure and the source copy at `<repo>/dist/` is never
  deleted. `release/` is gitignored — this harness's build output is never meant to be committed.
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
  - **Heap allocation sampling** (`HeapProfiler.enable` → `HeapProfiler.startSampling({samplingInterval:
    32768})` → *drive the interaction* → `const {profile} = await client.send('HeapProfiler.stopSampling')`;
    walk `profile.head`'s tree by `.selfSize`/`.children`, resolving `.callFrame` the same way as
    the CPU profiler's — same shape, same `resolveCallFrameName`). Committed as
    `startHeapSamplingProfile`/`--mode=heap` in `perfHarness.mjs`/`measureInputLag(Electron).mjs`.
    This is what finally attributed a real share of the `(program)` bucket to a specific defect (a
    ConsString-flatten pattern in CM6's `doc.toString()`, see "what `(program)` really is" above) —
    JS call-stack sampling alone can't distinguish "this native time is a string flatten" from any
    other unattributed native work, but a huge single allocation site pointing at the exact call
    site that triggered it can. `disabled-by-default-v8.runtime_stats` (Runtime Call Stats, which
    would give an even finer native-time breakdown) was tried and didn't pan out in this
    environment's Chromium build — enabling the category produced no RCS-shaped events at all, just
    the same plain GC/compile events already visible via `disabled-by-default-v8.gc`/
    `disabled-by-default-v8.compile` (both now also pass-through-able via `withCdpCategoryTrace`'s
    `categories` parameter / `measureInputLag.mjs`'s `--categories=` flag).
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

## CodeMirror 6 migration: performance audit (everything above this section is Lexical-era)

Everything above this section predates the CM6 migration and is scoped to `src/components/
Editor.tsx` (Lexical) — still the editor every real user gets today (see next paragraph).
This section covers a first performance audit of `src/components/CM6Editor.tsx`, the CM6-backed
`EditorAdapter` implementation built alongside it (see `EditorContract.ts`'s "implementations
may be partial while the rewrite is in flight" rule, and CM6Editor.tsx's own file-level doc
comment for the full slice-by-slice port history).

**Load-bearing fact, not a footnote: CM6Editor does not ship.** It's gated in
`SectionEditorArea.tsx` behind `import.meta.env.DEV && localStorage.getItem('thockdown:cm6-editor-spike') === '1'`
— statically false (and dead-code-eliminated) in any production build. Every real user, on the
packaged Electron app, still gets `Editor.tsx` (Lexical) today, with the full O(document)
per-keystroke residual already documented above. Any performance win in this section — CM6's
own ~2x-over-Lexical keystroke latency, or the fixes below — reaches zero real users until this
gate is removed. That's a product decision (CM6 is explicitly framed as a "spike"/"shadow-
adapter stage" migration with known-unported pieces, e.g. the `hasViewportLines`-style
first-restore flash gating), not something this audit round changed unilaterally.

### Method

A dedicated harness, `scripts/perf/measureCM6RealApp.mjs`, was added (reusing `perfHarness.mjs`'s
primitives, matching `measureInputLag.mjs`'s CLI shape) — it forces the CM6 path on via
`page.addInitScript` setting the localStorage flag before every navigation, then measures the
*real app's* `CM6Editor.tsx`, not the standalone `scripts/perf/cm6-spike/` prototype the Phase-0
spike measurement (`measureCM6Spike.mjs`) used. CM6's real scroll element
(`.cm-scroller`) and contenteditable (`.cm-content`) differ from Lexical's
(`.thockdown-custom-scrollbar` / `.editor-text`), so `placeCaretAt` needed a CM6-specific variant
using CM6's own `Mod-Home`/`Mod-End` default keybindings instead of `perfHarness.mjs`'s
scroll-then-click approach. A second script, `scripts/perf/verifyCM6PostFix.mjs`, does a
live-browser functional pass (typing, Tab, Enter, Ctrl+B, paste via a synthetic `ClipboardEvent`,
undo, and the caret-at-document-end-with-trailing-blank-lines case) with console-error
monitoring, per this doc's own "live-browser functional check is mandatory" rule for anything
touching caret/selection/rendering.

### Findings and fixes (all inside CM6Editor.tsx itself)

Despite CM6's own DOM rendering already being viewport-bound (unlike Lexical, which mounts every
paragraph), several call sites in CM6Editor.tsx were still doing O(document length) work per
keystroke/transform/paste — all found by direct code reading (grepping for `.doc.toString()` and
`{from: 0, to: doc.length}`), then confirmed live rather than assumed fixed from reasoning alone:

1. **`view.state.doc.toString()` on every caret update.** `updateCaret` (scheduled via rAF on
   every `docChanged`/`selectionSet`/`viewportChanged`, i.e. essentially every keystroke, scroll
   tick, and selection change), `reconcileCagedScroll` (every keyboard-refocus-caging key), and
   `reconcilePasteScroll` (every paste) all materialized the full document into a string purely to
   satisfy `CaretVisualPosition.ts`/`CaretTerminalOffset.ts`'s `rawText` parameter — code written
   for Lexical, where a DOM-derived selection offset genuinely has no cheaper source. That
   function's actual need is narrow: is the caret at the absolute document end, and if so, how
   many trailing newlines are there (a rare visual-compensation case for blank lines at doc end,
   gated on `caretRect.source === 'adjacent-probe' || 'anchor-fallback'`). Fixed with a CM6-local
   `resolveCM6CaretTopInScroll`, using `view.state.doc.length`/`view.state.selection.main` (both
   O(1) — CM6's own `EditorState` already carries these, no DOM walk needed) plus a
   256-character-bounded `Text.sliceString` tail probe for the trailing-newline count, never the
   whole document. Kept CM6-local rather than changed in the shared Lexical-consumed files, since
   `BlockCaretPlugin.tsx`/`CagedScrollPlugin.tsx` don't share this defect (different, already-cheap
   rawText source there).
2. **`applyTransformResult` always replaced the whole document.** Every Tab/Enter/markdown-
   shortcut/character-insert-transform (checklist typeover) dispatched
   `{from: 0, to: doc.length, insert: next.text}`, discarding CM6's own incremental
   change-tracking for what's almost always a small localized edit, on some of the most common
   keys there are. Fixed with a common-prefix/common-suffix diff (same technique already proven
   in `PreviewBlockSplit.ts`/`MarkdownContext.ts`/`canonicalizeParagraphSegmentsIncremental`) that
   dispatches only the minimal changed range. Provably exact by construction (prefix + insert +
   suffix reconstructs `next.text` exactly) — not a "trust prior computation" cache with a hazard
   class, so no fuzz test was needed, just the live-browser functional pass.
3. **The four pre-commit transform handlers re-derived canonical text from scratch.** Tab/Enter/
   markdown-shortcut/character-insert transform handlers all called a fresh
   `view.state.doc.toString()` to build the `text` field passed into the `EditorBindings`
   callbacks, instead of reusing `previousTextRef.current` — which the `updateListener` and the
   note-switch hydration effect keep synchronously in sync, and which is guaranteed already
   correct at the point these pre-commit handlers fire (before this keystroke's own edit
   commits). Exactly the same pattern already proven for Lexical's `ContractBridgePlugin.tsx` (see
   `readCanonicalRootText`'s fix, above in this doc) — CM6Editor had simply reintroduced the
   already-solved problem in its own, separate call sites.
4. **Paste handler materialized the full document to splice a string by hand.** Read
   `view.state.doc.toString()`, built `nextText` via `currentText.slice(0, from) + sanitized +
   currentText.slice(to)`, then dispatched that as another full-document replace. Simplified to a
   direct targeted `{from: selection.from, to: selection.to, insert: sanitized}` dispatch — CM6
   already supports replacing just the affected range; no full-document materialization,
   splicing, or replace needed at all. Also relies on fix #1 for its own pre-paste caret-position
   read.

### Verification

`npx tsc --noEmit`, `npm run lint`, full unit suite (unchanged, 251/251 — no CM6Editor-specific
tests existed to update; the fixes are exact-by-construction transformations, not caching
schemes, per fix #2's own reasoning above), `scripts/perf/verifyCM6PostFix.mjs` (live-browser,
all checks passed, zero console errors), and an A/B `git stash` comparison isolating fix #2's own
effect in the most directly-affected case: a 20-keystroke `Enter`-key burst on a synthetic
1.5M-character note, caret at document end (`node scripts/perf/measureCM6RealApp.mjs
--mode=burst --keystrokes=20 --position=end --char=Enter`) — **81.6ms/keystroke mean before,
73.5ms/keystroke after (~10%)**. A plain-character burst (`--char=x`, exercises fixes #1/#3 but
not #2) showed no significant change (~45ms/keystroke mean, both before and after) — see "what's
still open" below for why.

### What's still open

**CM6 itself already delivers a real win over Lexical at this scale, independent of this round's
fixes.** Same synthetic 1.5M-character note, same burst methodology as the Lexical numbers earlier
in this doc: a 30-keystroke plain-character burst at document end measured **~45ms/keystroke mean**
against Lexical's documented ~85-170ms at the same scale — roughly 2x, not the Phase-0 spike's
"30-40x" (that number was the *isolated* CM6 prototype with none of this app's caret-overlay/
scrollbar/caging/typing-sound wiring around it; the real, fully-integrated number is far more
modest, see next finding for why).

**The dominant remaining per-keystroke cost was not inside CM6Editor.tsx — found, and fixed, in
`EditorSection.tsx`.** A CDP JS-sampling profile (`--mode=profile`) on the plain-character burst
repeatedly attributed a large, dominant cost (~400-530ms across a 30-keystroke burst, by far the
single biggest bucket) to `(anonymous) @ EditorSection.tsx:549` — a line number that doesn't
correspond to any real function there when checked directly against the source, the same
dev-bundle source-map-drift artifact this doc flagged twice before (`:547` in an earlier round).
**Resolved this time by not trusting the profiler further**: per this doc's own established
fallback (`performance.mark`/`measure` bracketing real candidate functions), every hook call in
`EditorSection.tsx` feeding off `currentEditorText` was temporarily bracketed with mark/measure
pairs and re-measured live. Exact match, immediately conclusive: `activeNoteDocumentStats`'s
`useMemo` — `.trim().split(/\s+/u)` word-counting the *entire document* on every keystroke,
purely to feed a footer word/character-count display (`SectionEditorArea.tsx`) — accounted for
**473.8ms of the 30-keystroke burst (~14.8ms/keystroke mean, up to ~34ms max)**, dwarfing every
other hook (`usePreviewMarkdownRendering` 96ms, `useNoteSnapshotTimeline` 75ms, everything else
under 25ms total). This is shared Lexical+CM6 infrastructure — both editor paths route through
`EditorSection.tsx` identically — so it was never CM6-specific, just masked in earlier Lexical-era
profiling by other, larger, since-fixed costs.

Fixed by debouncing (200ms) rather than computing synchronously in a `useMemo`: word/character
counts have no correctness reason to be exact on every keystroke (they only ever feed a passive
display, never editor state/selection/save logic), so this is squarely "deferred/off-critical-path
work" per the philosophy doc's solution-hierarchy tier 3 — the O(document length) cost itself
isn't reduced, it's moved off the keystroke-to-paint path entirely. Verified behaviorally
equivalent (same computation, just deferred) via a live-browser check comparing the stats display
before/after typing against a `git stash`-reverted baseline (identical output in both cases, so no
regression in the counting logic itself, only its timing) — `npx tsc --noEmit`, `npm run lint`,
full suite unaffected (251/251, no test covered this exact useMemo). Re-measured, full 30-keystroke
plain-character burst on the 1.5M-character note, caret at end:
- **CM6 path: 44.96ms → 22.69ms/keystroke mean (~50%), 42ms → 16.7ms median (~60%).**
- **Lexical path (the editor real users actually get today): 68.5ms/keystroke mean** — this fix
  benefits the shipping editor directly, independent of the CM6-gate question below.

**Lesson for whoever profiles this next**: the source-map-drift caveat from earlier rounds is now
confirmed, not just suspected — an anonymous-function CDP profile entry's line number in this
`dev:browser` environment cannot be trusted at face value. Best working theory: it reports where
the enclosing anonymous function/closure *starts*, not the currently-sampled statement, so for a
hook-call argument spanning hundreds of lines that start can land far from the actual hot line.
Named-function entries (e.g. `normalizeForComparison`, `splitMarkdownIntoPreviewBlocksIncremental`)
remain reliable. When an anonymous entry dominates a profile, don't guess from the line number —
bracket candidates directly with `performance.mark`/`measure` (see
`scripts/perf/measureEditorSectionHooks.mjs`, added this round and left in place as a reusable
diagnostic for the next time `EditorSection.tsx`'s hook fan-out needs auditing) and let real
numbers settle it.

**A second instance of the same pattern, found by re-profiling after the fix above — also
fixed.** With `EditorSection.tsx:549` gone from the profile, the next-largest named entry was
`normalizeForComparison @ useNoteSnapshots.ts:98` (~87.5ms/30-keystroke burst, ~2.9ms/keystroke
mean). Same shape as `activeNoteDocumentStats`: `normalizedLiveText` re-normalized `liveText` (the
whole document) on every keystroke, feeding `snapshotIdsMatchingPresent`/`hasPendingManualChanges`
— both purely drive the Time Machine timeline's "present" dot (`PresentStateCircle.tsx`,
`SnapshotTimelineSlider.tsx`), never editor state or save logic. Fixed the same way: a debounced
`debouncedLiveText` (200ms) instead of tracking `liveText` directly, leaving the explicit
`createManualSnapshot` action (a user click, needs the exact current text, not a stale debounced
one) untouched. Verified via `npx tsc --noEmit`, `npm run lint`, full suite (251/251), and a
live-browser check confirming the present-state indicator still renders and updates with no
console errors. Total sampled JS time for the profiled burst: **1696ms → 1119ms (34%) after both
fixes**, and CM6-path burst wall-clock: **44.96ms → ~23ms/keystroke mean (~50%)**.

**The production gate is the highest-leverage open item, and is a product decision, not an
engineering one.** Flipping `isCM6EditorSpikeEnabled` in `SectionEditorArea.tsx` to ship CM6 to
real users needs an explicit decision (not assumed by this audit) given CM6Editor.tsx's own doc
comment lists at least one deliberately-unported piece (the boundary-restore flash gating) and
the file is still described as a "shadow-adapter stage" spike, not a completed migration. Asked
explicitly this round — the answer was "not yet, keep auditing/hardening first," which is why this
section exists as multiple fix-and-reprofile rounds rather than stopping at the first one.

**Update, a later session: the gate is flipped — CM6 is the production editor as of 0.5.4.** The
user, building main locally, noticed the "infinity grid" (the box-grid background this whole
audit ported to CM6) wasn't showing up — a direct symptom of the gate above still defaulting to
off outside dev+localStorage-opt-in. Asked to flip it for real this time. Before doing so, flagged
the one still-open item from this audit (the boundary-restore flash gating, still not-ported as of
the paragraph above) back to the user rather than shipping past a known gap silently; asked to
close it first rather than ship as-is.

Ported `hasViewportLines`/`isSnapshotRestorePending` into `CM6Editor.tsx`, mirroring
`Editor.tsx`'s own mechanism exactly: same two pieces of state, the same one-rAF settle window
bracketing `applySnapshot`, and the same set of gated visuals (grid lines, boundary-zone
backgrounds, drag handles, the caret overlay, the selection highlight — plus the `.cm6-editor-root`
container's own `visibility` toggle, CM6's equivalent of Editor.tsx's ContentEditable visibility
hide). New `fontReady`/`caretSuspended` props on `CM6EditorProps`, both optional and defaulting to
"already ready"/"not suspended" so the perf harness and the existing `verifyCM6*.mjs` regression
scripts keep behaving exactly as before without modification; `SectionEditorArea.tsx` wires the
real values through (`editorFontLoadVersion > 0`, `isCaretSuspended`) the same way it already does
for the Lexical branch.

Flipped `isCM6EditorSpikeEnabled` → `isCM6EditorEnabled`, CM6 the default with no DEV/localStorage
opt-in required; kept a low-cost rollback (`localStorage['thockdown:cm6-editor-spike'] = '0'` now
forces the Lexical editor back on for a given browser profile without a rebuild) given how
recently this graduated past "shadow-adapter stage" — cheap insurance, not scope creep, since the
mechanism already existed and only needed inverting.

**The specific regression risk this gating change carries, and why it was checked directly rather
than trusted from the reasoning alone**: if any real mount/note-switch path ever failed to call
`adapter.applySnapshot({ viewportLines })`, `hasViewportLines` would stay `false` forever and the
editor would render permanently blank — no grid, no caret, nothing — exactly the kind of
caret/selection-adjacent regression this doc's own process discipline treats as the highest-severity
class of bug. Verified live, not assumed: a new `scripts/perf/verifyCM6ProductionGating.mjs`
(committed as a regression check, not a one-off) confirms CM6 mounts by default with no
localStorage flag set, the grid/caret render on first mount, switching to a second note through
the *real* UI (clicking its sidebar entry, not the mock-bridge shortcut, which doesn't exercise the
live in-app restore path) leaves both still rendered and the caret un-stuck, the switched-to note's
text actually loaded, and the `'0'` rollback flag genuinely falls back to the Lexical editor — zero
console errors throughout. Also ran the existing `verifyCM6PostFix.mjs` (typing, Tab, Enter,
Ctrl+B, paste, undo on a large note with trailing blank lines) and the full `verifyCM6Phase2Slice*.mjs`
regression suite (all 18 scripts) against the flipped default, plus `npx tsc --noEmit`, `npm run
lint`, and the full unit suite.

**What's still open, honestly, after this flip**: CM6Editor has no empty-note placeholder text
("Jot down a thockdown note...") the way `Editor.tsx` does — noticed while doing this port, real,
but unrelated to the flash-gating this round closed, and not fixed here (see `TODO.md`). Every
other gap this audit ever found in `CM6Editor.tsx` was already fixed in an earlier round (see the
sections above) before this flip was even requested.

### Diminishing returns confirmed by a further round (after the two debounce fixes merged)

The two fixes above (PR #44, merged into `main`) were re-profiled once more, with the same
`performance.mark`/`measure` bracketing technique applied to every remaining hot-path call in
`CM6Editor.tsx`'s `updateListener`/`updateCaret`/`reconcileCagedScroll` and to every step of
`useEditorSectionMount.ts`'s `onTextChange` binding (typing-sound setup, title-preview
derivation, `doc.toString()`, the React `setState` calls, `queueSave`). **Conclusion: no further
single dominant offender remains.** Every bracketed piece measured well under 2ms/keystroke mean
on the synthetic 1.5M-character note, and most are already the incrementally-optimized versions
this doc's own history already built (`deriveNoteTitleIncremental`, `updateInlineStateLineCacheIncremental`,
`splitMarkdownIntoPreviewBlocksIncremental`). The instrumentation was reverted after answering the
question — this is a diagnostic technique to reach for again, not permanent code (see
`scripts/perf/measureEditorSectionHooks.mjs` for the reusable harness half of it).

**`(program)` and `(garbage collector)` are now the two largest remaining CDP profile buckets**
(~38% of total sampled time combined) — not attributable to a specific named function, and the
best available explanation is downstream of the one remaining full-document string allocation per
keystroke: `update.state.doc.toString()` in `CM6Editor.tsx`'s `updateListener` (and
`readCanonicalRootText()`'s equivalent in Lexical's `ContractBridgePlugin.tsx`), required because
the `EditorBindings` contract (`EditorContract.ts`) hands the *entire* canonical text to
`onTextChange` on every doc-changing keystroke. The allocation itself is cheap to *create*
(~0.4ms measured) but happens every single keystroke regardless of document size or how small the
edit was, and downstream consumers (`useNoteSaveQueue.ts`'s `queueSave`, `noteTitle.ts`'s title
derivation, `MarkdownContext.ts`'s inline-state scan, `PreviewBlockSplit.ts`) all receive this
same full string and must at minimum diff it against their own previous copy to find what changed
— GC pressure from one ~1.5MB string (plus whatever each consumer retains a reference to) every
keystroke is a plausible, not yet directly measured, explanation for these two buckets. **Not
confirmed by a direct measurement yet** — see the handout below for what to check first.

**What was NOT pursued further, and why:** typing-sound synchronous overhead
(`typingSoundManager.playRandomClick`'s pre-await portion, ~1.4ms mean/~10ms max) is real but
isn't a document-scale defect — its cost doesn't grow with document size at all, it's native Web
Audio API node-creation overhead — so it's out of scope for *this* effort's contract even though
it's part of overall keystroke latency. (A separate, narrower fix for it *was* made this round —
see "Typing-sound bypass fix" below — but reducing it further, or trimming the feature, was
explicitly ruled out by the user; sound quality is a deliberate product identity, not incidental
weight to cut.)

### Typing-sound bypass fix (small, separate from the document-scale audit above)

`TypingSoundManager.ts`'s `playLayer` ran the *entire* Web Audio node-creation chain
(`createBufferSource`, buffer lookup, jitter/playbackRate/detune computation, `createGain`,
`connect`, echo-layer construction, `.start()`) for every layer (click/bass/treble) on every
keystroke, even when that layer's own volume slider was at 0 or the layer was toggled off — the
existing `layer.enabled`/`assetIndexes.length` gate caught the "layer off" case, but nothing
caught "volume slider at 0" before doing all of the above for zero audible output. Fixed two ways:

1. `playLayer` now computes `effectiveGain` (`options.gain × layer.gain`) immediately after the
   existing `enabled`/`assetIndexes` check and returns before touching `AudioContext` at all
   (skips even `ensureContextRunning`'s already-cheap resume check) if `effectiveGain <= 0`.
2. A new `isAnyLayerAudible()` gate at the very top of `playRandomClick` skips the *entire*
   pipeline — `tryPlayBoundBuffer`, `getSoundAttributes`, all three `playLayer` calls, and the
   background bounce scheduling — in one check when every layer is simultaneously silent (e.g.
   bass/treble volume both 0, or global key volume 0 with bass/treble also silent), rather than
   discovering that three separate times after doing real work each time.

Verified live (not just by reading the code): `AudioContext.prototype.createBufferSource`/
`createGain` were monkey-patched via `page.addInitScript` to count real calls, then the actual
settings UI was driven through Playwright (open options → expand "Keystroke Sounds" → enable set
A → max all three volume sliders via keyboard `End` → confirmed typing created new
`AudioBufferSourceNode`s as expected) followed by silencing all three sliders via keyboard `Home`
and confirming typing created **zero** new nodes of either kind. `npx tsc --noEmit`, `npm run
lint`, full suite (251/251) all clean. Not merged into a broader document-scale claim — this is a
correctness-preserving early return (identical behavior whenever `effectiveGain > 0`), verified in
isolation.

### Handout: exploring the `EditorBindings` full-text-per-keystroke contract (not started)

This is a scoping brief for whoever picks up the architectural option flagged above, not a plan
already committed to — the user asked for this to be written up for exploration, explicitly
deferring the actual redesign decision.

**The problem, precisely stated.** `EditorContract.ts`'s `onTextChange` event carries the
*entire* canonical document text (`event.text: string`) on every keystroke that changes the
document, for both the Lexical (`Editor.tsx`/`ContractBridgePlugin.tsx`) and CM6
(`CM6Editor.tsx`) implementations alike. This was a reasonable, simple contract when the app was
young; at 1.5M characters it means one full-string allocation (`view.state.doc.toString()` /
`readCanonicalRootText()`) every keystroke, handed to every consumer downstream
(`useEditorSectionMount.ts`'s `onTextChange` binding, and transitively `useNoteSaveQueue.ts`,
`noteTitle.ts`, `MarkdownContext.ts`, `PreviewBlockSplit.ts`, `useDocumentFind.ts`,
`usePreviewScrollbar.ts`, `useMarkdownFormattingToolbar.ts` — see `EditorSection.tsx`'s hook
fan-out). Every one of those consumers has already been made *internally* incremental (reuse
prior work, diff against a cached previous string) per this doc's long history — but every single
one of them still starts from a **fresh, fully-materialized string** each keystroke, because
that's what the contract hands them. The suspected remaining cost (the `(program)`/
`(garbage collector)` buckets above) is downstream of *producing* that string, not of any
consumer's own processing of it.

**Before designing anything: confirm the hypothesis is real, not assumed.** This doc has been
burned before by trusting a plausible-sounding diagnosis without measuring it (see "The original
diagnosis in this doc was wrong" near the top). Concretely, before touching `EditorContract.ts`:
1. Use `--mode=trace` (category-level CDP trace, already in `perfHarness.mjs`) with a
   `disabled-by-default-v8.gc` or equivalent GC-specific category enabled, or Chrome's own heap
   allocation instrumentation (`HeapProfiler.startSampling`), to attribute the
   `(garbage collector)` bucket to specific allocation sites rather than assuming it's this one.
2. Try a cheap, reversible experiment first: comment out (or short-circuit) every consumer of
   `event.text` except the minimum needed for `latestEditorTextRef`, re-measure the same
   1.5M-character burst, and see how much of the `(program)`/GC cost actually goes away. If it's
   small, this whole redesign isn't worth its cost and something else is the real driver.

**If the hypothesis holds, the shape of a fix (not designed in detail here):** CM6 already has
the document as a `Text` (rope) object (`view.state.doc`) with O(log n) slicing and no need to
materialize a flat string for most operations. The redesign direction is threading that (or an
equivalent incremental-diff payload — old text + change range + inserted text, rather than a full
new string) further downstream instead of collapsing to a string immediately in the
`updateListener`. Concretely this likely means: extending `EditorTextChangeEvent` (or adding a
parallel, richer event) to carry a change description (`{from, to, insert}` or equivalent) instead
of only `text: string`, and reworking each downstream consumer to accept that incrementally
instead of assuming a fresh full string every time.

**Why this is a real architectural project, not a quick trim — scope it accordingly:**
- `EditorContract.ts` is the shared boundary both `Editor.tsx` (Lexical) and `CM6Editor.tsx`
  implement (`docs/editor-contract.md`) — changing its shape means updating both implementations
  in lockstep, and Lexical's own change-tracking primitives are different from CM6's `Text`/
  `ChangeSet` (no native rope-with-diff object the same way), so the two sides may need genuinely
  different adapters onto whatever the new contract shape is.
- Every downstream consumer listed above currently assumes `event.text` is the plain, complete,
  current document — several of them (`queueSave`, title derivation) already keep their own
  "last known text" state for diffing purposes, so a change-delta-based contract could actually
  *simplify* some of them (no need to diff old-vs-new when you're handed the diff directly) but
  each one needs individual review, not a mechanical find-and-replace.
- This is squarely `docs/document-scale-performance-philosophy.md`'s own "process discipline":
  measure first, verify any incremental/diffing logic against ground truth with a fuzz test (this
  codebase has two documented incidents of a plausible incremental scheme shipping a silent
  correctness bug — see that doc's "Process discipline" section), and a live-browser functional
  check before trusting anything here touches editor state.

Not started. Left here so the next session (or this one, on request) has the actual problem
statement, the measurement gap to close first, and the known scope/risk shape, rather than
starting from a blank page.

## This round: the handout's own hypothesis, tested before any redesign was built — refuted

Picked up the handout above at its own explicit first instruction: "before designing anything,
confirm the hypothesis is real, not assumed." Ran its named step 2 (the cheaper, more direct of
the two suggested checks): short-circuit every consumer of `event.text` except
`latestEditorTextRef` and re-measure, to see how much of the `(program)`/`(garbage collector)`
CDP-profile buckets actually goes away.

**Method.** A temporary, uncommitted one-line early `return` inserted into
`useEditorSectionMount.ts`'s `bindings.onTextChange`, immediately after
`latestEditorTextRef.current = canonicalText` — skipping typing-sound playback, the
deferred/immediate `setActiveNoteText`/`setEditorTextVersion`/`setEditorSelection` commits,
external-note bookkeeping, title-preview derivation, and `queueSave`, i.e. every real consumer of
the flattened string this handout names. This is a strictly more aggressive cut than any real
contract redesign could achieve (a rope-diff-based contract would still have to feed *something*
to each consumer; this feeds them nothing), making it the correct upper bound on the redesign's
possible win. `npm run perf:input-lag -- --mode=profile --chars=1500000 --keystrokes=30
--position=end`, dev:browser, 4 independent runs with the change in place and 4 with it reverted
(`git checkout` between sets, same session, same note) — per this doc's own established caution
that a single profile-mode run isn't always enough to separate a real effect from run-to-run
noise at a modest effect size.

| | baseline (unmodified) | consumers short-circuited |
|---|---|---|
| total sampled JS (4 runs) | 2448.6, 1963.1, 2068.2, 2101.5 — mean 2145.4ms | 1608.8, 1536.4, 1702.1, 1424.1 — mean 1567.9ms |
| `(program)` (4 runs) | 1241.1, 902.1, 983.9, 1002.8 — mean 1032.5ms | 1044.4, 984.4, 1113.7, 877.5 — mean 1005.0ms |
| `(garbage collector)` (4 runs) | 84.0, 65.1, 88.9, 65.2 — mean 75.8ms | 55.1, 77.3, 38.3, 47.6 — mean 54.6ms |

**Conclusion: the handout's specific hypothesis is refuted, not confirmed.** Total sampled JS did
drop, a real ~27% (2145.4ms → 1567.9ms mean) — but almost none of that came from the two buckets
the hypothesis named. `(program)` is statistically flat (1032.5ms → 1005.0ms, a ~2.7% difference
that's smaller than the run-to-run spread *within* either the 4 baseline or 4 experiment runs
individually) — eliminating literally every consumer of the flattened string, the most aggressive
version of the fix the handout proposed, left this bucket untouched. `(garbage collector)` did
drop proportionally (~28%), but it's a small absolute contributor either way (~76ms → ~55ms out of
a ~2100ms total) — not close to explaining the dominant cost. The ~577ms of real total reduction
came almost entirely from named, already-attributed consumer-side work disappearing from the
profile as expected (`$reconcileRoot`/`$reconcileNode`/`$createChildrenArray` React-triggered
Lexical reconciliation, `sanitizeTextFragment`, `splitMarkdownIntoPreviewBlocksIncremental`,
`computeCommonLinePrefixSuffixLen` in both `noteTitle.ts` and `MarkdownContext.ts`,
`deriveNoteTitleIncremental`, `validateTextInvariants`) plus a partial drop in
`cloneEditorState`/`getModernOffsetsFromPoints` from fewer React-state-triggered re-renders — i.e.
exactly the already-incremental, already-optimized consumer costs this doc's history already
built, now simply confirmed to still be real and to still be there, not a new discovery.

**What this means for the redesign the handout scoped.** The `(program)` bucket — the single
largest entry in every profile this doc has taken since the CM6 audit — is not, per this direct
test, downstream of the full-text-per-keystroke contract shape at all. It survives unchanged even
when nothing downstream of `latestEditorTextRef` runs. Whatever it actually is (V8-internal
bytecode/IC dispatch overhead, native string/array operations without an attributable JS frame,
or something else) sits upstream of or parallel to the `EditorBindings` contract — inside
Lexical's own `registerUpdateListener`/reconciliation cycle, which fires and does its own work
regardless of what the app's `onTextChange` callback does with the result. **Don't build the
`EditorContract.ts`/rope-diff redesign on the strength of this hypothesis** — the measured upper
bound on its win (a strictly more aggressive cut than the real redesign could achieve) is ~27%
total, concentrated entirely in costs already fixed by this doc's existing incremental work, with
zero measured effect on the actual dominant bucket. This is the same shape of finding as the
"Phase B measured before being built — deprioritized" round above (a plausible-sounding structural
fix, measured before being built, found to have a capped and unimpressive ceiling) — not a new
technique, the same discipline applied one level up the stack.

**What's still open, honestly.** `(program)`'s own ~1000ms/30-keystroke-burst floor is not
explained by this round — only shown *not* to be what the handout guessed. Attributing it further
would need a different diagnostic than CDP JS sampling (which by construction can't attribute time
it can't tie to a JS call frame) — e.g. Chrome's `disabled-by-default-v8.gc` / `disabled-by-default-v8.compile`
trace categories (not yet tried; `withCdpCategoryTrace` in `perfHarness.mjs` already accepts a
categories string, this would need a small script variant rather than a `perfHarness.mjs` change,
since the standard category set is what every other trace-mode measurement in this doc compares
against), or Chrome's `HeapProfiler.startSampling` for allocation-site attribution. Given the
`EditorContract` redesign this was meant to justify is now off the table per this round's own
finding, digging further into `(program)`'s exact composition is lower-priority than it looked
before this test — worth doing only if a future session has a fresh, specific lever in mind for
whatever it turns out to be, not as an open-ended "find out what it is" exercise. This measurement
was also dev:browser-only, consistent with the rest of this doc's default methodology but not yet
cross-checked against the packaged Electron app the way several earlier findings in this doc were
— if `(program)`'s composition is investigated further, spot-check there too before trusting a
dev:browser-only number, per this doc's own repeated caution that the two don't always agree.

No source changes this round — the short-circuit was a temporary, uncommitted local edit,
reverted (`git checkout`) immediately after measurement. Verified clean: `git status` shows no
diff, `npx tsc --noEmit` passes.

## This round: what `(program)` really is, on the now-shipped CM6 editor — found a real allocation-site defect and fixed it

The CM6 production flip (see the CodeMirror section above) landed since the round above, changing
what "the shipped editor's profile" even means — this round's own investigation had been scoped
to Lexical, which real users no longer get by default. Re-baselined on CM6 first: same synthetic
1.5M-character note, `--mode=profile`, 30-keystroke burst, caret at end. CM6's total sampled JS is
already dramatically smaller than Lexical's own numbers throughout this doc's history — ~600-700ms
vs. Lexical's ~2000-2400ms, and `(program)` is a much smaller *share* too (~100-127ms, ~15-20% of
total, vs. Lexical's ~1000-1241ms, ~50-65%) — consistent with CM6 not paying Lexical's own
reconciliation/node-tree overhead. `(program)` is still the largest or second-largest named bucket
on CM6, though, so the question carried over.

**A real, immediate casualty of the CM6 flip, found and fixed first**: `npm run perf:input-lag`
started timing out at `placeCaretAt` immediately after the flip — `perfHarness.mjs`'s
`SCROLLER_SELECTOR` only ever matched Lexical's `.thockdown-custom-scrollbar` class, which
`CM6Editor.tsx` never sets (`measureCM6RealApp.mjs` already had its own CM6-specific
`placeCaretAtCM6` for exactly this reason, back when CM6 was opt-in). Fixed by widening the shared
selector to `:is(.thockdown-custom-scrollbar, .cm-scroller):has(...)`, so the general-purpose
harness works against whichever editor is actually active without the caller needing to know which
one ships today.

**Picked up this doc's own two suggested next steps for attributing `(program)`.** (1) GC/compile
category tracing: extended `withCdpCategoryTrace` with an optional `categories` override (default
unchanged) and a matching `--categories=` flag on `measureInputLag.mjs`, then ran with
`disabled-by-default-v8.gc`/`disabled-by-default-v8.compile` added. Inconclusive on its own: GC
totaled ~254ms and compile/JIT ~233ms across the burst, but category-trace mode sums across *all*
threads (including background GC/compiler worker threads), while the JS-sampling profile's
`(program)` bucket is main-thread-only self-time — the two aren't directly comparable, and
`disabled-by-default-v8.runtime_stats` (the category that would give a proper Runtime Call Stats
breakdown) turned out not to emit any actual RCS events in this Chromium build regardless of
category flags (confirmed by capturing raw trace events directly — only plain GC/compile `X`
events came through, no counter/object events of the kind RCS needs). This lever is recorded as
attempted and inconclusive, not silently dropped.

(2) Heap allocation-site attribution (`HeapProfiler.startSampling`) was the one that actually
answered the question. Added `startHeapSamplingProfile`/a `--mode=heap` flag to both
`measureInputLag.mjs` and `measureInputLagElectron.mjs`, reusing the existing source-map-aware
`resolveCallFrameName` (HeapProfiler's `SamplingHeapProfileNode.callFrame` has the same shape as
the CPU profiler's, so this came for free). First run, on `dev:browser`: **83.5% of all sampled
allocation** (~38MB of ~46MB across a 30-keystroke burst) attributed to a single site the resolver
labeled `event @ useEditorSectionMount.ts:776` — a name that turned out to be misleading (see
below), but the *line* was real, and directly explains a meaningful share of `(program)`.

**Root cause, confirmed mechanistically, not guessed.** `CM6Editor.tsx`'s hot `updateListener`
produces `event.text` via `update.state.doc.toString()`. CodeMirror's own `Text.toString()` calls
`sliceString(0)`, which builds the result via **repeated `+=` concatenation across every child**
(`node_modules/@codemirror/state/dist/index.cjs`'s `TextNode.sliceString`/`TextLeaf.sliceString`)
— a classic pattern that leaves V8 holding a lazy **ConsString** (a tree of unmerged string
pieces) rather than a flat buffer. The first thing downstream that touches even a single character
of that string forces V8 to flatten the *entire* string to service the access — an O(document
length) copy that shows up as native, unattributed time (`(program)`) and a single huge allocation
(the flat copy), regardless of how small the actual touch was. In this app, the very first thing
`bindings.onTextChange` does is `deriveTypingSoundKeyId(event)`
(`useEditorSectionMount.ts:776`), which reads `event.text[event.selection.start - 1]` — one
character — triggering a full ~1.5MB flatten on that keystroke. The misleading `event` label came
from `resolveCallFrameName`'s source-map lookup picking up a parameter-name mapping at that
generated position rather than the enclosing function's name; confirmed by dumping the *raw*
(pre-source-map) `callFrame` for the same allocation, which had an empty `functionName` and a
generated line/column that, read directly out of the built bundle, matched
`deriveTypingSoundKeyId`'s body exactly (`se=>{if(se.source!=="user-input")return; ... const
V=se.text[se.selection.start-1] ...`). **Confirmed this wasn't specific to that one function**:
short-circuiting just `deriveTypingSoundKeyId`'s body didn't shrink the allocation, it *moved* it
— the next run's heaviest site became a `split`/`join` call elsewhere in the same `onTextChange`
dispatch chain, same ~46MB total. Short-circuiting *every* consumer of `event.text` (the same
"handout hypothesis" technique from the round above) dropped total sampled allocation from
~45-49MB to ~1.5MB (a ~30x drop) — direct proof the cost is a single per-keystroke flatten
triggered by whichever consumer happens to touch the string first, not a property of any one
function.

**The fix**: CodeMirror's `Text.toJSON()` is public, documented API — "Convert the document to an
array of lines (which can be deserialized again via `Text.of`)" — built via direct array pushes
(`Text.flatten`), not `+=`. `doc.toJSON().join('\n')` produces the identical string (same content,
same `\n` separator `toString()` itself documents) in one native `Array.join` pass, with no lazy
ConsString left to flatten later. Applied at both hot call sites: the `updateListener`'s own
`event.text` production, and a second, smaller instance found by extending the same reasoning
found here to CM6Editor.tsx's note-switch hydration-check effect (`useEffect` keyed on
`[noteId, initialText]`, which — like `NoteTextHydrationPlugin.tsx`'s own equivalent effect on the
Lexical side, already documented earlier in this doc — fires on every keystroke since
`initialText` changes every keystroke) doing its own `view.state.doc.toString() === initialText`
comparison, paying the same flatten cost a second time per keystroke.

**Provably exact, no fuzz test needed** — same reasoning this doc has already used for CM6's own
diff-based `applyTransformResult` fix and `buildDocumentFindHits`'s reorder: this is an alternate,
equivalent way to materialize the same string, not a caching/reuse scheme with a hazard class to
adversarially test.

**Verified, in order**: `npx tsc --noEmit`, `npm run lint`, full unit suite (251/251); the full
existing `verifyCM6Phase2Slice*.mjs` (18 scripts) + `verifyCM6PostFix.mjs` +
`verifyCM6ProductionGating.mjs` regression suite, twice (once after the first call site, once
more after the second) — 20/20 clean both times, including the note-switch/scroll-restore and
save-pipeline round-trip checks most likely to catch a subtle correctness break in text
production. Measured via a controlled A/B (isolated to just `CM6Editor.tsx`, harness/tooling
changes held constant, 3 runs each side): total sampled allocation per 30-keystroke burst dropped
**~45-49MB → ~19MB** (first call site only) **→ ~13.7MB** (both). CDP profile-mode GC time showed a
clean, non-overlapping ~20% reduction across the 3-vs-3 runs (every fixed run below every baseline
run) for the first call site; total/`(program)` themselves moved a smaller, noisier amount (~7-9%
on the first fix) — consistent with allocation volume being the more reliable signal for this
specific change in this environment's established wall-clock/CPU-sampling noise band, not a
contradiction of the allocation-based finding.

**What this answers, and what it doesn't, about "what `(program)` really is."** A meaningful,
now-fixed share of it was this ConsString-flatten pattern — confirmed by the allocation-volume
drop and the GC-time correlation. But `(program)`'s own value barely moved in the noisier
wall-clock/CPU-time metrics even after fixing both call sites, meaning **a further floor remains,
not explained by this round**. Two honest candidates, neither tested here: (1) CM6/CodeMirror's
own internal transaction-dispatch and DOM-patching machinery (native code with no attributable JS
frame, unrelated to string materialization) — plausible given `(program)` was already present even
in the fully-short-circuited "nothing touches `event.text`" experiment from the round above,
before the CM6 flip; (2) V8 JIT tier-up/deopt churn from a hot loop repeatedly executing
newly-compiled code, which the category-trace's `V8.Maglev*`/`V8.Turbofan*` entries hint at but
this round's methodology couldn't cleanly attribute to main-thread self-time (see the
GC/compile-category caveat above). Worth a fresh CDP heap/CPU-sampling pass if a future session
wants to chase this further, now that `--mode=heap` and `--categories=` are committed, reusable
harness capabilities rather than one-off scripts.

## This round: the two remaining `(program)` candidates from above, tested — one refuted, one narrowed, and the residual reframed as acceptable

Picked up the two candidates the round above left open. Added a `--warmup=N` flag to
`measureInputLag.mjs` (types `N` characters, untimed/unprofiled, right after placing the caret and
before the measured burst starts) — a committed, reusable harness capability, not a one-off, for
exactly this kind of "is this a cold-start artifact" question.

**Candidate 2 (JIT tier-up/deopt churn) — tested directly, largely refuted.** If a meaningful share
of `(program)` were one-time JIT compilation/tier-up cost paid on the first several keystrokes of a
burst, pre-warming with real keystrokes first (so the hot functions are already optimized by the
time the profiler starts) should show a clear drop in the *measured* burst's `(program)` value.
Same 1.5M-character note, `--mode=profile`, 30-keystroke measured burst, 3 runs each: cold start
(`--warmup=0`) averaged `(program)` 105.7ms / total 644.9ms; pre-warmed (`--warmup=100`) averaged
`(program)` 101.2ms / total 587.6ms — a ~4% difference on `(program)` specifically, well inside
this environment's established profile-mode noise band, not the large, clear effect a real
warm-up cost would produce. **Also directly checked within a single burst** (`--mode=burst`,
50 keystrokes, per-keystroke deltas): keystroke #1 alone was a genuine outlier (51.75ms vs. a
12-27ms steady-state band for the rest), but the "first 10 mean" (20.7ms) vs. "last 10 mean"
(16.5ms) difference is small and the occasional spikes elsewhere in the burst (#26 at 41ms, #31 at
48ms) look like periodic GC pauses, not a declining warm-up curve. Conclusion: there's a real but
tiny one-keystroke setup cost, not an ongoing tier-up tax across the burst — this candidate isn't
where `(program)`'s bulk lives.

**Candidate 1 (CM6/native framework overhead) — not directly attributed, but narrowed by
elimination and reframed as likely acceptable.** With the ConsString-flatten fix from the round
above already landed, re-ran the same document-size comparison this doc's own benchmark cares
about most ("page 1 must feel identical to page 1,000"): `--mode=profile`, 30-keystroke burst,
caret at end, a 10,000-character note vs. the usual 1.5M-character one. **`(program)` itself is now
close to document-size-*independent*** — 89.1ms mean (small note, 2 runs) vs. 105.7ms mean (large
note, 3 runs, same numbers as the warm-up comparison above) — a ~19% difference, the same order as
this environment's own run-to-run noise, not the dramatic multi-x-or-more gap this doc's history
has always found for a genuine O(document length) defect (`getOffsetWithinRoot`'s old 1926ms vs.
absent-from-profile, `computeInlineStateAtOffset`/`countLineIndex`'s old position-only-present
signature). This is the sharpest evidence yet that the ConsString-flatten fix removed `(program)`'s
*entire* document-length-scaling component, leaving behind a small, roughly constant per-keystroke
floor — consistent with candidate 1 (CM6's own transaction-dispatch/DOM-patch machinery, or
Chromium's native contenteditable/keydown handling), which by its nature wouldn't scale with
document size either. Not proven by direct attribution (no tool available in this session isolated
CM6-internal C++ time specifically), but narrowed to "the only remaining plausible explanation"
by process of elimination against the two candidates this doc actually had.

**GC still scales with document size, and that's now understood, not mysterious.** Same
comparison: GC dropped from 39.2ms (large note) to 7.6ms (small note) — a real, clear,
still-present size-dependence, unlike `(program)`. A fresh heap-sampling run on the large note
explains why without any new mystery: **the single largest allocator is now `join` (~34MB of the
burst's total), i.e. this round's own fix** — `doc.toJSON().join('\n')` still has to materialize one
full flat copy of the document every keystroke, same as `doc.toString()` always did, just done
once, deliberately, and correctly attributed instead of lazily deferred into whichever consumer
touched the string first. This is the same "irreducible O(document length) floor" this doc already
named and deliberately chose not to chase further before the CM6 flip (see "the rope lever, Phase 2
proof-of-concept" and the "eliminate the flatten entirely" scoping above) — GC's residual
size-scaling is that same already-accepted floor showing up in a new place, not a new defect this
round introduced or missed.

**Where this leaves `(program)`, concretely, for whoever picks this up next**: the
document-length-scaling defect is gone (confirmed by the smaller-note comparison above); what
remains is a small (~90-110ms per 30-keystroke burst, ~3ms/keystroke), roughly constant floor most
likely attributable to CM6/Chromium's own native machinery, which this session's tooling can
narrow by elimination but not directly attribute further. Per this doc's own standing caution
against open-ended attribution without a fresh lever: don't keep chasing this specific number
without one. The one lever that *would* attribute it directly — Chrome's Runtime Call Stats
(`disabled-by-default-v8.runtime_stats`) — was tried again implicitly via the same category flag
and confirmed (again) not to emit real RCS events in this environment's Chromium build; getting
real RCS data would need launching Chromium with `--enable-benchmarking`/a build that supports it,
not just enabling the trace category, and hasn't been attempted.

No `src/` changes this round — `--warmup` is a harness-only addition. Verified: `npx tsc --noEmit`,
`npm run lint` clean (no test-suite or regression-script re-run needed, per this doc's own
scoped-effort discipline for a pure measurement/tooling change with zero application-code diff).

## This round: a real user report finally reconciled — the multi-second gap this doc left open for
## several rounds was three separate, unrelated bugs, none of them in anything profiled above

A user reported multi-second per-keystroke lag on a real ~1.5M-character note (a Ulysses text
import) in the actual app — the exact gap this doc has flagged as unreconciled since the
dev-mode-browser-vs-real-app section far above, and every synthetic measurement in this doc
(Linux/Xvfb, packaged-Electron, all of it) kept landing 2-3 orders of magnitude faster than the
report. That gap is now closed, and the answer is unglamorous: it was never one deep, subtle
defect the synthetic harnesses were failing to reproduce — it was three ordinary bugs that only
show up on a *real* note with real editing history and real document shape, none of which a
synthetic 1.5M-character note (uniform short paragraphs, freshly generated, no snapshot/save
history) would ever trigger. Lesson for whoever reads this next: when a synthetic benchmark and a
real user report diverge by orders of magnitude for multiple rounds running, stop trusting the
synthetic benchmark's shape and go get a live trace from the real report instead — this round's
breakthrough was a real DevTools Performance-panel capture from the user's own machine, not
another harness run.

**Bug 1 — a real correctness/perf defect in `parseStructuralRanges` (`src/editor/PreviewBlockSplit.ts`),
predating all of this doc's incremental-caching work.** `parseStructuralRanges` absorbs leading
blank lines *before* a top-level node into that node's own range (`rangeStartLine1 =
previousEndLine1 + 1`), but had no equivalent for trailing blank lines *after the very last node* —
those were never assigned to any range at all. Any document ending in a trailing newline (the
overwhelming common case) therefore always had a cached range list whose last entry fell short of
the true line count. Invisible on a full parse (nobody was checking), but fatal to
`splitMarkdownIntoPreviewBlocksIncremental`'s contiguity invariant: editing anywhere except very
near the document's end keeps that broken tail entry unchanged in every incremental splice's
`tailRanges`, so the final `rangesAreContiguous` check (correctly) rejects it and falls back to
`fullSplit` — a full remark parse, ~2 seconds on this note — on literally every keystroke, forever,
for the entire lifetime of that document. Root-caused via a live DevTools Performance capture (not
this doc's usual CDP-scripted profiling) showing `renderRootSync → ... → usePreviewMarkdownRendering
→ splitMarkdownIntoPreviewBlocksIncremental → fullSplit → remark's fromMarkdown` at ~2000ms, then
confirmed mechanistically by adding temporary fallback-reason logging directly to the three
`fullSplit` call sites inside the incremental function and reading the real trigger off the user's
own console. Fixed by forcing the last node's range to extend to the document's true `lineCount`
unconditionally, mirroring how the existing 0-or-1-node special case already does. Verified: the
full existing fuzz suite (3 seeds × 350 edits) still passes; a new targeted regression test (500
short blocks, edit near the start, document ending in `\n\n`) proves the fast path now actually
engages via reference-equality on an untouched tail block; two new "dense corpus" fuzz seeds
(150-250 blocks × 350 edits) added to the permanent suite, and both existing fuzz corpus builders
now end in a trailing blank line ~70% of the time, so this document shape has ongoing coverage
rather than only a one-off regression test. `npx tsc --noEmit`, `npm run lint`, full `npm test`
(263/263 at the time) all clean.

**Bug 2 — pre-existing debug logging dumping the entire note's text into the console on every save,
un-gated.** `useNoteSaveQueue.ts`'s `flushSave` had `console.debug`/`console.warn` calls that
included the *full* normalized text (up to the whole document size) in the logged object, firing on
every debounced save (and, for notes synced to an external file, twice more). With DevTools open —
exactly the condition needed to investigate a lag report in the first place — Chromium has to
retain and format a growing pile of multi-megabyte string objects, which measurably delays
subsequent macrotasks (a 350ms debounce timer was observed firing ~3s late while this was active).
Fixed by dropping the full-text fields from the logged objects entirely (kept `noteId`/`textLength`
where useful). Not caught by any existing test since it was a pure logging side effect with no
behavioral contract to test against.

**Bug 3 — `SnapshotMark`'s tooltip computed unconditionally on every render, unrelated to what
component actually changed.** `SnapshotTimelineSlider.tsx`'s `formatSnapshotTooltip` runs a full
regex word-count over a *snapshot's* entire historical content (up to the size of the whole note)
and was inlined directly into JSX's `title` attribute — recomputed on every render of the
component, not just when a tooltip is actually shown. Since typing triggers a re-render of the
whole editor tree (`setActiveNoteText` et al.), every visible history mark on the timeline — wholly
unrelated to the keystroke just typed — was paying this cost every single keystroke too. A second
live DevTools Performance capture caught this as the next-largest cost once Bug 1 was fixed
(~110ms, down from Bug 1's ~2000ms). Fixed with a `useMemo` keyed on the snapshot record itself,
which is referentially stable across re-renders unless the underlying snapshot list actually
changes (confirmed via `useNoteSnapshots.ts`'s `snapshotsById`, keyed on the same `snapshots`
array) — safe by construction, not a caching heuristic with a hazard class, since a snapshot's own
content is immutable once taken.

**Follow-on, not itself found via profiling but requested once the above closed the loop**: the
footer word-count display (`EditorSection.tsx`) had the same shape of latent per-keystroke
O(document length) cost as everything above, previously mitigated only by deferring/debouncing it
(tier 3 in this doc's own solution hierarchy), not by making the computation itself cheaper (tier
1/2). Split into `src/editor/WordCount.ts`'s `countWords` (the full "establish" scan) and
`trackWordCount` (the incremental "track" delta) — genuinely simpler than this doc's markdown-
parsing incrementals, since a word boundary only ever depends on whitespace immediately touching an
edit, with no forward-unbounded hazard class the way an unclosed code fence has. Implementation
reuses `computeMinimalTextReplacement` (already used by CM6's same-note hydration path) to find the
edited range, then widens outward only to the nearest whitespace on each side. Character count
needed no equivalent module: `text.length` is already O(1). Verified: a seeded fuzz test (3 seeds ×
500 edits) against `countWords` as ground truth, all passing on first attempt; `npx tsc --noEmit`,
`npm run lint`, full `npm test` (283/283) clean.

**Combined live result, same real user, same real note, same real app**: `commitMs` (CM6's own
transaction-apply cost) was never the problem — consistently 2-5ms throughout this whole
investigation. `paintMs` (physical keydown to next painted frame, the number that actually matches
what a user feels) went **~1900-2000ms → ~110ms (Bug 1 fixed) → ~18.5ms (Bug 3 fixed)** on the exact
same 1.5M-character real note, measured via new lightweight opt-in instrumentation added this round
specifically for this purpose (see below), not a synthetic harness. 18.5ms lands in the same floor
this doc's synthetic measurements have called "irreducible, likely CM6/Chromium native overhead"
since several rounds ago — i.e., this real note now performs the same as the synthetic ones always
claimed it should, closing the gap this doc left open for a long time.

**New, permanent capability**: opt-in live-usage input-lag logging, gated behind
`localStorage.setItem('thockdown:debug-input-lag', '1')` (+ reload; zero cost when unset — one
`localStorage` read at mount, no per-keystroke overhead). Logs real wall-clock checkpoints from a
physical keydown through CM6's commit, through `onTextChange`'s full call chain
(`useEditorSectionMount.ts`), to the next painted frame, straight to the console — for reproducing
a lag report live in the actual app with the user typing themselves, rather than reconstructing a
synthetic Playwright script and hoping it matches. This is what actually closed the gap this
round; consider it a first-class tool alongside `scripts/perf/measureInputLag*.mjs`, not a
throwaway. Left in place deliberately (per explicit user decision this round) rather than stripped
after use.

**Also this round, unrelated to input lag but found while investigating it live**: the real
database backing the note had ~4,200 rows in `notes_fts` for ~38 distinct notes — some notes
carrying 200+ duplicate copies of their own content in the search index, and `PRAGMA
freelist_count` showing ~71% of the file as reclaimable dead space (a 312MB file for what should
have been under 100MB of live data). Root cause: `bootstrapFromFilesystem()` (runs on every app
launch) used `INSERT OR REPLACE INTO notes_fts`, which silently degrades to a plain `INSERT` on an
FTS5 virtual table (no real unique constraint for "OR REPLACE" to match against) — every launch
duplicated every note's content into the index again, forever. Fixed at the source (explicit
delete-then-insert, matching the pattern the regular per-keystroke save path already used
correctly). Also added a permanent, automatic startup self-healing pass —
`DatabaseService.sanitizeDatabase()`, called once per launch right after `bootstrapFromFilesystem()`
— so any installation upgrading from a version with the old bug gets its existing duplicates
cleaned up automatically (not just prevented going forward), and any future regression of the same
shape self-heals on the next launch instead of accumulating silently: (1) unconditionally dedupes
`notes_fts` down to one row per note (keeping the highest rowid — always a syntactically complete,
valid row, never a partial one, so this can only discard stale index duplicates, never real note
content, which lives in the `notes` table and the `.md` files, not `notes_fts`); (2) conditionally
`VACUUM`s, gated behind an actual bloat threshold (`electron/databaseSanitationPolicy.ts`'s
`shouldVacuumForBloat` — both freelist *ratio* > 30% and reclaimable size > 20MB required, so a
small or proportionally-tidy database never pays a VACUUM's real cost, which holds an exclusive
lock and rewrites the whole file). The threshold logic is a pure function deliberately kept free of
any `better-sqlite3` import (that native module is compiled against Electron's bundled Node ABI,
confirmed live to fail under vitest's plain-Node ABI with a `NODE_MODULE_VERSION` mismatch), so it
alone is unit-testable (`electron/databaseSanitationPolicy.test.ts`, 6 cases including exact
threshold-boundary behavior); the DB-touching dedupe/VACUUM statements themselves were verified
manually against the real affected database this round (298MB → 80.5MB, 217MB reclaimed) rather
than via an automated test, since better-sqlite3 can't run under this project's test runner at all.
**Worth flagging explicitly since the user asked for this to be "tested for a while" before fully
trusting it on a production install**: the pure decision logic has real unit coverage, but the
actual SQL execution against a live, real-shaped database has exactly one manual verification (this
round, this database) — treat `sanitizeDatabase()`'s live behavior as freshly-shipped, not
battle-tested, until it's been observed across a number of real launches.

**What's still open**: nothing new from this round's own investigation — Bugs 1-3 above are closed
and verified. The pre-existing ~3ms/keystroke floor this doc already characterized as "likely
CM6/Chromium native overhead, not further attributable without new tooling" is unchanged and still
the honest answer for whatever's left. The `sanitizeDatabase()` real-world observation window noted
directly above is the one open item this round actually added.

## This round: scrollbar gesture, and max speed's second job

Three things the user asked for, one of which explains a number from the round
below.

**The 18-second travel was a wrong default, not a design.**
`DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC` was 6000 while the Options
slider's own default is 80,000 -- so every fallback path (a fresh install, a
state file written before the setting existed, a non-finite value handed to the
setter) silently ran at a tenth of the intended speed. That is exactly the
"reverts to the wrong default in some cases" the user reported, and it is why a
100,000px journey measured 18.2s: 100,000/6,000. The constant is now 80,000 and
the slider reads its default from it rather than repeating the literal, so the
two cannot drift apart again. Same journey now: **1.27s**.

**Max speed also caps duration.** The slider now has a dual meaning: the
longest any scroll may take is `SCROLL_DURATION_CAP_PX / maxSpeed` seconds --
the time to cover 200,000px at the chosen speed -- so 2s at the slider maximum
and 2.5s at the default. A journey that cannot fit under both limits keeps the
duration ceiling and exceeds the velocity cap, deliberately: the velocity cap
shapes ordinary travel, the ceiling bounds the extraordinary kind.

Implemented as a uniform time compression of the plan
(`compressScrollPlanToDuration`), not a clip: every time field scaled by the
same factor, the plateau speed scaled inversely. `sampleScrollPlan` divides an
elapsed time by a plan time in each of its three branches, so scaling both
leaves the sampled position at the same *fraction* of the journey exactly
unchanged -- easing, plateau and endpoints all survive. There is a test that
samples both plans at twenty matched fractions and asserts they agree.

It lives in `buildScrollPlanFromCurrentParams`, NOT in `buildScrollPlan`:
the latter has two other callers (`escapeHoldRotationCurve` with a maxSpeed in
*slots* per second, and `AccordionSection` with its own constants), and a rule
expressed in pixels would be nonsense for both.

**Click travels, hold snaps** (`scrollTrackHold.ts`, shared by both
scrollbars). A left click on the track travels there; holding the button for
250ms snaps instead. The snap fires on its own timer *while the button is still
down*, which is what makes the gesture discoverable -- you hold, it jumps, and
you have learned it without being told. The release listener lives on the
window (a hold that wanders off the track is still a hold) and cleans itself up
on every exit path including unmount and window blur, which otherwise leaves a
gesture armed that fires a snap nobody asked for.

Verified live in both panes: render view, short click at 30% travels (2.35s
including settle detection) and a hold at 60% is already there 418ms in, before
release; edit view, same, quantized to the row grid via a now-exported
`quantizeScrollTopToRow` so the snap lands on exactly the grid the animation
would have.

**Two observations worth recording, neither acted on:**

- The scroll curve has no ease-in left on long journeys. Measured at
  80,000px/s: 2,000px is a pure bell, 20,000px ramps for 0.15s, 100,000px for
  0.05s, and by 350,000px the ramp has vanished entirely -- the bell's natural
  peak speed grows with distance while `t` does not, so the ramp-up fraction
  goes to zero. Pre-existing, not introduced by the duration ceiling, but it
  means a very long scroll starts and stops abruptly at speed.
- The EDIT pane's scrollbar still resolves against pixels, and CM6's own height
  estimates move as content is measured: clicking at 50% and holding at 50%
  landed 20% apart in one live run, because the estimate changed between them.
  The render pane's character mapping is the fix for that class of bug; whether
  it is worth porting to an editor whose lines are near-uniform is an open
  question.

## This round: a travel animation has to keep re-aiming, because its target moves

Asked what happens if the reader opens a large note and immediately clicks the
scrollbar track at 30%. Checking rather than reasoning turned up two defects,
one of them shipped in the round below.

**The track click was still pixel math.** Only the thumb DRAG had been routed
through character space; `handlePreviewTrackMouseDown` still computed
`ratio x maxScrollTop`. So the two gestures that mean the same thing to the
reader -- drag the thumb to 30%, click the track at 30% -- resolved against
different spaces, and disagreed by more the less uniform the document's content
density was. Both now go through the same mapping.

**A pixel target fixed at click time is a promise the app cannot keep.** Click
at 30% inside the calibration window and the target is 30% of the flat 56px
guess. Measured on a 1.2M-character note (3,972 blocks): the estimate at click
time was 223,159px against a true 349,261px, and the travel animation for a
jump that size runs **18 seconds** on this hardware -- long enough that the
model lands, blocks are measured, and the total size moves repeatedly while it
is in flight, each change redefining what the fixed target meant. The click
landed around 13% of the document instead of 30%.

The fix holds the destination in character space -- which does not move -- and
re-projects it into pixels every frame (`smoothScrollToChar`).
`scrollToNonQuantizedSmooth` re-plans smoothly from wherever the animation
currently is and no-ops on an unchanged target, so this costs nothing until the
geometry actually moves; a 24px threshold keeps measurement noise from
restarting the easing every frame.

**And calibration must not yield to the app's own animation.** The survey
yields to `isNonQuantizedSmoothScrollActive` -- correct when the reader is
scrolling, backwards while calibrating, because the animation's destination is
a character position and until the model lands the pixel it maps to is a guess.
The animation was, in effect, waiting on a survey that was waiting on the
animation. While calibrating, only the READER's own scrolling now causes a
yield. (A travel animation fires scroll events of its own, so the
"scrolled recently" timestamp had to learn to ignore them too.)

After all three, the same early click at 30% lands on block 1,159 of 3,972 --
the same block the fully settled click lands on, and within 1% of the character
target, that last 1% being the thumb-centring convention (clicking at 30% of
the track centres the thumb there, which is travel-ratio 29.2%, not 30%).

**Open question for the next session:** that travel animation takes 18s for
100,000px. It is the app's own distance-based curve
(`buildScrollPlanFromCurrentParams`), not anything this work introduced, but
the user guide describes a track click as jumping "directly to that position",
which 18 seconds is not. Worth asking whether a track click should travel or
snap.

## This round: what CPU throttling found that a fast machine hid

Both of these were invisible at full speed and obvious at 6x
(`measurePreviewHeightModel.mjs --throttle=6`). Worth repeating for anything
in this area: the reporter's hardware is several times slower than this
container, and "it settles instantly here" is not evidence.

**1. The measurement host was never unmounted when calibration finished.**
`finishCalibration` applied the model and returned without clearing
`prewarmBatch`, so the last ~90 fully rendered markdown blocks stayed in the
DOM for the rest of the session -- costing layout on every frame the reader
scrolls, which is exactly the cost the scroll-yield path exists to avoid. It
also made anything watching `[data-prewarm-index]` (two of the perf scripts)
believe a survey was still running forever. Found by instrumenting the live
page rather than reasoning about the code.

**2. The batch sizer collapsed to its floor again on slow hardware** -- the
same defect the budget raise fixed, re-appearing for the same reason one level
down. A slice cannot cost less than one React commit plus one forced layout,
and at 6x throttle that fixed cost alone exceeded the whole 32ms budget, so
every slice was spent on overhead: 160 calibration blocks took **11.9s**. The
sizer now takes the fixed cost as an input (the hook feeds it the cheapest
slice seen so far) and stretches the budget to a multiple of it, capped at
120ms per slice. Slow hardware gets fewer, bigger slices instead of a floor's
worth of tiny ones.

At 6x CPU throttle, 400k chars / ~4,000 blocks:

| | before these two | after |
|---|---|---|
| scrollbar settled | 11.9s | **4.1s** |
| re-settled after a font change | never (host never unmounted) | **2.8s** |
| settled estimate error | 0.4% | 0.4% |

## This round: the scrollbar thumb is a position in the TEXT, not in the pixels

Second half of the Kindle idea, on top of the height model below. The model
made the pixel substrate honest to ~0.4%; this makes the thumb exact by
construction, and immune to layout entirely.

**What it is** (`src/editorSection/previewCharPosition.ts`): the block list,
prefix-summed into character offsets, plus the two conversions the scrollbar
needs — pixel position → character position and back — each interpolating
*inside* the block it lands in, using that block's own on-screen geometry.
Interpolation is not optional: block-granular position would freeze the thumb
while the reader scrolls through one tall block and then snap it.

**Position from characters, size from pixels.** Position is the half that has
to be exact, and in character space it does not move when the layout moves — no
creep while heights are discovered, no jump when the font changes. Size stayed
a pixel ratio on purpose: "how much of the document is on screen" measured in
characters swings wildly between a screen of dense prose and a screen holding
one big code block, so a character-sized thumb visibly grows and shrinks as you
scroll. Position must be exact; size only has to be steady.

**The wiring.** `usePreviewMarkdownRendering` owns the block list and the
virtualizer, `usePreviewScrollbar` owns the thumb, and they are separate hooks
in `EditorSection`. The bridge is a ref holding two functions
(`PreviewDocumentPositionApi`) rather than a value — the scrollbar reads it on
every scroll event, and anything routed through React state would re-render the
section per frame. Both sides still work when it is null (no blocks yet, edit
mode), falling back to the pixel mapping.

Note `virtualizer.getMeasurements()` is private in the published types;
`measurementsCache` is the public array it writes into, and calling
`getVirtualItems()` first (memoized) is what guarantees it is current.

**Verified** (`scripts/perf/verifyPreviewCharScrollbar.mjs`, real thumb drags
via mouse events, 400k-char document of 1,331 varied blocks):

| property | result |
|---|---|
| inverse (drop the thumb at r, read it back) | worst error **0.001** |
| thumb drift while parked and untouched | **0px over 2s** |
| drag to 1.0 | lands on block 1,323 of 1,330 mounted — the final screen |
| monotonic across 0 / .25 / .5 / .75 / 1 | yes |

**Also this round:** the fitted model is now applied even when it fails its own
trust check. It is fitted from a hundred real blocks of *this* document, so its
predictions beat a flat 56px guess in every case constructed for it (for a
document of images the fit degenerates to "the average sampled image", which is
the right thing to guess). The trust check no longer decides whether to use the
model, only whether it is good enough to stop there — a failing one still holds
the scrollbar steady while the fallback survey refines it in the background.

**And:** the discovery progress bar is now the snapshot timeline's own rail
carrying a horizontal scroll HANDLE that grows from nothing to the full track
(`.preview-discovery-handle`), rather than a bar in its own smaller track. It
is also held back for 600ms before appearing at all: fitting a model takes
~0.3s, and a progress bar that appears and vanishes inside a third of a second
reads as a glitch rather than an explanation.

## This round: the document is no longer measured at all — heights are modelled from the source

**The problem the survey never solved.** The background survey (below) made the
scrollbar honest by rendering and measuring every block. On the user's own
1.5M-character note that meant ~18,000 markdown renders, reported live as "1%
of progress every other second" — minutes of a scrollbar that is quietly
wrong, and the survey's own cost is what made the text vibrate on slower
hardware. Two rounds of tuning (the batch-sizer fix, one commit before this)
took the same document from 21.5s to 8.7s in this container. Better is not
fixed: the approach's floor is "render the whole document once", and that floor
is seconds at best.

**The idea, from the user: how does a Kindle do this?** It doesn't. Its
progress unit is the *location* — a fixed slice of the source file, assigned at
import — so a font change repaginates the current screen and nothing else. Its
page numbers, where it shows them, are looked up from a map generated
server-side, never computed on the device. The insight is that the progress
metric was never a pixel quantity.

**What shipped** (`src/editorSection/previewHeightModel.ts`): heights stay
pixels, so the thumb stays visually proportional, but they are *derived from
the source text* by a model fitted from a ~160-block sample:

- blocks are bucketed by SHAPE (heading/list/quote/code/table/media/rule/
  paragraph) off the first line's sigil — a string test, not a parse;
- per shape, `height ≈ intercept + perLine × predictedLines`, where
  `predictedLines` sums `ceil(visibleChars / charsPerLine)` over the block's
  own source lines (per line, so a five-item list is five lines, not one);
- the two linear parameters are solved by least squares; `charsPerLine` is the
  only thing searched, over a 1-D grid. No font metrics are involved anywhere —
  fitting sidesteps line-box rounding, margin collapsing and wrap points, all
  of which would silently bias the whole document if got wrong.

**The sample budget is spent by share of the document**, not evenly. An even
split left the dominant shape with a dozen samples to fit a slope that then
multiplies ten thousand blocks; the sampling error showed up as a **2.6% bias**
on the document total. Proportional allocation, same number of renders: **0.4%**.

**It refuses to be confidently wrong.** The fit reports a per-block median
error and, more importantly, the signed bias of its SUM (`biasPct`) — the
number the scrollbar actually cares about, since wrap-point noise is unbiased
and cancels across thousands of blocks while a systematic offset does not. If
the bias exceeds 4% or the median block error 30% (`isPreviewHeightModel-
Trustworthy`), the model is discarded and the document is measured block by
block exactly as before. A document of images fails this on purpose: its
heights are not a function of its text.

**Measured** (`scripts/perf/measurePreviewHeightModel.mjs`, real Chromium,
1.5M chars of varied prose = 18k blocks, against ground truth from walking
every viewport):

| | flat estimate + survey | fitted model |
|---|---|---|
| scrollbar settled after | 21.5s (minutes on the reporter's desktop) | **0.3s** |
| settled total vs truth | −71% | **0.0%** (225px of 473,228) |
| jump-to-bottom miss | ~3,700px | **0px** |
| worst size jump while reading | 1,091px | 53px |

**What this makes cheap.** A geometry change (font size, line height, letter
spacing, pane width) re-casts the whole document by arithmetic over the block
list — microseconds — instead of re-surveying it. Fitted models are cached by
geometry signature, so returning to a geometry costs nothing at all. This is
the "cast the discovery into a new mould" question from the round below,
answered properly: the mould is the model, and it is parameterised by one
measurement of the current typography.

**Still open (next round):** driving the thumb by *character offset* rather
than pixel offset, Kindle-style. The model gets the substrate honest — native
wheel/fling scrolling and `scrollToIndex` both run on pixel offsets and need
it — but the thumb itself needs no heights at all: position is
`charOffset(topBlock) / totalChars`, size is `visibleChars / totalChars`. That
would take the residual to zero by construction, make the thumb immune to
typography entirely, and let the slow fallback survey be retired, since
navigation would no longer depend on heights being known.

## This round: can a survey be re-cast into a new geometry rather than re-run?

Asked directly. **Not derived — but often remembered.**

**Why deriving does not work.** Width, font size, letter spacing and edge
padding all change *where text wraps*, so a block's line count changes, and a
stored height carries no record of its line count. Only a pure line-height
change would be a linear transform, and only if the fixed (margin/padding) part
had been stored separately from the line-driven part. The aggregate numbers show
how far off a naive scale would be: 1280px -> 1100px (width x0.859) moved the
true total 49,753 -> 61,210px, a x1.230 change against a naive inverse-width
x1.164; font-size 16 -> 24px (x1.5) moved it x2.535 against a naive x2.25. Both
~5-11% out in aggregate, and far worse per block, since a heading that never
wrapped does not change at all while a long paragraph changes a lot.

**Why "from scratch" was already cheaper than it sounds.** A restart only
resets the survey's own bookkeeping; it never touches the virtualizer. The
previously committed heights stay live, so the scrollbar holds the *previous
geometry's* numbers rather than collapsing to the flat estimate — measured at
16.7% wrong after a modest resize and 48.3% after a large font change, against
71% for a cold document.

**What was added: remember, don't derive.** Completed surveys are now kept keyed
by the geometry they were taken at (`PREVIEW_PREWARM_GEOMETRY_CACHE_SIZE`, 4,
LRU). Geometries repeat far more often than they are novel — a sidebar toggled
off and back, a font size tried and undone, a split divider dragged and
returned. Measured at 6x CPU throttle:

| step | discovery bar | total |
|---|---|---|
| initial survey @1280 | shown, 10.5s | 49,753px |
| resize to 1100 (new geometry) | shown, 7.5s | 61,215px |
| **back to 1280 (already surveyed)** | **none** | 49,753px |
| **back to 1100 (already surveyed)** | **none** | 61,215px |

Only *completed* surveys are stored — a partial one (geometry changed mid-sweep)
would be a cache entry that silently under-describes the document. And any edit
clears the whole store, since the heights are only valid for the text they were
measured from; serving them afterwards would be exactly the "confidently wrong"
failure this feature exists to avoid. Both are asserted in
`verifyPreviewPrewarmSafety.mjs`.

One note on that assertion: returning to a surveyed geometry matches to within
**2px across a 49,504px document** (0.004%), not exactly — the handful of blocks
mounted while the pane was at the other width get re-measured for real on the
way back and land sub-pixel differently. The check uses a 100px tolerance,
because a genuine cache miss is not a near miss: it would show the other
geometry's height, ~11,000px out.

**Still open, if it ever matters:** a *sampled* re-cast — measure ~10% of blocks
after a geometry change, take the ratio, and apply it to the rest as a
provisional commit before the full survey finishes. That would cut the "wrong by
17-48% while re-surveying" window at the cost of a second thumb movement. Not
built, since the geometry cache covers the repeating case and the stale heights
cover the novel one tolerably.

## This round: what happens if the reader scrolls while the survey runs

Asked directly, and worth measuring rather than reasoning about. Answer, at 6x
CPU throttle on a 600k-character document, scrolling continuously:

| | median frame | p95 | prewarm DOM present |
|---|---|---|---|
| scrolling **during** the survey, before this round | 29.9ms | 119ms | — |
| scrolling **during** the survey, after this round | **23.0ms** | 109ms | 13 of 273 frames |
| scrolling **after** the survey completed (control) | 23.3ms | 111ms | 0 |

Scrolling during the survey now costs the same as scrolling after it. Two fixes
got there, and the second was only found because the first appeared to work:

1. **Yield while the reader scrolls.** `requestIdleCallback`'s `timeout` means a
   batch runs whether the thread is idle or not, so the survey worked straight
   through scrolls. A passive scroll listener plus a quiet window
   (`PREVIEW_PREWARM_SCROLL_QUIET_MS`, 180ms) defers new batches.
2. **Yielding has to mean unmounting.** That alone moved median frame time only
   29.9 -> 26.0ms, because declining to *start* a batch leaves the previous
   batch's blocks mounted -- real rendered markdown, still costing layout on
   every frame. Instrumented: the host was present on **253 of 253 frames** of a
   continuous scroll. The pause paused nothing the reader could feel. Clearing
   `prewarmBatch` when yielding is what closed the gap.

**What is still visible during discovery, by design:** the scrollbar is
knowingly wrong. Scrolling to what looks like the end lands short, and more
document appears. That is the deliberate trade for a thumb that does not crawl,
and it is what the discovery progress bar exists to explain. The survey also
takes longer while the reader is actively scrolling, since it is yielding --
correct priority, and the bar shows it.

**What is not visible:** the reader's content never moves (0px drift, parked or
scrolling -- the 120px "jump" an early probe reported appeared in the control
arm too, so it was the probe's own artifact), and the survey follows the reader
rather than ignoring them: `cursorIndex` is re-read from the live viewport on
every batch, so blocks near where they are get measured first.

## This round: the survey no longer churns while it runs, and says so

**Reported from an older Linux laptop**, and reproduced exactly here with CDP
CPU throttling (`Emulation.setCPUThrottlingRate`, rate 6) — which is the tool to
reach for whenever a report is hardware-shaped: the scroll thumb creeping for a
prolonged time while a large document is explored, restarting whenever the
editor's dimensions change, and the text "vibrating".

**All three were self-inflicted by the survey shipped in the round below.**
Measured at 6x throttle, parked mid-document with no user input at all:

| | with the survey | survey disabled |
|---|---|---|
| total-size changes in 12s | **115** (biggest 1,125px) | 1 (13px) |
| scrollTop compensations | **96, totalling 25,280px** | 0 |

Every `resizeItem` changes the total size (the thumb moves) and, for a block
above the fold, compensates scrollTop (the content shifts). On fast hardware the
whole survey is over in ~1.3s so it reads as a brief settle; at 6x it is twelve
seconds of visible dragging. **This is the second time in this effort that a
change looked finished because the machine measuring it was too fast** — see the
Chromium 124 note in `docs/cm6-parity-hardening-plan.md`. Throttle before
believing a perf feature is invisible.

**The fix, per the user's own instinct:** the survey now *buffers* every height
and hands them to the virtualizer in **one commit** when it completes, so the
scrollbar sits on its initial estimate for the duration rather than crawling
toward the truth. Measured after: 3 size changes and 1 scrollTop move for the
whole survey, and — the number that matters — **0px of on-screen content drift
across 288 sampled frames**. The single scrollTop move is a coordinate-system
shift, not a visible jump: react-virtual's per-item compensation is exact.

Two supporting changes:

- **Restarts are debounced** (`PREVIEW_PREWARM_RESIZE_SETTLE_MS`, 300ms). A
  window or split-view drag fires the invalidation probe every frame, so an
  undebounced restart meant a survey that never finished while the reader was
  still dragging — on exactly the hardware where it is slowest.
- **The timeline slot becomes a progress bar while a document is in discovery**
  (`.preview-discovery-*`, render view only; in edit mode the survey runs
  silently). Borrowing that slot rather than adding one keeps the status where
  the eye already goes, and costs nothing: a document still being surveyed is
  not one whose history anyone is navigating yet. Progress updates only when the
  whole integer percent moves, so a 1,000-block survey costs at most 100
  re-renders rather than one per batch.

A note on the bar's styling, since it looked done and was not: drawn on the
snapshot rail it was invisible — that rail is a 2px hairline built to thread
markers onto, so the fill measured as a white 2px line on a white 2px line. It
has its own 4px track now.

**The instrument needed fixing too.** `measurePreviewMeasurementCache.mjs`
detected completion by watching for the total size to stop changing — exactly
the churn this round removed — so it reported "settled" instantly and then
measured an unsurveyed document (71% error, 29,646px jump-to-bottom miss). It
now waits for the sweep to stop rendering batches instead. Worth remembering:
**an instrument calibrated against a symptom breaks when you fix the symptom.**

**Verification:** `tsc`, `eslint`, `npm test` (619/619), both live scripts, and
two new permanent assertions in `verifyPreviewPrewarmSafety.mjs` that run under
6x CPU throttle — content drift 0px, total-size changes 2. Accuracy from the
round below is unchanged: −0.1% cold, 0px jump-to-bottom, biggest jump 1px.

## This round: the preview scrollbar is now accurate before the reader scrolls — background measurement prewarm

**The defect.** The preview virtualizes blocks with a flat 56px estimate
(`PREVIEW_BLOCK_ESTIMATED_HEIGHT_PX`), so any block not yet scrolled past is a
guess. Measured on a 300k-character note (`scripts/perf/measurePreviewMeasurementCache.mjs`):
cold total size **14,216px against a true 49,439px — 71% short**. Consequences the
user reported and this reproduces: jumping to the bottom of the scrollbar lands
**3,715px short of the end**, and a long scroll churns — total size changed **37
times over 60 viewport hops, biggest single jump 1,091px**.

**The fix.** A background sweep measures every block into the virtualizer's own
cache (`virtualizer.resizeItem`) shortly after the note opens, in idle-time
slices with an 8ms budget and an adaptive batch size. Scheduling logic is
isolated and unit-tested in `src/editorSection/previewMeasurementPrewarm.ts`;
the DOM half lives in `usePreviewMarkdownRendering.tsx`.

| | before | after |
|---|---|---|
| cold total size vs. true | 71% short | **0–0.1% off** |
| jump-to-bottom miss | 3,715px | **0px** |
| biggest size jump while scrolling | 1,091px | **12px** |
| settle time, 300k chars (~250 blocks) | — | **1.25s** |
| settle time, 1.2M chars (~1,000 blocks) | — | **5.3s** |
| median frame during the sweep | — | **16.7ms (untouched 60fps)** |
| frames over 50ms, 1.2M chars | — | **2** (worst 60.7ms) |

**Fidelity is the whole game, and two traps were found by measurement.** A
prewarmed height that is *wrong* is worse than no prewarm: the virtualizer holds
a confident wrong number until the block really mounts, then corrects — the same
flicker, moved. Both traps under-measure silently, and both are the sort of thing
that would make an implementation look finished and ship a regression:

1. **Containing block.** The measurement host must live inside the virtualizer's
   *spacer*, not the scroller. The scroller is `position: relative`, so an
   absolutely positioned host attached there resolves `width: 100%` against its
   **padding** box — 36px wider than the real blocks (2 × `--preview-edge-padding`).
   Every block that wraps then measures short; only tall, wrap-heavy blocks
   reveal it (a 1,160px blockquote measured 1,119px).
2. **Margin collapse.** Each measured block must keep the real wrapper's absolute
   positioning. Stacked in normal flow, adjacent blocks collapse margins with
   each other, which the real (absolutely positioned) list never does — measured
   at −12 to −18px per block.
   A third, smaller one: block 0's leading `h1`/`h2` gets `margin-top: 0` from a
   `:first-child` rule the host can't match by position, so it is mirrored by
   class (`.preview-prewarm-first-block`) in markdown.css. The two must stay in step.

**Invalidation was initially wrong, and the first fix's own test hid it.** The
sweep restarted on a new block list or a change in the scroller's `clientWidth`.
Neither fires for preview font size, line height, letter spacing or edge
padding: those arrive as inline styles on the scroller that this hook never
sees, and padding lives *inside* `clientWidth`, so even that doesn't move.
Measured staleness after each change, as jump-to-bottom error: **font size
2,590px, line height 2,014px, edge padding 396px**. Confidently wrong, which is
worse than the flat estimate the feature replaced.

Worth recording *how* this nearly slipped through: a first probe compared the
total size after a font change against the total after a full walk, and both
read 52,728px — an apparent 0% error. That comparison was measuring the wrong
thing. The honest test is whether jumping to the bottom of the scrollbar lands
at the end, and it did not.

The fix does not enumerate the settings — that list would rot the first time a
new one is added. It watches a **probe**: a hidden element inside the spacer
holding fixed, deliberately wrapping text, inheriting exactly what the real
blocks inherit. Anything that would re-wrap or re-space a block changes the
probe's own box, and a ResizeObserver on it restarts the sweep. It also catches
ancestor-driven changes (double-size mode, a root font scale) that no observer
on the scroller's own attributes would see. All four cases now land 0px from the
end.

**Guarding it.** `scripts/perf/verifyPreviewPrewarmSafety.mjs` asserts the host
never becomes visible, never extends the scrollable area, leaves no DOM behind,
doesn't break the render↔edit round trip, and re-measures the document after
each of the four typography changes above.

**A note on that round trip:** the first toggle out of an arbitrary mid-block
scroll position legitimately moves ~1,400–1,500px, because restore is
block-quantized by design (persisted `anchorBlockIndex` plus a fixed one-line
offset). A/B'd against unmodified code — 1,494px baseline vs 1,411px with the
prewarm — so it is pre-existing, not a regression. The check therefore asserts
that a *settled* position stays put (0px), which is the property that matters.

**Also found (pre-existing, not fixed):** `scripts/perf/verifyScrollSync.mjs` and
`perfHarness.mjs`'s `seedLargeNoteAndReload` both wait for the edit-mode
contenteditable to become *visible*, but a restored note comes back in render
view, where the edit pane is legitimately hidden — so both time out on
unmodified code. Confirmed by A/B. Filed in `TODO.md`.

**Verification:** `npx tsc --noEmit`, `eslint`, `npm test` (619/619), plus the two
live-browser scripts above at 300k and 1.2M characters.

## This round: first edit→preview toggle latency on large notes — fixed via background preview-block prewarm

The first switch from edit to preview on a large note used to pay for a full `splitMarkdownIntoPreviewBlocks` remark parse inside `usePreviewMarkdownRendering`, because the incremental block cache started empty whenever that hook first rendered. Now `useEditorSectionMount` builds that cache in the background while the user remains in edit mode, then passes the same `previewBlockSplitCacheRef` into `usePreviewMarkdownRendering` so the first toggle warm-starts the incremental parser instead of parsing the whole document on demand.

**Source changes:**
- `src/editorSection/useEditorSectionMount.ts`: added `previewBlockSplitCacheRef`, populates it via a 500ms-debounced background task using `splitMarkdownIntoPreviewBlocksIncremental` (with a `requestIdleCallback` fallback), reuses the cached result for DB-persisted anchor-block resolution, and exports the ref in the hook result.
- `src/editorSection/usePreviewMarkdownRendering.tsx`: accepts an optional `previewBlockSplitCacheRef`; uses it as the shared cache instead of its own private ref.
- `src/editorSection/EditorSection.tsx`: destructures `previewBlockSplitCacheRef` from `useEditorSectionMount` and passes it to `usePreviewMarkdownRendering`, including through the `SectionHandle` it registers.

**Verification:** `npx tsc --noEmit`, `npm run lint`, `npm test` (277/277). `scripts/perf/verifyScrollSync.mjs` stable across 20 toggles. Isolated benchmark on a 1.5M-character synthetic document (`scripts/perf/benchmarkPreviewBlockSplit.mjs`): cold full parse ~769ms, warm cached reuse ~0ms (~36,700x speedup). Live `dev:browser` toggle measurement on the same size: first toggle ~180ms, cached toggle ~40ms, confirming the cache is live and the previous multi-second parse cost on first toggle is gone.

## This round: persisted preview-block cache survives app restart

The background prewarm cache from the previous round only helped within a single app session. After restart, the first edit→preview toggle on a large note paid the cold parse cost again. Now the structural ranges from the last preview-block split are persisted with the note (piggybacked onto the debounced text save and the note-leave UI-state checkpoints) and restored when the note is reactivated, so the cache survives app restarts.

**Source changes:**
- `src/shared/noteLifecycle.ts`: added `PersistedPreviewBlockCache` type (`v`, `textHash`, `ranges`) and extended `SaveNoteInput`, `NoteUiStatePayload`, and `NoteUiState` to carry it.
- `src/shared/hashText.ts`: new renderer-side `hashNormalizedText` (SHA-256) so the renderer can verify the persisted cache against the loaded note text.
- `src/editor/PreviewBlockSplit.ts`: added `PREVIEW_BLOCK_CACHE_VERSION` and `restorePreviewBlockSplitCacheFromRanges(text, ranges)` to reconstruct a full `PreviewBlockSplitCache` from persisted ranges.
- `electron/databaseService.ts`: added `previewBlockCache TEXT` to the `notes` table; `upsertNoteContent` and `saveNoteUiState` accept/COALESCE the JSON blob; `getNoteUiState` returns it.
- `electron/noteLifecycleService.ts`: serializes the cache JSON for `saveNote`/`saveNoteUiState` and deserializes it for `getNoteUiState`.
- `src/editorSection/useEditorSectionMount.ts`: added `buildPersistedPreviewBlockCache(text)`; includes the cache in `persistEditUiState` and `persistActiveNoteEditModeStateNow`; the `previewBlockSplitCacheRef` and `previewBlocksCacheRef` are now owned by `EditorSection.tsx` and passed in as options so `useNoteSaveQueue` can read them.
- `src/editorSection/useNoteSaveQueue.ts`: accepts `previewBlockSplitCacheRef`; when flushing a debounced text save, it builds and hashes the persisted cache and passes it to `saveNote`.
- `src/editorSection/EditorSection.tsx`: owns `previewBlockSplitCacheRef`/`previewBlocksCacheRef` and `activeNoteTextRef`; seeds the cache from `getNoteUiState` on note activation when the text hash matches; passes the refs into the save queue and mount hook.
- `src/dev/installBrowserMockBridges.ts`: mirrors the main-process cache persistence/return semantics in the browser mock so `dev:browser` behavior matches Electron.

**Verification:** `npx tsc --noEmit`, `npm run lint`, `npm test` (277/277). Live `dev:browser` toggle measurement on a 500K-character synthetic document: first toggle ~160ms, cached toggle ~35ms. Browser-mock storage inspection confirmed `previewBlockCache` is written after the note-leave checkpoint and returned by `getNoteUiState`; `activateNote` logged successful hash-match restoration. A full close/reopen browser-mock restart measurement harness was attempted but proved flaky due to test-harness page-lifecycle timing; the persisted-cache restore path is validated by the hash-match log and the storage inspection.

## This round: note tab-switch / initial-load slowness on large notes — fixed

Switching to a large note (or loading it on startup) still took >2 seconds even though the persisted preview-block cache was being restored. Profiling `activateNote` in `EditorSection.tsx` showed `buildEditRestoreSnapshotFromUiState` was running a full `splitMarkdownIntoPreviewBlocks()` remark parse on the newly loaded text in order to resolve the persisted `anchorBlockIndex` to a source line. The persisted cache had already reconstructed the block array, but it was never passed into `buildEditRestoreSnapshotFromUiState`, so the resolver paid the full parse cost again on every note activation.

**Source changes:**
- `src/editor/EditRestoreMath.ts`: `resolveEditSourceAnchorLineFromUiState(text, uiState, blocks?)` and `buildEditRestoreSnapshotFromUiState({ ..., previewBlocks? })` now accept an optional already-computed preview block array and skip the expensive full remark parse when one is supplied.
- `src/editorSection/EditorSection.tsx`: `activateNote` now passes the restored in-memory block cache (`previewBlocksCacheRef.current.blocks`, verified to match `hydratedText`) into `buildEditRestoreSnapshotFromUiState`. Added opt-in `[activate-note-timing]` logs around each major sub-step (outgoing UI-state persist, load note + UI state, cache restore, snapshot build, external-note setup, state updates) so future slowness can be pinpointed without code changes.

**Verification:** `npx tsc`, `npm run lint`, `npm test` (277/277). The cache-reuse path is verified by construction: the blocks come from `restorePreviewBlockSplitCacheFromRanges`, which materializes them from the same structural ranges that `splitMarkdownIntoPreviewBlocks` would have produced, and the hash match guarantees the text is identical. The timing logs are gated by `localStorage.getItem('thockdown:debug-input-lag') === '1'` to avoid console noise in production.

## This round: scroll-sync regression after cache wiring — fixed

After wiring the preview-block cache through `activateNote`, mode-toggle scroll-sync regressed in two ways:
1. Scrolling in render (preview) mode and switching back to edit did not update edit's scroll location.
2. Scrolling in edit and switching to render only updated after two scroll events; the first appeared ignored.

Root causes in `src/editorSection/useEditorSectionMount.ts`:
- `toggleRenderViewMode` rounded the edit viewport's source line up to the *next* preview block (`resolvePreviewBlockIndexForSourceLine(...) + 1`) instead of the containing block. This made preview land one block ahead of edit, so small intra-block scrolls produced no visible change.
- The render->edit branch had an inner "already restored" fast path that short-circuited whenever `editRestoreCompletedForNoteIdRef` contained the current note. Because entering preview adds that key, returning to edit always hit the fast path and ignored any preview-side scrolls.

**Source changes:**
- `src/editorSection/useEditorSectionMount.ts`:
  - `toggleRenderViewMode` now uses the containing block index (no `+1`) when round-tripping through the canonical BLOCK, so both modes land on the same top-level preview block.
  - Removed the stale "already restored" fast paths in both `toggleRenderViewMode` and the `isPreviewMode` transition effect. When `sectionRequiresScrollUpdateRef` is true on a render->edit transition, edit is now re-derived from the current preview anchor instead of assuming the hidden edit pane is still correct.
  - Added `[scroll-sync]` diagnostic logs around the toggle showing the raw source line, containing block index, chosen anchor index, and anchor start line.

**Verification:** `npx tsc`, `npm run lint`, `npm test` (277/277). Live verification needed: open a multi-block note, enable `localStorage['thockdown:debug-input-lag']='1'`, scroll in each mode, toggle, and confirm the logs show `containingIndex === anchorIndex` and that the top block in render matches the top block in edit.
