# Interaction Design Philosophy

## Purpose
This document defines how input, caret, scroll, note activation, and render/state-update scope must be implemented across the app.

The goal is deterministic behavior with one source of truth per interaction phase, and a render footprint that never exceeds what actually changed.

## Quality Bar
- Interactions must feel crisp, predictable, and immediate.
- Any tolerance, smoothing, or fudge factor must be deliberate, documented, and tied to a clear UX rationale.
- Hidden leeway that can blur correctness boundaries is not acceptable.
- No unnecessary re-renders or flicker: only what changed should redraw. This is treated as a correctness bar, not a cosmetic nice-to-have.

## Core Principles

### 1. Press-driven actions, not release-driven actions
- Primary user intent is recognized on key press.
- Any action that can be triggered on key press must not be deferred to key release.
- Key release is allowed only for lifecycle cleanup, never for first-time behavioral correction.

### 2. Deterministic first, geometric fallback second
- Boundary logic must be driven by deterministic state derived from the operation context.
- Geometry is a reconciliation aid, not the authority for core correctness.
- If geometry is missing or ambiguous, prefer deterministic state over timing retries.

### 3. Single owner per concern
- Scroll ownership must be explicit during guarded transactions.
- Caret visibility and viewport movement must not compete across multiple independent handlers.
- Each interaction has one active owner for state transitions.

### 3b. View-scrolling keys belong to the visible pane, not to whatever has focus
- `PageUp`/`PageDown` move the *view the reader is looking at*. Focus is where
  their next character would go, which is a different question: having just
  clicked a toolbar button does not mean the reader stopped reading. Routing
  these keys by focus alone leaves them swallowed by a button that has no use
  for them -- measured live: one click on any toolbar icon and PageDown did
  nothing at all until the reader clicked back into the text.
- So each pane listens at the window, and three conditions decide the single
  owner: the section is the active one (otherwise both panes of a split view
  answer the same keypress), the pane is the one on screen (the edit pane stays
  mounted while hidden, and would otherwise scroll invisibly in render view),
  and nothing with a real claim already took the key.
- "A real claim" means either a caret that can page through text
  (`contentEditable`, `textarea`) or a control that deliberately binds the key
  and calls `preventDefault` -- the Options sliders nudge by ten steps. Both
  panes use the identical predicate so they cannot drift apart; a focused
  button or search field is not a claim.

### 3c. The scrollbar describes the text, not the layout
- A scrollbar asks one question of the document -- "where am I, as a fraction?"
  -- and gets it two different ways depending on size
  (`src/editor/documentPosition.ts`). The scrollbar itself only ever deals in
  ratios and knows nothing about which answer it got.
- **Under 50,000 characters**: ordinary pixel scrolling. The whole document is
  rendered, its height is genuinely known, and pretending otherwise would be
  ceremony.
- **Over 50,000 characters**: the document is chunked, so its pixel height is
  not known -- and no attempt is made to learn it. Thumb POSITION is a
  character offset into the source; thumb SIZE is `viewport lines / document
  lines`, counted once from the source. Neither reads `scrollHeight`.
- The reason for the second is not accuracy, it is stability. A pixel ratio is
  a question about layout, and layout is not known until it has been measured,
  so the thumb moved every time the app learned something -- once per note
  load, and again whenever a better height estimate arrived. A scrollbar that
  twitches when the app's knowledge improves is reporting on the wrong thing.
- Ballpark is the standard there, not exactness: measured within 2-9% of the
  pixel ratio on ordinary notes, and knowingly worse on image-heavy ones. A
  thumb that is consistently a little wrong beats one that is briefly right and
  then moves.
- Recompute on CHANGE (the text, the typography, the pane geometry), never on
  measurement. If a recomputation would be triggered by the app finishing some
  work rather than by the reader doing something, it is the wrong trigger.
- That rule is now enforced rather than merely intended: the size is COMMITTED
  against a signature of exactly those inputs and held until one of them moves
  (`createCommittedThumbHeight`, `src/editor/scrollThumbMetrics.ts`). Deriving
  the right answer on every sync is not the same thing as holding it -- any
  wobble in the reading became a thumb that resized under the reader, most
  visibly at the end of a long journey.
- A provisional answer is never committed. "Not yet" is not an answer, and a
  document entitled to an exact scrollbar must not be pinned to whatever
  estimate happened to be current the first time it could say anything
  (`isThumbRatioSettled`, `src/editor/documentPosition.ts`).
- Where a thumb is written directly to the DOM for an animation, handing it
  back has to write the DOM directly too. A restore that only sets React state
  is silently conditional on that state having changed -- and once the size is
  correctly stable, it never has, so the animation's last frame stays on screen
  for good.

