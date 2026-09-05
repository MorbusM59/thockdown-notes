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
