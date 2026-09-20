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

## The flow, and every term in it

This section is the map: what the words mean, and how the next screen is
chosen. Everything below it is the machinery that carries this out.

### The vocabulary, defined

| term | what it is, exactly |
| --- | --- |
| **run** (a *game*) | one `GameRecord` in `save.games`: a seed, base stats, gold, fame, region, level and encounter counters, and what it has bought. A run ends at death or at the last level. |
| **level** | ten encounters. The fifth and ninth are mini bosses, the tenth is the boss. Counters live on the record; `stages/levelProgress.ts` reads them. |
| **encounter** | one step of the ten. Advanced by an `advanceEncounter` effect, never by arriving anywhere. |
| **stage** | a value of `StageModule` (`core/stage.ts`): an id, a title, and three functions — `enter`, `present`, `resolve`. Thirteen of them, in one `ReadonlyMap` (`stages/index.ts`). |
| **frame** | `{ stageId, state }`, one element of `save.director.stack`. The stage is shared; the frame is this visit's own state, and it is `JsonObject` so it survives disk. |
| **screen** | what `present(state, context)` returns: a list of choices and a `screenKey`. Derived on every render, never stored. |
| **choice** | one ring cell: an id, a label, an icon, optionally a `detail`. Pre-resolved — a cell is offered because its roll already succeeded. |
| **effect** | a value describing a change to the save (`model/effects.ts`). A stage returns them; only `applyEffects` performs them. |
| **transition** | what `resolve` returns: `stay`, `push`, `pop`, `replace`, `reset` or `leave`. It is the only thing that changes the stack. |
| **interlude** | a stage entered by `push` from the CHROME rather than from a ring cell — the two rail gauges. It `pop`s back to the frame underneath, untouched. |
| **omen** | a phase of the hub, not a stage: the screen offering one rest or a handful of region traits, shown before each fixed encounter. |
| **region** | one of six, chosen at each level's start; it decides which ten traits the omen may draw from. |
| **modifier** | an item or a trait, rolled once per run from a template (`model/modifierSlots.ts`) and held by id. |
| **catalog** | `catalogFor(content, seed)` — this run's rolled modifiers, a function of the seed, memoized. |
| **build** | VECTOR ONE: an adjective and a set of stat WEIGHTS (`model/vectors.ts`). Ratios, not points — one build reads the same at any tier. |
| **tier** | VECTOR TWO: a number, the stat budget the weights split. A monster's is its rank's plus one per level; a player's starts at 5 and fame buys it to 30. |
| **species** | VECTOR THREE: a noun, carrying non-stat modifier effects and nothing else. The peoples are the `playable` ones; the rest are what you fight. |
| **class** | VECTOR FOUR: a noun, carrying MOVES that swap one combat choice for another. It touches no number a stat block implies. |
| **move** | One swap: what replaces the attack or a defence, and when. Armed when the action comes up, so the cell can name it. |
| **profile** | `resolveRunProfile(...)` — what a character is worth right now: base stats, build, species, everything held. Recomputed, never stored. |

Two words that are NOT synonyms, having once been one: a **fame purchase**
(`model/famePurchases.ts`) is bought with fame and dies with the run; a
**permanent unlock** (`model/permanentUnlocks.ts`) is earned by a run and
crosses into the next.

### How the next screen is chosen

There is no flow chart anywhere in the code. The next screen is always the
same derivation — the top frame of `save.director.stack`, asked to `present`
itself — and the only thing that moves is the stack. So "the flow" is
entirely the set of transitions the thirteen stages return.

```
  open the view ──► welcome ──┬─ continue ──► (pop back into the suspended frame)
   (enterEntryScreen,         │                or replace ──► encounterSelect
    pushed on top)            ├─ new game ──► RESET ──► characterCreation
                              ├─ settings ──► PUSH ──► settings ──► pop
                              └─ leave ────► the host reclaims the slot

  characterCreation ──► regionSelect ──┬─ (can afford the market) ──► outpost ──► encounterSelect
                                       └─ (cannot) ─────────────────► encounterSelect
                                                   outpost ──► PUSH ──► market ──► pop

  ┌───────────────── encounterSelect — the hub, re-entered once per encounter ─────────────────┐
  │  encounter 5, 9, 10 :  the OMEN first (a `stay`), then the fixed monster — one cell        │
  │  every other        :  Go Hunting  /  Go Exploring                                         │
  │  level complete     :  advance ──► regionSelect (+ advanceLevel)                           │
  └────────────────────────────────────────────────────────────────────────────────────────────┘
        │ hunt              │ explore                │ fixed
        ▼                   ▼                        ▼
      hunt ──► combat    underConstruction ──► hub  combat
                              (encounter NOT spent)

  combat ──┬─ won or the monster fled ──► loot ──► hub  (+ grantExperience, advanceEncounter)
           ├─ the player fled ──────────► hub        (+ advanceEncounter — running still costs it)
           └─ defeated ─────────────────► RESET ──► welcome  (+ endGame)

  from ANY screen, by pressing a rail gauge:  PUSH ──► statPoint | fame ──► pop back
```

Five different stages `replace` into the hub — the outpost, the loot screen,
either end of a fight, the region select, and the under-construction wall —
which is why the omen is a phase OF the hub rather than a stage before it: a
rule placed at each of five routes in is five copies of one rule, and the
sixth route would not know to ask. A stage also cannot redirect on `enter`
(only `resolve` returns a transition), so an omen stage would have had to
show the boss screen first and push itself on top of it.

Two screens are reachable at every moment and belong to no point in the
sequence: the stat-point screen and the fame screen. They are `push`ed by the
chrome's rail gauges, so what is underneath — a rolled encounter, a
half-fought round — is still there when they `pop`.

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
| the identity pill | `V-3 [Combat]` — level in roman numerals, encounter in arabic, then the stage. In the note-id position on the chapter bar, fixed width, clipped: it changes every step, and a pill that hugged it would shove the narration sideways each time |
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

**Fame's tally is always zero, and honestly so.** *(Superseded — fame points
are now attained off the same ladder stat points climb, derived rather than
stored, and the crown gauge reports how many are waiting. The half that is
still unwritten is what a point BUYS: the Renown screen says so rather than
offering an invented unlock. See entry 75.)*

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

A **stage** is a value of the `StageModule` interface (`core/stage.ts`): an
id, a title, and three functions. There is no class, no instance and no
lifecycle — the thirteen stages are module-level constants in one map.

| function | called | may roll | may return effects |
| --- | --- | --- | --- |
| `enter(input, context, rng)` | once, when a frame is created | yes | yes |
| `present(state, context)` | on every render, arbitrarily often | no — takes no `rng` | no — the return type has no field for them |
| `resolve(state, choiceId, context, rng)` | once per choice taken | yes | yes |

**Pure** is meant in the mathematical sense: the result is determined by the
arguments, and evaluating it changes nothing. `present` is pure outright,
which matters because React decides how often it runs. `enter` and `resolve`
are pure too despite rolling: the generator is a number passed in as `rng`
and its successor comes back in the result (`core/rng.ts`), so randomness is
threaded rather than ambient — which is what makes a run replayable from its
seed alone.

**Never writes** means: no stage function has `GameSave` in its return type.
A stage that wants the save changed returns values of type `Effect`, which
are inert data, and one function turns them into a new save —
`applyEffects(save, effects, content, nowMs)`, a fold whose only callers are
`applyTransition` and `enterStage` in `core/director.ts`. So every rule about
when a change is legal lives in one place, and a stage is testable by calling
it with a literal state object and comparing the effect array it hands back:
no database, no app.

A stage also does not touch the ring, and does not know another stage exists
— it names a successor only by id, inside a transition.

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

## The four vectors

**A player and a monster are the same four things**, and each one affects
what they are in exactly ONE way (`model/vectors.ts`):

| vector | what it is | the ONE thing it does |
| --- | --- | --- |
| build | an adjective | weights over the six stats |
| tier | a number | how many stat points those weights split |
| species | a noun (what it is) | non-stat modifier effects |
| class | a noun (what it does) | swaps a combat choice for another |

So a monster reads off the four in order — *a Dashing Orc Bruiser at tier 12*
— and so does a player. THE SAME FOUR on both sides, deliberately: a rule
that applies to one and not the other is a rule written twice and got wrong
once.

**What this replaced, and why.** An origin carried stat gifts *and* damage
percentages *and* an armour rule; a monster class carried stat deltas; a
species carried stat deltas too; a rank carried a stat shift *plus* armour
*plus* charisma resistance. Four names, three of them doing overlapping
arithmetic, and no way to answer "where does this number come from" without
reading all of them. `MONSTER_TYPE_STAT_SHIFT`, `MONSTER_TYPE_ARMOR`,
`Origin`, `MonsterClass` and `Species.statDeltas` are all gone.

**The tier is split by LARGEST REMAINDER**, not by rounding each share. The
design says "5 points are distributed according to weights", and *distributed*
is taken literally: the block sums to exactly the tier. It agrees with the
design's own worked example (tier 5 over `agility 1, might 2` gives 2 and 3
either way) and it does not leak — six equal weights at tier 5 round to one
each and hand out SIX, which would make the flattest build quietly the
strongest at every tier. `vectors.test.ts` asserts the sum, that a stat with
no weight never gains one at any tier, and monotonicity (no seat moves
backwards as the tier grows).

**Both stat-bearing vectors arrive as MODIFIERS.** `resolveProfile` clamps
base stats to six because base stats are what a run SPENT; tier is not
spending, so `buildModifier` hands it in as `statDelta` effects above the
clamp, exactly where gear lands. A tier-20 boss reaches Might 13 without the
cap learning an exception. A species is wrapped the same way
(`speciesModifier`), which is what lets it say "+100% damage" or "worn armour
counts for nothing" with no code anywhere knowing species exist — and gets
`describeModifier` to write its tooltip for free.