### 3e2. A keypress moves the text by whole rows, and never by a revision's cost
- **The invariant.** One arrow press moves the TEXT by exactly zero rows or
  exactly one row, decided only by whether the caret has reached the cage's
  edge -- never by anything about measurement. It is an invariant about where
  CHARACTERS sit, not about `scrollTop`: when a height-map revision changes the
  height of content above the viewport, holding the text still *requires*
  `scrollTop` to change, by exactly the revision's cost.
- Therefore `scrollTop` is the wrong thing to measure, and measuring it is how
  this hid for so long. A press reporting a scroll delta of -208px may have
  moved the reader one row while absorbing a -182px revision, which is right,
  or eight rows, which is not. Only text movement -- scroll delta minus height
  change -- answers the question, and the trace reports both halves for that
  reason.
- **A revision above the viewport is the only thing that displaces a reader.**
  Heights learned *below* the viewport do not move what is above them, so
  downward travel is correct by construction and must be left alone. Correcting
  it anyway broke it outright: the bottom resting position is screen-anchored
  (pane height minus two insets) rather than a row, so a real row can never
  land on it, the caret sits permanently short, and a correction firing on that
  residual fights every keypress. The correction is top-edge only.
- **CM6's anchor is not the reader's caret.** Its compensation holds *its own*
  anchor still, which can carry the caret clean across the viewport -- measured,
  a 442px revision moved it from the top edge to the bottom. So a check that
  asks only "is the caret inside the cage" is satisfied by a caret that has been
  thrown the width of the pane. Remember which edge the reader was travelling
  along and restore that; and let only a real keypress set it, since a
  correction that redefines the edge oscillates forever.
- A "no edge" answer is an answer. A caret comfortably inside the cage is not a
  missing reading, and treating it as one leaves the last edge standing, so
  every later press in any direction drags the caret back to it.

### 3e3. A long journey is one displacement, shown two ways
- **The curve is the whole-document curve.** `sampleJourneyDisplacement`
  (`packages/interaction/scrollJourney.ts`) says where the document *would* be at any
  moment if every block of it were mounted — ramp up, plateau, ramp down, as a
  single continuous position. A windowed pane does not get a different or
  shorter journey; it gets the same one, shown differently.
- **The only per-frame question is whether that position can be shown with
  real text.** If it can, the scroller scrolls. If it cannot, the curtain
  covers it. The curtain is therefore up for exactly the interval the pane
  cannot show, which on a windowed pane is most of the journey rather than
  only its middle.
- **What this replaced.** Three phases with three notions of motion, in which
  the curtain was driven at a constant peak speed because the plateau was the
  only phase that had one. It could only ever cover the plateau, so on a
  windowed pane — a mounted runway of a couple of thousand pixels against ramps
  of tens of thousands — the reader spent the rest of the journey watching a
  pinned scroller: measured at **94 consecutive frames, about 1.6 seconds**, of
  which the curtain covered one. There are now zero pinned frames, because
  nothing ever asks the scroller for a position it cannot give.
- **Both seams are continuous by construction.** The curtain is driven by the
  same displacement, so it enters at exactly the speed the real text was moving
  when the runway ran out, and leaves at exactly the speed the real text picks
  up again. Measured on a windowed travel: entering at 1.13 viewports per frame
  and leaving at 0.57, against 3.58 under the old constant peak-speed drive.
  That is also what made the spoof visible again — it used to cross the pane
  faster than it could be read.
- **Full cover has to be reached as the runway runs out, not after it.** The
  leading seam must sweep in over text that is still moving; a frozen strip
  beside a moving one is more obviously wrong than the cut it is hiding. So
  cover starts a viewport's worth of travel early.
- **Two lower bounds decide when the curtain lifts, and the longer wins.** The
  landing runway (cover until there is real text to arrive over) and the
  plateau (the middle is skipped rather than travelled, and that skip stays
  covered however much document sits either side of it). Without the second, a
  pane holding the whole document lifts the curtain after a single frame and
  shows a 126,909px jump.
- **The curtain's length is free.** It is a childless element clipped by a
  viewport-sized host, so only the visible strip is laid out and painted.
  Measured across band heights from 6,000px to 1,000,000px: **0.17–0.19
  ms/frame, flat** — about 1% of a 60fps budget, and independent of how far the
  journey goes.

### 3e3b. Mounted is not reachable
- A windowed pane has three different answers to "where is that character",
  and only one of them decides whether a travel needs the curtain:
  **is it mounted** (a measurement exists), **is it in the window** (the block
  index is in range), and **can a plain scroll get there** (its pixel is inside
  `[0, maxScrollTop]`). Only the third is a question about `scrollTop`, and it
  is the one that must be asked.
