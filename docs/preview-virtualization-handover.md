# Preview-Pane Virtualization — Handover

Written for a fresh Claude Code conversation picking this up. Scoped specifically to fixing
**initial mount of a brand-new, uncached large note**, which is the one item in
`docs/large-document-performance-handover.md`'s "what's still open" list not yet touched by any
round of work. **Read `docs/document-scale-performance-philosophy.md` first** — the benchmark,
solution hierarchy, and process discipline there apply here unmodified.

## The problem, restated

A prior round measured initial mount of a 12,000-line note at **~9.8–12s wall-clock**, of which
only ~3s is the markdown parse itself (`splitMarkdownIntoPreviewBlocks()`'s full-document
`remark` structural parse — see `docs/large-document-performance-handover.md` for that
measurement). The remaining ~7-9s was never attributed to a specific instrumented function in
that round. This doc's research (read-only, this session) traced it to the most likely cause:
the preview pane mounts **every** markdown block's real DOM output unconditionally, regardless of
viewport, on the very first render.

This is a distinct problem from everything fixed so far. The incremental block-split
(`splitMarkdownIntoPreviewBlocksIncremental`) and the paragraph-offset index
(`ParagraphOffsetIndex`/`LexicalParagraphOffsetSync`) both only help once there's a previous
call's cache to diff against, or once the index is populated — a note's first render has neither,
so both already fall straight to their full/slow paths. Fixing this needs a different technique:
bounding the *initial DOM footprint* to the viewport, not making the computation incremental.

## Where the mount cost actually lives (confirmed by reading the source, not yet re-profiled)

**`src/editorSection/usePreviewMarkdownRendering.tsx:250-262`** is the unconditional mount loop:

```tsx
const previewMarkdownElement = useMemo(() => (
  <>
    {previewBlocks.map((block, index) => (
      <PreviewMarkdownBlock
        key={index}
        text={block.text}
        lineOffset={block.startLine}
        searchHighlightPlugin={previewSearchHighlightPlugin}
        components={previewMarkdownComponents}
      />
    ))}
  </>
), [previewBlocks, previewSearchHighlightPlugin, previewMarkdownComponents])
```

Every block in `previewBlocks` — however many hundreds/thousands of top-level `remark` nodes a
12,000-line note has — gets its own `PreviewMarkdownBlock` (line 52-76 of the same file, one
`<ReactMarkdown>` call each, `memo`'d on `(text, lineOffset, searchHighlightPlugin, components)`).
That memoization only prevents *re-rendering* an already-mounted block on a later keystroke; it
does nothing for the first mount, where every block is unmounted and must render regardless. Each
`ReactMarkdown` call is its own independent `remark`→`rehype`→React-element pipeline — a *second*
per-block parse on top of the structural-boundary parse already counted in the ~3s figure above.

This lands in the DOM at **`src/editorSection/SectionEditorArea.tsx:183-205`**: a plain
`<div ref={previewScrollRef} className="markdown-preview ...">` with native `overflow` scroll over
the full, unvirtualized content height. No windowing container, no fixed-height spacer.

**No virtualization library is currently a dependency** (checked `package.json` in full — no
`react-window`, `@tanstack/react-virtual`/`react-virtual`, `react-virtualized`, or similar), and
**no in-repo pattern to mirror** — the Lexical editor side doesn't virtualize either (it mounts a
normal `contentEditable` tree; nothing in `src/plugins/` does viewport-based node mount/unmount).
This would be a net-new pattern, not an extension of an existing one.

## The three places that assume every block is already mounted, real DOM

All three do synchronous `querySelectorAll`/geometry work against the *entire* preview container,
assuming full DOM presence with no async/virtualized gap. Each needs to change before
virtualization is safe to ship.

### 1. `src/editorSection/usePreviewScrollbar.ts` — custom scrollbar thumb math