**What each vector may NOT do is enforced**, in `validateContent`: a species
carrying a `statDelta` fails (that is the build's), so does a build with no
positive weight, two builds with the same normalised ratio, and a class whose
move can never fire because an unconditional one for the same cell is
declared above it. That last one caught a real bug on its first run. The
rule cannot be enforced by a type — `ModifierEffect` is one union — so
nothing else stops the first interesting monster putting two Might on a
species and the vectors overlapping again within a release.

**A class move REPLACES a cell and never adds one.** The pace constraint is
the reason: a run is a dozen levels of ten encounters of twenty actions, so a
class that put two more cells on every screen would cost more reading than
the fight is worth. A move is ARMED when the action comes up and its id
stored on the fight's state — `present` may not roll, and a move re-decided
on every render would change while the player was reading it — so the ring
shows "Haymaker" and pressing it strikes a Haymaker. A multi-strike move is
a whole exchange per strike (its own dodge offer, hit roll, crit and damage
draw), which is what makes a Juggler's two blows at 60% a different thing
from one blow at 120% rather than a rounding difference.

**Ranks are tiers and packs are rolled.** runt 0, regular 5, elite 10, mini
boss 15, boss 20, plus one per level past the first — one and not five, so
the rungs stay legible for a whole run. The "group" rank is gone: a runt
always has a friend and usually two, an ordinary monster has one half the
time, and anything elite or above travels alone
(`MONSTER_BUDDY_CHANCES`). The count is rolled once, per offer, and stored on
it, so a reloaded fight is the same fight.

**A name is derived**, never stored: rank, build, species, class, and a count
where there is more than one. There is no authored per-species-per-rank table
to keep in step, and no stored string a content edit can leave describing a
different creature.

`npm run adventure:sim -- --rank-vectors` pins each build, species and class
in turn and prints what each is actually worth. A row that does not move is a
vector that never reaches the fight — which is what the table reported on its
own first run, when the pin was landing before character creation had
finished and was being overwritten by it.

## The model

**Six stats**, declared in `model/stats.ts`: Might, Agility, Perception,
Intellect, Charisma, Luck. Base stats cap at **6** — that cap is about what a
run's own SPENDING can reach; the build's tier, items and traits are what
carry you past it, which is why effective stats resolve in one documented
order (`model/modifiers.ts`):

```
clamp(base, 0..6) → + stat deltas → derive → × (1 + Σ percentages) → normalize
```

**Everything is a percentage, and stat points are the one exception.** A flat
"+25 hit points" is a third of a starting character and a rounding error on a
late one, so it had to be re-tuned every time a curve moved; a percentage is
worth the same share wherever it lands. Stat points stay flat because a stat
point is the unit the whole table is written in. The two kinds of percentage
are *not* the same arithmetic, and this is the one thing about the vocabulary
worth memorising:

- a **quantity** (hit points, damage, actions) takes percentages **additively**:
  +20% and +30% is +50%.
- a **chance** takes a percentage of what is **left**: +20% accuracy removes a
  fifth of the *misses*, and a second +10% removes a tenth of what still
  misses. A penalty is the mirror, on the successes. It cannot overshoot, it is
  the same shape as the run's own thumb (`pressThumb`), and adding percentage
  points to probabilities is how a game ends up with a guaranteed critical hit.
  Carried as `ChanceAdjustment`'s two keep factors, because a chance is
  contested when it is rolled and cannot be finished in advance.

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

**Everything is rolled from a template.** Items and traits alike are authored
as **templates** (`model/modifierSlots.ts`) that say what a thing is *about* —
which stats it would plausibly sharpen, which odds or quantities it would
plausibly move, which of the richer effects suit it, and whether it is armour
— and the run rolls which of those it actually is. Sixty templates is sixty
things in one run and a different sixty in the next, with no hand-tuned number
anywhere in either list.

**The two kinds differ in two lines of `SLOT_PLAN` and in nothing else.** An
item is GEAR: it has two **stat** slots, because the base stat cap is the thing
gear exists to carry a character past, and one verbose slot. A trait is
something you ARE and cannot be picked up, so it has no stat slots at all and
spends them on a second **verbose** one — which makes traits the odd and the
particular half of the game and items the half that moves the table. That is
written down once, as a declaration the roller reads, rather than as two
rollers.

The roll is **once per run, per template**, off `game.seed` mixed with the
template's id (`core/rng.ts`'s `seedFrom`). Per *offer* would mean the
Spyglass in the market and the Spyglass in the chest were different objects
with one name, that a screen re-entered showed different numbers, and that
every unacquired offer had to be persisted. Per run means a Spyglass is simply
what a Spyglass is in this world: the save goes on referring to items by id,
and the keep marks, the carry limit, the "already held" filters and the market
table all keep working untouched. A **per-template stream** rather than one
sequence walked in content order, so adding a thirty-first item does not
silently re-roll the other thirty for every save in existence.

The slots: **armor** (present only where the fiction carries it, always filled
when it is, taken first), **stat** slots (1–3 points each, never the same stat
twice), one **derived slot** (10–50% in tens), and **verbose** slots — a
conditional on how the fight is going, on where in the round the action falls,
or on what else is carried, never the same one twice. Two or three are filled,
armor counting as one. Every verbose effect has to **reach the fight**; that is
the standing bar for admitting one, and `adventure:sim --rank` is how it is
checked.

**One range per slot, not one per template.** Every slot's size is declared
beside the others in `model/modifierSlots.ts` — 1–3 stat points, 10–50% in
tens, **3–9 decaying armor on an item and 1–3 natural armor on a trait**, a
third of it because a point that survives a whole level is worth several that
do not. Armor was eight hand-written pairs in content for one release, which
is eight numbers to re-tune every time the damage curve moves.

What each kind's armor slot GRANTS follows from the kind and nothing else: an
item gets a pool of its own that wears as it absorbs, a trait gets armor decay
cannot touch. Which is why `tempered` (a floor under a decaying pool) and
`ward` (a second grant of natural armor) are both **items only** — a trait has
no pool to put a floor under, and its armor slot already *is* the ward.

**There is no "unspecified" state any more, and the machinery is gone with
it.** Five entries used to exist by NAME and carry a `tag` effect saying their
effect had not been decided, kept out of every pool that offers so a choice
between two of them could not happen. A template always rolls into something,
so the state cannot arise — and `isOfferable`, `UNSPECIFIED_TAG`, the `tag`
effect kind, `EffectiveProfile.tags` and `hasTag` are all deleted rather than
left standing over a case that cannot occur. The `tag` escape hatch never had
another user in its life; keeping it for the day something needs one is the
thing `model/effects.ts` says about its own vocabulary.

Effects come in two kinds, and the distinction is load-bearing: **passive**
(re-applied whenever the profile resolves) and **conditional** (fired only in
a matching `Situation` — below a fraction of hit points, or on the round's
first or last action). Conditionals are resolved in `resolveProfile` and
nowhere else, so there is one place a condition can be got wrong rather than
one per consumer. The round-position one needs a profile resolved *for one
action*, which only the fight knows: `stages/combat.ts`'s `actingProfile`
builds it, and `model/combat.ts`'s `roundActionPosition` reads the **round**
rather than one side's pool — read per side, an opener on Dodge (which only
ever fires on a monster's action) would be permanently switched off.

**Motes are a currency and a milestone at once**, and the two never interact:
the balance (`earned − spentOnTraits`) buys traits, while stat points read
`earned` alone, which is monotonic. So spending never slows the character and
hoarding never speeds it up; what moves is the threshold, pushed
`5 × pointsAcquired` further by each point taken. One running balance cannot
express that — subtracting a purchase from it would silently defer the next
stat point — which is why two numbers are stored and neither is derived from
the other.

**Armor is not a stat, and it belongs to the ITEM.** Every other stat is
static for a level; armor is *spent*. It is a pool **per item** carrying an
armor slot — its own points, its own maximum, its own decay floor — plus one
`natural` pool for everything decay cannot touch. Points live on the **holding
row** (`HoldingRow.armorPoints`, absent meaning full); the maximum and the
floor are properties of the item as this run rolled it and are never stored.
That is the whole of "drop the item and its armor goes with it": the row is
deleted and there is nothing to correct. A single `fromItems` pool was the
first version and could not say *which* item wore down, so a drop had to guess
how much of the pool went with it, and "restore each item to what its owner
maintains" had no *each* to act on.

Three moments, three different rules:

1. **An absorb** reduces the blow, and one piece may lose a point — the
   **fullest** piece still above its own floor, so a kit wears evenly rather
   than letting one big shield rot beside a pristine bracer.
2. **After a fight**, every piece is brought **up to** `(Might + Intellect) / 20`
   of its own maximum, plus whatever repairs the run carries. It is a ceiling,
   not a top-up: a piece already above the line keeps what it has, so the kit
   *settles onto* the condition its owner can maintain over a level. Applied at
   `advanceEncounter`, which is exactly the moment "after the fight" names and
   is already emitted by every stage that ends one — a `repairArmor` effect
   beside it would be a second statement of the same moment.
3. **A new level** makes every surviving piece whole again.

## What is built, and what is not

Built and exercised end to end: the director, the stack, the effect
vocabulary, the save and its sanitizer, stats, modifiers, armor, checks,
determinism, the mote model, the chrome contract, the two tuning sliders and
true mode (entry 90), **the four vectors** (build, tier, species, class, with
class moves reaching the fight), and the whole encounter chain — welcome,
character creation over five questions, region select, the hub, the hunt, the
round engine with its four defences, and the loot that pays for it. The two acquired-\* interludes are
GONE — what you carry belongs on the chrome, always visible, not behind a
permanent cell.

**Not built, on purpose**: exploring, charisma actions, special attacks and
spells. (Special encounters were on this list and are now REMOVED rather than
pending — the omen took what they were for; see `stages/encounterSelect.ts`.) Their rules are still being written, and the
platform routes them to a stage that says so *in the game* rather than
stubbing them with plausible behaviour. That is how the previous draft
acquired numbers nobody chose and then defended them.

**Now built**: the level's end. What survives is an ALLOWANCE per kind
(`keepAllowance`, one to start and raised by a fame unlock — entry 86),
marked by pressing pills on the strip — marks first, topped up with the
newest finds, so exactly `min(allowance, held)` are lit and each is true —
and everything else is given up, in the order the rules require: restore hit points against the maximum as it stands with everything
held, THEN release, and let `followMaxHitPoints` bring the pool down to the
new maximum, so a run always sets out full.

**Now built**: the level-start EXCHANGE, as an OUTPOST between the road and
the level (`stages/outpost.ts`, `stages/market.ts`) — the trader sells items
for gold, the Oracle sells traits for motes, six on the table and ten apiece,
and the outpost only stands there at all while one of the purses can pay. The
price was the piece the design did not specify and now does.

Stat points are spendable from the rail's STAR GAUGE, on any screen — which is
what "spendable at any time", the design's own wording, actually asks for (see
entry 75). Fame points are attained off the same ladder and are spent from the
CROWN GAUGE beside it, on the run's own shape: what it can carry and what
survives a level (entry 86).

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
6. **Intellect and Charisma — ANSWERED, and built** (`model/spells.ts`,
   `model/charm.ts`). Both are unlocks rather than curves, as the plan says,
   and what settled their shape was not a list but the PACE constraint: the
   default mode is attack, charm plays itself, and magic arrives as cells
   already sorted so the first one is the right one. See the design
   document's foot for the tables and entry 77 below for the machinery. The
   plan's own spell rule -- learned at a level's start, `2 x Intellect` picks
   -- is superseded by a per-round roll and is marked as such there.

   What is STILL open under this heading is the plan's **charisma actions**,
   the tier-and-usage table with `MONSTER_TYPE_CHARISMA_RESISTANCE` behind it.
   The three charm effects that exist are automatic and answer a different
   question ("what is true of this round"); a charisma ACTION is a cell the
   player presses, and whether the pace constraint leaves room for one at all
   is the author's call, not the code's.
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

    Fame is therefore the milestone, not a running total: what is WAITING is
    derived from the ladder (`famePointsAvailable`), `famePointsSpent` is
    behind you, and the run's score is the two added together — which is what
    `fameReached` computes and `bestFame` records, because spending your fame
    points must not cost you the score. Gold gained the same two-fields-not-one
    split motes have, for the identical reason: buying an item must not push
    the next fame point away.

    The threshold advances on the SPEND, not the attainment — hoard a point
    and the next is no closer. That was already the stat-point rule; naming
    it once made it a rule rather than a coincidence.

    **What a fame point BUYS is now written** (`model/famePurchases.ts`, entry
    86) and `allocateFamePoint` is no longer the only thing that spends one.
    Still unwritten, and deliberately so: the rates at which gold and
    experience are earned in the first place (open question 7). The
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
17. ~~**Difficulty choice.**~~ **ANSWERED — and not in the ring at all.**
    Two sliders in the options panel's ThockQuest section, see entry 90.
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
   **Special Encounter is superseded**: the cell was removed rather than
   built, and the omen (`model/specialEvents.ts`) is what stands in its
   place. The other two names stand.