- Conflating the first with the third is what sent most scrollbar clicks in a
  large note nowhere. The window's last screenful is mounted, in range, and
  *unreachable*: it cannot be brought to the top of the pane because nothing is
  mounted below it to scroll into. Asking for that pixel clamps, so the travel
  lands short of where the reader clicked — and no curtain is raised, because
  the branch that clamped had already decided none was needed.
- So the rule is: **the curtain is raised whenever a plain scroll cannot
  reach the target**, not whenever the target is outside the window. In a
  document past the 50,000-character windowing threshold that is almost every
  scrollbar click. Both paths follow it — the animated one
  (`smoothScrollToChar`) and the instant one (`scrollToChar`).
- The old predicate came from the chunked virtualizer, where "in the current
  chunk" and "reachable" genuinely were the same question. Windowing replaced
  chunking and they stopped being the same; the predicate did not follow.
- **Distance does not decide whether a windowed travel is bridged.** The
  journey planner's own threshold asks "is there a middle worth cutting" — a
  hop shorter than the two ramps has none, so it plays as an ordinary curve.
  That is right for a pane holding its whole document and wrong for a windowed
  one, where a target outside the window is unreachable *at any distance*.
  Measured: the threshold is 11,369px at the default curve, about **thirty
  screenfuls** of a 371px pane, so every scrollbar click landing nearer than
  that was planned as direct, aimed at a pixel the scroller did not have,
  clamped, and arrived short with no curtain. In a document past the windowing
  threshold that is nearly every click, and only the longest ones ever
  bridged.
- So the planner takes `requireBridge`, and the engine sets it from
  `journeyDistancePx` — the option one caller passes for exactly one reason,
  that the destination has no pixel in this scroller. Inferred from the option
  already there rather than given a flag of its own: two flags meaning the same
  thing is how they come to disagree, which is the bug directly above.
- **A ratio that cannot be resolved must still move the reader.** The tail
  probe measures how many characters the last screen holds, and restarts on
  every change of document, typography or pane width. Until it answers, the
  ratio-to-character mapping used to return null — and a null there made the
  click do nothing at all, silently. Mapping straight through the document is
  slightly low at the very bottom of the track and the scroller clamps that
  itself; a dropped click has no such excuse.

### 3e4. `scroll-behavior` has one owner and many borrowers
- `.markdown-preview` carries `scroll-behavior: smooth` in CSS, so anything
  driving its own animation must hold `auto` for the length of its run. Four
  things in the render view do, and they overlap constantly: a journey, a wheel
  glide or coast, a held page key, a thumb drag.
- Save-set-restore is correct for one borrower and wrong for two, and both
  failures shipped. **Inner finishes first:** it hands the property back to
  what it found, which is the outer borrower's `auto`, and the pane never sees
  its CSS again. **Outer finishes first:** it restores the real value while the
  inner one is still animating, so every remaining write is natively
  smooth-scrolled and each frame retargets the last — measured, a 400px journey
  that should run 0-19-65-201-336-382-397-400 instead moved **four pixels and
  stopped.** It reads as a short nudge in the right direction that gives up.
- That second one happened on every wheel gesture followed by a scrollbar
  click, because the glide's teardown fires precisely when it notices a journey
  has taken the scroller. It was invisible on long journeys — their ramps are
  under the curtain and the landing is set directly — and fatal on short ones.
- So the property is owned by `packages/interaction/scrollBehaviorLock.ts` and callers
  take a counted borrow. First borrow records the real inline value and sets
  `auto`; last release puts it back. Releases are idempotent, because teardown
  here is reached from a frame loop finishing, a cancel and an unmount, and any
  two can fire for the same borrow.
- **Synchronous save-set-restore around a single write does not need the lock**
  — nothing can interleave with it, and whatever it saves is what it restores.
  Only borrows that outlive a frame do. Adding a new one of those without
  taking a borrow reintroduces the whole class.

### 3f. A journey in flight is not interruptible, except to end it
- While a scroll is travelling, an ordinary click on the track is ignored. A
  second journey would inherit the stretched thumb as its own base size and
  set off from that, which is how a thumb ends up longer than its own rail.
- The one input honored mid-flight is the HOLD, which snaps. That is coherent
  because a snap ends the journey outright rather than trying to travel
  alongside it -- and it is the gesture a reader reaches for precisely when
  they have decided the journey is in the way.
- Ending a journey early, by any route, must return the thumb to its resting
  size. A cancelled animation that leaves its own geometry behind is worse
  than one that never ran.

### 3g. A wheel spin may outlive the hand, and one nudge takes it back
- Three notches in the same direction, each inside the user's `auto scroll`
  threshold (10-50ms), are one gesture rather than three, and the view keeps
  scrolling at the rate that gesture set (`src/editor/wheelSpin.ts`). Both
  sliders carry an OFF position as their leftmost step rather than a
  separate toggle -- one persisted number per control, and the off state
  living at the end of the axis it continues.
