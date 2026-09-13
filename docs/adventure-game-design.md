# The adventure game — design contract

> **RESTORED.** This document was deleted by `5523f8f` ("Rebuild the
> adventure as a platform"), which treated it as a point-in-time record. It
> is not one: it is the source of truth for the game's RULES, and deleting it
> took six open questions out of the project's memory with it. It is back,
> with its specification text intact and only its MODULE PATHS corrected —
> every `rules/*` path in the original predates the rebuild.
>
> **Read this with [adventure-platform.md](adventure-platform.md).** They are
> not rivals and they do not overlap: this document says what the game's
> rules ARE, that one says how the platform underneath is BUILT. Where a rule
> here is not implemented, this document still stands and the code is what is
> behind.
>
> **Open questions live in ONE place** — adventure-platform.md's numbered
> list, which is what the project refers to by number. The list at the foot
> of this document has been folded into it; see the note there.

The game reached by right-clicking the User Guide window control. This
document is the source of truth for its RULES; `src/escapeMenu/escapeMenuContract.ts`
is the source of truth for how it reaches the screen. Read both before
changing either.

The rules live in `src/adventure/model/` (pure rules) and `src/adventure/core/` (the director) as pure functions over
serializable state — no React, no clock, no `Math.random` (the run carries
its own seed). That is not fastidiousness: a run is saved after every single
player action and must be replayable from its seed plus its inputs, or a
defect in it cannot be reported, only described.

## The shape of a run

A **run** is a sequence of **rounds**. Each round is a fixed sequence of
**steps** ending in a boss, with minibosses on the way (`model/` — NOT BUILT;
`STANDARD_ROUND_LAYOUT` is the specification's own example, and the only
layout today). A round runs through four phases, which are explicit states
because the ring can only ask one question at a time (`core/director.ts` + `stages/`):

```
outfitting ──► step ──► … ──► roundEnd ──► outfitting ──► …
                 │                  │
                 └──────► over ◄────┘
```

- **outfitting** — spend the round's experience and gold. One unit of
  experience buys one trait, one unit of gold buys one piece of gear, each
  chosen from `2 + Luck/2` offers. Offers are rolled *when each selection
  becomes current*, so a Luck bonus from the item just taken widens the next
  offer. Units are consumed as the queue is built, so a run saved midway
  through cannot spend them twice.
- **step** — the player picks from `2 + Perception/2` options. What those
  options *are* is content (see "The seam" below).
- **roundEnd** — keep **one** piece of gear and **one** trait. Everything
  else is discarded, *including whatever was kept last round*
  (`model/` — NOT BUILT; `releaseModifier` is the effect it will use). The carry-over is never a growing pile; it is
  exactly two things, chosen fresh from everything currently held.
- **over** — defeat (hit points reached zero) or retirement. Fame is the score.

## The stats

Five, declared in `model/stats.ts` and read by every formula through a
`StatBlock` — a sixth stat is an entry in `STAT_KEYS` plus a formula, not a
migration.

Base stats are capped at **6**; gear is what takes you past it. That is why
effective stats are computed in one documented order (`model/modifiers.ts`):

```
clamp(base, 0..6) → + gear/trait stat deltas → derive → × derived scales
                  → + derived deltas → normalize (counts whole, chances 0..1)
```

| Stat | Effects |
| --- | --- |
| Luck | offers per selection `2 + Luck/2`; crit chance `20% + 10%·Luck` |
| Might | hit points `50 + 15·Might`†; damage multiplier `50% + 15%·Might` |
| Perception | choices per step `2 + Perception/2` |
| Charm | spell casts per round `2 + Charm` |
| Agility | dodge chance `50% + 5%·Agility`; hit chance `50% + 5%·Agility` |

† The specification writes this one as `50 + 15·Resilience`, and there is no
Resilience in its list of stats. Implemented against Might, the stat it is
listed under. See the open questions.

**Stat checks** (`model/checks.ts`): roll a D6, add the encounter's
Difficulty Rating, and the check passes if the stat **matches or exceeds**
that total. The die is the opposition, not the player's contribution — the
inverse of the more common tabletop convention, and worth stating because
the two read identically in prose. A rating at or above the die's maximum
cannot be passed at all. The scene layer resolves its `check` outcomes
through this same function, so the game has exactly one check rule.

## Economy

- **Fame** — the score. Awarded by minibosses and bosses. Only goes up.
- **Experience** and **gold** — quantized units, spent one-for-one on the
  selections at the start of the next round.
- **Stat points** — roughly one per round, granted by the layout's `boon`
  step rather than by the round ending, so a round left early never quietly
  pays out.

## Enemies and combat

An enemy archetype is a *shape*, not a statline (`model/` — NOT BUILT): a band
of percentages applied to the round's base value, so "a brute is 140–180%
health" holds at round 1 and round 40. The base is
`10 · factor^round`, with the factor set once per run by the difficulty
preset — easy 1.01, medium 1.02, hard 1.05, insane 1.1 (`model/` — NOT BUILT).

Combat is *decided immediately* (`model/` — NOT BUILT): the player commits, and
is told how it went. That is a statement about the interface, not the maths
— the exchange still runs blow by blow (hit → crit → enemy answers unless
dodged), because that is what makes a stat point feel like anything, and
because the event log it returns is what an encounter's prose will be
written from.

## The seam

`core/director.ts` + `stages/` deliberately does **not** decide what an encounter is. A
step's content — the choices, their prose, whether one starts a fight or a
skill check — is supplied from outside and comes back as a single
`StepOutcome` (fame, units, damage, gear, traits, stat points, whether to
advance). That is the only way anything outside the rules changes a run.

Two content layers exist, and they are not rivals:

- the **run framework** (`rules/`) decides *which* encounter you face and
  what it pays out;
- the **scene layer** (`content/`) is one way an individual
  encounter's choices can be authored — a small branching graph with
  requirements, effects, weighted chance and stat checks. `The Long Margin`
  is currently wired up as the whole game; it will become one encounter's
  worth of authoring once the run framework is playable.

## Open questions

Folded into [adventure-platform.md](adventure-platform.md)'s numbered list,
which is the one the project cites by number. Six of them existed ONLY here
and were lost while this file was deleted: starting stats, the round
exponent, enemy accuracy, what defeat does, whether difficulty is chosen at
run start, and the absence of gear/trait content. They are questions 13-18
there now.

Two of this document's own questions have since been answered:

- **Resilience** is a leftover, not a sixth stat. Physical attack and
  physical defence are one stat, Might — which is why the hit-point formula
  was written under Might while naming Resilience.
- **Fame** is the stat-point ladder fed by gold, on identical numbers
  (`model/milestones.ts`).
