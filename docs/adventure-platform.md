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
| the chapter bar | its leading toggle, the identity pill, then narration: a LIST of pills, NEWEST FIRST — what just happened, and the frame for what is being asked — followed, while the dial sits on a choice that has one, by that choice's effects in a DASHED pill |
| the identity pill | `IV [Combat] 3 | 4` — level in roman numerals, the stage, how far through it. In the note-id position on the chapter bar, fixed width, clipped: it changes every step, and a pill that hugged it would shove the narration sideways each time |
| the strip | what the run is carrying: items out from the left, traits in from the right |
| the two meters | the currencies, flanking the strip: gold leading, motes trailing, each with an icon on its outward side. They are next to what they BUY — a balance on the tab bar and the things it bought a whole editor away were two halves of one thought in two places |
| the rail | one gauge per subdivision, each an icon at the foot with a two-digit tally under it — how many of that gauge's own points the run has SPENT — and a bar rising above both |
| the toggle, the action | two buttons the game may claim; **empty** until it does |

**Narration is a list, and the list is the STAGE's.** One entry is the
ordinary case and reads as the single line it used to be. A stage with a
sequence to show — a combat round, action by action — hands back the whole
list every time, newest at the head, and the older entries scroll rightward
under the bar's own fade. There is deliberately no "append": appending would
make the director own a log, and owning a log means owning the question of
when it is CLEARED, which is a rule about rounds that only the fight knows.
The director stores what it was handed and nothing else; a stage that
accumulates keeps its entries in its own state, where they are persisted with
everything else it remembers, so leaving mid-round and coming back finds the
round's story where the round itself is.

An entry's markup is small and is not Markdown (`escapeMenu/narrationMarkup.ts`):
bold for the action, italic for the outcome, both for a figure, and
`[fa-solid fa-burst|hit]` where one glyph says what a sentence would. **A
glyph carries its own word** — the parser will not open an icon without the
pipe — because a table here mapping icons to nouns is the same
hand-maintained drift the icon contract test exists to remove. An empty word
(`[fa-solid fa-left-long|]`) is a DECISION that the glyph adds nothing to
say, not an omission.

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
determinism, the mote model, the chrome contract, the difficulty presets and
the settings screen, and the whole encounter chain — welcome, character
creation, region select, the hub, the hunt, the round engine with its four
defences, and the loot that pays for it. The two acquired-\* interludes are
GONE — what you carry belongs on the chrome, always visible, not behind a
permanent cell.

**Not built, on purpose**: exploring, special encounters, charisma actions,
special attacks and spells. Their rules are still being written, and the
platform routes them to a stage that says so *in the game* rather than
stubbing them with plausible behaviour. That is how the previous draft
acquired numbers nobody chose and then defended them.

**Not built, and MISSING rather than deferred**: the level-start EXCHANGE —
motes for traits, gold for items, from a random offering whose width is a
stat. The design specifies it; what it does not specify is a PRICE, so it
cannot be built without inventing one. Until it exists, gold and motes
accumulate with nothing to buy, and a character's only growth besides stat
points is the items a fight happens to drop.

Stat points ARE spendable now, at the hub, whenever the ladder has one waiting
(`stages/statPoints.ts`) — "spendable at any time" is the design's own wording.
Fame points are not: what a fame point buys is unwritten, and the effect that
would spend one only moves the ladder.

Content is perhaps half written. Every placeholder is labelled: an entry that
exists by name but whose effect is undecided carries a `tag` effect saying
exactly that, and is kept OUT of every offer pool (`isOfferable`) rather than
served as a choice that does nothing. **Do not fill these in.** The ten items
and ten traits that ARE specified were written here rather than in the design
document — see question 66.


## Open questions

These block a playable game and want answers rather than guesses.