- **Both panes, one gesture.** The edit and render views share the state
  machine, the three sliders and every rule below; what the wheel means does
  not depend on which pane it is over. They differ only where the panes
  themselves differ -- see 3h.
- In the edit view, every simulated nudge is an ordinary whole-row scroll, so
  3d holds through a coast exactly as it does under the hand.
- A coast travels at the rate the hand set, which is now a rate the reader
  set: one `step` (3h) per simulated nudge, in whichever unit the pane
  counts in. Nothing in the spin model knows about either -- it carries
  whatever the real nudge was worth -- which is why one number governs the
  wheel and the coast together and they cannot drift apart.
- **The tail of the gesture is not input.** A spin does not end on the notch
  that starts the coast; the remaining notches arrive while it runs, and
  acting on them doubles the speed while treating them as an interruption
  kills the coast on the frame it began. They are ignored for a flat 500ms
  -- a property of the hand, which takes about as long to stop turning a
  wheel however fast it was turning it. A window proportional to the
  gesture's own speed served the fast spin worst, which is the one with the
  longest tail.
- **The coast ends at the user's `cut off`** (50-500ms between rows). This
  was derived from the spin threshold for a while, on the theory that one
  number should not need a second; in practice they answer different
  questions -- how quick a spin has to be, and how slow a coast may get
  before it stops being one -- and tying them together meant tuning either
  could only be done by accepting what it did to the other.
- **Except at the dampen slider's leftmost position**, which is a decay of
  exactly 0 rather than a very small one, and where the coast runs until
  something stops it. That position is a sentinel value rather than a small
  number, because "never slows" and "slows imperceptibly" are different
  promises and only one of them can be kept by arithmetic.
- **After that, the next notch stops the coast and scrolls nothing** -- the
  same bargain as 3f. A gesture that both halts the motion and adds to it
  cannot be aimed, and stopping on the line you meant to stop on is the
  entire point of taking control back.
- Anything else that means the reader has moved on -- a keystroke, a click in
  the text, a blocked scroll transition, the end of the document, unmounting
  -- ends it too. A page that keeps moving under a keypress is not a feature.

### 3h. A notch is worth so much reading, and the reader sets how much
- **A wheel notch is measured in text, in both panes** (`src/editor/wheelStep.ts`).
  The edit view scrolls `step` whole rows per notch (1-10); the render view
  scrolls `step` line heights (0.5-5, fractional). Neither is a pixel figure,
  and that is the point: turn the text size or the line spacing up and the
  same gesture still moves the same amount of *reading*. A pixel-delta wheel
  -- which is what the render view used to have, straight from the device --
  quietly scrolls less and less text as the reader makes the text bigger,
  which is exactly backwards.
- **Two settings, because the panes count in different units and always
  have.** The edit view lands on row boundaries (3d), so its step can only
  be a whole number of rows; the render view has no grid to land on, so its
  step can be a fraction of a line. One shared number would have to be one
  or the other, and would be lying to one of the panes.
- **Which is why both panes intercept every notch.** A non-passive wheel
  listener takes a pane's scrolling off the compositor: nothing moves until
  the main thread has seen the event and declined to cancel it, measured on
  the real app with a 1200-section note at 4ms to first movement when
  passive against 33ms when not. That is a real cost, paid on every wheel
  event, and it is the price of the notch being worth what the reader asked
  for rather than what the device happened to send. It also makes the two
  panes answer a wheel the same way, which they visibly did not before.
- **What counts as a nudge is decided identically**, by the one
  `editor/wheelNotch.ts` accumulator both panes learn the device on. The
  same wheel on the same desk makes a nudge in both at the same moment, and
  a trackpad's sub-notch stream makes one in neither.
- **The render view's coast is continuous, not stepped**
  (`src/editor/wheelSpinProfile.ts`). Same schedule, same decay, same cut
  off, same distance travelled at every nudge time -- but the nudge distance
  is a unit of calculation only, never of animation. A row is small enough
  that a step reads as motion; a render view step is several lines tall, and
  once the dampening has stretched the interval toward the cut off,
  delivering that in one jump twice a second is a page being nudged, not a
  page coasting to a stop. The coast is therefore planned once, at the
  moment the spin is detected, as a series of dots -- at time T_n the reader
  has travelled n nudges, arriving at speed P/d_(n-1) -- and ridden as a
  monotone cubic through them: exact at every dot, C1 between them, sampled
  from absolute elapsed time so a late frame self-corrects.
