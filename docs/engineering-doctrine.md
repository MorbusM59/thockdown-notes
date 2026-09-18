# Engineering Doctrine

How work is done here. `guiding-vision.md` says why this app exists; this says
what it means to add to it without degrading it.

The division of labour is deliberate. The human moves fast and loose: ideas
arrive half-formed, ambitious, sometimes contradictory, and that is their
value. The agent is the counterweight — deliberate, methodical, and
answerable for the state of the codebase. Its job is not to implement whatever
is asked as quickly as possible. Its job is to keep this place coherent, and to
extend it only with pieces that are genuinely in harmony with what is already
here.

Concretely: **vet before building.** When an idea arrives, state the concerns
before writing code — what it conflicts with, what it would cost, which
existing rule it bends. The idea then gets refined until it can be built
cleanly. An idea implemented faithfully but incoherently is a failure, not a
delivery. Refusing to raise a concern because the request was clear is the
worst outcome available.

---

## 1. Set the bone. Never splint the fracture.

**The intended meaning, restored.** A fracture that is splinted rather than set
knits crooked: it holds for a while and will never carry load. The rule is
about the FIRST INSTINCT when something is broken — look for the structurally
correct arrangement, rather than for the layers and detours that would let the
broken structure keep bearing weight. It is not a rule about locating a "core
component". "The bone" drifted into meaning that, and the drift cost this rule
most of its force: finding the important file is easy, and declining to prop up
a structure you have just proved unsound is the hard part.

Two things follow, and they are the same instinct applied at two moments.

*Before fixing, ask where the fault IS, rather than where it SHOWS.* A symptom
appears at the surface; the defect is almost always one or more layers below.
Fixing where the symptom shows produces something that looks like a fix, passes
the immediate test, and leaves the real fault in place with one more layer of
compensation on top of it.

*Having found it, repair the structure rather than brace it.* A guard, a
clamp, a retry or a correction placed downstream of a fault is a splint. It is
load-bearing for exactly as long as nobody adds the next caller.

*Instance.* The render view restored one paragraph too high on every note
switch. Three fixes were attempted in ascending layers — the anchor resolver's
gap direction, then the restore's retry, then a discarded return value — each
plausible, each a splint. The actual fault was that `usePreviewWindow` stated
the rule *"a landing overrides a carry"* and applied it on only one of the two
branches that land. Every earlier fix would have shipped, and none of them set
anything straight.

## 2. When pieces will not fit, step up a level.

If a change requires a special case, a guard, or a clamp to coexist with what
is already there, that is a signal that the level being worked at is the wrong
one. Step up until a level is found where every piece places cleanly. Then fix
it there, and the special cases dissolve rather than accumulate.

*Instance.* The window oscillated between 16 and 24 blocks forever. The first
fix clamped the step so it could not overshoot — a guard bolted onto a formula
that was already wrong. The level above was the actual rule: *the window has a
target depth and a band it tolerates; it acts only outside the band, and when
it acts it aims at the target, never at the threshold it is escaping.* Both
directions then derive from one statement, and the clamp becomes a consequence
instead of a patch.

## 3. Never converge by retrying.

Wait until the information is there, then hit the target by design. An
approximate landing followed by a correction is not a cheaper way of arriving;
it is a wrong result painted first, and it is frequently worse than wrong,
because the correction becomes an input to whatever reads the result next.

Loops that retry until a timeout are the strongest form of this smell. So is
"try, look, try again" — even when bounded, even when it usually converges on
the first attempt.

*Instance.* The preview restore scrolled on an estimate, looked for its
target, and re-aimed for up to ninety frames. Replacing it with two
single-shot landings — one per rendering mode, each computed from information
already in hand — removed the loop, the frame budget, the cleanup registry it
needed, and a whole subscription channel on the settle gate.

## 4. A rule stated once must hold everywhere it applies.

This codebase reasons richly and locally: individual functions carry excellent
explanations of why they do what they do. The characteristic failure is not
bad reasoning — it is *correct reasoning applied to one caller and not its
sibling*. When a second branch, path or mode is added later, the invariant
does not follow it.

When you find an invariant, ask immediately: **what else does this apply to,
and does it hold there?**

*Instances.* "A landing overrides a carry" — honoured on the re-anchor path,
absent from the fast path. Grow and trim in the window planner — trim aimed at
the target, grow aimed at the threshold, for no stated reason. Both produced
compounding, user-visible drift.

## 5. Understand the system before measuring it.

Measurement is one tool among several, and it is not the strongest one. The
strongest one is reading the code until every moving part and every interaction
is genuinely understood. That is slower to start and far faster to finish,
because a measurement taken without that understanding does not answer the
question — it answers *a* question, and there is no way to tell which.

The distinction that decides which tool to reach for:

- **Questions about the CODE** — what does this do, why, what calls it, what
  did its author intend, does that intent still hold — are answered by READING.
  Never by experiment. The answer is already written down, usually including
  the reasoning.
- **Questions about the WORLD** — how long does this take, does it drop frames
  on slow hardware, what does the browser actually lay out, what did the user's
  machine really do — are answered by MEASURING. Nothing else can answer them.

Reaching for measurement on a code question is the characteristic error. It is
slow, and worse, it produces confident false positives: a symptom is observed,
over-read, and a fix lands one or more layers above the fault.

*Instance, the clearest.* The claim "a 1,000-item checklist is 1,000 blocks"
was wrong, and a throwaway probe was written to measure it — when
`PreviewBlockSplit.ts`'s own doc comment already states that "a 'loose' list or
a multi-line table is never split apart mid-construct." **The answer was
written down.** An experiment was run to learn something the code said plainly.

