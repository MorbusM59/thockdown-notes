# Document Scale Performance Philosophy

## Purpose

This document defines the standing performance contract for the editor at scale. It is not a
bug-hunt log (that's `large-document-performance-handover.md`, which tracks the current punch
list against this contract) — it's the durable principle every future performance decision in
this codebase, at any layer, gets measured against.

## The benchmark

**Page 1 must feel identical to page 1,000.** A novelist writing a full novel — hundreds of
thousands of words, tens of thousands of lines — on a ten-year-old laptop must never
perceive "load." Not a stutter on keystroke, not a hitch on scroll, not a pause on note
switch, whether they're on line 1 or line 100,000. That is the literal acceptance test for
this app's core editing experience, not an aspiration. A feature isn't done if it degrades
with document size; it's unfinished.

This is not a new concern layered onto the app — it is core to why the previous version of
this app (V1) was scrapped and rebuilt. Caret-placement correctness and large-document
performance bottlenecks were structural failures in V1, not surface bugs. V2's foundation is
judged structurally sound enough not to repeat that; this document exists so it stays that
way. There is no scrap-and-restart option left on the table this time — every fix from here
has to land inside the current foundation.

## The core principle: computational scope must track the *viewed slice*, not the document

Every operation the editor performs on a keystroke, a scroll tick, or a note switch has some
natural computational scope: the set of data it actually needs to touch to do its job
correctly. For an editor whose document can be arbitrarily large, that scope must be bound by
**what's visible or being directly edited**, never by **total document size**. An operation
whose cost scales with document length, when its correct scope is a viewport or an edit
locality, is a defect — not a tradeoff, not an acceptable cost, not something to note and
move on from. This applies uniformly across every layer: markdown parsing/rendering, DOM
reconciliation, caret/selection offset computation, node tree operations, scroll-position
math, search, everything.

The corollary that matters most in review: **"it only shows up on huge documents" is not a
mitigating factor, it's the whole bug.** A function that's fast on a typical note and falls
over on a 50,000-line one hasn't degraded gracefully — it has failed the one property this
app is supposed to guarantee. Treat "O(document length) per keystroke" findings with the same
severity as a correctness bug, because past a certain document size, for this app's target
user, that's exactly what it is: the app silently stops being usable for the exact task
(writing something long) it exists to support.

## Solution hierarchy: elegance and continuity first, structural compromise last

When a document-scope operation needs to become viewport-scope, prefer solutions in roughly
this order:

1. **Algorithmic incrementality.** Reuse prior work for whatever part of the document didn't
   change; only redo work for the edited region plus whatever bounded context correctness
   requires. This is almost always available and almost always preserves the current
   continuous-document UX with zero visible change to the user. (`PreviewBlockSplit.ts`'s
   incremental block-boundary reuse is the reference example as of this writing.)
2. **Native/framework delegation.** Let the browser's own C++ implementation, or the editing
   framework's own dirty-tracking, do work that's inherently bound to what changed, instead of
   a hand-rolled full-document walk. (`SyntaxHighlightPlugin`'s use of Lexical's
   `registerNodeTransform` is the reference example.)
3. **Deferred/off-critical-path work.** Move genuinely necessary but non-blocking work off the
   keystroke-to-paint path (a Web Worker, a `requestIdleCallback`, a coalesced
   `requestAnimationFrame`) so it can't compete with input latency, even if its own total cost
   doesn't shrink.
4. **Viewport-bound rendering (virtualization).** Mount/reconcile only what's on screen plus a
   buffer, for whatever can't be made incremental. This changes DOM footprint, not the
   document's logical continuity — the user still sees and scrolls through one continuous
   document.
5. **Structural chunking (pagination or equivalent).** Genuinely bound the document into
   independently-addressable pieces so no single operation's *correct* scope can ever be the
   whole document, no matter how large it grows. This is the strongest guarantee available and
   the last resort — it changes what the document *is* to the user, not just how it's
   rendered.

Options 1–4 are strongly preferred and, together, are expected to be sufficient for this app's
actual target scale. Option 5 stays in the toolbox for a reason — if measurement ever proves
the earlier options structurally can't hit the benchmark — but reaching for it isn't a
shortcut around doing 1–4 properly first, and it is never the default answer to "this is
slow."

## If a structural sacrifice is ever genuinely required: it must read as a choice, not a limitation