- **A coast brakes, it does not stop.** The cut off says an interval this
  long no longer reads as motion; it does not say the motion should end
  mid-stride, which ending on the last nudge amounted to -- speed went from
  a seventh of its starting value to zero in one frame. The nudge that would
  have exceeded the cut off is spent braking instead, through
  `buildReleaseRampDownPlanFromCurrentParams`: the same bell tail the
  key-held continuous scroll releases with and every journey ramps down
  through, so a coast ends the way every other motion in the app ends. That
  shared bell is truncated at about 19% of its own peak rather than carried
  to zero, so this is not a stop at rest -- it is a stop from 0.65px per
  frame instead of 9.3px, which is below noticing. The absolute per-frame
  figure is the thing to check if the ramp's shape is ever retuned.
- **A gesture's shape is set by the hand that made it.** The dampening and
  the cut off are read once, when the spin is detected, and the coast then
  runs on those numbers. Moving either slider mid-coast does not re-shape a
  gesture already in flight; it applies to the next one. The auto-scroll
  threshold's off position is the exception, and stops a running coast at
  once -- switching a feature off is a request to stop now.
- **A single notch is travelled, not jumped** (`src/editor/wheelNotchTravel.ts`).
  Owning the notch means nothing animates it any more, and an instantaneous
  write of several line heights is the one kind of motion the eye cannot
  follow at all. So a notch is played across time instead.
- **A lone notch rides the shared bell, so the sliders reach one line of
  scrolling.** `ramp` and `shape` cut a single notch's curve exactly as they
  cut a journey's, and `speed` sets its duration at a quarter of the journey
  time -- 100ms at the default, 25ms to 500ms across the slider. A quarter
  and not the whole: a journey's 400ms spent on one line lags the hand badly.
  This is not decoration. Built on a quintic alone, a notch measured
  byte-identical across the full range of every slider -- `shape` from 0.1 to
  0.9 moved nothing, because a quintic Hermite is fixed entirely by its
  boundary conditions and reads no curve parameters at all. Now `shape` moves
  the apex from 10% to 89% of the notch: at 0.1 half the distance is gone in
  the first quarter and the rest glides out, at 0.9 it has barely started.
- **The second notch splices onto the first, it does not restart it.** A wheel
  is turned, not tapped, so notches arrive while the previous one is still
  being paid out. Each new one snapshots the in-flight motion's instantaneous
  velocity AND acceleration and builds a quintic to the new total -- whatever
  was left plus the new notch -- which is `buildContinuationPlan`, the same
  mid-flight retargeting the escape-hold ring uses. Measured at 0.0% velocity
  step across every cadence from 30 to 100ms, against the full drop to rest a
  restart would have made at exactly the moment the reader asked for more.
- **Only the first notch of a run is shaped, and that is the trade.** The bell
  cannot be started from a velocity it did not plan for, and the splice must
  match one exactly -- so a notch landing mid-flight is a quintic and carries
  no slider character. The reader judging `shape` is turning the wheel once,
  which is the case that answers to it; the reader spinning it is asking for
  continuity, which is the case that cannot.
- **A spin carries what the notch had not delivered yet.** A spin is detected
  on its third notch, by which point the glide still owes about 2.7 nudges --
  notches arrive far faster than one is paid out. The coast inherits that
  remainder rather than dropping it, so a spin travels what the hand actually
  turned. It is folded in with a smootherstep (zero velocity and acceleration
  at both ends, so it cannot reintroduce a step) spread across the whole
  schedule rather than the coast's opening: the same 208px folded into the
  first tenth of a second peaks 93% above the uncarried coast, and spread it
  peaks 19% at a point where the coast has already slowed. A carry is owed,
  not urgent.
- **Only a nudge the OTHER way stops a coast.** A nudge the coast's own way
  is not an interruption, it is a request for more of what is already
  happening -- so it adds one more nudge of distance and the coast runs on.
  The reversal still scrolls nothing, so you can halt on the line you meant
  to, and it is honoured inside the grace window as well as outside it: a
  hand finishing its own spin does not reverse, so a reversal in there is a
  real one, and making the reader wait 500ms for it reads as the wheel being
  ignored.