32 where a level ends — **answered**: at the boss, encounter 10.
33 the narration format — **accepted**, to be adopted.
34 armor — **accepted** as a real extension, and now placed: it applies on
Defend and nowhere else.

29 is NOT answered — see below.

## Still open, and each one blocks something

**NEW, and measured against the commit before the vectors landed: FIGHTS GOT
TWO TO EIGHT TIMES LONGER, and the obvious lever does not fix it.**

Same sim, 200 runs, level cap 3, `7b170b8` (before) against the four vectors
(after):

| preset | died before → after | rounds per fight before → after |
| --- | --- | --- |
| Easy | 66% → **37%** | 4.0 → **33.4** |
| Medium | 95% → **71%** | 4.1 → **8.8** |
| Hard | 99% → 88% | 4.5 → 6.1 |
| Extreme | 100% → 96% | 4.3 → 4.9 |

The game got EASIER (a run gets five tier points at creation where an origin
gave two or three, and fame buys twenty-five more) and the fights got LONGER
with it — the old 4.0 rounds everywhere was not a short fight, it was a fast
death. A live playthrough agrees: around a hundred presses for one encounter
against the design's own pace constraint of **twenty actions a fight**.

**`BASE_DAMAGE` is the parameter its own comment says is expected to be
tuned, and it is not the lever.** Swept at 120 runs:

| BASE_DAMAGE | Easy rounds/fight | Easy died |
| --- | --- | --- |
| 10 (shipped) | 29.4 | 40% |
| 15 | 9.5 | 58% |
| 20 | 10.9 | 68% |
| 25 | 3.6 | 71% |
| 30 | 1.6 | 74% |

It shortens fights and costs almost twice the death rate doing it, because
speeding both sides up favours whoever has FEWER hit points and that is the
player: a character carries fifty to a hundred and thirty, while a monster
carries its own pool **times its pack size**. Fight length and difficulty are
not separable with one number while the two pools are that lopsided.

So this is not one constant to turn. It is the same question as the one
below, from the other end — what a stat is worth decides how much of a
monster a tier buys — and it wants deciding before anything is tuned.

**NEW, and it is what the four vectors made visible: THE SIX STATS ARE NOT
WORTH THE SAME, and the gap is about seven to one.**

A build is a set of weights over the six stats, so a build is worth whatever
the stats it weights are worth. That was always true and never legible,
because before the vectors everybody had roughly the same spread and an
origin nudged it. Now a build IS the spread, and the ranking reads straight
off it.

Measured, `--rank-vectors`, 50 runs on Medium to level 3 (encounters won,
mean — the baseline with nothing pinned is 10.2):

| build | what it weights | won |
| --- | --- | --- |
| Brooding | Intellect 2, Might 1 | **24.5** |
| Erudite | Intellect | **23.3** |
| Shrewd | Intellect 2, Charisma, Luck | 17.7 |
| Fleeting | Agility | 14.8 |
| Feral | Might, Agility | 12.8 |
| Journeyman | one of each | 9.9 |
| **Hulking** | **Might** | **7.4** |
| Blessed | Luck | 6.7 |
| Hawk-Eyed | Perception | 4.7 |
| Wayward | Luck 2, Agility, Charisma | **3.4** |

**The first reading of this was wrong and is corrected here**, because the
correction is the useful part. It looked like "damage reads only Might, so a
build that does not weight Might cannot hurt anything". Hulking is a pure
Might build and it comes SEVENTEENTH of twenty-five. The pattern is not about
Might at all:

- **Intellect and Agility buy ACTIONS or a way round the fight.** Magic
  cannot miss, cannot be dodged and goes through armour, and reaching one
  spell brings every weaker one; Agility buys more attempts per round.
- **Might, Luck and Perception all MULTIPLY ONE BLOW.** Might sets how big it
  is, Perception how reliably it lands and how tight its band, Luck how often
  it doubles — three stats competing to improve the same single event, in a
  fight decided by how many events you get.

So the question for the author is not the damage formula; it is **whether a
stat that scales one blow can ever be worth a stat that grants another
action**, and if not, what the three multiplier stats get instead. A live
playthrough shows the cost from the other end: a run weighted into the
multiplier stats spends **seventy presses** on one encounter, against the
design's own pace constraint of twenty actions a fight.

Three shapes it could take, none chosen — this is a RULES question and
therefore the author's:

1. The multiplier stats gain a second job apiece, so each buys something the
   others cannot (Perception an extra attempt, Luck an extra action on a
   crit, Might a threshold effect).
2. Magic and actions are brought down to where the multipliers are, rather
   than the multipliers up.
3. The stat table is left alone and BUILDS are constrained to shapes that mix
   a multiplier stat with an action stat — which gives up the vector as a
   free choice and is the weakest of the three.

Classes spread less and sit the right way round for the sim's "careful"
policy, which defends often: Duelist 20.0, Berserker 18.3, Warden 17.1 down
to Assassin 9.2 and Pyromancer 8.7 — the guard-and-riposte moves are ahead
because a riposte turns a defence into a free attack, which is again the
actions-versus-multipliers pattern. Species are the flattest of the three
(15.3 down to 6.5), which is the one of the four that looks roughly tuned.

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

40. ~~**Nothing chooses a difficulty.**~~ **ANSWERED, BUILT, and SUPERSEDED
    by entry 90** — the four presets and the settings screen below no longer
    exist; what stands is the pair of sliders. Kept because the ARGUMENT for
    two numbers is what entry 90 answers with a second slider. Four
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

41, 43, 46 and 47 are **answered and BUILT or recorded** — a pack is one
hydra with a shared pool (`model/monsters.ts`); a monster dodges if it can
and defends otherwise, and never elects to flee; and the highest usable
charisma tier is the character's Charisma, now stated in the plan rather than
inferred. (46 was about the TYPE SHIFT flooring at zero. **Superseded**:
there is no type shift — a rank is a tier, and a tier of zero splits to a
block of zeroes with nothing to floor.)

