# The adventure platform — design contract

The game reached by right-clicking the User Guide window control. This
document is the source of truth for HOW THE GAME IS BUILT;
`src/escapeMenu/escapeMenuContract.ts` is the source of truth for how it
reaches the screen. Read both before changing either.

Two things are deliberately separated here, and conflating them is what went
wrong with the first attempt:

- The **platform** (`src/adventure/`) is a director and a set of stages. It
  knows about screens, choices, stacks, saves and effects. It contains no
  rules.
- The **game** is Thockquest (`src/adventure/content/thockquest.ts`), which
  is data. A second game would be a second content file, not a second
  engine.

## The ring is an input device

The escape-hold ring says how a choice is expressed — an icon and a few
words — and how many will fit. It says nothing about the bookkeeping
underneath, and the bookkeeping owes it nothing. There are exactly three
channels:

| Channel | Carries |
| --- | --- |
| the ring | one question's choices, as icon + short label — ALL of them the stage's own |
| the tab bar | health, armor and the six stats, each an ICON and its value (the name in the tooltip) — or, while a choice is focused, that choice's own effects |
| the chapter bar | its leading toggle, the identity pill, then narration: what just happened, and the frame for what is being asked |
| the identity pill | `IV [Combat] 3 | 4` — level in roman numerals, the stage, how far through it. In the note-id position on the chapter bar, fixed width, clipped: it changes every step, and a pill that hugged it would shove the narration sideways each time |
| the strip | what the run is carrying: items out from the left, traits in from the right |
| the two meters | the currencies, flanking the strip: gold leading, motes trailing, each with an icon on its outward side. They are next to what they BUY — a balance on the tab bar and the things it bought a whole editor away were two halves of one thought in two places |
| the rail | one gauge per subdivision, each an icon at the foot with a two-digit tally under it — how many of that gauge's own points the run has SPENT — and a bar rising above both |
| the toggle, the action | two buttons the game may claim; **empty** until it does |

The chapter bar carries narration and nothing else. It led with a second
pill naming the run (`Thockquest — Level IV, A remote island`) and that pill
is gone: the tab bar's identity pill already says which mode holds the slot
and the counter already says how far into it you are. **The REGION's name is
therefore not shown anywhere right now** — the counter has the level, and
where you are has no surface. Worth a decision when region actually means
something mechanically; not worth reinstating a pill for.

Both rows below the editor are laid out on the TAG BAR's anatomy, one
position at a time. The chapter bar takes its head from it exactly: the
layer toggle, the id pill saying which one this is, then the strip. The
stats row below repeats the shape at its own scale — the leading toggle,
the strip, the two currency meters flanking it, the manual-save position
closing it. The mode lays both rows out itself rather than filling in the
editor's — the rule that a mode owning a slot owns its chrome was previously
spelled once per position, which is how a row's SHAPE stayed the editor's
while only its contents changed.

**Fame's tally is always zero, and honestly so.** Fame points are meant to be
attained and spent the way stat points are, and neither half is written:
there is no fame-point field on the record, no curve turning fame into
points, and nothing to spend one on. `model/motes.ts`'s `famePointsSpent`
answers it in one place so the day the concept lands the chrome already reads
it — deliberately a function and not a stored field, because storage with no
writer is a rule half-decided.

Both bars are the real ones, element for element — the same well, scroll
shell, display row and pill a note's tabs and chapters use, sharing
`shared/usePillStripScroll.ts`, so a strip wider than its bar scrolls under
the same fades instead of overrunning it.

Those last four are the chrome AROUND the editor, and one rule covers all of
them: **a mode owning a slot owns that slot's chrome.** The editor underneath
has been emptied, so its word count, its timeline, its scrollbar and its
snapshot control describe nothing — a surface the mode does not fill goes
BLANK rather than falling back to them. Two of the six worked this way from
the start and four did not; `EscapeMenuModeChrome` (renamed from
`…ModeStatus`, which stopped being honest at six surfaces) is what closed
that. Nothing in it is game-shaped: pills, gauges, a counter string and two
buttons.

State goes up and narration goes down, and that is a rule rather than a
layout convenience: a reader's eye goes up for "how am I doing" and down for
"what is going on", the same way it does for a note's tabs and its chapters.
`src/escapeMenu/EscapeMenuStatus.tsx` renders each half into the bar it
belongs to.

