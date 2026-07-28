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

## What's still open

**Initial mount / note switch for a brand-new (uncached) huge note is NOT improved by the
above.** The incremental split only helps when there's a previous call's cache to diff
against; the very first render of a note has none, so it falls straight to the full-parse
fallback — measured unchanged at ~9.8–12s wall-clock for a 12,000-line note, ~3s of which is
still the unavoidable first full parse. This is a separate problem from the per-keystroke one
and still needs one of the two candidate paths below (most of the ~12s wall-clock isn't even
the parse — it's unaccounted for by any instrumented function here, most likely the initial
mount of every block's `ReactMarkdown` output at once, i.e. exactly what "virtualize the
preview pane" below would fix).

**A large residual per-keystroke cost remains even after the parse fix, not yet
investigated.** Post-fix, the held-key burst still averaged ~425ms/keystroke wall-clock, of
which only ~17ms/keystroke is accounted for by `splitMarkdownIntoPreviewBlocksIncremental`
(and `readCanonicalRootText` was independently measured at 10–40ms/call in the *previous*
round, on the old unoptimized path — likely similar or smaller now, not re-measured this
round). That leaves ~350-400ms/keystroke unexplained by anything instrumented so far. Prime
suspects, in rough likelihood order, none confirmed yet:
- React's own reconciliation/commit cost for whichever `PreviewMarkdownBlock`s actually
  changed (should be O(1) per #16, but not verified with the React Profiler under this
  specific large-note condition).
- Broader App-level re-render cascade on every keystroke when `deferPreviewOnRapidInput` is
  off (the toggle exists precisely to coalesce this, but this round's measurements all ran
  with it at its default-off state — re-measure *with* it on before doing anything else here).
- CDP/Playwright dispatch overhead inflating the wall-clock number itself, separate from any
  real in-app cost — worth cross-checking against React's Profiler API or `performance`
  marks bracketing the full React commit, not just Playwright's `Date.now()` deltas.

Recommended next action, following this doc's own now-twice-reinforced rule: **measure before
touching code.** Re-run the same live-browser measurement harness (see below) with
`deferPreviewOnRapidInput` toggled on, and with `performance.mark`/`measure` (or the React
Profiler) bracketing the full commit cycle, not just the two functions already instrumented
here, before deciding whether this is a React problem, a remaining-architecture problem, or a
measurement-methodology artifact.

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
in `LexicalEditor.d.ts`, not a private API), which does reliably reflect "something in this
subtree changed" regardless of object identity. Not attempted this round — the
`previousTextRef.current` fix above already captured the cheap, zero-risk half of this, and
measurement showed the parse fix mattered far more; revisit only if the "residual
per-keystroke cost" investigation above points back here.

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
- Verification bar for any change here: `npx tsc --noEmit`, `npm test` (153/153 passing as of
  this writing, no known pre-existing failures), `npm run lint`, **and** a live-browser check
  — twice now, a change here has passed its own unit tests while still being wrong; only a
  live check (or, better, a fuzz test comparing against ground truth across many random
  inputs, not just hand-picked cases) has caught it either time.
- This branch's PRs (#14–#17) were all opened against `main` and merged directly (`merge`
  method, not squash/rebase) once each was independently verified; follow the same pattern
  for any follow-up here rather than stacking onto old branch state.