If pagination or an equivalent structural chunk ever becomes necessary, the bar for shipping
it is not "it's fast now." The bar is that the experience it replaces must feel like a
**deliberate, polished design decision** a thoughtful team made on purpose — never like a
technical constraint the user is being asked to tolerate. Concretely, that means: a page
boundary crossed by scrolling should carry its own considered transition (e.g. a smooth
scroll to the page's end, a distinct and pleasant "turn the page" moment, then a smooth scroll
onward to the target line) — not a jump-cut, not a spinner, not a visible seam. If it can't be
made to feel intentional and pleasant, it isn't ready to ship, regardless of how much it
helps performance. This is explicitly *not* the current plan — today's job is to deliver the
existing continuous-document design at full performance — but if this path is ever taken, the
craft bar above is non-negotiable, not a nice-to-have.

## Process discipline (inherited, and now doubly reinforced)

This codebase's performance work has already been burned twice by the same failure mode:
trusting a plausible-sounding optimization without checking it against reality, and having it
turn out to be *wrong*, not just imperfect — a silent correctness bug shipped past unit tests,
caught only by live verification. See `large-document-performance-handover.md` for both
concrete incidents (a Lexical node-identity caching scheme that silently diverged from the
DOM; a markdown block-split incremental cache that trusted an unverified adjacency assumption
around code fences). The rules below are non-negotiable specifically because of that history:

1. **Measure before diagnosing, and measure again after fixing.** Reading code and reasoning
   about where the time goes is a hypothesis, not a finding. Use a live browser
   (`npm run dev:browser` + Playwright, see the handover doc for the environment-specific
   incantations) against a genuinely large document, with `performance.mark`/`measure` or a
   CDP CPU profile bracketing real candidate functions, before deciding what to fix — and
   again afterward, to confirm the fix actually moved the number and to find what's now the
   next bottleneck.
2. **Correctness-verify incremental/caching logic against ground truth, not hand-picked
   cases.** Any optimization that reuses prior computation instead of redoing it from scratch
   must be checked with a property/fuzz test comparing its output to the naive full
   recomputation across many random inputs — hand-written test cases alone have already
   proven insufficient twice in this exact codebase. If the reasoning behind why an
   incremental approach is safe can't be stated precisely enough to also state what a fuzz
   test should adversarially target, that reasoning isn't done yet.
3. **A live-browser functional check is mandatory, not optional, for anything touching editor
   state, selection, or rendering.** Unit tests test the model you wrote, not the browser's
   actual behavior; this codebase has two documented cases of tests passing while the feature
   silently corrupted state. Passing tests are necessary, never sufficient, for this class of
   change.
4. **Every fix in this space should state, explicitly, what remains.** A performance pass
   that fixes the biggest bottleneck and stops without profiling again has probably just
   promoted the second-biggest bottleneck to first place. Document the next number, not just
   the one just fixed.

## Current status against this contract

Tracked in `docs/large-document-performance-handover.md`, kept current as work lands. As of
this writing: per-keystroke markdown preview re-parsing has been made incremental (fixed);
per-keystroke canonical-text re-derivation has been partially reduced (fixed for four of five
call sites; the fifth is architecturally harder and still open); initial mount of an
uncached large note is still full-document-scoped (open); and a newly-found, currently
dominant cost — `getOffsetWithinRoot` in `SelectionOffsets.ts` performing a full linear scan
over every paragraph in the document to resolve a caret's character offset — is open and is
the immediate next target under this contract, since caret placement is exactly the kind of
per-keystroke, viewport-local operation this document says must never scale with document
length.

## Review checklist

Before considering any performance-relevant change in this space complete:
- [ ] The change was motivated by a live measurement, not code-reading alone.
- [ ] The change's cost is bound to the edited/viewed slice, verified by measuring on a
      genuinely large document (tens of thousands of lines), not just a small one.
- [ ] If the change reuses prior computation, there's a property/fuzz test proving equivalence
      to full recomputation, and the doc comment states precisely why the reuse is safe.
- [ ] A live-browser functional check was performed, not just the automated test suite.
- [ ] The re-measurement after the fix is recorded, including what the *next* largest cost is.
- [ ] Nothing here quietly reached for structural chunking (pagination or equivalent) without
      first exhausting incrementality, framework delegation, deferral, and virtualization —
      and if it did, the resulting experience meets the craft bar above, not just the
      performance bar.