## Director and stages

```
                 ┌──────────── the director ─────────────┐
  player input ─►│  a stack of stage frames               │
                 │  + narration + rng + the core cells    │
                 └──┬─────────────────────────────────┬───┘
                    │ present(state)                  │ resolve(state, choice)
                    ▼                                 ▼
                 ┌── the stage on top ────────────────────┐
                 │  pure functions over JSON state        │
                 └────────────────────────────────────────┘
                                                      │ effects
                                                      ▼
                                     the save (model/gameState.ts)
```

A **stage** is a collection of pure functions the director calls with state
and gets results from. It owns one part of the game, emits one or more
**screens**, and hands off. It does not touch the ring, does not persist
anything, does not know another stage exists, and **never writes** — it
returns *effects* describing what should change, and the director applies
them. That is what keeps a stage testable without a database and keeps every
write in one place.

A **service** is a pure function a stage calls that never speaks to the
player: a stat check (`model/checks.ts`), an armor absorb (`model/armor.ts`),
stat resolution (`model/modifiers.ts`). Enemy generation and combat
resolution will be services.

### The director contributes no cells

It used to add three to every screen — acquired items, acquired traits, leave.
Three of the twelve the dial can hold, on every screen, to say things that
either belong somewhere always-visible (what you are carrying is a strip of
pills on the chrome, not a cell and a screen behind it) or are needed on
exactly one screen (leaving, which the welcome stage offers as an ordinary
choice; everywhere else the way out is the slot's own exit button). What is
left in `director.ts` is sequencing and nothing else, which is what it always
claimed to be — and `MAX_STAGE_CHOICES` became the whole dial rather than a
share of it.

### A stack, not a current stage

A fight has decisions inside it that are not the fight, and an ending must
give back the screen underneath. One "current stage" could only express that
by making every stage save and restore its own suspended state — the same
mechanism written once per stage instead of once in the director.

### Opening is an event, not a condition

Opening the view pushes the ENTRY SCREEN on top of whatever was there, so the
first question is always "continue, or begin again". The suspended run is
untouched underneath: continuing is a `pop` straight back into the exact
frame and the exact roll state, and starting fresh is `reset`, the one
transition that discards frames below itself.

That resolves the tension between two things that both had to be true — the
stack exists so a player can be dropped back exactly where they were, and
being dropped back mid-swing into a fight you have forgotten, with no way out
to start another game, is not what anyone wants on opening a view.

**`enterEntryScreen` is an EVENT.** Its predecessor was a condition — "put the
player somewhere if they are nowhere" — which was safe to re-check on every
save change, and its one caller is an effect that does exactly that. Pushing
the entry screen under those conditions puts it back on top after every
choice, and the player can never leave it. Caught live, not by a test: the
hook's effect depends on the OPENING alone, reading the save and the commit
callback through refs so neither a new save nor a re-created callback can
re-fire it.

### Three rules the types enforce

1. **Stage state is `JsonObject`.** No closures, no class instances, no Maps.
   The player can leave at *any* screen and come back to it, which is only
   true if every frame survives a round trip through disk.
2. **`present` receives no random state.** Every roll happens in `enter` or
   `resolve`, and its outcome is stored in stage state until it is shown. A
   stage that rolled while building its cells would make the draw order
   depend on how many times React re-rendered, and the game would stop being
   replayable with no symptom at all.
3. **`present` cannot return effects.** Looking at a screen changes nothing.

Rule 2 is also a design rule: **choices are pre-resolved.** "Dodge" appears
because the dodge roll already succeeded, so picking it cannot fail. The ring
tells you what is possible, which is how a stat point shows itself — as
options appearing, rather than as a number you are asked to trust.

### Determinism

A game is replayable from its seed plus the ordered list of choices taken,
which is what makes a defect *reportable* rather than merely describable. The
director owns the clock; no stage ever sees one. Tested as a property
(`core/director.test.ts`), including a separate test that `present` is pure —
the replay test alone does not catch a roll in `present`, because a screen is
not part of the save. (Verified by injecting one: it passes replay and fails
the purity test.)

## The ring is the game, so it cannot outlive it

A mode may declare `onDismiss` (`src/escapeMenu/escapeMenuContract.ts`). The
adventure wires it to leaving, because lowering the ring — Escape, or a cell
that does not keep the menu open — otherwise left the slot occupied by an
empty editor with the window control still lit: a view whose effects the
player can see but which they cannot reach.

And the ring cannot be missing while the game is up either: a mode owning a
slot IS an open ring, derived rather than arranged by whoever opened it
(`App.tsx`'s `isEscapeRingUp`). Reloading mid-game is what exposed the
difference — the overlay is persisted and came back, "the reader raised the
ring" is transient and did not, so the slot returned occupied with nothing
in it.

The converse holds too, and it is the same observation from the other side:
**a note arriving in a slot lowers the ring.** In a note the text is the
content and the ring is a menu over it; for a mode the ring *is* the content.
So a ring left up over a note the reader just chose is a menu they did not
ask for, sitting on top of the thing they did. Only an arriving note counts —
opening the adventure empties its slot and raises the ring in one gesture,
and treating that as a switch would close the ring on the way in.

Which slot is showing what is not the game's business at all. It is one
record and one derivation, shared with the User Guide and undocked notes —
see `src/shared/slotOverlay.ts`, whose invariant is that stored state may
never contradict the screen.

## Two stores

- **Content** (`content/`) ships with the app, is never written, and changes
  every release. TypeScript data, validated by a test.
- **Save** (`model/gameState.ts`) belongs to the player and is migrated.

Save refers to content **by id** and tolerates an id content no longer has —
dropped, never crashed on. That is what lets an item or a region be deleted
without breaking somebody's game.

The save is shaped as **tables** — `profile` is a row, `games` are rows,
`holdings` and `outcomes` are rows keyed by game id — even though it is
currently written as one JSON document through the app-state path
(`electron/stateService.ts`'s `sanitizeMenu`, per CLAUDE.md's two halves).
Moving it into `electron/databaseService.ts` is then an insert loop per array
rather than a redesign. The one deliberate exception is the director's stack,
which holds opaque stage state and is a blob wherever it lives.

**Outcomes gain rows, not columns.** New content introduces a new `outcome`
kind and touches no schema; a column per content addition would make content
the opposite of additive.

## The model

**Six stats**, declared in `model/stats.ts`: Might, Agility, Perception,
Intellect, Charisma, Luck. Base stats cap at **6**; items and traits are what
carry you past it, which is why effective stats resolve in one documented
order (`model/modifiers.ts`):

```
clamp(base, 0..6) → + stat deltas → derive → × scales → + deltas → normalize
```

**Stat checks**: roll a D6, add the Difficulty Rating, pass if the stat
matches or exceeds the total. The die is the *opposition*, not the player's
contribution — the inverse of the common tabletop convention, and it reads
identically in prose, so it is worth stating. A check also reports a **tier**,
because some content reads in degrees: a track gives "some sort of creature"
at a bare pass and "a hulking orc warrior" at a wide one.

**Modifier effects are declarative data, not code.** The tab bar shows an
item's effect while its cell is focused, and that text has to be *live* —
"Avid Collector: +30% damage (3 items)" is true only if the number comes from
the same declaration the resolver applies. One vocabulary produces both the
maths and the words. `tag` is the escape hatch for effects the vocabulary
cannot express; that one carries written prose, because nothing else can.

Effects come in two kinds, and the distinction is load-bearing: **passive**
(re-applied whenever the profile resolves) and **on-acquire** (fired once,
changes state). Armor is the reason.

**Motes are a currency and a milestone at once**, and the two never interact:
the balance (`earned − spentOnTraits`) buys traits, while stat points read
`earned` alone, which is monotonic. So spending never slows the character and
hoarding never speeds it up; what moves is the threshold, pushed
`5 × pointsAcquired` further by each point taken. One running balance cannot
express that — subtracting a purchase from it would silently defer the next
stat point — which is why two numbers are stored and neither is derived from
the other.

**Armor is not a stat.** Every other stat is static for a level; armor is
*spent*. Two pools — `fromItems`, which decay can touch, and `natural` from
traits, which it cannot — because one number could not express a trait that
grants armor decay cannot reach. It is rebuilt at the start of each level, so
an item carried over counts as a fresh acquisition.

## What is built, and what is not

Built and exercised end to end: the director, the stack, the effect
vocabulary, the save and its sanitizer, stats, modifiers, armor, checks,
determinism, the mote model, the chrome contract, and the stages for welcome,
character creation, region select and the encounter hub. The two acquired-\* interludes are GONE — what you
carry belongs on the chrome, always visible, not behind a permanent cell.

**Not built, on purpose**: hunting, exploring, chance encounters, combat and
loot. Their rules are still being written — the action economy, what the
damage multiplier multiplies, what a region's pools contain — and the
platform routes them to a stage that says so *in the game* rather than
stubbing them with plausible behaviour. That is how the previous draft
acquired numbers nobody chose and then defended them.

Content is perhaps a third written. Every placeholder is labelled: an entry
that exists by name but whose effect is undecided carries a `tag` effect
saying exactly that, so it shows up in the tab bar as unspecified rather than
as a number somebody would have to guess was real. **Do not fill these in.**

## Open questions

These block a playable game and want answers rather than guesses.

1. **The tab bar is not focus-sensitive yet.** A choice's `detail` is computed
   and carried on every `Choice`, but the escape-menu contract has no way to
   show it: `EscapeMenuModeChrome` is static for as long as a mode is up.
   Needs an additive field on the shared contract. (A modifier's live effects
   ARE now readable — as the tooltip on its strip pill — so this is about the
   focused CHOICE, not about holdings any more.)
2. **Readouts have no icons.** The design's status line is written in icons;
   the contract's readout is a short label and a value.
3. **Motes — BUILT** (`model/motes.ts`). One earning stream, two stored facts:
   `experienceEarned` (monotonic) and `experienceSpentOnTraits`. The spendable
   balance is `earned − spentOnTraits` and has nothing to do with stats. Stat
   points read `earned` alone: available when `earned ≥ experienceToNextStatPoint`,
   which starts at 10 and grows by `5 × pointsAcquired` on each allocation
   (10, 15, 25, 40, 60, 85 …). The gauge shows
   `(earned − (next − 5 × pointsAcquired)) / (5 × pointsAcquired)` — with the
   first span read as 10 rather than `5 × 0`, or it divides by zero before the
   first point.
4. **Resilience.** The design writes hit points as `50 + 15 × Resilience`, and
   Resilience is not one of the six stats — but the formula is written under
   Might, and is read against Might here. Seventh stat, or a slip?
5. **Player base damage.** The damage *multiplier* is specified; what it
   multiplies is not.
6. **Intellect and Charisma** have unlocks (spells, charisma actions) rather
   than curves, and neither list is written. They are declared stats with real
   effects pending.
7. **Enemy scaling, fame, experience and gold rates, and the action economy.**
   All unwritten.
8. **Ring capacity — ANSWERED, and the cap is wrong.** The ring holds TEN
   cells, not twelve. Cells sit at equal ANGULAR intervals on a rounded
   square, so their spacing varies around the perimeter and the tightest pair
   decides legibility; both shape inputs are reader-facing sliders, so the
   cap has to hold across their whole range and not just at the defaults.

   | cells | tightest gap, defaults | tightest gap, worst settings |
   | --- | --- | --- |
   | 10 | 52.0px | 44.5px |
   | 12 | 46.2px | **37.3px** |

   Against a 44px button. At maximum rounding the rounded square degenerates
   to a circle of radius 72px, and twelve 44px buttons need radius 84 to sit
   apart on one — a physical shortfall, not a tuning one, since the panel and
   button sizes are static CSS tokens.

   `escapeHoldRingCapacity.test.ts` computes this from the real layout
   function. **The decision is which way to close the gap** — ten choices, or
   smaller cells, or a larger panel — and the third test in that file is what
   fails the day someone assumes it was settled.
9. **Regions** currently carry a name and nothing else: which encounters and
    monsters each brings into scope is unspecified.
10. **A second game slot.** The save is shaped for it (`games` is a list,
    `activeGameId` says which is live). Continuing now resumes the EXACT
    screen, because leaving no longer discards the stack — it is suspended
    under the entry screen. What is still missing is more than one of them:
    the stack is the director's, not the game row's, so a second live game
    would have nowhere to keep its own.
11. **Armor decay's curve.** "A chance based on luck" is specified; the curve
    is not. `ARMOR_DECAY_TUNING` is a labelled placeholder, not a tuned value.
12. **Fame — shaped, not numbered.** Fame is the score, driven by TOTAL GOLD
    accumulated, and getting progressively harder as it rises: the run's
    tension is meant to be between growing the character with stat points and
    converting power into gold, and gold into score. The curve is not written.