*Instance, the expensive one.* An eight-paragraph drift on note switch cost
three wrong fixes in ascending layers. Each was made from a trace showing a
symptom, without having read `moveWindow` and `anchorWindowOn`. Reading them
took minutes and made the fault unmistakable: a stated invariant applied to one
of two branches. The traces were not wrong; they were being asked to do a job
that reading does better.

*Counter-instance, so the balance is clear.* Whether a fully mounted 200-block
note drops frames at 6x CPU throttle is not knowable from any amount of
reading. That measurement decided a 1,700-line deletion, and nothing else could
have.

### Establish validity BEFORE running anything

A measurement that cannot discriminate is worse than none: it returns a number,
the number is believed, and the search moves somewhere false. Before running
anything, state all three:

1. **The question**, precisely enough that a specific result answers it.
2. **What would refute the hypothesis** — if no result could, this is theatre.
3. **Why this instrument can tell the difference**, including what it cannot
   see. `dev:browser` in the Browser pane never composites, so
   `requestAnimationFrame` never fires there and any rAF-dependent number taken
   from it is fiction rather than approximation.

Then, and only then, the trace outranks the theory — because it was built to.

## 6. Test the property, not the step.

A cumulative defect cannot be caught by a single-step assertion. If a bug
compounds — a walk, a drift, an oscillation — the test has to iterate and
assert the *fixed point*.

*Instance.* A two-cycle in the window planner survived twenty-five passing
tests, because every individual decision it made was correct. Only running the
decisions back to back shows that the two states are unreachable from each
other.

## 7. Delete what the fix makes dead, in the same change.

A fix that leaves its predecessor in place doubles the number of mechanisms a
future reader must understand, and one of them is a lie. When a mechanism is
superseded, it goes — along with its tests, its constants, its plumbing, and
its entry in any document that describes it.

*Instance.* Removing virtualization from the continuous pane took with it the
measurement survey, the estimate tiers, the hidden measurement host, the
discovery progress bar, a library dependency, and a persisted database column:
**−1,729 lines**, all of it scaffolding for a decision that no longer held.

## 8. No workarounds. Ever.

This is pre-alpha. There is no user to shield from a defect and no release to
protect, so there is never a reason to route around one. A setting that avoids
the bug, a threshold that dodges it, a flag that disables the path — these
convert a fault into a permanent feature of the landscape and guarantee the
next person meets it somewhere else.

If a defect is understood, fix it. If it is not understood yet, say so and
keep measuring.

## 9. A document that describes the code is part of the code.

A stale description is worse than no description: it is believed. When
behaviour changes, the documents that describe it change in the same breath, and
a superseded section is *marked* superseded rather than quietly left to rot.

*Instance.* `large-document-performance-handover.md` recorded "Fixed by
virtualizing the preview pane" as a past-tense achievement. Several sessions
later it was still read as present-tense description, and work was planned on
an architecture that no longer existed.

---

## The order of work

The rules above say what good looks like. This says what to do first, and it
is deliberately front-loaded onto understanding. Most of the cost of a bad fix
is paid before a line is written, in the decision to start writing.

0. **Read the documentation around the issue.** The canonical docs in
   CLAUDE.md, and the doc comments on whatever the issue touches. This
   codebase records its reasoning where the reasoning lives.
1. **Analyse the code.** Not the file the symptom appeared in — every file
   involved in producing it.
2. **Understand all the components** and, more importantly, their
   *interactions*. A symptom is usually the projection of an interaction onto
   one component, and reasoning about the projection alone is how a whole
   dimension goes unnoticed.
3. **Understand why things are the way they are.** Nearly every mechanism here
   carries the measurement or the incident that produced it. Find it before
   proposing to change it.
4. **Check whether that original reasoning still holds** — for the code as it
   is now, and for what is about to be built. Reasoning that was sound when
   written frequently outlives its premise; that is the most common thing
   worth finding.
5. **Draft an integration or refactoring plan** in which the new idea places
   cleanly. If no such plan exists at this level, apply rule 2 and go up one.
6. **Discuss the plan** before building. State what was found, what it
   conflicts with, and — explicitly — what could NOT be determined by reading,
   so the gaps are visible rather than assumed away.
7. **Run whatever measurements close a real knowledge gap**, subject to rule
   5's validity check. A gap that blocks the *plan itself* is measured earlier,
   at step 5, and the plan says so; measuring is not confined to this step, it
   is only ever justified by a gap that reading cannot fill.
8. **Execute, with a sanity check at every step** — is this still doing what
   the plan said, and is the app still whole?
9. **Hand over for user testing.** Report what was verified and what was not,
   plainly.

### When a check contradicts the plan, stop

Do not fix forward. A failing sanity check means the understanding from steps
1–4 was incomplete, so the correct move is to return there, not to add a
correction on top of a plan that is already known to be wrong. Every wrong fix
in this document's instances was a fix-forward from a plan that had already
been contradicted once.

## The daily walk

Extending the temple is the smaller half of the job. The larger half is
noticing what has drifted out of harmony — a mechanism superseded by something
newer, a correction whose original cause was fixed elsewhere, a fallback whose
trigger is now unreachable, a rule that half-applies.

When something like that turns up mid-task and fixing it would derail the
current work, it goes in `pending-review-and-removal.md` with what would have
to be true to remove it. It does not get silently stepped over. The point of
walking the same paths daily is to see what a first visit cannot.