1. **The focused choice's effects — ANSWERED, on the chapter bar rather than
   the tab bar.** A choice's `detail` reaches the screen as a DASHED pill
   following the narration: dashed because it is the only thing on that bar
   that has not happened yet, and it goes away the moment the dial moves on.

   The design document said this should REPLACE the stats readout while a
   choice is focused. That was written when the ring was a menu you raise and
   lower; it is permanently up during play now, and the dial always has a
   focused cell, so replacing would have meant the stats line was never
   visible. The stats stay above, where "how am I doing" lives, and the
   preview sits beside the narration, where "what is being asked" does.

   Four parts, three of which already existed:
   - the DATA belongs to the cell (`EscapeMenuCell.detail`), authored where
     the choice is authored;
   - the WHEN belongs to the ring — `EscapeHoldPanel`'s one `hovered ??
     focused` resolution, which already drove the centre label, now also
     reports the cell id. **One resolution, two surfaces**: computing it twice
     is how the centre label and the pill would come to name different cells,
     the same argument that put the hover answer in `refreshHoverFromPointer`
     rather than in CSS. An ID, not the cell, so a mode rebuilding its cells
     every render cannot push a new object into host state and loop;
   - the WHERE belongs to the host (`SectionEditorArea` renders both the ring
     and that bar, so there is no store and no context);
   - the MODE stays static. It never learns which cell is focused, so it
     cannot start narrating through the dial.

   `detail.title` is deliberately not drawn: it is always the cell's own
   label, which the ring's centre is showing at that exact moment. It carries
   the tooltip and the accessible name instead.
2. **Readouts have no icons — ANSWERED.** `EscapeMenuReadout.icon` is
   required, and the tab bar draws an icon and a value with the name in the
   tooltip. The six stats use `STAT_ICONS`; charisma is `fa-masks-theater`
   and agility `fa-feather-pointed` (the design's `fa-lips` is Font Awesome
   PRO and does not exist in the free set shipped here). Fame and stat points
   take the crown and the star from the rail's own gauges, so one quantity
   never wears two glyphs on one chrome. Gold and motes left the bar entirely
   for the stats row, beside the strip they buy.
3. **Motes — BUILT** (`model/motes.ts`). One earning stream, two stored facts:
   `experienceEarned` (monotonic) and `experienceSpentOnTraits`. The spendable
   balance is `earned − spentOnTraits` and has nothing to do with stats. Stat
   points read `earned` alone: available when `earned ≥ experienceToNextStatPoint`,
   which starts at 10 and grows by `5 × pointsSpent` on each allocation
   (10, 15, 25, 40, 60, 85 …). The gauge shows
   `(earned − (next − 5 × pointsSpent)) / (5 × pointsSpent)` — with the
   first span read as 10 rather than `5 × 0`, or it divides by zero before the
   first point. The ladder itself moved to `model/milestones.ts` once fame
   turned out to be the same one (question 12).
4. **Resilience — ANSWERED: a leftover.** Physical attack and physical
   defence are ONE stat, Might, which is why the design document's own
   hit-point formula was written under Might while naming Resilience. There
   is no seventh stat. `50 + 15 × Might` now reads that way deliberately
   rather than by inference.
5. **Player base damage.** The damage *multiplier* is specified; what it
   multiplies is not.
6. **Intellect and Charisma** have unlocks (spells, charisma actions) rather
   than curves, and neither list is written. They are declared stats with real
   effects pending.
7. **Fame, experience and gold rates.** What a minion, a miniboss and a boss
   are each worth. Unwritten.

   *(Enemy scaling and the action economy were listed here as unwritten and
   are NOT: both are specified in [adventure-game-design.md](adventure-game-design.md),
   which was deleted in the platform rebuild and has been restored. Scaling
   is `10 · factor^round` with the factor set once per run by the difficulty
   preset — easy 1.01, medium 1.02, hard 1.05, insane 1.1. The action economy
   is the round's four phases and its step layout. Neither is BUILT; both are
   decided.)*
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
12. **Fame — ANSWERED: it is the stat-point ladder, fed by gold.** The curve
    is identical, so it is written once (`model/milestones.ts`) and both
    currencies are instances of it:

    | stream | currency spent on | milestone | ladder |
    | --- | --- | --- | --- |
    | `experienceEarned` | traits (`experienceSpentOnTraits`) | stat points | 10, 15, 25, 40, 60, 85 … |
    | `goldEarned` | items (`goldSpentOnItems`) | **fame points** | the same |

    Fame is therefore the milestone, not a running total: `famePoints` in
    hand, `famePointsSpent` behind you, and the run's score is the two added
    together (which is what `bestFame` records — spending your fame points
    must not cost you the score). Gold gained the same two-fields-not-one
    split motes have, for the identical reason: buying an item must not push
    the next fame point away.

    The threshold advances on the SPEND, not the attainment — hoard a point
    and the next is no closer. That was already the stat-point rule; naming
    it once made it a rule rather than a coincidence.

    **Still unwritten, and deliberately so:** what a fame point BUYS, and the
    rates at which gold and experience are earned in the first place (open
    question 7). `allocateFamePoint` moves the ladder and nothing else. The
    EARNING half of both ladders is also unwired — nothing emits
    `grantStatPoints` or `grantFamePoints` when a threshold is crossed,
    because that belongs to the level flow that is not built.

Recovered from [adventure-game-design.md](adventure-game-design.md) when it
was restored — these existed only in that file and were lost while it was
deleted:

13. **Starting stats.** A new run starts at 0 in everything, which makes hit
    chance 50% and hit points 50. Intended, or does a run start with points
    to spend?
14. **The round exponent.** Is `n` in `10 · x^n` the round number (1-based,
    as the deleted implementation had it) or rounds completed? At medium the
    difference is 2%; at insane it is 10%.
15. **Enemy accuracy.** The player has a hit chance; enemies land unless
    dodged. Should enemies miss on their own account too?
16. **Defeat.** Does a run end at zero hit points, or does the round end and
    the run continue?
17. **Difficulty choice.** Presented at run start, in the ring, as the first
    thing a new run asks? Nothing presents it, and no preset is stored.
18. **Gear and trait content.** The catalog type is ready
    (`model/modifiers.ts`) and Thockquest carries a handful of examples;
    a real pool does not exist.

The RESTORATION also turned up three apparent code-versus-contract
disagreements. **Two of them were not real** and are recorded here so nobody
finds them again: the restored file was an OLDER version of the design plan,
describing five stats and a different stat table. Against the CURRENT plan
(`adventure-game-design.md`) the code's stat table matches row for row —
Agility gives dodge and the action count, Perception gives encounter choices
and hit chance, Intellect and Charisma carry unlocks rather than curves — and
so does the check rule. The lesson is the one rule 9 already states: a stale
description is believed, and a stale description that has been *restored*
looks authoritative.

The third was real, and is answered:

19. **"Round" and "level" — ANSWERED, they are different things.** A LEVEL is
    one iteration of the whole cycle after character creation: from choosing
    where to go, through a predetermined number of encounters and minibosses,
    to the level's final boss. A ROUND is one unit of COMBAT — from every
    party holding all its actions to every party having spent them, after
    which the counts reset. Monsters scale per LEVEL. The deleted plan's
    `10 · factor^round` said round and meant level.

## Building the action economy

Most of what was missing is now specified — monster stats by class and type,
the power multiplier, base damage, the defensive choices, the level layout,
contested stats, rounding, the names. **All of it is written down in
[adventure-game-design.md](adventure-game-design.md)**, in the deviations
section, because rules belong there and only what is OPEN belongs here.

Questions 22-28 and 30-34 are answered by that section. Numbers are kept
rather than reused, since the project cites them:

22-24 monster actions / health / damage — **answered**.
25 which defensive choices appear — **answered** (dodge, defend, flee, take
the hit; dodge gated on the contested Agility check).
26 the bonus on a defensive stat check — **answered by 25, in effect**: the
plan's "on a choice, depending on a stat check, a bonus may become available"
is the dodge rule. Nothing else is pending under it.
27 effect duration — **answered**: there is no duration model. "The rest of
the round" means until every action point is spent, and Stomp simply reduces
the current monster action pool.
28 encounters per level — **answered**: ten, with mini bosses at 5 and 9 and
the boss at 10.
30 `stat / unlock level` rounding — **answered**: down, everywhere.
31 naming — **answered**: Special Encounter, Charisma Actions, Region.
32 where a level ends — **answered**: at the boss, encounter 10.
33 the narration format — **accepted**, to be adopted.
34 armor — **accepted** as a real extension, and now placed: it applies on
Defend and nowhere else.

29 is NOT answered — see below.

## Still open, and each one blocks something

29, 35, 36 and 37 are **answered and BUILT** — see the design plan, and
`model/stats.ts`, `model/difficulty.ts`, `model/monsters.ts`:
the counter table and one opponent-optional `deriveStats`; the power
multiplier on hit points and damage only; the damage multiplier left
uncontested because it is a coefficient, with Might-versus-Might reserved for
special attacks; and the charisma failure chance as a type base plus
`Tier × uses / Charisma` over an uncontested Charisma.

38. **`level` or `level − 1` in `factor^level`.** At level 1 the multiplier is
    already 1.05 rather than 1. The old plan had the same ambiguity and it
    compounds: at insane 1.2 over ten levels the difference is a factor of
    1.2.

39. **"Difficulty Rating" now means two things.** In the plan it is the number
    added to a D6 in a stat check (`model/checks.ts`). In the power
    multiplier it means the difficulty preset — easy, normal, hard, insane.
    One of them needs a different word before either is built on.

40. ~~**Nothing chooses a difficulty.**~~ **ANSWERED and BUILT.** Four
    presets, each TWO numbers rather than one — a base on a monster's hit
    points and damage, and a growth the level exponentiates on top
    (`model/difficulty.ts`):

    | Preset | Monster hit points & damage | Per level |
    | --- | --- | --- |
    | Easy | 50% | ×1.01 |
    | Medium | 80% | ×1.02 |
    | Hard | 100% | ×1.05 |
    | Extreme | 120% | ×1.1 |

    A single growth factor could only reach the late game; the base is what
    moves the FIRST fight, which is where a run is actually lost. The choice
    is made on a settings screen pushed from the entry screen
    (`stages/settings.ts`), stored on the SAVE, and copied onto a run when it
    starts — a preset changed mid-run would rewrite what every fight already
    fought was worth. Medium is the default, and `hard` is the old
    single-curve behaviour exactly.

41. **How many monsters is a Group?** Type Group is `−1` to base stats and
    "multiple monsters"; the count is not given. It also decides whether the
    turn-order denominator sums several monsters' action pools, which the
    formula implies but has never been stated for more than one.

42. **Which classes can a monster be?** The plan lists Fighter, Mage and
    Thief. The player origins are Warrior, Thief, Mage and Bard, and their
    bases are what monsters borrow — so Bard's is either a fourth monster
    class or unused. A charisma-shaped monster is not idle: Talk is one of
    the plan's own monster actions.

43. **What is "the best outcome" for a defending enemy?** Dodge always beats
    the rest when it is offered, and Defend beats Take the hit — but whether
    an enemy ever chooses Flee, and on what condition, is an AI policy the
    phrase does not settle. Enemies that never flee make Terrify meaningless.

44. **What a successful Flee yields.** The encounter ends; whether it pays
    loot, fame or nothing is unstated, as is whether the level's encounter
    count still advances.

45. **Fame, experience and gold rates.** What a regular monster, a mini boss
    and a boss are each worth. (Was question 7, still the last economic gap.)

41, 43, 46 and 47 are **answered and BUILT or recorded** — a group is one
hydra with a shared pool (`model/monsters.ts`); a monster dodges if it can
and defends otherwise, and never elects to flee; the type shift does not
floor at zero; and the highest usable charisma tier is the character's
Charisma, now stated in the plan rather than inferred.

48 and 49 are **answered and BUILT** — a group defaults to three members,
and the payout table is in the design plan. The ROUND ENGINE is built with
them (`model/combat.ts`): the turn-order roll, the four defences, the
exchange, the round's exits and what each one pays.

50 and 51 are **answered and BUILT** — the escalating loot/mote check
(`model/rewards.ts`), the species table (`content/`) and the offer generator
(`model/encounterOffers.ts`). See the design plan.

52 is **BUILT**: the encounter chain runs end to end —
`encounterSelect → hunt → combat → loot → encounterSelect(+1)`, with the boss
placed at 5, 9 and 10 and the level advancing after ten.

55. **A RUN IS A MONOTONIC DECLINE, and no preset fixes that.** Measured over
    300 runs per preset (`npm run adventure:sim`, policy `careful`, which
    dodges when it can and runs below a quarter health):

    | Preset | died | encounters won (p10/med/p90) | damage per fight |
    | --- | --- | --- | --- |
    | Easy | 98% | 1 / 3 / 6 | 12.7 |
    | Medium | 100% | 0 / 1 / 2 | 22.8 |
    | Hard | 100% | 0 / 0 / 1 | 30.3 |
    | Extreme | 100% | 0 / 0 / 1 | 35.5 |

    The arithmetic behind it is the level's own shape: **ten encounters and
    eighty hit points, with the rest only at the level's END** (a level is its
    own journey; `advanceLevel` refills). That budget allows a fight to cost
    about EIGHT hit points, and on Medium one costs twenty-three — so no run
    reaches the rest that would have refilled it. Nothing about the round
    engine is wrong — a first fight is close to even (the player needs about
    twelve rounds to kill, and dies in about fifteen) — the run simply never
    gets anything back, so it is the second and third fights that kill.

    Of the three levers, **recovery is DEFERRED rather than rejected**, and
    the reason is legibility rather than shape (the design doc's own wording,
    which is where that decision lives): with healing in, every question about
    how long a run should last has two answers at once, and the ones that
    matter now are about damage, actions and armor. The order is — get the
    balance right with no healing at all, then introduce healing and equally
    punishing new damage sources TOGETHER, as one layer balanced against
    itself. The effect kind is gone from the vocabulary rather than merely
    unused, so that layer arrives as a decision rather than by accident.
    (A rise in MAXIMUM hit points is granted rather than merely permitted, and
    that is NOT healing under the rule as its author states it: current and
    maximum move together, so nothing lost is restored and the equation stays
    readable — raising the maximum alone would be *taking damage* equal to the
    delta. The falling direction is the same rule, and it has one planned
    moment: giving up items and traits at a level's end, where hit points must
    be RESTORED FIRST and the modifiers removed after, so the fall lands on a
    full pool. See the design doc.)

    What is being tuned instead is **the thumb** (see below) against the
    remaining two levers:
    - **Acquisition.** A run starts with one item and one trait and dies
      before it can collect more. The economy is calibrated for a run that
      survives and nothing does: the first stat point costs ten motes, and a
      Medium run earns **1.3** before it dies. Pinning four defensive pieces
      from the start takes Easy to a median of NINE encounters won — the
      content already reaches "monster territory"; a character cannot live
      long enough to hold it.
    - **Cost.** Cheaper encounters, which is the lever that costs the fights
      their tension.

56. **A monster's action count comes straight off Agility, uncapped**, and the
    measurements above put a number on it: a three-action monster against a
    two-action player is where most of the damage per fight comes from. It is
    the action economy working, and it is also the single biggest lever on
    difficulty with nothing bounding it.

57. ~~**Nothing WIRES the old questions yet**~~ — **SUPERSEDED and BUILT**
    (was 52, and duplicated it). The chain runs: hunt, combat, loot, and a
    level that counts to ten.

58. **Species modifiers are not capped.** A Beast at −3 Intellect on a group's
    −1 is −4 before class. Nothing says a monster's stats have a floor (see
    46) and nothing yet says they have a ceiling either.

59. **`fa-swords` shipped as an empty box** before a test caught it — it is
    Font Awesome PRO, like `fa-lips` before it. A Pro icon does not fail
    loudly; it renders as a blank square that reads as a rendering fault.
    `content/icons.contract.test.ts` now parses both the content and the
    STAGE SOURCES (where the broken one was written inline) against the free
    set that actually ships. Nothing is open here — it is recorded because it
    is the second time.

60. **Narration spans had to become ONE flex item.** `.tag-pill` is
    `inline-flex`, so a span per formatted run made every run a flex ITEM,
    and a flex item whose entire content is a space collapses to nothing —
    which ate the gap between the bold action and the italic outcome.

61. **A round SAYS itself in glyphs, and only for as long as it lasts.**
    Every action prepends one pill — `[who] [what] [how much] [to whom]`
    (`stages/combatLog.ts`) — and the next round opens by cutting the strip
    back to a single status pill: actions and hit points for both sides,
    mirrored around the clash arrows. So the bar holds exactly the round being
    fought, newest first, and never a history no bar could carry. The damage
    figure appears ONLY on a hit: the difference between something and nothing
    should be whether there is a number, not what the number is. The choice
    cells use the same glyphs their outcomes do, so each mark is learned once.

62. **"Begin combat" is gone.** It was a one-cell screen at the head of every
    round that could not be answered any other way, so it asked nothing — the
    round's actions are restored whichever way it is pressed. The only thing
    it reported was that time had passed, which the status pill now says
    without spending a press. A round turns over on its own.

63. **The ring's default is the ORDER**, which is easy to change by accident.
    The dial resets to its first cell on every step, so the first choice a
    stage lists is the one a fast player presses: Dodge, then Attack, then
    Defend. `DEFENCES` happens to be in that order and `defencesOffered`
    preserves it — `stages/combatLog.test.ts` asserts it, because nothing
    about a reordering would otherwise look like a change in behaviour.

64. **TWO HARNESSES, and neither can answer the other's question.**
    `npm run adventure:sim` (`scripts/adventure/simulate.ts`) plays thousands
    of runs through the pure model in a second and answers everything
    statistical; `--rank` PINS each item and trait in turn and prints what
    each is worth, which is how a modifier that reaches the tab bar and not
    the fight shows itself as a row that does not move. `npm run
    adventure:play` (`scripts/adventure/playthrough.mjs`) plays a run in the
    REAL Electron app and reports what the chrome shows, which is the only way
    to see an empty box where a Pro icon was named. A browser in the loop
    cannot answer a balance question at a few hundred milliseconds per choice,
    and the model cannot see the screen.

    Note the native-module trap between them: `better-sqlite3` must be built
    for ELECTRON to run the playthrough (`npx electron-rebuild -f -w
    better-sqlite3`) and for NODE to run vitest (`npm rebuild better-sqlite3`,
    which `npm run pretest` does). Getting it wrong does not say so: Electron
    never opens a window, and vitest segfaults.

65. **A modifier's effect has to REACH the thing it names**, and three classes
    of it did not (`model/modifierReach.test.ts` now holds each one):
    - A CHANCE could not be finished inside the profile, because it is
      contested at the moment it is rolled — so combat resolved chances from
      the stat block and never saw a modifier at all. Adjustments (a scale and
      a delta) are now carried on the profile and applied by one function,
      `resolveChanceWith`, which both the tab bar's figure and the fight's
      roll go through.
    - A rise in MAXIMUM hit points was permitted rather than granted, so "+25
      hit points" changed nothing until the next heal — of which there are
      almost none. Hit points now follow their ceiling in both directions,
      once, around every effect (`followMaxHitPoints`).
    - An UNSPECIFIED placeholder was offered as an ordinary choice; character
      creation served up "Bronze Talisman or Nail Clipper", neither of which
      did anything. Offerability is now derived from whether an entry has any
      effect at all (`isOfferable`) rather than declared per entry, and the
      placeholders stay in content under the design's own names.

66. **Ten items and ten traits are written and are NOT from the design
    document.** They are the one invented part of `content/thockquest.ts`, and
    they aim at a spread rather than a ladder: flat, scaling, conditional,
    recovering, and two that cost something (an Iron Buckler that trades dodge
    for armor, a Cracked Hourglass that trades fifteen hit points for an
    action). Their numbers are a first pass; `--rank` is how to see what each
    is currently worth. The design's own unspecified names are untouched.

67. **THE THUMB ON THE SCALE** (`successAdjust`, `model/chance.ts`'s
    `pressThumb`). One number from 0 to 1 that scales a **player's chance to
    FAIL** and a **monster's chance to SUCCEED**:

        player:  1 − (1 − p) × (1 − t)     a 20% failure at t=0.5 becomes 10%
        monster: p × (1 − t)               a 60% hit     at t=0.5 becomes 30%

    The shape is the point. Both sides keep reading the same stat table, the
    same contest and the same formulas, so a point of Agility is worth what it
    was worth and two characters cannot change places — the thumb moves them
    both. It cannot overshoot either, since it scales a probability rather
    than adding to one, so no clamp is hiding a mistake; and it has least
    absolute effect where it should, on a roll that was already nearly
    certain.

    Applied at the ROLL and nowhere else: a character's own numbers are what
    the character is worth, and the thumb belongs to the run's tuning. That is
    enforced by construction rather than remembered — `resolveChanceWith`
    presses it only when it is told which SIDE is rolling, and the profile
    passes no side at all. It is copied onto a run when the run starts,
    exactly as the preset is — but UNLIKE the preset it is also turned live:
    the options panel's Debugging section carries a slider that writes the
    setting AND the run in progress (`withSuccessAdjust`), because the whole
    use of a tuning instrument is to move it and feel the difference in the
    fight on screen. A preset is frozen mid-run to protect what fights already
    fought were worth, which is a promise to a player; an instrument makes no
    such promise. The harness turns the same knob headlessly
    (`--success-adjust`, `--sweep-adjust`).

    Measured, 200 runs per cell, stopping after level 3:

    | preset | thumb 0% | 20% | 30% | 40% | 50% |
    | --- | --- | --- | --- | --- | --- |
    | Easy | 99% died, med 2 | 54%, 13 | 17%, 27 | 1%, 30 | 0%, 30 |
    | Medium | 100%, 1 | 94%, 3 | 76%, 5 | 33%, 20 | 8%, 29 |
    | Hard | 100%, 0 | 100%, 2 | 96%, 4 | 74%, 6 | 29%, 21 |
    | Extreme | 100%, 0 | 100%, 1 | 100%, 1 | 92%, 4 | 69%, 8 |

    Two things to read off it. The transition is SHARP — on Medium the death
    rate falls from 94% to 8% across twenty points of thumb — because the
    fight is close to even to begin with and the thumb compounds over every
    roll of a run. And the two dials compose: roughly ten points of thumb is
    worth one difficulty step, so they are not two names for the same
    quantity. A level is ten encounters, so a median of 10-20 is a run that
    finishes a level or two, which is currently around **Medium at 40%** or
    **Hard at 50%**.