Doesn't query blocks directly, but its whole model (`syncPreviewCustomScrollbar`, lines 93-143)
computes thumb size/position from the native `scroller.scrollHeight`/`scrollTop` (lines 104-140),
which only reflects the true document height today because every block is really laid out. Under
virtualization, `scrollHeight` needs to keep reporting an accurate (real-or-estimated) *total*
height — e.g. spacer elements sized from cached per-block heights — or the thumb will be wrong.
Also has a `MutationObserver` (`subtree: true, childList: true, characterData: true`, lines
207-212) that re-syncs the thumb on any DOM mutation; this will fire continuously as blocks
mount/unmount while scrolling under virtualization — harmless (it's just a re-measure), but a
real, frequent cost worth watching in re-measurement. `handlePreviewTrackMouseDown` (259-280) and
the PageUp/PageDown continuous-scroll code (322-475) compute target `scrollTop` purely from
`scrollHeight`/`clientHeight` ratios with no block awareness — these don't need rewriting as long
as `scrollHeight` stays meaningful.

### 2 & 3. Two independently-duplicated anchor-resolution implementations

Both resolve "which rendered block/line is at or near the viewport top," and both do it by
brute-force DOM geometry over *every* anchor element currently in the container — there is no
shared implementation between them, which is itself worth fixing regardless of virtualization
sequencing (two independent implementations of the same resolution logic is its own latent-bug
risk, the same class of thing this codebase's process discipline exists to catch).

- **`src/editor/EditRestoreMath.ts:106-148`, `findPreviewSourceAnchorElement(container, sourceLine)`**:
  `container.querySelectorAll('[data-source-line-start], [data-source-line]')` over the whole
  container, builds `AnchorEntry[]`, delegates to `resolvePreviewSourceAnchorEntry`
  (`PreviewScrollAnchor.ts:9-31`, pure array logic — that function itself is virtualization-agnostic,
  it just needs entries that actually cover the target line). Assumes synchronous, complete DOM —
  under virtualization, a `sourceLine` inside an unmounted (off-screen) block either silently
  resolves to the nearest *mounted* block or returns `null`.
- **`src/editorSection/useEditorSectionMount.ts:397-427`, `resolvePreviewSourceAnchorFromContainer(container)`**:
  the live call site with the identical hazard, reimplemented independently: queries every
  `[data-source-line]` element, calls `getBoundingClientRect()` on **each one** (potentially
  thousands on a large note) to find the anchor nearest-at-or-above the viewport top. Called from
  two places — `persistRenderViewStateForNoteNow` (428-441, scroll-position persistence on note
  switch/teardown) and a 120ms scroll-debounce effect (1557-1589) that fires **continuously while
  scrolling the preview**, re-querying and re-measuring every mounted anchor each time.

**Recommended fix direction**: deduplicate these into one shared implementation, and rewrite it
against whichever virtualization library's own index↔offset API is chosen (it already maintains
exactly this "which index is at this scroll position" mapping internally) instead of DOM geometry.

## Candidate approach

Per the solution hierarchy in `document-scale-performance-philosophy.md`, this is squarely
option 4 (viewport-bound rendering) — options 1-3 don't apply here since the cost isn't the
computation, it's the DOM footprint of mounting content nobody can see yet.

- **Library**: `@tanstack/react-virtual` is the strongest fit — headless (no prescribed markup or
  styling), so it can sit inside the existing custom-scrollbar UI (`usePreviewScrollbar.ts`)
  instead of fighting it, unlike `react-window`'s more opinionated component model.
- **Model**: viewport + buffer rendering keyed by block index (matching `previewBlocks`'s
  existing indexing). Per-block heights are unknown until first measured — use the
  "estimate then correct" pattern these libraries expect (an initial estimate, corrected via
  `ResizeObserver` as each block actually mounts and reports its real height), which also
  directly feeds the `scrollHeight`/spacer accuracy `usePreviewScrollbar.ts` needs.
- **Anchor resolution rewrite**: replace both DOM-geometry implementations above with one function
  built on the virtualizer's own "index at scroll offset" / "scroll offset for index" API.

## Craft-bar note (from the philosophy doc)

This change is explicitly **DOM-footprint-only** — the user still sees and scrolls through one
continuous document, nothing about the document's logical structure changes. That means the
philosophy doc's "structural sacrifice" craft bar (deliberate page-turn transitions, etc.) does
**not** apply here; this is option 4, not option 5. Flagging this explicitly anyway because
virtualization is exactly the kind of change that could accidentally regress into a visible seam
(a blank flash while a block mounts on fast scroll, a scrollbar thumb that jumps as estimated
heights get corrected) if implemented carelessly — any such seam should be treated as a bug to
fix, not an accepted tradeoff, before this ships.

## Open risks / things to verify explicitly

- **Scroll-position restore on note switch** (`persistRenderViewStateForNoteNow`) — currently
  measures real DOM geometry; needs to work from the virtualizer's model instead, and be checked
  against a note switch away-and-back on a large document.
- **The 120ms scroll-debounce anchor re-resolution** — fires continuously while scrolling; must
  stay cheap under the new model (this is precisely the kind of per-scroll-tick cost this whole
  effort is trying to bound, so a naive rewrite that's still O(mounted blocks) per tick would be a
  regression, not a fix).
- **Strict-Mode double-invoke safety** — the existing block-split cache needed a `useLayoutEffect`
  (not render-time) commit to stay Strict-Mode safe; a virtualizer integration doing its own
  ref-held mount/height cache will need the same care.
- **Search-highlight plugin** (`previewSearchHighlightPlugin`, threaded into every
  `PreviewMarkdownBlock`) — confirm it doesn't assume all blocks are simultaneously mounted (e.g.
  for "highlight count across the whole document" UI); not investigated this round.

## Before starting: re-measure

The 9-12s / ~3s-is-parse numbers are from a session two rounds prior to this doc. Per this
codebase's process discipline, confirm they still hold (same 12,000-line note, same CDP-profile or
wall-clock method as `large-document-performance-handover.md`'s "Environment notes" section) before
treating them as the target to fix against — code has changed since, including this round's
`normalizeInternalText` dedup, which touches the per-keystroke path but not initial mount, so the
initial-mount number itself is not expected to have moved, but that expectation should be checked,
not assumed.
