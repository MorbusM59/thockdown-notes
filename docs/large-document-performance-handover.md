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
- **Real, working setup validated this round (Windows; the previous version of this note
  described a Linux sandbox with paths like `/opt/node22` that don't apply here — that
  environment-specific detail is gone, don't chase it)**:
  1. `npm install -D playwright` (already added as a devDependency — should already be present
     in a fresh checkout; if not, add it) then `npx playwright install chromium` (~190MB
     download, one-time per machine, not committed/cached in the repo).
  2. `npm run dev:browser -- --port 5183 --strictPort`, backgrounded.
  3. A plain `.cjs` script (not `.mjs` — same ESM/NODE_PATH friction noted before generally
     applies) placed *inside the project directory* (so `require('playwright')` resolves via
     the project's own `node_modules` — a script in an external scratch/temp directory will
     fail to resolve it), run via plain `node script.cjs`. `chromium.launch()` with no
     `executablePath` override works fine once the browser is installed via step 1.
  4. To seed a large note without fighting the UI: `window.thockdownNotes.createNote({
     initialText })` then `window.thockdownSections.setActiveNote(sectionId, noteId)` (browser
     dev mode's mock IPC bridge, `src/dev/installBrowserMockBridges.ts`) — **then reload the
     page** (`page.goto` again, or `location.reload()`); this bridge call only updates
     *persisted* section state, it does not push a live update into the already-running React
     app. Confirmed working end-to-end this round for documents up to 1.5M characters.
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
- Verification bar for any change here: `npx tsc --noEmit`, `npm test` (184/184 passing as of
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
