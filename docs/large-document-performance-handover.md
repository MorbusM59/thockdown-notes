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