48 and 49 are **answered and BUILT** — the payout table is in the design
plan. (48 was "how many in a group". **Superseded** by the buddy roll: a
default group size no longer exists, because how many there are is drawn per
offer from the rank's own chances.) The ROUND ENGINE is built with
them (`model/combat.ts`): the turn-order roll, the four defences, the
exchange, the round's exits and what each one pays.

50 and 51 are **answered and BUILT** — the escalating loot/mote check
(`model/rewards.ts`) and the offer generator (`model/encounterOffers.ts`).
The "species table" they name is now the four vectors: an offer is a build, a
species, a class, a rank and a head count, and what a creature is called is
read off them rather than authored. See the design plan.

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

68. **A PILL CAN BE PRESSED, and that is the one place a mode is touched
    outside the ring.** The rule it bends — every gesture a mode has belongs
    in the ring — is real, and it holds for gestures: a gesture is a step in
    the game, and the ring is where the game is played. Marking an item to
    keep is not a step. The strip is what the run is CARRYING, the mark is a
    property of the thing carried, and it can be set at any time, changed
    freely, and costs nothing until the level ends. In the ring it would have
    become a screen, answerable only at the moment it is spent.

    The two BARS stay untouchable: they carry state and narration, and nothing
    on them is a thing you have. A pill is a `<span>` where it is a readout
    and a real `<button>` where it can be pressed — a span that listens for
    clicks is a button a keyboard cannot reach — and the cursor follows the
    element rather than the class, so nothing inert promises a press.

    The ring stays LEAN on purpose, and that is the author's own reason for
    bending their rule: it is an input device, and every selection forced
    through it loads it with things that could be settled with less effort
    elsewhere. The test is not "is this a choice" — it is whether the choice
    is a STEP in the game.

69. **Duplicates cannot exist.** Every effect a modifier carries is
    declarative, so a second copy is not a second object -- it is the same one
    applying twice, silently. The offer pools exclude what is held AND
    `acquireModifier` declines it, because an offer filter is a rule stated at
    one caller and the other pools are its siblings. It is also what lets a
    keep mark be a plain modifier id: an id names exactly one holding.

70. **A PUSHED STAGE CANNOT CHANGE ITS PARENT'S STATE**, and two features ran
    into it from opposite sides. `push` carries no `state` (core/stage.ts), so
    a stage that hands over cannot first record that it did.

    - **"What do you give up?"** cannot be a pushed stage: the parent would
      not have recorded that the offer was taken, so popping back would land
      on the same screen with the same offer still on it. It is a SHARED STEP
      instead (`stages/carry.ts`) — the acquiring stage keeps a `pendingId` in
      its own state and the module supplies the screen and the effects, so the
      flow stays where the flow's state already lives, and three acquiring
      stages cannot disagree about what happens when the hands are full.
    - **The market's six** cannot be the market's, for the mirror reason: a
      market that rolled its own table would roll a fresh one every time it
      was re-entered, which is a free reroll for the price of two presses. The
      OUTPOST rolls the stock and pushes it in, and a bought thing leaves the
      table by being HELD rather than by being struck off it — the same filter
      every pool uses. The parent's frame is untouched underneath, which is
      what makes leaving and returning show the same table.

    Read together: a `push` is right when the parent has nothing to record,
    and the thing to reach for otherwise is one stage's own state plus a
    shared helper — not a second frame that cannot talk back.

71. **"You cannot afford this" is an ABSENCE, never a refusal.** Choices are
    pre-resolved (core/stage.ts), so a cell in the ring is a thing that WILL
    happen. The trader's offers vanish the moment the purse drops below the
    price, and the outpost's door with them — verified live: nineteen gold
    bought one cape, and the nine left took every buy cell off the screen and
    the trader's door off the outpost.

72. **A CELL NAMES THE ACT, not the thing** -- "Drop Whetstone", "Lose
    Patient Hunter" -- because the ring's centre shows that label and nothing
    else while the dial sits on it. A list of the things you are carrying, on
    a screen that follows a purchase, reads as a second offer; the verb is the
    only thing saying which way round the question is. An item is DROPPED and
    a trait is LOST: you put one down, the other leaves you.

    The same screen offers a way BACK, and that it can is a property of the
    flow rather than a kindness: the offer is held as `pendingId` and nothing
    is paid or taken until the question is answered, so cancelling returns
    exactly the state that was there before. This screen shipped without one,
    on the reasoning that the choice had already been made -- which was wrong
    about its own design, and is the kind of claim a comment can carry for a
    long time unchallenged.

73. **THE KILL IS THE LAST LINE OF THE FIGHT, and it is shown on the SPOILS
    screen** -- `[you] [cross] [damage] [it]`, in the same four-part shape
    every other combat pill has, behind that screen's own opening line. The
    round's log is spent at the boundary (see 61), so the one thing worth
    carrying across it travels as the loot stage's input rather than as
    narration the next stage would overwrite.

74. **WHERE IN THE LEVEL YOU ARE IS A FACT ABOUT THE RUN, not about the
    stack.** The encounter counter was threaded from stage to stage as input,
    for two real reasons -- a stage cannot update its own state while pushing
    a child (see 70), and every stage in the encounter chain replaces the
    last at the same depth, so there is no parent frame to hold it. Both are
    facts about the STACK. The moment something OUTSIDE the stack had to read
    the number -- the identity pill, which now says `V-3` -- a threaded value
    could not answer, and the choice was between a second copy on the record
    for display or moving the one copy there. Two numbers that must agree and
    are not derived from each other is what this codebase is made of, so it
    moved: `GameRecord.encounterIndex`, advanced by an `advanceEncounter`
    effect emitted by whatever stage SPENT the encounter.

    It got smaller in the move. Four stages stopped carrying a number they
    only passed along, `underConstruction` stopped having to explain why it
    hands its input back unchanged (it emits no effect, so nothing advances),
    and the fled-encounter rule -- running still spends one -- became one
    effect on the flee path rather than a `+1` written at two call sites.

    The count advances on the way OUT of the spoils screen, not on the way
    into the next fight, and that is a display decision as much as a
    sequencing one: everything about the encounter just fought is behind the
    player, so the number they read is the one they are PREPARING for. It
    runs to eleven, which is how the hub knows the level is over; the chrome
    clamps to ten, because `V-11` in a level of ten reads as a bug.

75. **A GAUGE IS PRESSED TO REACH WHERE ITS POINTS ARE SPENT**, and that is
    the second place a mode is touched outside the ring (see 68). The
    argument is narrower than the pill's and worth keeping straight. A pill
    is pressed because marking a held thing is not a step in the game. A
    gauge press IS a step -- it puts a screen up. What keeps it honest is
    that it is not a DECISION: a gauge names a standing quantity, and
    pressing it goes to where that quantity is spent. The decision is still
    taken in the ring, on the screen the press opens.

    This is what finally made "spendable at any time" true rather than
    aspirational. The stat point was a cell on the hub, which could only mean
    "spendable when the level lets you"; putting that cell on every screen
    was never on offer, because a cell standing in a fight is a decision
    taken while a monster waits. The gauge is on every screen already,
    because it is chrome. The hub got a twelfth of its dial back.

    **Reachability moved the gate.** `allocateStatPoint` declines when the
    ladder has nothing waiting, but `adjustBaseStat` -- emitted beside it,
    because which stat is the game's business and the ladder is the
    platform's -- does not. A screen that offered its stat cells with nothing
    waiting would have handed out the stat for free, every press. The gate is
    now in the stage, where it belongs: with nothing waiting the only cell is
    the way back. A way back is itself new, and necessary -- arriving by
    pressing a gauge has to be undoable by choosing nothing.

    Both gauges lead somewhere whether or not anything is waiting. A control
    that appears only when it is useful is one the player cannot go looking
    for, and both screens are worth reading empty.

    The crown's screen is `Renown`. It was a placeholder that invented
    nothing while what a fame point buys was still open; the unlocks landed
    in exactly that stage the day they were decided (entry 86), which is what
    it was held open for.

76. **A TALLY UNDER A BAR SAYS WHAT IS WAITING, not what is behind you.**
    Both rail gauges carried the count SPENT, which is a true number nobody
    acts on -- and it sat directly under a bar filling toward exactly the
    thing the reader wanted to know about. Spending a point made the number
    go UP. It is now what is in hand, on both gauges, derived from the ladder
    like everything else about them. The stat-point readout on the tab bar
    went with it: the same number in two places on one chrome is two
    quantities to a reader.

77. **THE PACE CONSTRAINT IS THE DESIGN, and Charisma and Intellect are what
    it produced.** The author's own statement of it is at the foot of the
    design document and is worth reading before touching anything in a fight:
    a run is a dozen levels of ten fights of twenty actions, so a choice that
    costs ten seconds of thought is a choice that cannot exist. Everything
    below is that one sentence, applied.

    **Charisma never asks.** Three effects, rolled when the round opens,
    firing on the monster's own actions -- and the interception is rolled when
    the action is ARMED rather than when a defence is answered, because a
    charm rolled at answer-time would cost a press to learn that nothing
    happened. That is the whole of why it is free, and it is testable as a
    property: a talkative character is asked to defend fewer times over the
    same fights than a silent one.

    **Intellect deals a hand.** Availability collapses to ONE number
    (`spellReach`), because reaching a level brings every lower one with it --
    a set could express a hand the rule says cannot be dealt. Rolled once per
    ACTION, every time the player is about to act. It was once a round at
    first, alongside the charms, on the argument that the ring's first cell
    should not move under a fast player; that was the wrong trade, because a
    round that reached Meteor reached it for every action in the round and a
    Meteor STREAK is not what one chance in twelve buys. The charms stay per
    round: being under one is a property of the ROUND -- it is what the pill
    says, and what "lasts until the end of the round" means.

    **The order IS the recommendation.** Strongest spell first, then Attack,
    then Prepare. A player who presses the first cell every time is playing
    well, which is what a fight this long requires.

    **EVERY ACTIVE EFFECT STACKS.** A second Plague takes twice the share, a
    second Storm throws twice the bolt, a second Ignite burns twice as hot,
    and a second Prepare doubles every term of the next attack -- rider
    included, which comes down once per preparation. Three of them were flags
    first, on the reading that a condition is either on or off; that made a
    second cast a wasted action, which in turn made those cells something the
    ring had to WITHHOLD (on entry 71's argument, that a first cell which is
    sometimes a mistake is a fight the player has to read). Counting removes
    the special case rather than managing it: nothing is ever withheld for
    having been cast already, and `SpellKind` -- which existed only to tell
    the two apart -- is gone.

    **Prepare is the exception that proves it**: one decision, one
    consequence, and the one place the whole stat block is spent at once. The
    two stats that were worth nothing in a fight -- Charisma and Intellect --
    are the two that turn it into an event.

78. **A FIGHT NOW STEPS FORWARD ON ITS OWN, and the stage is a loop.** Until
    charms existed, every action either asked something or ended something, so
    `afterAction` could resolve one action and return. A charmed action does
    neither: it happens, it is worth a pill, and the fight is in exactly the
    position it was. `stepFight` advances through the end of a round, a new
    round opening, and any number of actions taken away from the monster,
    until it reaches a question or an ending. Recursing instead would have
    made "how many things can happen between two presses" a property of the
    call stack.

    Two consequences worth knowing. **The end of a round is an EVENT**: the
    lingering spells pay out there and either can finish the fight, so they
    land before the fight is asked where it stands. And their pills are
    CARRIED into the next round's log rather than left in the one being
    discarded, which is the only way the reader sees them at all.

    **A fight can now be over before it begins** -- a Doom on the opening
    action. `enter` cannot hand back a transition (entering a stage is not
    answering one), so the fight comes to rest on a finished state and one
    cell pays it out, with its words read from the status: "Withdraw" over a
    corpse is the one thing that screen must not say.

79. **EVERY NARRATION PILL CARRIES ITS OWN TOOLTIP**, which is its words and
    then ITS ARITHMETIC. The vocabulary already requires an icon to carry the
    word it stands for (`narrationMarkup.ts`), so the words cost nothing to
    keep in step; the working is what the fight actually did.

    An entry is a string and stays one: everything after the first newline is
    DETAIL (`splitNarration`), one line per fact. Narration is a `string[]`
    through the director, the save and the sanitizer, and a shape change there
    would ripple through all three to carry something only the renderer reads.
    A pill with nothing to explain is exactly the string it always was.

    **The numbers are the ones the fight USED, never recomputed.** A roll is a
    VALUE (`core/rng.ts`'s `Roll` -- `nextChance` is it with the working
    thrown away, defined in terms of it so the two cannot disagree about what
    "passed" means), carried out on `Blow.math` and on every model that rolls
    anything. A tooltip that derives its own answer from the stats is a
    tooltip that can disagree with the blow it is explaining, which is the one
    thing it must not do.

    One shape, everywhere: a roll reads `rolled|needed` as whole percentages
    -- "42|65" is "rolled 42, needed under 65" -- and a sum is written out
    with its terms (`Damage: 8 = 4 x 2 crit`). Where the pill's glyph is
    ambiguous the tooltip says so in words: a dodge and a miss wear the same
    mark, because both are "nothing arrived", so a dodged blow says it was
    dodged rather than leaving the absent hit roll to imply it.

80. **DAMAGE IS DRAWN, NOT FIXED** (`model/damageRoll.ts`). A blow's nominal
    is its ceiling; what arrives is drawn from a band below it whose width is
    `BASE_DAMAGE_SPREAD x (6 - perception) / 6`, best of `1 + luck` draws.

    Three things about it are worth knowing before touching a fight.

    **The band comes back LOW FIRST, always.** The spread goes negative past
    the base stat cap -- deliberately, so gear that carries Perception past
    what a run can reach buys damage instead of consistency -- and `1 -
    spread` is then above 1. Ordering it inside `damageBand` rather than at
    each caller is the whole reason that function exists: a caller that
    assumed `1 - spread` was the floor would sample the band backwards.

    **A band of no width is not drawn from.** Drawing anyway would spend the
    rng stream on an answer that cannot vary, and in a seeded game every roll
    after it shifts. So a character at the pivot takes ZERO draws, not one.

    **It reads the attacker's stats**, whoever the attacker is, which is the
    same invariant the thumb exists to protect. See the design document's
    foot for why, and for the one reading of the spec that would change it.

    It applies to attacks -- everything through `resolveExchange`, plus the
    Storm's bolt, which the spec defines as Singe's damage. Plague and Ignite
    are shares rather than blows and stay fixed.

    One defect it produced, caught live rather than by a test: the damage
    tooltip built its terms and then threw them away, because the short-form
    check tested `terms.length === 1` -- true whenever there was no crit and
    no armour -- instead of testing whether there had been a band. It read
    "Damage: 6" for a blow drawn from four to seven. The check is on the BAND
    now, which is what it was ever about.

81. **AN ITEM IS ROLLED FROM A TEMPLATE, once per run** (`model/itemSlots.ts`,
    `content/index.ts`'s `catalogFor`). The reasoning is in **The model**
    above; what belongs here is what it cost and what it settled.

    **The catalog stopped being a constant.** It was built once at import time
    in three places (the hook, the director's deps, the simulation harness),
    which would have described whichever game happened to be open first and
    gone on describing it forever. It is now a function of `game.seed`,
    memoized per seed, and `DirectorDeps` no longer carries one at all —
    `buildContext` resolves it, `applyEffect` resolves it, and neither can be
    handed the wrong one. `game.seed` existed already and was read by nothing:
    the field for this was sitting there.

    **`--rank` now measures a template**, averaged over the rolls each run made
    of it, which is a strictly better question than the one it answered about a
    hand-tuned item. Its pins are `{kind, id}` references rather than
    `Modifier`s, because outside one run there is no such object as "the
    Spyglass".

    **Measured, on Easy, 30 runs per row:** baseline 8.27 encounters won,
    every item between 8.67 and 26.23, every trait between 7.80 and 15.57.
    That gap is the finding: **the traits are now the weak half**, and
    revisiting their power against the rolled items is the next session's work.
    The run as a whole got easier in the right direction — on the same seeds
    and policy, Easy went from a 100% death rate and a median of 2 encounters
    won to 80% and a median of 4.

    **Two placeholders were filled, and they were the author's to fill.** The
    Bronze Talisman and the Nail Clipper carried `unspecified` tags. What an
    item does is no longer a number anybody chooses, so "unspecified" stopped
    being a state an item could be in; `isOfferable` now guards traits alone,
    and three of those are still in that state and still not ours.

82. **ARMOR MOVED ONTO THE ITEM**, and the reasoning is in **The model**. What
    is worth recording is the shape of the change: `Armor` became
    `{ natural, pieces }`, `setArmor` became points per item, `GameRecord.armor`
    was **deleted** rather than left unused, and the round's working copy
    serializes its pieces. A save written before the move carries a
    `fromItems` number and no pieces; there is no honest way to say which item
    those points were on, so the natural pool is read and the wear is lost —
    the generous direction, and the only one available.

    `armorDecayFloor` is now a property of the piece rather than a
    profile-wide maximum, which is what per-item pools made possible: the
    jerkin wears down to two and stops, and the bracer beside it does not
    inherit that.

83. **PREPARE WAS THE LAST THING WORKING IN A SECOND CURRENCY.** Its
    "+10% hit chance per point" added points to the chance while every other
    boost took a share of the remainder, so a prepared attack at Perception 6
    beside two accuracy items was a certainty. It is a keep factor now, like
    everything else. This is rule 4 of the doctrine in its usual shape: the
    rule was right at one caller and not at its sibling.

84. **TRAITS ARE TEMPLATES TOO**, and the change was almost entirely
    subtraction. The reasoning is in **The model** above; what belongs here is
    what it settled and what it cost.

    **Two lines of `SLOT_PLAN` are the whole difference between the kinds.**
    Everything else that could have forked — the roller, the effect
    vocabulary, the describer, the validator, the catalog, the reach rules for
    conditional effects — is shared, which is what "a rule stated once must
    hold everywhere" looks like when it is arranged in advance rather than
    repaired afterwards. `rollItem` became `rollModifier`, `ItemTemplate`
    became `ModifierTemplate`, `itemSlots.ts` became `modifierSlots.ts`.

    **Three complaints the content validator now makes, each found by reading a
    rolled catalog rather than by reasoning about one:**
    - a **trait that declares stats** declares something it has no slot to
      roll;
    - a **template that cannot reach two slots** rolls something thinner than
      the design says any modifier is. Naming FEWER options than its kind has
      slots for is fine and often deliberate — a Whetstone is Might and
      nothing else — so the check is on the capacity, not on each list's
      length;
    - a **trait naming `ward`** is naming its own armor slot twice, and a
      trait that rolled both came out carrying two identical `naturalArmor`
      effects. That one is the reason the armor slot's meaning is derived from
      the kind rather than declared per template: once it is, "what does a
      trait's armor slot grant" has exactly one answer and the duplicate is
      visible.

    **Measured (`--rank`, Easy, 30 runs per row).** Before traits were rolled,
    items ran 8.67–26.23 encounters won against a baseline of 8.27 and traits
    ran 7.80–15.57 — the gap this change was for. After: baseline 7.47, items
    11.50–26.33 (median 16.9), traits 6.47–15.53 (median 11.1). The traits
    moved up and the two halves still do not meet, which is defensible rather
    than finished — gear is bought with gold and there is far more gold in a
    run than there are motes, so an item SHOULD move the table further than a
    trait. Whether that is the right ratio is a tuning question and not a
    structural one.

    **One row is below the baseline, and it is worth reading before fixing.**
    Silver Tongue (6.47) buys `offerChoices` and `encounterChoices` and nothing
    a fight reads, so preferring it costs a pick and returns nothing the
    harness measures — the simulation's policies take the pinned thing whenever
    it appears and then choose by their own rule, which is exactly the rule
    more choices are supposed to improve. So the number is partly an artefact
    of the instrument, and tuning the trait against it would be tuning against
    the harness. Recorded rather than acted on.

85. **THE ARMOR RANGES ARE THE SLOT'S, NOT THE TEMPLATE'S** — 3–9 decaying,
    1–3 natural. Stated by the author, and worth recording because the first
    version had it the other way round: eight item templates each carrying
    their own `[min, max]`, which read as expressive (a big shield, a small
    bracer) and was in fact eight hand-tuned numbers in a file whose whole
    point is that it contains none. Every other slot declares one range for
    the game; armor does now too.

86. **WHAT A FAME POINT BUYS IS THE RUN'S SHAPE** (`model/famePurchases.ts`),
    and the two rules it raises were written as seams long before there was
    anything to put in them: `carryLimit` and `keepAllowance` have always
    been functions of the RUN rather than constants at their call sites,
    because the design said "a fame unlock is expected to raise it". The
    unlocks went in without touching either call site, which is what a seam
    is for.

    **FAME IS SPENT WITHIN A RUN**, which is a change of the author's: the
    original plan had it persist between runs. What persists instead will be
    a separate list of PERMANENT UNLOCKS, earned by what a run spent rather
    than carried over as currency — available origins at the start, and
    whatever else — and those are not written. Nothing here anticipates them
    beyond leaving the ceilings where a permanent unlock could later move
    them.

    **FOUR PURCHASES, TWO RULES, TWO KINDS** — a grid, so the table carries
    `rule` and `kind` columns rather than four bespoke entries: Strong Back
    (items carried, 1), Large Coffers (items kept, 2), Experienced (traits
    carried, 1), Stubborn (traits kept, 2). Carrying more costs one and
    keeping more costs two, because a carried modifier is lost at the level's
    end and a kept one is the only thing that compounds across a run.

    **THE CEILING IS ON THE RULE, NOT ON THE PURCHASE COUNT.** Six carried at
    once and three surviving a level is where the design puts the top of a
    run; expressed as "buy this three times" that ceiling would move silently
    the day a base value changed. Stated as a total, the base and the ceiling
    can each move without the other lying. It is clamped where the rule is
    read as well as gated where the purchase is made, because the list is
    PERSISTED: a save from another build must not be able to raise a rule
    past the design's top.

    **THE PURCHASE IS ONE EFFECT** (`buyFameUnlock`), price and grant
    together, so paid-but-not-granted and granted-but-not-paid are both
    inexpressible. The obvious alternative — the screen emitting
    `allocateFamePoint` once per point of the price and then a grant — is two
    facts a caller has to keep in step, and effects are applied against the
    state the last one left, so a two-point purchase attempted with one point
    waiting would take the point and hand the unlock over anyway.

    **THE RUN RECORDS WHAT IT BOUGHT AS A LIST, repeats and all** — one entry
    per purchase, the same rows-not-columns discipline `outcomes` uses: a
    fifth unlock is a new id and touches no schema, and an id a build no
    longer knows is ignored by the readers rather than crashing them.

    The screen gates as the stat-point screen does — it offers only what can
    be taken right now, so a cell on the ring is always live — and puts the
    WHOLE ladder, prices and standings, on the way-back cell's detail,
    because a player saving up needs to see what they are saving for. It
    STAYS on the screen after a purchase rather than popping, unlike a stat
    point: these come in fours at two prices, so several points in hand is
    usually several decisions, and being thrown back to the fight after each
    one would make the second cost a gauge press.

87. **AN ORIGIN IS A MODIFIER, AND UNLOCKS ARE DERIVED.** Two changes that
    arrived together because the second needs the first.

    **SUPERSEDED IN PART by entry 88 (the four vectors).** The origin is gone,
    split into a build, a species and a class; what survives unchanged is the
    ARGUMENT — that what a character IS arrives as a modifier layer above the
    base-stat clamp rather than being written into the block a run spends —
    and the permanent-unlock mechanism, which now gates a class. Read this for
    the reasoning and entry 88 for what the code does.

    **Origins stack.** An origin's gifts were applied at character creation as
    `adjustBaseStat`, which wrote them into the base block — and the base
    block is capped at six, so a Warrior's +2 Might was two of the player's
    own six points, spent for them before they chose anything. An origin is not
    progression, it is what you ARE, so it now sits where gear sits: the run
    records `originId`, and `originModifier` hands the resolver a Modifier
    built from the origin's own `effects`. Every run has all six points in
    every stat whatever it plays as, and a Warrior at the cap fights at 8.

    `Origin.statDeltas` became `Origin.effects`, in the MODIFIER vocabulary,
    which is what "like an item" means in code rather than by analogy: the
    Berserker's +100% damage and its no-worn-armour rule need no new
    declaration and no code at character creation — the same `describeModifier`
    an item's detail uses writes its tooltip.

    **The profile has ONE resolver now** (`resolveRunProfile`). Four call
    sites spelled out the same triple — base stats, held modifiers, holding
    counts — and an origin resolving with the modifiers would have had to be
    remembered at every one. That is this codebase's characteristic failure
    written out in advance, so the triple is a function: there is no way to
    resolve a run's profile without its origin in it. `armorIn` collapsed into
    `armorOf` in the same pass, being the same function with a different third
    argument once armour had to ask the profile whether worn gear counts.

    **`noDecayingArmor` is a CEILING, not a quantity**, which is why it is a
    flag: "minus all of it" would depend on what happened to be worn and could
    be out-added by a second piece. Natural armour is untouched by it, because
    the rule is about worn gear rather than about being hard to hurt.

    **Permanent unlocks are DERIVED after every effect**
    (`model/permanentUnlocks.ts`), never granted: no effect hands one out and
    no counter can disagree with the run that produced it — the argument the
    milestone ladders already make. The set is the union of what the save had
    with whatever the run now satisfies, so a new condition is covered without
    its author knowing this exists, the set can only grow (an unlock cannot be
    lost by a later effect making its condition false again), and there is no
    site to forget. A condition reads the RUN, not the save: an unlock earned
    across two runs would be a tally, which is the currency model this
    replaced, and the type cannot express one.

    The gate is in the STAGE, as every reachability gate here is: content says
    what an origin requires (`requiresUnlock`), character creation decides
    whether to offer it. An origin not yet earned is not on the ring at all.

    **The sim was lying, and that is worth recording.** Its "careful" policy
    judged health as `hitPoints / (50 + 15 * baseStats.might)` — the
    hit-point formula, copied — so the moment origins left the base block the
    denominator lost the origin's Might, health read too high, the policy
    stopped being careful, and the harness reported the GAME as having got
    harder (Easy's death rate 87% → 94%). It reads `deriveStats` through the
    real profile now and the numbers came back. An instrument that restates a
    formula measures the copy.

88. **REGIONS DECIDE WHAT CAN BE FOUND, AND THE OMEN IS WHERE THEY SAY SO.**
    Regions recorded a choice and did nothing with it. They now own the trait
    pool of the special event that stands before every mini boss and boss.

    **THE HEXAGON.** Six regions, thirty traits, each trait in two regions,
    ten per region: those four numbers are `30 x 2 = 60 = 6 x 10`, which is a
    2-regular graph on six vertices, whose only connected form is a ring. So
    the regions are laid in a ring and the traits are authored on the BORDERS
    between them -- six groups of five -- and a region is the two groups it
    lies between. Every constraint then falls out of the shape rather than
    being maintained by hand: ten per region because a region has two
    borders, two regions per trait because a border has two sides.
    `regionTraits.contract.test.ts` holds the arithmetic anyway, because the
    groups are hand-typed lists of ids and a typo that repeats one id and
    drops another keeps every count intact while quietly putting one trait in
    four regions.

    The shape buys the design something a flat assignment would not:
    NEIGHBOURS OVERLAP BY FIVE AND OPPOSITES BY NOTHING, so the world has a
    grain and travel is a decision. Each border is NAMED, and a region's two
    border names are its detail on the road screen -- ten trait names would
    cost more reading than the pace constraint allows, and the names are the
    honest short form because they are literally the groups.

    **THE OMEN IS A PHASE OF THE HUB, not a stage**, and that is the funnel's
    doing. Five stages route into `encounterSelect` (outpost, loot, combat
    either way, region select, the under-construction wall), so "go to the
    omen first when the next encounter is fixed" placed at each of them is
    five copies of one rule and the next route in would not know to ask.
    Placed in the hub it is asked once. A stage also cannot redirect on entry
    -- a transition comes from `resolve` -- so the omen as its own stage would
    mean showing the boss screen and pushing the omen off it, which is the
    wrong order, and the order is the whole point: you are given something
    before you are shown what it is for.

    Both screens belong to ONE entry: the boss and the omen's traits are
    drawn together in `enter`, and answering the omen is a `stay`. So the
    monster cannot change because you took a heal, and there is no marker on
    the record -- the stage's own state carries it, which is exactly what
    stage state is for.

    **THE RULES ARE THE MODEL'S** (`model/specialEvents.ts`): the rest is
    `10 + 2 x Might` so it is worth most to the character built around
    surviving; the traits are `2 + Intellect / 2`, which widens the choice
    rather than improving it. Both floor at zero, because a Berserker starts
    at -2 Intellect. Fewer traits than asked for is a real outcome, not a
    failure: the rest is always on the table, so the screen is never empty.

    Taking a trait with full hands goes through `stages/carry.ts` unchanged
    -- the same drop question loot asks, in the same words.

    **It moves the balance a long way**, as three free things a level should:
    Easy's death rate fell 88% -> 66% and the median run reached level 2.2
    rather than 1.6. That is the sim reporting the game, not itself, this
    time.

89. **THE FOUR VECTORS.** What a player or a monster IS is now exactly four
    things, each with one name and one way to affect what it is. The full
    account is in **The four vectors** above; this entry records what was
    decided and what it replaced.

    | vector | what it is | the ONE thing it does |
    | --- | --- | --- |
    | build | an adjective | weights over the six stats |
    | tier | a number | how many stat points those weights split |
    | species | a noun | non-stat modifier effects |
    | class | a noun | swaps one combat choice for another |

    **What was wrong before.** An origin carried stat gifts AND damage
    percentages AND an armour rule (entry 87 is the story of getting it half
    apart); a monster class carried stat deltas; a species carried stat
    deltas too; a rank carried a stat shift plus armour plus charisma
    resistance. Four names, three of them doing overlapping arithmetic. The
    author's own summary: *"with the berserker, I muddled things"* -- the
    Berserker was four vectors wearing one name, and is a CLASS now, because
    what is distinctive about a berserker is how they fight.

    **Largest-remainder apportionment**, not per-share rounding. "Five points
    distributed" has to hand out five; per-share rounding leaks six for six
    equal weights and would make the flattest build the strongest at every
    tier. It agrees with the design's worked example either way, so this was
    free.

    **Weights are non-negative**, because a negative weight shrinks the
    denominator and would make one stat's share depend on how bad you are at
    a third. A stat a build does not want gets no weight.

    **The vector rule is enforced, not remembered** (`validateContent`): a
    species may not carry a `statDelta`, a build may carry nothing but
    weights, a class may not touch the profile, no two builds may share a
    normalised ratio, and a move declared below an unconditional one for the
    same cell is an error. `ModifierEffect` is one union, so a type cannot do
    this -- and without it the first interesting monster puts two Might on a
    species and the vectors overlap again within a release. It found a real
    bug on its first run (the Juggler's Cascade was unreachable).

    **A move replaces a cell and never adds one**, is armed when the action
    comes up and stored by id, and names the cell it stands in for. A
    multi-strike move is a whole exchange per strike, which is what makes two
    blows at 60% a different thing from one at 120%.

    **Ranks became tiers and groups became a roll.**
    `MONSTER_TYPE_STAT_SHIFT`, `MONSTER_TYPE_ARMOR` and the "group" rank are
    deleted rather than left unused. Armour is the species'.

    **Creation deals six of each vector.** The ring holds twelve cells and
    the catalogue is two dozen builds; dealing is what every other offer in
    this game already does, and it makes two runs differ before the first
    fight.

    **A real bug came out of the wiring**: `actingProfile` in
    `stages/combat.ts` called `resolveProfile` directly with `game.baseStats`
    and the held modifiers -- the exact triple `resolveRunProfile` exists to
    stop anybody spelling out (entry 87) -- and so resolved a first-action
    bonus against a character who had never heard of the run's build or
    species. The one call site that most needed the vectors was the one that
    left them out. That is the characteristic failure, found again, one
    release after the resolver that was supposed to end it.

    **`--rank-vectors`** pins each build, species and class in turn. On its
    first run every row was identical, which is exactly the finding the table
    exists to report -- here about itself: the pin was landing before
    character creation had finished and the creation screens were overwriting
    it. With the pin moved past creation, every row moves, which is the
    statement that all three content vectors reach the fight.

    **What it is worth** is measured and written up as an open question above
    -- *the six stats are not worth the same* -- because that is what the
    table turned out to be about. Short version at 50 runs on Medium: builds
    spread 24.5 to 3.4, and it is NOT the Might-versus-the-rest split it
    first looked like (a pure Might build comes seventeenth of twenty-five).
    The stats that grant actions or bypass the fight beat the three that
    multiply one blow. **None of this is tuned.**

90. **THE TWO NUMBERS ARE SLIDERS NOW, AND TRUE MODE SAYS WHETHER THEY COUNT.**
    The four presets of entry 40 and the settings stage that offered them
    (`stages/settings.ts`, `SETTINGS_STAGE_ID`, the `setDifficulty` effect)
    are deleted. What replaces them is two sliders in the options panel's
    ThockQuest section, which is where every other thing a reader tunes
    already lives:

    | Slider | Range | Default | What it is |
    | --- | --- | --- | --- |
    | Difficulty | 1.01 – 1.25, step 0.01 | 1.01 | the base of `power = progression ^ level`, on monster hit points and damage (`model/difficulty.ts`). The FIELD is still `progression`, which is what the curve is; the slider is labelled for what a player is choosing. |
    | Luckiness | 0 – 1, step 0.05 | 0 | `successAdjust`, the thumb on the scale (`model/chance.ts`). **Named `Luckiness`, not `Luck`**: Luck is one of the six stats, where it buys damage draws, and one word for two unrelated dials is a collision a reader has no way to resolve. |

    **The preset's second number is gone and is not missed.** A preset was a
    (base, growth) PAIR, and the argument for the pair was that a growth
    factor alone can only move the late game — it does nothing about the
    first fight, which is where a run is actually lost. That argument was
    right, and the second slider is what answers it: the thumb is flat,
    immediate and reaches the very first roll. One slider bends the curve,
    the other lifts the whole line. A hidden third number doing half of each
    would be exactly the overlap the vectors were separated to end, so the
    level-zero multiplier is 1 and a monster at level zero is worth what its
    stats derive.

    Measured, at progression 1.01, over the sim's careful policy: luckiness
    0 / 0.2 / 0.4 / 0.6 gives deaths 92% / 57% / 12% / 0% and rounds per
    fight 4.0 → 1.7. The thumb turns out to be the pace lever too.

    **TRUE MODE decides whether a slider is an override or a commitment**,
    and it is one toggle under the two of them. Off (the default), the
    sliders are read at the ROLL and apply to the run already in progress —
    which is what makes them worth moving while a fight is on screen. On,
    a run is played at what it was CREATED with. Both are one read-time
    resolution, `runTuning` (`model/gameState.ts`), and never a write: the
    record keeps what the run began with either way, which is what lets true
    mode mean anything and what a future permanent unlock would read.

    **Both numbers are mixed into the run's seed** (`seedFrom(createSeed(now),
    "<progression>:<successAdjust>")`), so two runs begun at different
    settings are different runs and not the same one played differently.
    Two tests were recomputing `createSeed(1)` to predict a catalogue and had
    to be pointed at `activeGame(save).seed` instead — the same defect class
    as an instrument that restates a formula.

    **Turning true mode ON wipes an active run past level one** (`withTrueMode`
    clears the run, the holdings, the outcomes and the stack), because a run
    cannot be half-locked. That is guarded by a press and HOLD at
    `HOLD_COMMIT_MS`, the app's "I know this is not undoable" threshold, and
    the tooltip says which of the two a press will be before it is made.
    Turning it OFF costs nothing and is a plain click. `SAVE_VERSION` went to
    6.

91. **HOLDING SPACE PLAYS ON**, at a rate and to a boundary the reader sets
    (`model/autoAdvance.ts`, two more sliders in the same section: **auto
    advance**, five evenly spaced scopes from `nothing` to the end of the
    level, and **auto speed**, 50–1000ms in fifties, dead while the scope is
    `nothing`).

    **SPACE AND NOT ENTER** is the browser's doing: a native button fires its
    click from Enter on every auto-repeat keydown, at whatever rate the OS
    decides, and from Space only on RELEASE. Space is therefore the one key
    whose press and release the panel can see the whole of, and taking it
    over means `preventDefault` on the keydown — which is also what stops the
    native click arriving on release and pressing one extra cell.

    **THE RING KNOWS NOTHING ABOUT ROUNDS OR LEVELS.** A mode hands it an
    `EscapeMenuAutoAdvance` — an interval and an opaque `boundaryKey` — and
    the hold ends when the key it started with stops matching. `boundaryKeyFor`
    is the whole of the rule: a combat-only scope returns null outside a
    fight, which is what makes a round-scoped hold decline to start on a
    hub screen. The round number is read out of the combat frame's own state,
    never tracked beside it.

    **THE RELEASE IS A WINDOW-LEVEL FACT**, and this was found live. The ring
    re-deals its cells on every advance, so the focused cell unmounts and
    focus churns through `<body>` before the panel takes it back. A `keyup`
    bound to the ring can land somewhere else entirely, and the `blur` that
    first stood in for that case fired on the ring's OWN re-deal — which
    ended every hold after exactly one press (a level-scoped hold sat on one
    action for twenty-four seconds). The keyup is watched on the window in
    capture, together with the window losing focus, which is the one event
    that means no keyup is ever coming. Focus moving inside the app is not an
    end; the mode going away still is, in the effect that already owns that.
    Verified after the fix: a level-scoped hold at 50ms plays encounters 1
    through 10 and stops on the region choice at II-1.

    **A GUARDED PRESS AND ITS CLICK ARE ONE DECISION.** Cancelling a
    `pointerdown`'s default does NOT stop the click — Chromium suppresses the
    compatibility mouse events and dispatches `click` from the activation
    behaviour anyway. So the true-mode hold turned the mode on and the click
    behind it turned it straight back off. Re-asking the state in the click
    cannot fix that: the state is what the hold just changed, and React
    dispatches the click against the new closure. The press tells the click
    what kind of press it was, in a ref written on every `pointerdown`.

92. **A DESCRIPTION EXPLAINS ITSELF ONLY WHEN ASKED** (`model/modifiers.ts`'s
    `DescriptionStyle`). A fifth setting, `verboseDescriptions`, ON by
    default: a player meeting "+20% Accuracy" for the first time cannot know
    it is a share of the misses rather than twenty flat points, and that is
    the difference between an item worth taking and an item worth taking
    twice. Off once it has been read — it is then the same sentence at every
    fight forever, and it is what stopped a narration line fitting a narrow
    editor slot.

    | verbose | concise |
    | --- | --- |
    | `+2 Armor that cannot decay` | `+2 Natural Armor` |
    | `+2 Armor to every item after each fight` | `+2 Mending` |
    | `5 Armor, worn down as it absorbs` | `5 Armor` |
    | `-15% Dodge (of your dodges)` | `-15% Dodge` |
    | `+40% Accuracy (of your misses) on your last action of a round` | `+40% Final Accuracy` |
    | `+10% Damage per item (3 held: +30%)` | `+30% Damage` |
    | a move's `flavour`, which is a sentence | dropped |

    **THE STYLE IS ONE REQUIRED ARGUMENT, never a default.** A default means
    a call site that forgot it silently stays verbose, and this is the rule
    that has to hold at every describer or at none — rule 4, stated in a
    type. The director resolves it ONCE onto `StageContext.describe`
    (`descriptionStyleOf`), so no stage reads the setting and the seven call
    sites cannot disagree; making the argument required is what found all
    seven, since the compiler listed them.

    **NO SAVE_VERSION BUMP, and that is a decision rather than an oversight**:
    the sanitizer tests `verboseDescriptions !== false`, because absence has
    a right answer (true) and `=== true` would read every save written before
    this field as concise and flip a setting nobody touched. That is the
    `isDoubleSizeMode` failure in the other direction.

    **FLAVOUR IS NOT A DESCRIPTION** and is the one line the format rules
    below do not govern: it is a sentence, capitalised, with a full stop, and
    it says nothing about what a move does — which is exactly what concise
    exists to be rid of, so it appears in verbose only.

93. **HOW A DESCRIPTION IS WRITTEN IS A PROPERTY, NOT A HABIT**
    (`model/descriptionFormat.contract.test.ts`). Four rules, checked against
    every effect of every item, trait, species and build in the catalogue and
    every move of every class, in BOTH styles, so a content author gets them
    enforced without having read them:

    1. Stat and derived-value names are capitalised (Agility, Damage, Armor,
       Natural Armor, Hit points) — read from the label tables, so a renamed
       stat cannot fall out of the allowed set.
    2. Nothing else is capitalised at the front. A description is a phrase,
       and a row of capitalised phrases reads as sentences that have all lost
       their full stops.
    3. No trailing period, for the same reason.
    4. No `--`.

    The sweep also asserts that concise is strictly SHORTER in total and
    never longer, and that no player-facing description says "tier" at all.
    A/B'd: restoring one old string produces six named complaints.

94. **TIER AND BUILD ARE DIFFERENT KINDS OF FACT, and no longer share a pill.**
    A BUILD is how a character grows — a set of proportions, fixed at
    creation — and a TIER is how far they have come. They were one readout
    ("Tier -- Hulking Mertok Duelist"), which made the tier read as a
    property of the build.

    The tier pill is a bare figure now, labelled with the noun alone because
    the row composes `"<label>: <value>"` itself (a label carrying the figure
    too read as "Tier: 5: 5" — caught live, not by a test). The three content
    vectors get **NAMEPLATES**: a readout with NO VALUE, which
    `EscapeMenuReadout.value` now expresses as optional, drawn square on its
    icon alone with everything it has to say in the tooltip. That is what a
    name IS on a row of quantities. The build's tooltip carries its weights
    as REPEATED INITIALS — `Sly (AAP)` — which is the only place in a run
    they can be read; it works because the six stats have six distinct
    initials, and `vectors.test.ts` holds that, since a seventh starting with
    an M would print two builds the same.

    **Character creation shows a build's WEIGHTS and nothing else.** It
    showed what a build came to at the CURRENT tier, which made the ratio
    look like a consequence of the tier rather than the thing being chosen.
    `tierOf` and the tier in that screen's `screenKey` are deleted with it —
    the screen no longer varies with the tier, so the key must not claim to.

95. **ONE SEPARATOR BETWEEN TWO DESCRIPTIONS**: `"  |  "`, from a single
    constant used by the rendered row and by the accessible name alike
    (`EscapeMenuStatus.tsx`'s `DETAIL_SEPARATOR`), where a centre dot and a
    `", "` had been saying it differently. The spaces are IN the string
    rather than in a margin, because the accessible name is plain text and
    has no margins — a rule about what separates two descriptions has to hold
    in both renderings or it is two rules. `white-space: pre` on the span is
    what stops HTML collapsing them.

96. **"--" IS GONE FROM EVERYTHING A READER SEES**, and
    `shared/userFacingText.contract.test.ts` keeps it that way. It asks
    whether a string is reader-facing from its POSITION — anything in
    `src/adventure/`, anything in `electron/help/`, or a string landing in a
    `data-tooltip`/`aria-label`/`title`/`placeholder` — rather than from a
    list of files somebody has to keep joining, the same argument as
    `focusOwnership.ts`'s predicate replacing its allowlist. Parsed with the
    TypeScript compiler, because the distinction it rests on (a string
    literal versus a comment containing the same characters) is the one a
    regex cannot draw. **The source's comments keep `" -- "`**: the rule is
    about the product. Markdown rules of three or more hyphens are exempt and
    nothing else is. It found three tooltips a hand-written scan had missed
    on its first run.

97. **THE ARMOR FLOOR IS DELETED, as a stat and as a concept.** It overlapped
    two things that already existed without being either: natural armor is a
    point decay cannot touch, mending is points coming back, and a floor was
    a third rule about the same pool that had to be held in the reader's head
    alongside both. Gone: the `armorDecayFloor` effect kind, the `tempered`
    verbose slot that rolled it, the eight templates that named it, two
    validator rules, `armorSlotOf`'s second return field, `ArmorPiece.floor`,
    the `armorAmount` parameter `rollVerbose` carried only for it, and the
    one test that existed to assert it. Decay stops at zero, which is what a
    pool with no floor already meant — the test above it already asserted
    that an item pool wears to exactly zero while natural armor survives.

98. **HOW HURT YOU ARE IS THREE NAMED BANDS** (`model/health.ts`), and the
    boundaries are written in exactly one place:

    | band | holds | 
    | --- | --- |
    | `maimed` | below a third |
    | `injured` | below two thirds — **a maimed character is also injured** |
    | `healthy` | two thirds and up |

    What preceded it was four authored thresholds — `0.35` on one move, `0.4`
    on a species, `0.5` and `0.6` elsewhere — which is four different ideas of
    "hurt" in one game, none of them nameable on a pill and none comparable
    to each other.

    **NOT DISJOINT, and that is the author's own definition**: an effect that
    rewards being hurt should get MORE true as things get worse, so a Frenzy
    that stopped when you were nearly dead would quit at the only moment it
    was for. `healthy` is therefore exactly the complement of `injured`, and
    `modifierReach.test.ts` walks the whole hit-point range asserting a
    fraction is in one or the other and never in neither — the two constants
    are written separately and nothing else would keep them in step.

    `healthy` is REACHABLE because a new `hale` slot rolls it, on eight
    templates that are about staying whole (the armour pieces, and the traits
    whose idea is composure rather than desperation). A condition nothing can
    produce is a condition that does not exist.

    **A TARGET'S health is NOT built** and is named rather than silently
    missing. The author asked for `+100% Damage vs maimed`, and it cannot be
    written where this lives: a conditional percentage is folded into
    `resolveProfile`, which computes what a character is worth with no target
    in hand — the bar, character creation and the offer screens all resolve a
    profile with nobody to hit. A target band means moving that whole class of
    effect out of the profile and applying it at the BLOW. That is a real
    change to combat resolution and is not half-built here.

99. **A PER-HOLDING EFFECT STATES ITS RULE, never its running total.** It read
    `+15% Damage per item (2 held: +30%)`, and the parenthesis is wrong
    exactly where these are read most: at character creation nothing is held,
    so a real effect announced itself as `+0%` and looked like nothing at all.
    What an offer IS cannot depend on what you happen to be carrying when you
    look at it, and the carried count is on the bar anyway. That made
    `holdings` dead in both describers, so it is gone from them and from the
    seven call sites that were computing `holdingCounts` only in order to
    describe.

100. **CONCISE HAS A VOCABULARY FOR MOVES.** `describeMove` had the style
     threaded through it and used it only to drop flavour; its other eleven
     lines printed the same in both. Now:

     | verbose | concise |
     | --- | --- |
     | `4 strikes, 45% Damage each` | `Split (4x45%)` |
     | `50% of the hits turned critical` | `50% hit to crit` |
     | `35% of the misses gone` | `35% miss to hit` |
     | `strikes back for 50% of a blow` | `Vengeance (50%)` |
     | `costs them 1 Action` | `Stun (1)` |
     | `Armor does not see it` | `Magical` |
     | `2 Armor, this blow only` | `2 Block` |
     | `on the first action of a fight` | `on Engage` |
     | `on the first/last action of a round` | `Initial` / `Final` |
     | `every time` | nothing at all |

     **`Split` and `on Engage` rather than `Flurry` and `Ambush`**, which the
     author proposed and then changed: both are the names of real moves, and
     a term that also names one specific move reads as a cross-reference to
     it (`Ambush: 250% of a blow | Ambush`).

     The two round positions take the SAME adjectives an item's conditional
     percentage takes, because it is the same fact — reading it two ways
     because it arrived from two functions is this codebase's characteristic
     drift, stated as rule 4.

     An unconditional trigger says NOTHING in concise: "every time" is the
     absence of a condition, and printing it makes the reader check a line
     that can never differ. All 42 moves still describe as at least one line,
     which is checked rather than assumed.

     The terms are exported as `MOVE_TERMS` (and `ROUND_POSITION_WORD`) and
     `descriptionFormat.contract.test.ts` READS them, rather than keeping a
     second list of which capitalised words are proper names — the contract
     caught all five on its first run, which is what that list is for.

101. **"Hit points" is "Health"** everywhere a player reads it: the derived
     label, the tab bar's readout, a monster's detail. The field is still
     `maxHitPoints`, which is what it IS in the formula.

102. **A BLOW CAN READ ITS TARGET'S HEALTH**, through the door that already
     existed rather than a new one. `Situation` is the set of optional facts
     about the moment a profile is resolved in, and absence there already
     means "not in force" — so the opponent's health is one more field on it
     (`opponentHealthFraction`) and the effect names whose health it reads
     (`subject: 'self' | 'target'`). A target effect resolves to nothing on
     the status bar, at character creation and on every offer screen, because
     none of them has an opponent — exactly as a self-conditioned effect
     resolves to nothing with no hit points given. One rule, one door, one
     absence.

     A FRACTION rather than hit points, unlike the self side, and that
     asymmetry is honest: this character's maximum is derived right there from
     their own stats, and the opponent's is the opponent's business.

     **`actingProfile` LOST ITS SHORTCUT** (`stages/combat.ts`). It returned
     the unconditioned profile unless the action sat on a round's edge, which
     was true while the edge was the only thing the situation could decide.
     With a target in it, that early return would have silently dropped every
     `subject: 'target'` effect in the middle of a round — rule 4's exact
     shape. Resolving is arithmetic over a handful of modifiers, once per
     action. Verified: crit 0.500 with no foe, 0.750 against a hurt one,
     0.500 against a whole one.

     `MoveSituation` grew the same field, and `{ kind: 'targetHealth', band }`
     joined the triggers — `moveSituationFor` already computed both sides'
     health and picked one, so it now hands back both.

     Content: **Velkar** (+50% Crit vs injured), **Brannoch** (+60% Damage vs
     healthy), the Assassin's **Execute** (300% of a blow vs maimed, declared
     FIRST so it beats Backstab's roll) and the Templar's **Condemn** (vs
     healthy) — the mirror that makes a glass-cannon opener playable.

103. ~~**A MONSTER'S CONDITIONALS NEVER REACH IT.**~~ **FIXED in entry 107,
     and the reason given here for not fixing it was WRONG** — see there. The
     bug was real and the measurement stands; the diagnosis of what it would
     cost did not. Pre-existing and
     MEASURED rather than suspected: `buildMonster` calls `resolveProfile`
     with no situation at all, so every `derivedPercentWhileHealth` and
     `derivedPercentOnAction` on a monster species resolves against the
     default — `hurtFraction` 1 and neither round edge. A Ghoul built with its
     two `injured` effects and one built without them have identical `damage`
     and `maxHitPoints`. Ghoul and Lich are affected today; a `healthy` one
     would fire ALWAYS rather than conditionally. A Wolf effect written during
     entry 102 was REMOVED rather than shipped inert. See `TODO.md` for what
     would have to be true to fix it: a `Monster` would have to stop being a
     snapshot frozen at offer time.

104. **A TIER STARTS AT ZERO and is earned one per stat point AWARDED**
     (`statPointsEarned`), spent or not. An advancement is therefore worth two
     points — one apportioned by the build the moment it lands, one the player
     places wherever they like. Keying it off the SPEND would make a player
     saving a point weaker than one who spent theirs badly, which is a choice
     nobody should be punished for making carefully. Both halves stay derived:
     what was taken is on the record, what is waiting is read off the ladder.

     `MAX_PLAYER_TIER` is **`MAX_FAME_TIER`** now, because it never named a
     player's maximum again — a run's tier is base plus earned plus bought,
     and only the last of those three has a ceiling.

105. **THE GUARDIAN ANGEL** (`model/guardian.ts`) is what makes entry 104
     survivable: a hidden FLOOR under the run's luckiness, `LUCKINESS_INITIAL`
     60% on the first level, `LUCKINESS_INITIAL_DECAY` 20% less each level,
     gone by the fourth.

     **A FLOOR, not an addend**: it supersedes the reader's Luckiness slider
     only while it is higher, so somebody who turned theirs up never meets it.
     Adding instead would make the early game harder for a player who
     deliberately chose a high number, which is the opposite of what a floor
     is for. **Not a setting**, so true mode does not freeze it and free mode
     does not override it — it applies under both, after either answer.
     Invisible to the player on purpose: it is not a mechanic to play around,
     it is the game declining to be brutal before a run has anything to be
     brutal with.

106. **A NAMEPLATE IS AS TALL AS THE ROW ITS SIBLINGS DEFINE.** The three
     vector pills drew short: a `.tag-pill` is sized by its content, and a
     single icon's line box is shorter than a figure's. `align-self: stretch`
     against the flex line is the derivation — no pixel value to drift when
     `--ui-font-scale` moves, and no second opinion about how tall a readout
     is. Live: 21px, the same as all nine neighbours.

107. **A MONSTER IS A VIEW, NOT A RECORD — and entry 103's excuse was wrong.**

     Entry 103 said fixing it meant a `Monster` would "have to stop being a
     snapshot frozen at offer time", which "touches what the encounter
     persists". **Neither half was true.** A `Monster` is not persisted at
     all: `monsterFor` rebuilds it from the stored `EncounterOffer` — a
     handful of ids — on every call, three times in `combat.ts` alone. It was
     already recomputed per action. The only thing missing was that nobody
     told it *which moment it was being computed for*.

     The author put it better than either of my framings: a monster simply
     *has* the "200% damage vs maimed" property, and it kicks in when an
     attack is resolved rather than when the monster is created. Because the
     monster object is ephemeral, "rebuild it with the situation" IS "the
     conditional kicks in at resolution time" — the same statement.

     The fault was rule 4, exactly: **a conditional resolves against the
     moment** was stated for the player (`resolveRunProfile` takes a
     `Situation`, so `actingProfile` passes the live one) and not for its
     sibling (`buildMonster` had no such parameter, so it resolved against
     `{}` and the conditionals collapsed into their no-information answer).
     The fix is to give the monster the same door, not to build a second
     mechanism.

     `buildMonster` takes a `MonsterMoment`: the fight's damage taken, the
     action position, and the player's health fraction. Absent on the offer
     screens and in the hunt, where nothing has been swung at — the honest
     answer, and the same one the player's bar gets.

     **TWO PASSES inside `situationFor`, and the first is not waste**: the
     fight tracks a monster's wear as DAMAGE TAKEN, and turning that into hit
     points left needs the maximum the STATS derive — before any conditional
     has moved it. Otherwise an effect that raises hit points while maimed
     lifts the character out of the band that switched it on. `resolveProfile`
     already keeps exactly that discipline for the player; this is the same
     rule applied to the side that could not state it, because the caller has
     no maximum to divide by until the monster exists.

     **Measured, the same way the bug was.** A Ghoul at full health is
     unchanged (damage 20.2, 2 actions); at 70% health — inside `injured` —
     it is 36.4 damage and 3 actions, which is the +80% and +50% its species
     has always claimed. With no moment at all it reads 20.2 again. The Wolf's
     `vs maimed` effect, written for entry 102 and then removed rather than
     shipped inert, is back: 20.2 against a whole player, 36.4 against a
     maimed one. `monsterMoment.test.ts` holds the property in both
     directions and A/B's clean — two of its five fail without the fix.

     `combat.ts` assembles the moment once, in `monsterMoment`, rather than
     spelling the triple out at each of its three rebuild sites: a moment
     assembled correctly at two of three is the same defect one level down.

108. **A CLASS MOVE OUTRANKS THE CELL IT STANDS IN FOR.** The ring opens on
     its first cell, so the order of the defence screen IS the default a
     player holding Space presses through. It was `DEFENCES`' order with a
     move merely renaming whichever cell it replaced, which meant the plain
     Defend beat the thing the class was chosen FOR whenever the move landed
     on Flee or Take the hit. The rank is now Dodge, then any cell carrying
     an armed move, then the plain answers (`stages/combat.ts`'s
     `defenceRank`; ties keep `DEFENCES`' order, a sort being stable).
     PRESENTATION ONLY — `armDefenceMoves` still rolls in `defencesOffered`'s
     order, because that order is what keeps the seeded stream fixed, and a
     sort that reached it would make the rolls depend on what was rolled.

109. **EVERY STAT-DELTA CHANCE IS A HALVING CURVE, and an immunity is no
     longer expressible.** `base + perPoint x delta` walked off both ends and
     the clamp turned each end into an immunity: dodge was a flat 100% at ten
     points of Agility, crit was CERTAIN at eight of Luck and exactly ZERO two
     points down, and a charm check was strictly zero against any monster
     whose Intellect matched the player's Charisma. None of those is a corner
     — a mono-stat build at the base cap of six plus six of tier is at twelve
     against another build's nothing, so deltas past ten are ordinary play.
     The curve is

         u = delta + deltaShift
         u <= 0:  p = 0.5 x 2^(-deltaForce x |u|)
         u >  0:  p = 1 - 0.5 x 2^(-deltaForce x u)

     — one rule read from whichever side you are on: every `1/deltaForce`
     points of delta halves whichever of the two is LEFT. **It is the same
     arithmetic as `ChanceAdjustment`'s keep factors and as `pressThumb`**, so
     the base curve stopped being the one place in the game that worked
     differently from everything applied on top of it. Strictly inside 0..1 at
     every finite delta and monotone in it, so nothing clamps it and no clamp
     is hiding a mistake. **The thumb still reaches 1**, deliberately: a
     Luckiness of 1 means the player cannot fail, which is what that slider is
     for, and it is applied after this.
     **`deltaForce` is a shared 0.25** — four points to halve — chosen over
     the 0.5 first proposed because 0.5 made a two-point edge worth 75% and
     tracked nothing like the old curve in the range real fights sit in.
     **`deltaShift` moves the coin flip**: `p(-deltaShift) = 0.5` always. Four
     of the five checks sit at zero and are even money between equals; **crit
     is -4**, so a quarter at parity and even money only four points of Luck
     up, which is what keeps a crit a rarity rather than a contest.
     **THERE IS NO `base` FIELD** — a base and a shift are two ways to say one
     thing — and the cost of that is real: a reader could once read
     "50% + 5% a point" off the declaration and now cannot.
     `statChance.contract.test.ts` is the answer, stating every declaration's
     parity value and the whole table for the shared rate, so a tuning change
     has to come and edit it.
     **A REWARD CHECK IS NOT ONE OF THESE** and kept the straight line, under
     its own `LinearChance` in `model/rewards.ts`: it is uncontested (the
     fight is over) so there is no delta to answer, and `countRepeatedAwards`
     needs a chance ABOVE ONE with the repeat penalty coming off before
     anything clamps — a boss's 200% start is certain three times over, which
     a bounded curve cannot express. One name for two curve shapes was the
     thing to avoid.
     **CHARM'S FLOOR MOVED TO THE ROLL THAT ALWAYS HELD IT.** "A charisma of
     nothing is worth nothing" is `(0 - 0) / 12 = 0` in `rollCharms`, so no
     effect is ever up and the check never runs; the straight line stated that
     same floor a second time and paid for it with the Intellect immunity.
     Its test moved from the second roll to the first, having been asserting a
     state the game cannot reach.
     **`LIGHTNING_MAX_STRIKES` stopped being load-bearing** and stays: the
     chain now ends with probability one on its own, but "ends eventually" and
     "ends" are not the same promise to make about a loop in a pure function.
     **THE SIM COULD NOT MEASURE THIS**, and that is a finding about the
     instrument rather than about the change: it reports 94-98% death at every
     difficulty BEFORE the change as well as after, so the death rate is
     saturated and discriminates nothing. Entry 89 records Easy at 66% after
     the omen landed; something between then and now cost that and is worth
     its own session. The one signal that did move is rounds per fight, down
     roughly 10-15% (7.7 to 6.5 at x1.01): both sides land more often near
     parity, so fights resolve faster at the same damage per fight.


110. **A SLOT SHOWING THE GAME ALWAYS HAS A SCREEN.** Turning TRUE MODE on
     past level one wipes the run and clears the director stack with it
     (`withTrueMode`, entry 91) -- correctly, because a frame parked mid-fight
     against a run that no longer exists is the one thing the director cannot
     present. But an empty stack is exactly what `currentScreen` answers null
     to, and the effect that raises the entry screen fired on the view
     OPENING alone, so nothing put one back: the reader was left with an
     occupied slot drawing nothing, under a window control still lit for a
     game that was not on screen. The control was RIGHT -- the slot really was
     the adventure's -- so the fault was the missing screen, not the toggle.
     `useAdventureEscapeMenu`'s opening effect now also depends on "there is
     no screen", which is that impossible state stated directly. A DERIVATION
     rather than a call bolted onto the wipe, the same argument as the focus
     reconciler's: a future reason for the stack to empty is covered without
     its author knowing this exists. It depends on the one BOOLEAN and not on
     the save, because depending on the save re-runs after every choice --
     which is the failure `enterEntryScreen`'s own comment documents -- and
     `enterEntryScreen` is idempotent, so the one extra no-op run when the
     stack refills costs nothing. The start screen it puts up offers a NEW run
     rather than a resume, because `hasSuspendedRun` is read off the stack the
     wipe emptied.