- **Three quick nudges the coast's way are a respin, adopted only if they are
  faster.** The reader spinning harder wants more speed; the reader spinning
  slower than the coast has not asked it to slow down, and those nudges just
  extend it instead. "Faster" is measured against what the coast is ACTUALLY
  doing at that instant, not the rate it was planned at -- a coast a second
  and a half old has decayed to a fifth of its opening speed, and the same
  30ms respin is correctly declined at 200ms (coast 3,464px/s against the
  gesture's 2,560px/s) and adopted at 1,500ms (coast 723px/s). Adopting
  re-opens the grace window, because the new spin has a tail of its own.
- **`wheelSpin.ts` reports a respin, it does not take one.** Only the caller
  knows how fast its own coast is going -- the render view rides a
  precomputed curve and measures it, the edit view reads its decayed interval
  -- so the gesture layer offers the rate and the animation layer decides.
- **A coast ends at the document's edge, not the scroller's.** A windowed
  render view (`editorSection/previewWindow.ts`) runs out of mounted content
  many times on the way through a large note. The edit view can read "it did
  not move" as the end of the document; this pane must ask
  `isAtDocumentEdge`, or a coast would die a third of the way down.
- **Anything with a destination of its own outranks a coast**: a search
  jump, a scrollbar travel, a chapter change. One check for a running
  journey covers all of them, including the ones added later.

### 3i. A held button ramps and coasts; it never races or crawls
- **One routine owns press-and-hold value adjustment** (`src/shared/holdToAdjust.ts`
  for the motion, `src/shared/useHoldToAdjust.ts` for the wiring). Any control
  that lets the reader hold to change a number uses it. This is a toolkit
  piece, not a music-player detail: nothing in either file knows what the
  value means.
- **The motion is the app's own scroll curve, not a rate.** The leading half
  of the bell in `editor/ScrollCurvePlan` -- rest, up to a constant speed,
  then that speed held until release, and a hard stop. The two usual
  alternatives both fail: a rate proportional to hold duration takes off too
  fast to aim, and a fixed amount per interval is either too slow to cross the
  range or too coarse to land on a value. A two-step "slow then fast" only
  hides the discontinuity where the reader will feel it.
- **Ramp and shape come from the reader's animation settings unchanged.** They
  describe a feel that should be identical everywhere the app moves. Only
  speed converts, because a scroll's speed is in pixels and a value's is in
  whatever it counts: the setting is restated as *how long a hold takes to
  cross the whole range*, `0.5 + animationSpeed * 5` seconds. The floor is
  what keeps the snappiest setting aimable rather than instantaneous.
- **The curve is always the whole range's curve.** Where the press starts
  changes only how soon it reaches an end, never how it feels -- a hold from
  60 accelerates exactly like one from 0. Anchoring the curve to the remaining
  distance instead would make the same gesture behave differently depending on
  where the reader happened to be, which is the thing that makes a control
  feel unpredictable.
- **No hold threshold, and a tap always moves by one.** The value starts moving
  on press rather than after a delay spent deciding whether this is a click;
  a press that ends before the curve has earned a whole step still applies
  one. Waiting 300ms to decide makes the control feel dead exactly when the
  reader is being precise, and is unnecessary once a tap has a defined result.
- **Released means stopped.** There is no release ramp-down here, unlike a
  wheel spin (3g): a spin is momentum the hand imparted and left behind, while
  a held button is a continuous instruction that ends when the finger lifts.
  Coasting past the release would overshoot the value the reader stopped on.

### 3d. In edit view, text is never between rows
- The edit pane is a grid of character cells. Text sits on row boundaries
  before, during and after every interaction -- a wheel, a held PageDown, a
  thumb drag, a resize, a mid-flight animation frame. There is no moment,
  however brief, at which a line is allowed to sit half a row off its box.
- This is a hard guard, not a convention: every engine that writes `scrollTop`
  quantizes on the way out, and `src/editor/rowGridGuard.ts` is the net beneath
  them for the writes the app does not make (chiefly CodeMirror adjusting
  `scrollTop` as its own height estimates firm up). Two correctors never run on
  one scroller at once; the guard stands down while a drag-selection owns the
  position.
- The rule is edit view only. The render view lays out blocks of every height
  and has no grid to hold.

### 3d2. In edit view, a click lands on the box under the pointer
- The cells of 3d are what the reader sees and aims at, so a click selects the
  box the pointer is over -- the caret goes before that character -- not the
  nearest boundary between characters, which is what CodeMirror does on its
  own and which put every right-half click one box too far. A drag selects
  every box it covers, the box under the pointer included; double and triple
  clicks keep CodeMirror's word and line selection. One rule for every editor
  click, in `src/editor/boxPointer.ts`: plain presses and drags, right-click
  scope cycling and the checkbox caret-click all resolve their position there.
- The drawn mouse cursor sits exactly on the pointer, everywhere. It used to
  be drawn 5px right of it to make editor clicks feel accurate, which made
  every click outside the editor miss by those 5px and was only right at one
  font size. Accuracy is decided where the click is interpreted, never by
  moving the cursor's picture -- do not reintroduce an offset there.

### 3d3. In immersive mode, the edit view's scrollbar is part of the grid
- Immersive mode has no app grid to hold the ordinary track, so the track
  becomes the grid's last full box column, over exactly the whole rows the
  viewport shows; with review flags on, the flag column sits two columns to its
  left with one empty column between. The boxes are the track (in the gutter
  background colour) and the thumb (in the immersive scroll thumb colour,
  painted over it). Regular mode keeps its ordinary scrollbar.
- It is the SAME scrollbar, not a second one: thumb size from the text, click
  travels, hold snaps, the bridged-journey stretch -- all in pixels against
  whichever track element is mounted. Only the drawing differs, through one
  paint function in `CM6Editor.tsx` (`paintScrollThumb`), so the two
  presentations cannot drift apart. Do not fork the logic for the grid.
- The thumb's own boxes are inert: there is no drag. Anywhere else on the column
  is a track press read at its exact pixel -- the upper and the lower part of
  one box land differently -- and only the resulting scroll position is rounded
  to a row, as every edit-view scroll is. The thumb is a whole number of rows
  (decided where its size is decided, not only where it is drawn), and its
  two edges are each rounded to their own nearest row boundary
  (`src/editor/immersiveScrollColumn.ts`). That is what keeps it steady while
  it moves, makes it always cover the box that was clicked (pinned against
  either end of the track included), and keeps a journey's stretch from ever
  colouring a box past where it lands -- rounding a size and a start
  separately did exactly that, a one-row flicker below the destination. All
  three are tested properties, not intentions.

### 3e. A long journey is cut, not endured
- Travel time is a property of the interaction, not of the distance. A
  scrollbar click across a very large document takes about the same half second
  as one across a small one, because the journey's middle is removed rather
  than played (`packages/interaction/scrollJourney.ts`, `src/editor/scrollBridge.ts`).
- It is a cut, not a teleport, and the difference is the whole design: the
  motion ramps up on the real document, a curtain of spoof text sweeps in at
  the journey's own speed, the jump happens only while the pane is fully
  covered, and the ramp-down lands on the target as the curtain sweeps out. The
  reader sees text leave, text pass, and text arrive.
- Speed is always measured in real viewport pixels, never in characters. A
  character-space ratio may say WHERE to go; how fast it feels getting there is
  a question about the screen.
- The scrollbar tells the same story rather than a smoother one. Its thumb
  stretches across the span, holds while the cut happens, and gathers itself at
  the far end -- a thumb that slid evenly would be describing a journey that
  did not take place.
- Nothing here reaches the scroll-sync between the two panes, which keeps its
  own approach.

### 4. No hidden second chance paths
- Fallbacks may exist, but they must not duplicate primary behavior in another phase.
- A release-phase fallback that can re-run a press-phase action is prohibited.
- If fallback is required, it must be phase-compatible and side-effect bounded.

### 5. Recoverability without ambiguity
- User-facing state changes must be recoverable through explicit idempotent actions.
- If UI appears stale, selecting an item again should perform a safe reload path.
- Active identity and rendered content must stay coupled.

### 6. Simplicity over defensive complexity
- Do not add state branches unless they close a reproduced failure mode.
- Remove temporary probes and safety scaffolding once deterministic behavior is confirmed.
- Prefer fewer transitions with stronger invariants.

### 7. No blanket fail safes
- A fail safe must never be used to mask unknown structural or technical defects.
- Blanket catch-all correction paths that obscure root causes are prohibited.
- A fallback is acceptable only when the edge case is known, deterministic, and explicitly scoped.

### 8. Pathology-first visibility
- Pathological behavior must remain visible enough to trace to first cause.
- Do not suppress or auto-heal failures in ways that erase diagnostic signal.
- If behavior is wrong, the default response is root-cause analysis and core-fix implementation.

### 9. Root-cause correction mandate
- Fix the origin, not the symptom.
- If a workaround is temporarily required, it must be time-boxed, documented, and removed after root-cause fix lands.
- Every corrective patch should state what vulnerability was removed from the core path.

### 10. Surgical rendering, never blanket updates
- Every state update must be scoped to exactly the entities that changed. Before writing one, identify precisely what's affected -- don't reach for "just replace the whole list/array/object" as a default because the real scope wasn't analyzed.
- Unaffected siblings must keep stable object identity (same reference, not a re-created equal copy) so they don't re-render alongside the thing that actually changed.
- A blanket update is acceptable only when the entire scope genuinely did change -- never as a shortcut that saves having to figure out what did.
- This is the default impulse for every state-touching change, not a special-case optimization reached for only when profiling flags it. Unnecessary re-renders and flicker are a broken-feeling product, not a cosmetic detail: nothing undermines a premium, physical-object feel like parts of the UI visibly redrawing themselves for no reason. We're building something that feels like a rock, not a mirage.

## Input Phase Contract

### Key press phase
- Capture intent.
- Arm deterministic transitions.
- Apply primary behavior for actions that must feel immediate.

### Update phase
- Reconcile DOM/editor state after the engine applies mutation.
- Apply caged viewport correction and caret stabilization.

### Key release phase
- Clear pressed-key bookkeeping.
- Deactivate transient transaction guards when safe.
- Never perform first-time scroll or caret correction.

## Rules for Boundary-sensitive Enter and Arrow Handling
- Enter boundary shifts are key-press initiated.
- Arrow navigation reconcile is update-driven after movement is committed.
- Boundary detection must use authoritative caret geometry for arming decisions.
- Ambiguous geometry must never promote a boundary state.

- **A destructive decision is made from the source of truth, never from a renderer cache.** "Is this note empty?" answered from the editor's in-memory buffer or the notes list can be wrong in ways the two caches AGREE on -- the buffer misses text that arrived by another route, the list misses anything not yet refreshed -- and when they agree wrongly, the note is deleted with the user's writing in it. Read the record (and flush pending writes first). One IPC call at a rare gesture costs nothing; deleting someone's note is unrecoverable. Found exactly this way while building set-aside for undocked notes: a note reading "Call from Rita" was discarded because both caches still said it was the empty template.

## Rules for User-Facing Text
- **A tooltip is user information, never code commentary.** It says what the control does or why it is unavailable, in the reader's terms, and stops. Mechanism, architecture, rationale, and the design reasoning behind a restriction belong in the code comment next to the implementation -- where the person who needs them is actually looking -- not in the one line a user reads mid-task.
- Concretely: "The User Guide cannot be modified." is complete. "The User Guide is read-only -- it ships with the app and updates itself" is a note to a developer wearing a tooltip's clothes, and it costs the reader time to work out that none of it changes what they can do.
- The test: would this sentence still make sense to someone who does not know the app has a database, a main process, or a seeding step? If not, it is commentary. Move it into the code and write the user a shorter sentence.
- This applies equally to `aria-label`, placeholder text, empty-state copy, and confirmation prompts. Being thorough in the wrong register reads as noise, not care.

## Rules for Note Activation and Switching
- Note creation and activation must be atomic from the user perspective.
- Active note identity must drive editor instance ownership.
- Selecting a note card must be capable of forced reload recovery when state is stale.
- **Smooth scrolling is an orientation device, and orientation only exists within one document.** A jump that stays in the note the reader is already in (a find hit, a link to another part of the same note) animates: watching the travel is what tells them how where they were relates to where they asked to go. A jump that *changes* the active note never animates -- the position it would travel from is one the reader did not choose and mostly never saw, so the motion conveys nothing and only delays arrival.
- **A heading is a destination, not a point in prose.** A jump whose target is a heading (a table-of-contents entry, any `#heading:` anchor) lands that heading at the TOP of the viewport, not centred, and never animates -- not even within the note the reader is already in, which is the one exception to the orientation rule above. Centring a heading spends the upper half of the viewport on the section being left, and a menu of destinations is chosen from in order to arrive, not to watch. Mid-prose targets (a find hit, a manual `[text](#anchor)` into a paragraph) keep centring, the animation, and the highlight flash: there the target really is one point among others, and the flash is what distinguishes it.
- A note opened *at* a position (an anchor/TOC link into it) must be restored directly onto that position, not restored to its own stored position and then moved. The stored position must never be painted first: arriving somewhere the reader did not ask for, however briefly, is the same defect as landing there. Both panes have a channel for this -- `buildEditRestoreSnapshotFromUiState`'s `overrideSourceAnchorLine` for edit, `pendingRenderViewSourceAnchorRef` for render -- and both are fed from `activateNote`'s own override parameters.
- Programmatic jump geometry must not depend on the editor being focused. An unfocused editor has no DOM selection to measure, and following a link is exactly the case where focus is on the thing that was clicked -- resolve the target from the editor's own layout instead (CM6Editor's `resolveSelectionBlockInScroll`), or the jump silently does nothing in the one case it exists for.
- **Restores supersede, they never queue and never block.** A restore is a decision about where the reader should be, so the newest one -- computed from the newest state -- wins; an in-flight one is cancelled, not deferred to. Dropping the newcomer (the old rule) let a hand-off derived from where the reader actually is lose to a stale cached one, and made any restore that never completed silently disable every later restore for the rest of the session.
- **"It stopped moving" is not "it arrived."** A restore that positions the editor by line has to keep verifying against the editor's *current* height map: for lines it has not rendered, CM6 answers with an estimate that ignores wrapping, and a viewport landed on that estimate is perfectly stable at the wrong place. Settle loops exit when re-deriving the target would no longer move anything -- never on stillness alone.

## Review Checklist
Before shipping an interaction change, verify:
- No release-phase action duplicates a press-phase behavior.
- Boundary transitions are deterministic and reproducible under key repeat.
- No hidden race between native behavior and guarded behavior.
- Re-selecting active entities can recover from stale render states.
- Temporary instrumentation is removed once validation is complete.
- No blanket fail safe was introduced to hide unresolved behavior.
- Any fallback path is deterministic, bounded, and justified by a documented edge case.
- The patch removes or narrows a concrete root vulnerability instead of broadening tolerance.
- Every state update touches only the entities that actually changed; unaffected siblings keep stable object identity instead of being blanket-recreated.
